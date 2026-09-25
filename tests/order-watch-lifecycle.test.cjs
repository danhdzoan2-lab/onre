const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const owner='3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof',other='FxzLN1PTmdztV7PFBBL8XUo8WXBzgNMoK8ofLBhbkgtp';
const vault='9woPcp5X2aGZE6kZ9htFwepLDoeEi3WWcWZJZpmRYCXu',book='6o9P9WBeVn6eQcv7Z5LKdfSsy5KE4c1sv7N2qxh4k22d',now=Math.floor(Date.now()/1000);
const market={vaultAddress:vault,maturityDateUnixTs:now+10000,underlyingAsset:{mint:'mint'},orderbookAddresses:[book]};
const api={orderbook_address:book,vault_address:vault,user_address:owner,offer_idx:2,order_type:'buyYT',price_implied_apy:65000,created_at:new Date((now-100)*1000).toISOString(),expiry_at:new Date((now+1000)*1000).toISOString(),expiry_seconds:1100,original_amount:'500',tx_signature:'test'};
function fixture(storage){
 let sounds=0,notices=0,scans=0,load;
 const saved=new Map(Object.entries(storage||{})),nodes=new Map();
 class E{constructor(){this.children=[];this.dataset={};this.textContent='';}setAttribute(){}addEventListener(){}append(...xs){xs.forEach(x=>this.appendChild(x));}appendChild(x){if(x.parent)x.remove();this.children.push(x);x.parent=this;}insertBefore(x,b){if(x.parent)x.remove();const n=b?this.children.indexOf(b):this.children.length;this.children.splice(n,0,x);x.parent=this;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}}
 const ctx=vm.createContext({Date,Map,Set,Number,BigInt,Promise,ASSETS:{eusx:{label:'eUSX',mint:'mint'}},ExponentBook:require('../orderbook'),
 window:{addEventListener:(k,f)=>{if(k==='load')load=f;}},document:{createElement:()=>new E(),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new E());return nodes.get(id);}},
 localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},setInterval(){},getProxy:()=> 'proxy',apyDate:String,buyOrderApy:p=>100*Math.expm1(p/1e6),
 apyState:{markets:[market,{...market,vaultAddress:'second',maturityDateUnixTs:now+20000}],checkedAt:Date.now(),error:''},renderApy(){},renderBuyBooks(){},selectedAssets:new Set(['unrelated']),
 sound:()=>sounds++,notice:async()=>notices++});
 for(const file of ['limit-monitor.js','reward-range.js','order-watch.js','wallet-monitor.js'])vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..',file),'utf8'),ctx);
 const run=s=>vm.runInContext(s,ctx);ctx.owner=owner;ctx.other=other;ctx.api=api;ctx.market=market;ctx.mode='first';
 ctx.scan=async m=>{scans++;if(ctx.hold)await new Promise(resolve=>ctx.release=resolve);if(ctx.mode==='error')throw Error('offline');if(m.vaultAddress==='second'||ctx.mode==='empty')return {market:m,records:[],groups:[],checkedAt:Date.now()};
 const r=run("orderWatchRecord(api,market,'eusx')"),competitor={order:{...api,offer_idx:3}};
 return {market:m,records:[r],checkedAt:Date.now(),groups:[{apy:6.7,rows:ctx.mode==='solo'?[{order:api}]:ctx.mode==='behind'?[competitor,{order:api}]:[{order:api},competitor]}]};};
 run('scanWalletMarket=scan;startLimitAlarmAudio=sound;notifyLimitAlarm=notice;');
 return {ctx,run,load:()=>load(),saved,scans:()=>scans,sounds:()=>sounds,notices:()=>notices};
}
(async()=>{
 const f=fixture();f.run('walletMonitor.wallets.add(owner)');await f.run('pollOrderWatches()');assert.equal(f.scans(),0,'alarm OFF does not auto poll');
 await f.run('pollOrderWatches(true)');assert.equal(f.scans(),2,'manual scan covers all maturities');assert.equal(f.run('orderWatchState.records.size'),1);assert.equal(f.sounds(),0);
 f.run('limitState.enabled=true;limitState.options.buyPosition=true');await f.run('pollOrderWatches()');assert.equal(f.notices(),1);await f.run('pollOrderWatches()');assert.equal(f.notices(),1);
 f.run('stopLimitAlarm()');await f.run('pollOrderWatches()');assert.equal(f.notices(),1);
 const restored=fixture(Object.fromEntries(f.saved));restored.load();await restored.run('pollOrderWatches(true)');restored.run('limitState.enabled=true;limitState.options.buyPosition=true');await restored.run('pollOrderWatches()');assert.equal(restored.notices(),0,'ack survives reload');
 f.ctx.mode='error';await f.run('pollOrderWatches()');assert.equal(f.run('orderWatchState.records.size'),1);assert.equal(f.run('[...orderWatchState.records.values()][0].status'),'Stale');
 f.ctx.mode='first';await f.run('pollOrderWatches()');assert.equal(f.notices(),1,'stale did not rearm');
 f.ctx.mode='behind';await f.run('pollOrderWatches()');f.ctx.mode='first';await f.run('pollOrderWatches()');assert.equal(f.notices(),2);
 f.run('stopLimitAlarm()');f.ctx.mode='solo';await f.run('pollOrderWatches()');assert.equal(f.notices(),2);f.ctx.mode='first';await f.run('pollOrderWatches()');assert.equal(f.notices(),3);
 f.ctx.mode='empty';await f.run('pollOrderWatches()');assert.equal(f.run('orderWatchState.records.size'),0);assert.equal(f.run('limitAlarm.entries.size'),1,'closed order alarm latches');
 f.run("limitAlarm.entries.set('apy','gap alarm');removeMonitorWallet(owner)");assert.equal(f.run('limitAlarm.entries.size'),1);assert.equal(f.run("limitAlarm.entries.has('apy')"),true);
 const fresh=fixture();fresh.run('walletMonitor.wallets.add(owner);limitState.enabled=true;limitState.options.buyPosition=true');fresh.ctx.mode='empty';await fresh.run('pollOrderWatches()');fresh.ctx.mode='first';await fresh.run('pollOrderWatches()');assert.equal(fresh.notices(),1,'discover after empty');
 const split=fixture();split.run('walletMonitor.wallets.add(owner);limitState.enabled=true;limitState.options.sellPosition=true');await split.run('pollOrderWatches()');assert.equal(split.notices(),0,'Buy Position OFF suppresses a buy position alarm');split.run('limitState.options.buyPosition=true');await split.run('pollOrderWatches()');assert.equal(split.notices(),1,'enabling Buy Position evaluates the current fresh position');
 assert.equal(fresh.run('validMonitorWallet(owner)'),true);assert.equal(fresh.run("validMonitorWallet('invalid')"),false);assert.equal(fresh.run('addMonitorWallet(owner)'),false,'duplicate rejected');
 const legacy=fixture({'exponent-watched-buy-orders-v1':JSON.stringify({records:[{owner}]})});legacy.load();assert.equal(legacy.run('walletMonitor.wallets.size'),0,'no old wallet import');
 const race=fixture();race.run('walletMonitor.wallets.add(owner);limitState.enabled=true;limitState.options.buyPosition=true');race.ctx.hold=true;race.ctx.apyState.markets=[market];
 const pending=race.run('pollOrderWatches()');race.run('removeMonitorWallet(owner)');race.ctx.release();await pending;assert.equal(race.notices(),0);assert.equal(race.run('orderWatchState.records.size'),0);
 const multi=fixture();multi.run('walletMonitor.wallets.add(owner);walletMonitor.wallets.add(other);limitState.enabled=true;limitState.options.buyPosition=true');
 multi.ctx.apyState.markets=[market,{...market,vaultAddress:owner}];
 multi.ctx.scan=async m=>{const a={...api,user_address:m.vaultAddress===vault?owner:other,vault_address:m.vaultAddress};multi.ctx.currentApi=a;multi.ctx.currentMarket=m;
 return {market:m,checkedAt:Date.now(),records:[multi.run("orderWatchRecord(currentApi,currentMarket,'eusx')")],groups:[{apy:6.7,rows:[{order:a},{order:{...a,offer_idx:99}}]}]};};
 multi.run('scanWalletMarket=scan');await multi.run('pollOrderWatches()');assert.equal(multi.notices(),1,'multiple wallet alarms coalesce');assert.equal(multi.run('limitAlarm.entries.size'),2);
 multi.run('limitState.enabled=false;removeMonitorWallet(owner)');assert.equal(multi.run('limitAlarm.entries.size'),1,'removing wallet preserves other wallet alarm');assert.equal(multi.run('[...walletMonitor.alarmOwners.values()][0]'),other);
 console.log('PASS: wallet discovery, all maturities, empty-to-new, manual/OFF, dedup, Stop/reload, stale, 1/1, removals and races');
})().catch(e=>{console.error(e);process.exitCode=1;});
