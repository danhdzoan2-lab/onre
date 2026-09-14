const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),production=fs.readFileSync(path.join(root,'order-watch.js'),'utf8');
const bookAddress='ndAp6RJ1Q2wkoczCdXQteZk2UMnmDNWQDCCCKyLtymv',vault='y5UFEeB3LfUErLBjDMdZynAoqCwBgsMnDZSzth68aaH',owner='3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof';
const now=Math.floor(Date.now()/1000);
const api={orderbook_address:bookAddress,vault_address:vault,user_address:owner,offer_idx:2,order_type:'buyYT',price_implied_apy:65000,
  created_at:new Date((now-100)*1000).toISOString(),expiry_at:new Date((now+1000)*1000).toISOString(),expiry_seconds:1100,original_amount:'500',tx_signature:'test'};
const market={vaultAddress:vault,maturityDateUnixTs:now+10000,orderbookAddresses:[bookAddress]};
function fixture(gate=false,initial=null){
  let saved=initial,sounds=0,notices=0,reads=0,loaded;
  const nodes=new Map();
  class Element{constructor(){this.dataset={};this.children=[];this.events={};}append(...xs){for(const x of xs)this.appendChild(x);}appendChild(x){this.children.push(x);x.parent=this;}setAttribute(){}addEventListener(k,f){this.events[k]=f;}remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}}
  const el=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const offer={id:2,next:0,pricePointer:1,owner,side:2,virtual:0,created:now-100,expiry:now+1000,amount:200n};
  const book={vault,maturity:market.maturityDateUnixTs,priceDecimals:6,prices:[{id:1,price:65000,buyHead:2,buyTail:2}],offers:new Map([[2,offer]])};
  const snapshot={book,time:now,slot:123,checkedAt:Date.now()};
  const ctx=vm.createContext({Date,Map,Set,BigInt,Number,ExponentBook:require('../orderbook'),ASSETS:{sronyc:{label:'srONyc'}},selectedAssets:new Set(['other']),
    apyState:{error:'',checkedAt:Date.now()},window:{addEventListener(k,f){if(k==='load')loaded=f;}},document:{getElementById:el,createElement:()=>new Element()},
    localStorage:{getItem:()=>saved,setItem:(k,v)=>{saved=v;}},getProxy:()=> 'proxy',getOrderBookSnapshot:async()=>{reads++;return snapshot;},
    setInterval(){},buyOrderApy:raw=>100*Math.expm1(raw/1e6),apyDate:String,renderApy(){},escapeHtml:String,
    sound:()=>{sounds++;},notice:async(body,isRelevant)=>{if(!isRelevant||isRelevant())notices++;}});
  vm.runInContext(fs.readFileSync(path.join(root,'limit-monitor.js'),'utf8'),ctx);
  // Test-only substitution exercises the future enabled path; shipped source gate stays false.
  vm.runInContext(gate?production.replace('const ORDER_WATCH_PRIORITY_VERIFIED = false;','const ORDER_WATCH_PRIORITY_VERIFIED = true;'):production,ctx);
  const run=s=>vm.runInContext(s,ctx);
  run('startLimitAlarmAudio=sound;notifyLimitAlarm=notice;');
  ctx.api=api;ctx.market=market;run("const record=orderWatchRecord(api,market,'sronyc');const key=orderWatchKey(record);");
  return {ctx,run,book,snapshot,el,load:()=>loaded(),save:()=>saved,sounds:()=>sounds,notices:()=>notices,reads:()=>reads};
}
(async()=>{
  const gated=fixture();gated.run('orderWatchState.records.set(key,record);limitState.enabled=true;');await gated.run('pollOrderWatches()');
  assert.equal(gated.run('record.status'),'Unverified');assert.equal(gated.sounds(),0);assert.equal(gated.notices(),0);
  const f=fixture(true);f.run('orderWatchState.records.set(key,record);');await f.run('pollOrderWatches()');assert.equal(f.reads(),0,'OFF does not poll');
  f.run('limitState.enabled=true;');await f.run('pollOrderWatches()');
  assert.equal(f.run('record.status'),'At front');assert.equal(f.sounds(),1);assert.equal(f.notices(),1,'filtered token is still watched');
  await f.run('pollOrderWatches()');assert.equal(f.notices(),1,'no duplicate notification');
  f.run('stopLimitAlarm()');assert.equal(f.run('record.ack'),true);await f.run('pollOrderWatches()');assert.equal(f.notices(),1);
  const restored=fixture(true,f.save());restored.load();restored.run('limitState.enabled=true;');await restored.run('pollOrderWatches()');
  assert.equal(restored.notices(),0,'Stop acknowledgement survives reload and initial synchronization');
  f.snapshot.error='offline';await f.run('pollOrderWatches()');assert.equal(f.run('record.status'),'Stale');delete f.snapshot.error;
  await f.run('pollOrderWatches()');assert.equal(f.notices(),1,'unknown never rearms');
  const ahead={...f.book.offers.get(2),id:1,next:2,owner:'someone else'};f.book.offers.set(1,ahead);f.book.prices[0].buyHead=1;
  await f.run('pollOrderWatches()');assert.equal(f.run('record.status'),'Behind');assert.equal(f.run('record.ack'),false);
  ahead.amount=0n;await f.run('pollOrderWatches()');assert.equal(f.notices(),2,'behind then front rearms');
  f.run("limitAlarm.entries.set('apy-gap','APY still active');removeOrderWatch(key);");
  assert.equal(f.run("limitAlarm.entries.has('apy-gap')"),true,'Unwatch does not stop other alarms');assert.equal(f.run('orderWatchState.records.size'),0);
  const race=fixture(true);race.run('orderWatchState.records.set(key,record);limitState.enabled=true;');
  let release;race.ctx.getOrderBookSnapshot=()=>new Promise(r=>{release=r;});
  const pending=race.run('pollOrderWatches()');await race.run('pollOrderWatches()');
  race.run('removeOrderWatch(key)');release(race.snapshot);await pending;assert.equal(race.notices(),0,'no alarm for removed watch during fetch');
  const broken=fixture(true,'{invalid');broken.load();assert.equal(broken.run('orderWatchState.storageError'),true);
  console.log('PASS: release gate, disabled polling, filter-independent watches, latch/Stop/reload, stale recovery, Unwatch isolation and in-flight removal');
})().catch(e=>{console.error(e);process.exitCode=1;});
