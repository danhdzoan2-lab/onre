'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRuntime,validateConfig}=require('./runtime.cjs'),{AlarmEngine}=require('./engine.cjs'),{protect}=require('./vault.cjs');
const {COMMANDS,HELP,parseCommand,chunks,apyReport,orderReport,statusReport}=require('./commands.cjs');
const DEFAULT_RPC='https://wild-night-f072.amazygo1.workers.dev';
class MonitorService{
  constructor(directory,request=fetch){
    this.directory=directory;this.request=request;
    fs.mkdirSync(directory,{recursive:true});
    this.file=path.join(directory,'state.json');
    this.state={config:{version:1,wallets:[],buyPosition:false,sellPosition:false,rpc:DEFAULT_RPC,interval:5},paused:true,records:{},outbox:[],health:{},deliveries:{},updateOffset:0};
    if(fs.existsSync(this.file))Object.assign(this.state,JSON.parse(fs.readFileSync(this.file,'utf8')));
    // Restored Position state is not fresh until this process has resynchronized.
    for(const r of Object.values(this.state.records))r.positionFresh=false;
    this.token='';this.botName='';this.pairLink='';this.revision=0;this.markets=null;this.marketAt=0;this.marketRetry=0;this.sending=false;
    this.rewardState={campaigns:null,checkedAt:0,error:'',retryAt:0};
    this.setRuntime();this.ready=this.loadToken();
  }
  setRuntime(){this.runtime=createRuntime(this.state.config.rpc,this.request);this.engine=new AlarmEngine(this.runtime,this.state);this.snapshots=new Map();}
  async loadToken(){
    if(this.state.encryptedToken){try{this.token=await protect(this.state.encryptedToken,true);const me=await this.telegram('getMe',{});this.botName=me.username;}catch{this.statusError='Bot unavailable; check credentials or connection.';}}
    await this.ensureCommands();
  }
  async ensureCommands(){
    const chat=this.state.chatId,token=this.token;
    if(!chat||!token||this.menuBusy||this.menuOwner===chat||Date.now()<(this.menuRetry||0))return;
    this.menuBusy=true;
    try{
      await this.telegram('setMyCommands',{commands:COMMANDS,scope:{type:'chat',chat_id:chat}},10000,token);
      if(chat!==this.state.chatId||token!==this.token)return;
      await this.telegram('setChatMenuButton',{chat_id:chat,menu_button:{type:'commands'}},10000,token);
      if(chat===this.state.chatId&&token===this.token)this.menuOwner=chat;
    }catch(e){this.menuRetry=Date.now()+Math.max(60000,(e.retryAfter||0)*1000);}
    finally{this.menuBusy=false;}
  }
  save(){
    // Same-volume atomic replace: a crash never leaves a partly written JSON state.
    const temporary=this.file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(this.state),{mode:0o600});fs.renameSync(temporary,this.file);
  }
  async telegram(method,body,timeout=10000,token=this.token){
    if(!token)throw Error('Connect a Telegram bot first.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await this.request(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      const result=await response.json();
      if(!response.ok||!result.ok){const error=Error(response.status===429?'Telegram rate limited.':'Telegram request failed.');error.retryAfter=result.parameters?.retry_after||30;throw error;}
      return result.result;
    }catch(e){if(e.retryAfter)throw e;throw Error('Telegram unavailable; retrying.');}
    finally{clearTimeout(timer);}
  }
  async configureBot(token){
    if(typeof token!=='string'||!/^\d{5,20}:[\w-]{20,100}$/.test(token))throw Error('Enter a valid BotFather token.');
    const me=await this.telegram('getMe',{},10000,token),webhook=await this.telegram('getWebhookInfo',{},10000,token);
    if(webhook.url)throw Error('This bot has a webhook. Use a new dedicated bot.');
    const encrypted=await protect(token);
    this.revision++;this.token=token;this.botName=me.username;this.state.encryptedToken=encrypted;this.state.chatId=null;this.state.updateOffset=0;this.state.deliveries={};this.state.outbox=[];this.state.paused=true;
    this.menuOwner=null;this.menuRetry=0;this.createPair();this.save();
  }
  createPair(){
    if(!this.token||!this.botName)throw Error('Connect a bot first.');
    const code=crypto.randomBytes(24).toString('base64url');
    this.state.pairHash=crypto.createHash('sha256').update(code).digest('hex');this.state.pairExpires=Date.now()+600000;
    this.pairLink=`https://t.me/${this.botName}?start=${code}`;this.save();
  }
  sync(value){
    this.state.config=validateConfig(value,this.state.config);this.state.syncedAt=Date.now();this.revision++;this.setRuntime();
    this.engine.prune(this.state.config);if(!this.state.chatId)this.state.paused=true;this.marketAt=0;this.save();
  }
  options(value){
    if(!Number.isInteger(value.interval)||value.interval<2||value.interval>3600)throw Error('Enter a whole number from 2 to 3,600.');
    this.state.config.interval=value.interval;this.revision++;this.save();
  }
  pause(value){this.state.paused=value;this.revision++;this.save();}
  disconnect(){
    this.revision++;this.state.paused=true;this.state.chatId=null;this.state.encryptedToken=null;this.state.pairHash=null;this.state.pairExpires=0;this.state.outbox=[];this.state.deliveries={};this.token='';this.pairLink='';this.menuOwner=null;this.snapshots.clear();this.save();
  }
  view(){
    return {connected:!!this.state.chatId,botConfigured:!!this.token,botName:this.botName,paused:this.state.paused,config:this.state.config,syncedAt:this.state.syncedAt||0,checkedAt:this.state.checkedAt||0,
      pairLink:this.state.pairExpires>Date.now()?this.pairLink:'',status:this.statusError||'',health:Object.values(this.state.health).map(h=>({...h,label:this.runtime.assets[h.assetKey]?.label||'Markets'})),pending:this.state.outbox.length};
  }
  async loadMarkets(){
    if(this.marketFlight)return this.marketFlight;
    this.marketFlight=this.fetchMarkets();
    try{return await this.marketFlight;}finally{this.marketFlight=null;}
  }
  async fetchMarkets(){
    if(Date.now()<this.marketRetry)throw Error('Markets rate limited');
    if(this.markets&&Date.now()-this.marketAt<30000)return this.markets;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await this.runtime.withBookRequest(()=>this.request('https://app.exponent.finance/api/markets',{signal:controller.signal}));
      if(response.status===429){const header=response.headers.get('Retry-After');this.marketRetry=Date.now()+Math.max(1000,Number(header)*1000||Date.parse(header)-Date.now()||30000);throw Error('Markets rate limited');}
      if(!response.ok)throw Error('Markets unavailable');
      const result=await response.json();if(!Array.isArray(result)||result.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('Invalid markets');
      this.markets=result;this.marketAt=Date.now();return result;
    }finally{clearTimeout(timer);}
  }
  async loadRewards(){
    if(this.rewardFlight)return this.rewardFlight;
    const state=this.rewardState;
    if(Date.now()<state.retryAt||!state.error&&state.checkedAt&&Date.now()-state.checkedAt<5000)return state;
    this.rewardFlight=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      try{
        const response=await this.runtime.withBookRequest(()=>this.request('https://app.exponent.finance/api/orderbook-emissions/campaigns',{signal:controller.signal}));
        if(response.status===429){state.retryAt=Date.now()+Math.max(1000,this.runtime.apyRetryDelay(response.headers.get('Retry-After')));throw Error('Rewards rate limited');}
        if(!response.ok)throw Error('Rewards unavailable');
        const data=await response.json();
        if(!Array.isArray(data.campaigns)||data.campaigns.some(c=>!c||typeof c!=='object'||Array.isArray(c)))throw Error('Invalid rewards');
        state.campaigns=data.campaigns;state.checkedAt=Date.now();state.error='';state.retryAt=0;
      }catch{state.error='Rewards unavailable';state.retryAt=Math.max(state.retryAt,Date.now()+5000);}
      finally{clearTimeout(timer);}
      return state;
    })();
    try{return await this.rewardFlight;}finally{this.rewardFlight=null;}
  }
  async scanMarket(market,assetKey,config=this.state.config,runtime=this.runtime){
    const cache=this.snapshots,key=market.vaultAddress;
    const entry=cache.get(key)||{};
    if(entry.flight)return entry.flight;
    if(entry.data&&Date.now()-entry.at<2000)return entry.data;
    cache.set(key,entry);
    entry.flight=(async()=>{
      let data;
      try{data=await runtime.scanWalletMarket(market,assetKey,new Set(config.wallets));}
      catch{data={market,error:'Data unavailable'};}
      entry.data=data;entry.at=Date.now();
      if(!data.error&&data.checkedAt&&Date.now()-data.checkedAt<=12000){
        // Read-only report cache: never modifies alarm ACK or partial-fill baselines.
        entry.lastGood={...data,records:data.records.map(r=>{
          const groups=r.orderSide==='sell'?data.sellGroups:data.groups;
          const result=runtime.watchedGroupResult(r,{...data,groups,personalRecords:data.records});
          const prefix=groups?.flatMap(g=>g.rows).slice(0,result.position?.total||0);
          const verified=prefix?.length&&prefix.every(row=>row.position)&&result.front!==null;
          return {...r,groupPosition:verified?result.position:null};
        })};
      }
      return data;
    })();
    try{return await entry.flight;}finally{entry.flight=null;}
  }
  async commandText(command,revision){
    const runtime=this.runtime,config=this.state.config;
    if(command.error)return command.error;
    if(command.name==='help')return HELP;
    if(command.name==='status')return statusReport(runtime,this.state);
    if(command.name!=='apy'&&!config.wallets.length)return orderReport(runtime,[],command,config,this.state.paused);
    let markets,stale=false;
    try{markets=await this.loadMarkets();}catch{markets=this.markets;stale=true;}
    if(revision!==this.revision)return null;
    if(command.name==='apy')return markets?apyReport(runtime,markets,this.marketAt,stale,command.token):'⚠️ Market APY unavailable. Try again later.';
    // Do not mistake failed discovery for successful discovery of zero orders.
    let selected=markets?runtime.walletMarkets(markets):Object.entries(this.state.health).map(([vault,h])=>({assetKey:h.assetKey,market:{vaultAddress:vault,maturityDateUnixTs:h.maturity}}));
    selected=selected.filter(({assetKey})=>!command.token||command.token===assetKey);
    if(stale&&!selected.length)return '⚠️ Order data unavailable. Try again later.';
    // Reward estimates are queried only for commands, independently of alert data.
    // Failure never stops positions/fill monitoring or invalidates order snapshots.
    const rewardsFlight=selected.length?this.loadRewards():Promise.resolve(null);
    const bundles=[];
    for(let i=0;i<selected.length;i+=3){
      const batch=selected.slice(i,i+3);
      const results=stale?batch.map(({market})=>({market,error:true})):await Promise.all(batch.map(({market,assetKey})=>this.scanMarket(market,assetKey,config,runtime)));
      if(revision!==this.revision)return null;
      results.forEach((data,j)=>{
        const {market,assetKey}=batch[j];
        const failed=!!data.error||!data.checkedAt||Date.now()-data.checkedAt>12000;
        if(failed)data=this.snapshots.get(market.vaultAddress)?.lastGood||{market,checkedAt:0,records:Object.values(this.state.records).filter(r=>r.active&&r.vault===market.vaultAddress)};
        bundles.push({data,stale:failed,assetKey,market,marketCheckedAt:this.marketAt,marketStale:stale});
      });
    }
    const rewards=await rewardsFlight;
    if(revision!==this.revision)return null;
    return orderReport(runtime,bundles,command,config,this.state.paused,Date.now(),rewards);
  }
  async replyCommand(text,chat,revision){
    if(!text)return;
    for(const part of chunks(text)){
      if(revision!==this.revision||chat!==this.state.chatId||!this.token)return;
      await this.telegram('sendMessage',{chat_id:chat,text:part,reply_markup:{inline_keyboard:[[{text:'🌐 Open dashboard',url:'https://onre.vercel.app'}]]}});
    }
  }
  async handleCommand(message){
    if(message?.chat?.type!=='private'||String(message.chat.id)!==this.state.chatId||String(message.from?.id)!==this.state.chatId)return;
    const command=parseCommand(message.text,this.botName,this.runtime.assets);if(!command)return;
    const revision=this.revision,chat=this.state.chatId;
    const dataCommand=!command.error&&['buy','sell','orders','apy'].includes(command.name);
    if(dataCommand&&this.commandBusy)return this.replyCommand('⏳ Query in progress. Please wait.',chat,revision);
    if(dataCommand)this.commandBusy=true;
    try{await this.replyCommand(await this.commandText(command,revision),chat,revision);}
    catch{await this.replyCommand('⚠️ Query failed. Please try again.',chat,revision).catch(()=>{});}
    finally{if(dataCommand)this.commandBusy=false;}
  }
  async tick(){
    if(this.scanning||this.sending||this.state.paused||!this.state.chatId||!this.token||!this.state.config.wallets.length||!(this.state.config.buyPosition||this.state.config.sellPosition))return;
    this.scanning=true;const revision=this.revision,config=this.state.config,runtime=this.runtime,engine=this.engine;
    const oldBatches=new Set(this.state.outbox.map(b=>b.id));
    try{
      const markets=runtime.walletMarkets(await this.loadMarkets());
      if(revision!==this.revision)return;
      if(this.state.discoveryWarned)engine.queue([{kind:'health',text:'Market discovery recovered.'}],Date.now());
      this.state.discoveryWarned=false;this.state.discoveryFailedSince=null;
      this.statusError='';
      for(let i=0;i<markets.length;i+=3){
        const batch=markets.slice(i,i+3),results=await Promise.allSettled(batch.map(({market,assetKey})=>this.scanMarket(market,assetKey,config,runtime)));
        if(revision!==this.revision)return;
        results.forEach((outcome,j)=>{
          const {market,assetKey}=batch[j];const data=outcome.status==='fulfilled'?outcome.value:{market,error:'Data unavailable'};
          engine.process(data,assetKey,config);
        });
        engine.prune(config);this.save();
      }
      this.state.checkedAt=Date.now();this.save();
    }catch{
      this.statusError='Market discovery unavailable; old data retained.';
      this.state.discoveryFailedSince??=Date.now();
      if(!Object.keys(this.state.health).length&&Date.now()-this.state.discoveryFailedSince>=60000&&!this.state.discoveryWarned){this.state.discoveryWarned=true;engine.queue([{kind:'health',text:'Market discovery unavailable: Position and partial-fill monitoring interrupted.'}],Date.now());}
      for(const [vault,h] of Object.entries(this.state.health))engine.process({market:{vaultAddress:vault,maturityDateUnixTs:h.maturity},error:true},h.assetKey,config);
      this.save();
    }finally{
      if(revision===this.revision){
        const newBatches=this.state.outbox.filter(b=>!oldBatches.has(b.id));
        if(newBatches.length>1){this.state.outbox=this.state.outbox.filter(b=>oldBatches.has(b.id));engine.queue(newBatches.flatMap(b=>b.events),Date.now());this.save();}
      }
      this.scanning=false;void this.flush().catch(()=>{});
    }
  }
  currentEvents(batch){
    return batch.events.filter(e=>{
      if(!this.engine.allowedEvent(e,this.state.config))return false;
      if(e.kind!=='position')return true;
      const r=this.state.records[e.key];return r?.active&&r.positionFresh&&r.front&&!r.ack&&r.episode===e.episode&&!this.state.health[r.vault]?.error&&Date.now()-r.checkedAt<=12000;
    });
  }
  async flush(){
    if(this.sending||this.scanning||this.state.paused||!this.state.chatId||!this.token)return;
    this.sending=true;const revision=this.revision;
    try{
      while(this.state.outbox.length&&revision===this.revision&&!this.state.paused){
        const batch=this.state.outbox[0];if(Date.now()<batch.retryAt)break;
        const events=this.currentEvents(batch);
        if(!events.length){this.state.outbox.shift();this.save();continue;}
        // Telegram maximum text size: bounded chunks retain all coalesced events.
        const chunks=[];let text='OnRe · APY Alarm\n';
        for(const e of events){const line='\n'+e.text+'\n';if(text.length+line.length>3800){chunks.push(text);text='OnRe · APY Alarm (continued)\n';}text+=line;}chunks.push(text);
        if(events.length!==batch.events.length)batch.nextChunk=0;
        batch.events=events;this.state.deliveries[batch.id]=events;this.save();
        try{
          for(let i=batch.nextChunk||0;i<chunks.length;i++){
            if(revision!==this.revision||this.state.paused)return;
            await this.telegram('sendMessage',{chat_id:this.state.chatId,text:chunks[i],reply_markup:{inline_keyboard:[[{text:'Acknowledge',callback_data:'ack:'+batch.id},{text:'Open dashboard',url:'https://onre.vercel.app'}]]}});
            if(revision!==this.revision)return;
            batch.nextChunk=i+1;this.save();
          }
          this.state.outbox=this.state.outbox.filter(b=>b.id!==batch.id);this.statusError='';
          const ids=Object.keys(this.state.deliveries);if(ids.length>200)for(const id of ids.slice(0,-200))delete this.state.deliveries[id];
          this.save();
        }catch(e){if(revision!==this.revision)return;batch.attempts++;batch.retryAt=Date.now()+Math.max(e.retryAfter*1000||0,Math.min(300000,5000*2**Math.min(batch.attempts,6)));this.statusError='Telegram delivery delayed; retrying.';this.save();break;}
      }
    }finally{this.sending=false;}
  }
  async updates(){
    if(this.polling||!this.token)return;this.polling=true;const revision=this.revision;
    try{
      const updates=await this.telegram('getUpdates',{offset:this.state.updateOffset,timeout:25,allowed_updates:['message','callback_query']},35000);
      if(revision!==this.revision)return;
      for(const update of updates){
        this.state.updateOffset=update.update_id+1;
        const m=update.message,callback=update.callback_query;
        if(m?.chat?.type==='private'&&!this.state.chatId&&/^\/start [\w-]+$/.test(m.text||'')&&this.state.pairExpires>Date.now()){
          const hash=crypto.createHash('sha256').update(m.text.split(' ')[1]).digest('hex');
          if(hash===this.state.pairHash){this.state.chatId=String(m.chat.id);this.state.pairHash=null;this.state.pairExpires=0;this.pairLink='';this.state.paused=false;this.save();await this.telegram('sendMessage',{chat_id:this.state.chatId,text:'OnRe linked. Position and partial-fill alerts use your last synced Windows settings. Keep the PC awake and online. Use /help to view commands.'});void this.ensureCommands();continue;}
        }
        // Commit offset before asynchronous read-only work. Long queries must not
        // block Acknowledge callbacks or the next Telegram long poll.
        if(m){this.save();this.commandJob=this.handleCommand(m).catch(()=>{});}
        if(callback&&String(callback.message?.chat?.id)===this.state.chatId&&String(callback.from?.id)===this.state.chatId){
          const id=callback.data?.startsWith('ack:')?callback.data.slice(4):'';
          if(this.state.deliveries[id]){this.engine.acknowledge(this.state.deliveries[id]);this.save();await this.telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'Acknowledged on Telegram. Dashboard audio is unchanged.'});}
        }
      }
      this.save();
    }catch{this.botRetry=Date.now()+10000;}
    finally{this.polling=false;}
  }
  async test(){if(!this.state.chatId)throw Error('Link your Telegram account first.');await this.telegram('sendMessage',{chat_id:this.state.chatId,text:'OnRe test · Telegram notifications are connected. This message does not indicate a fill.'});}
  start(){
    let nextScan=0;
    this.timer=setInterval(()=>{
      if(Date.now()>=nextScan&&!this.scanning){nextScan=Date.now()+this.state.config.interval*1000;void this.tick().catch(()=>{this.statusError='Monitoring error; retrying.';});}
      if(Date.now()>=(this.botRetry||0))void this.updates().catch(()=>{});
      void this.ensureCommands();
      if(!this.scanning)void this.flush().catch(()=>{});
    },1000);
  }
  stop(){clearInterval(this.timer);}
}
module.exports={MonitorService};
