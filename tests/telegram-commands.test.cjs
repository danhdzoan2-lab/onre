'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MonitorService}=require('../companion/service.cjs');
const {COMMANDS,parseCommand,chunks,apyReport,orderReport}=require('../companion/commands.cjs');
const owner='Eo17ugMU4EtFUqi2189j6XLLrVcoWYKtQpJE29Yh1k3W',other='3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof';
const vault='7f1PgxY3kGsPqLAKpwcduZkcBEhpjMz7U1iJ4pcCCzDy',book='imv1h6xgX8GyiJjkBj5xvFxwWoB7sCyTGCi6yGK2bZt';
async function fixture(){
  const s=new MonitorService(fs.mkdtempSync(path.join(os.tmpdir(),'onre-commands-')),async()=>{throw Error('Fixture network disabled');});await s.ready;
  s.token='fixture';s.botName='FixtureBot';s.state.chatId='42';s.state.config.wallets=[owner];
  const seconds=Math.floor(Date.now()/1000),market={vaultAddress:vault,maturityDateUnixTs:seconds+10000,marketStatus:'active',underlyingAsset:{mint:s.runtime.assets.onyc.mint},orderbookAddresses:[book],impliedApy:.1255};
  const data=side=>{
    const api={id:'order-'+side,orderbook_address:book,vault_address:vault,user_address:owner,offer_idx:101,order_type:side==='sell'?'sellYT':'buyYT',price_implied_apy:118227,created_at:new Date((seconds-100)*1000).toISOString(),expiry_at:new Date((seconds+1000)*1000).toISOString(),expiry_seconds:1100,original_amount:'1000',amount_remaining:'1000',tx_signature:side+'-signature'};
    const record={assetKey:'onyc',book,vault,maturity:market.maturityDateUnixTs,owner,offerId:101,rawPrice:118227,created:seconds-100,expiry:seconds+1000,original:'1000',signature:api.tx_signature,orderSide:side,remainingYt:123.456,fillEvidence:{remaining:'800',slot:20}};
    const competitor={order:{...api,user_address:other,offer_idx:2,tx_signature:'other'},position:{index:1,total:2}},personal={order:api,position:{index:2,total:2}};
    const groups=[{apy:12.4,rows:[competitor]},{apy:12.5,rows:[personal]}];
    return {market,records:[record],groups:side==='buy'?groups:[],sellGroups:side==='sell'?groups:[],checkedAt:Date.now()};
  };
  s.loadMarkets=async()=>[market];s.marketAt=Date.now();
  return {s,market,data};
}
const message=text=>({text,from:{id:42},chat:{id:42,type:'private'}});
test('command parsing, token filters, bot mention and bounded replies',async()=>{
  const {s}=await fixture();
  assert.deepEqual(parseCommand('/SeLL@fixturebot srONyc','FixtureBot',s.runtime.assets),{name:'sell',token:'sronyc'});
  assert.deepEqual(parseCommand('/orders all','FixtureBot',s.runtime.assets),{name:'orders'});
  assert.equal(parseCommand('/buy@AnotherBot','FixtureBot',s.runtime.assets),null);
  assert.match(parseCommand('/sell NOTATOKEN','FixtureBot',s.runtime.assets).error,/Unknown token/);
  assert.match(parseCommand('/cancel','FixtureBot',s.runtime.assets).error,/Unknown command/);
  assert.equal(parseCommand('hello','FixtureBot',s.runtime.assets),null);
  const text=Array.from({length:120},(_,i)=>`Order ${i} · ${'x'.repeat(100)}`).join('\n');
  const parts=chunks(text);assert.ok(parts.length>1);assert.ok(parts.every(x=>x.length<=3800));assert.equal(parts.join('\n'),text);
});
test('only linked owner in private chat receives data; menu is scoped to owner',async()=>{
  const {s}=await fixture(),sent=[];s.telegram=async(method,body)=>(sent.push({method,body}),true);
  for(const m of [{...message('/help'),chat:{id:42,type:'group'}},{...message('/orders'),from:{id:43}},{...message('/apy'),chat:{id:43,type:'private'}}])await s.handleCommand(m);
  assert.equal(sent.length,0);
  await s.handleCommand(message('/help'));assert.match(sent[0].body.text,/\/sell srONyc/);
  await s.ensureCommands();await s.ensureCommands();
  assert.equal(sent.filter(x=>x.method==='setMyCommands').length,1);
  const menu=sent.find(x=>x.method==='setMyCommands');assert.deepEqual(menu.body.scope,{type:'chat',chat_id:'42'});assert.deepEqual(menu.body.commands,COMMANDS);
  assert.equal(sent.find(x=>x.method==='setChatMenuButton').body.menu_button.type,'commands');
});
test('menu registration failure backs off without disabling the bot',async()=>{
  const {s}=await fixture();let calls=0;s.telegram=async()=>{calls++;const e=Error('rate limited');e.retryAfter=120;throw e;};
  await s.ensureCommands();await s.ensureCommands();assert.equal(calls,1);assert.ok(s.menuRetry>Date.now()+100000);assert.equal(s.token,'fixture');
});
for(const side of ['buy','sell'])test(`${side} report shares front-to-personal positions; unverified/stale labels`,async()=>{
  const {s,data}=await fixture(),d=data(side),command={name:side};
  const report=orderReport(s.runtime,[{data:d,assetKey:'onyc'}],command,s.state.config,false);
  assert.match(report,/Position: 2 \/ 2 · Verified/);assert.match(report,/Remaining YT: 123.46/);
  const groups=side==='buy'?d.groups:d.sellGroups;groups[0].rows[0].position=null;
  assert.match(orderReport(s.runtime,[{data:d,assetKey:'onyc'}],command,s.state.config,false),/Position: — · Queue unverified/);
  d.records[0].groupPosition={index:2,total:2};
  const stale=orderReport(s.runtime,[{data:d,stale:true,assetKey:'onyc'}],command,s.state.config,false);
  assert.match(stale,/STALE — refresh failed/);assert.match(stale,/Position: 2 \/ 2 · STALE/);assert.doesNotMatch(stale,/· Verified/);
});
test('APY uses exact dashboard maturity selection, percentages and five-token order',async()=>{
  const {s,market}=await fixture();const report=apyReport(s.runtime,[market,{...market,vaultAddress:'earlier',maturityDateUnixTs:market.maturityDateUnixTs-100,impliedApy:.99}],Date.now(),false);
  assert.match(report,/ONyc · 12.55%/);assert.doesNotMatch(report,/99.00%|STRCx/);
  assert.ok(report.indexOf('ONyc')<report.indexOf('srONyc'));assert.ok(report.indexOf('eUSX')<report.indexOf('USX ·'));
  assert.match(apyReport(s.runtime,[market],Date.now()-100000,true,'onyc'),/STALE — refresh failed/);
});
test('manual orders while paused/OFF preserve alarms and fill baseline; shared flight',async()=>{
  const {s,market,data}=await fixture(),d=data('buy');s.state.records.persisted={ack:true,fillState:{remaining:'1000',slot:10}};
  const before=JSON.stringify(s.state);let release,reads=0;
  s.runtime.scanWalletMarket=async()=>{reads++;return new Promise(resolve=>release=()=>resolve(d));};
  const report=s.commandText({name:'orders'},s.revision);await new Promise(r=>setImmediate(r));
  const joined=s.scanMarket(market,'onyc');release();const [text]=await Promise.all([report,joined]);
  assert.equal(reads,1);assert.match(text,/Monitor paused/);assert.match(text,/2 \/ 2 · Verified/);assert.equal(JSON.stringify(s.state),before);
  await s.commandText({name:'buy'},s.revision);assert.equal(reads,1,'recent read is cached');
});
test('failure preserves old report, success empties it, removed wallet never leaks late response',async()=>{
  const {s,market,data}=await fixture();s.runtime.scanWalletMarket=async()=>data('sell');
  await s.commandText({name:'sell'},s.revision);s.snapshots.get(vault).at=0;s.runtime.scanWalletMarket=async()=>{throw Error('offline');};
  const stale=await s.commandText({name:'sell'},s.revision);assert.match(stale,/STALE/);assert.match(stale,/Order #101/);assert.doesNotMatch(stale,/No open personal orders/);
  s.snapshots.get(vault).at=0;s.runtime.scanWalletMarket=async()=>({market,records:[],groups:[],sellGroups:[],checkedAt:Date.now()});
  assert.match(await s.commandText({name:'sell'},s.revision),/No open personal orders found/);
  s.snapshots.get(vault).at=0;let release;const sent=[];
  s.runtime.scanWalletMarket=async()=>new Promise(r=>release=()=>r(data('buy')));s.telegram=async(method,body)=>sent.push(body.text);
  const pending=s.handleCommand(message('/buy'));await new Promise(r=>setImmediate(r));
  s.sync({...s.state.config,wallets:[]});release();await pending;assert.equal(sent.length,0);
});
test('command reply does not block callback processing; failed discovery is not empty',async()=>{
  const {s}=await fixture();let release,ack=false;
  s.commandText=async()=>new Promise(r=>release=()=>r('read-only result'));
  s.state.deliveries.batch=[];s.engine.acknowledge=()=>{ack=true;};
  s.telegram=async(method)=>method==='getUpdates'?[
    {update_id:1,message:message('/orders')},
    {update_id:2,callback_query:{id:'cb',data:'ack:batch',from:{id:42},message:{chat:{id:42}}}}
  ]:{};
  await s.updates();assert.equal(ack,true);assert.equal(s.state.updateOffset,3);release();await s.commandJob;
  const {s:offline}=await fixture();offline.loadMarkets=async()=>{throw Error('offline');};
  assert.match(await offline.commandText({name:'orders'},offline.revision),/Order data unavailable/);
  assert.match(await offline.commandText({name:'apy'},offline.revision),/APY unavailable/);
});
