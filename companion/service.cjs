'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRuntime,validateConfig}=require('./runtime.cjs'),{AlarmEngine}=require('./engine.cjs'),{protect}=require('./vault.cjs');
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
    this.setRuntime();this.ready=this.loadToken();
  }
  setRuntime(){this.runtime=createRuntime(this.state.config.rpc,this.request);this.engine=new AlarmEngine(this.runtime,this.state);}
  async loadToken(){
    if(this.state.encryptedToken){try{this.token=await protect(this.state.encryptedToken,true);const me=await this.telegram('getMe',{});this.botName=me.username;}catch{this.statusError='Bot unavailable; check credentials or connection.';}}
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
    this.createPair();this.save();
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
    this.revision++;this.state.paused=true;this.state.chatId=null;this.state.encryptedToken=null;this.state.pairHash=null;this.state.pairExpires=0;this.state.outbox=[];this.state.deliveries={};this.token='';this.pairLink='';this.save();
  }
  view(){
    return {connected:!!this.state.chatId,botConfigured:!!this.token,botName:this.botName,paused:this.state.paused,config:this.state.config,syncedAt:this.state.syncedAt||0,checkedAt:this.state.checkedAt||0,
      pairLink:this.state.pairExpires>Date.now()?this.pairLink:'',status:this.statusError||'',health:Object.values(this.state.health).map(h=>({...h,label:this.runtime.assets[h.assetKey]?.label||'Markets'})),pending:this.state.outbox.length};
  }
  async loadMarkets(){
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
        const batch=markets.slice(i,i+3),results=await Promise.allSettled(batch.map(({market,assetKey})=>runtime.scanWalletMarket(market,assetKey,new Set(config.wallets))));
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
          if(hash===this.state.pairHash){this.state.chatId=String(m.chat.id);this.state.pairHash=null;this.state.pairExpires=0;this.pairLink='';this.state.paused=false;this.save();await this.telegram('sendMessage',{chat_id:this.state.chatId,text:'OnRe linked. Position and partial-fill alerts use your last synced Windows settings. Keep the PC awake and online.'});}
        }
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
      if(!this.scanning)void this.flush().catch(()=>{});
    },1000);
  }
  stop(){clearInterval(this.timer);}
}
module.exports={MonitorService};
