'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRuntime,validateConfig}=require('../companion/runtime.cjs'),{AlarmEngine}=require('../companion/engine.cjs');
const owner='Eo17ugMU4EtFUqi2189j6XLLrVcoWYKtQpJE29Yh1k3W',other='3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof';
const vault='7f1PgxY3kGsPqLAKpwcduZkcBEhpjMz7U1iJ4pcCCzDy',book='imv1h6xgX8GyiJjkBj5xvFxwWoB7sCyTGCi6yGK2bZt';
function fixture(side='buy'){
  const runtime=createRuntime('https://example.com/rpc'),state={},engine=new AlarmEngine(runtime,state),now=Date.now(),seconds=Math.floor(now/1000);
  const market={vaultAddress:vault,maturityDateUnixTs:seconds+10000,orderbookAddresses:[book]};
  const api={id:'a',orderbook_address:book,vault_address:vault,user_address:owner,offer_idx:101,order_type:side==='buy'?'buyYT':'sellYT',price_implied_apy:118227,created_at:new Date((seconds-100)*1000).toISOString(),expiry_at:new Date((seconds+1000)*1000).toISOString(),expiry_seconds:1100,original_amount:'1000',amount_remaining:'1000',tx_signature:'signature'};
  const record=()=>vmRecord(api),vmRecord=o=>{const r={assetKey:'onyc',book:o.orderbook_address,vault:o.vault_address,maturity:market.maturityDateUnixTs,owner:o.user_address,offerId:o.offer_idx,rawPrice:o.price_implied_apy,created:seconds-100,expiry:seconds+1000,original:String(o.original_amount),signature:o.tx_signature,orderSide:side};return r;};
  const config={version:1,wallets:[owner],buyPosition:true,sellPosition:true,rpc:'https://example.com/rpc',interval:5};
  function data({behind=false,solo=false,amount='1000',slot=1,error=false,unverified=false,empty=false}={}){
    const r=record();r.fillEvidence={remaining:amount,slot};
    const personal={order:api,position:unverified?null:{index:behind?2:1,total:solo?1:2}},competitor={order:{...api,user_address:other,offer_idx:2,tx_signature:'competitor'},position:{index:behind?1:2,total:2}};
    const rows=solo?[personal]:behind?[competitor,personal]:[personal,competitor];
    return {market,records:empty?[]:[r],groups:side==='buy'&&!empty?[{apy:12.5,rows}]:[],sellGroups:side==='sell'&&!empty?[{apy:12.5,rows}]:[],checkedAt:Date.now(),error:error?'offline':''};
  }
  return {runtime,state,engine,market,api,record,config,data,now,key:runtime.orderWatchKey(record())};
}
for(const side of ['buy','sell'])test(`${side}: positions, acknowledgments, fills, stale and restart`,()=>{
  const f=fixture(side);f.engine.process(f.data({behind:true}), 'onyc',f.config,f.now);assert.equal(f.state.outbox.length,0);
  f.engine.process(f.data({slot:2}), 'onyc',f.config,f.now+1);assert.equal(f.state.outbox[0].events[0].kind,'position');
  const event=f.state.outbox[0].events[0];f.engine.acknowledge([event]);
  f.engine.process(f.data({error:true,amount:'700',slot:3}), 'onyc',f.config,f.now+2);assert.equal(f.state.records[f.key].ack,true);
  f.engine.process(f.data({amount:'800',slot:3}), 'onyc',f.config,f.now+3);assert.equal(f.state.outbox.at(-1).events[0].kind,'fill');assert.match(f.state.outbox.at(-1).events[0].text,/20.00%/);
  const before=f.state.outbox.length;f.engine.process(f.data({amount:'800',slot:4}), 'onyc',f.config,f.now+4);assert.equal(f.state.outbox.length,before);
  f.engine.process(f.data({amount:'900',slot:5}), 'onyc',f.config,f.now+5);f.engine.process(f.data({amount:'800',slot:6}), 'onyc',f.config,f.now+6);assert.equal(f.state.outbox.length,before,'increased quantity cannot create a false decrease');
  const restored=JSON.parse(JSON.stringify(f.state)),engine=new AlarmEngine(f.runtime,restored);
  engine.process(f.data({amount:'800',slot:7}), 'onyc',f.config,f.now+7);assert.equal(restored.outbox.length,before,'baseline and ack survive restart');
  engine.process(f.data({behind:true,amount:'800',slot:8}), 'onyc',f.config,f.now+8);engine.process(f.data({amount:'800',slot:9}), 'onyc',f.config,f.now+9);assert.equal(restored.outbox.at(-1).events[0].kind,'position');
  engine.acknowledge([event]);assert.equal(restored.records[f.key].ack,false,'an old callback cannot acknowledge a new position episode');
});
test('1/1, unverified queues, defaults and timed reminders',()=>{
  const f=fixture();f.engine.process(f.data({solo:true}), 'onyc',f.config,f.now);assert.equal(f.state.outbox.length,0);
  f.engine.process(f.data({unverified:true,slot:2}), 'onyc',f.config,f.now+1);assert.equal(f.state.outbox.length,0);
  f.engine.process(f.data({slot:3}), 'onyc',f.config,f.now+2);assert.equal(f.state.outbox.length,1);
  f.state.outbox=[]; // Simulate successful delivery before testing the reminder timer.
  const beforeReminder=f.data({slot:4});beforeReminder.checkedAt=f.now+50000;f.engine.process(beforeReminder, 'onyc',f.config,f.now+50000);assert.equal(f.state.outbox.length,0);
  // Keep snapshot time in the test's simulated clock.
  const d=f.data({slot:5});d.checkedAt=f.now+61000;f.engine.process(d,'onyc',f.config,f.now+61000);assert.equal(f.state.outbox.length,1);
  const solo=fixture();solo.engine.process(solo.data({solo:true}), 'onyc',solo.config);solo.engine.process(solo.data({solo:true,slot:2,amount:'500'}),'onyc',solo.config);assert.equal(solo.state.outbox[0].events[0].kind,'fill');
});
test('coalescing, successful removal, disabled alarms, and ID reuse',()=>{
  const f=fixture();f.engine.process(f.data(), 'onyc',f.config);f.state.outbox=[];
  f.api.tx_signature='new-incarnation';f.engine.process(f.data({amount:'500',slot:2}), 'onyc',f.config);
  assert.equal(f.state.outbox[0].events.length,1,'new identity does not retroactively report partial fill');
  const r=Object.values(f.state.records).find(r=>r.signature==='new-incarnation');assert.equal(r.fillState.remaining,'500');
  f.config.buyPosition=false;f.engine.prune(f.config);assert.equal(f.state.outbox.length,0);
  f.engine.process(f.data({slot:3,amount:'400'}), 'onyc',f.config);assert.equal(f.state.outbox.length,0);
  f.config.wallets=[];f.engine.prune(f.config);assert.equal(Object.keys(f.state.records).length,0);
  const g=fixture();g.engine.process(g.data(), 'onyc',g.config);g.engine.process(g.data({empty:true}), 'onyc',g.config);assert.equal(g.state.records[g.key].active,false,'absence does not infer full fill');
});
test('one outage warning and recovery, preserving position ack',()=>{
  const f=fixture();f.engine.process(f.data(),'onyc',f.config,f.now);f.engine.acknowledge(f.state.outbox[0].events);
  f.engine.process(f.data({error:true}),'onyc',f.config,f.now+1);f.engine.process(f.data({error:true}),'onyc',f.config,f.now+61000);f.engine.process(f.data({error:true}),'onyc',f.config,f.now+65000);
  assert.equal(f.state.outbox.length,1);assert.equal(f.state.outbox[0].events[0].kind,'health');
  f.engine.process(f.data(),'onyc',f.config);assert.equal(f.state.outbox.length,2);assert.match(f.state.outbox[1].events[0].text,/recovered/);assert.equal(f.state.records[f.key].ack,true);
});
test('configuration rejects invalid wallets, duplicates and private RPC',()=>{
  const f=fixture();assert.equal(validateConfig(f.config).interval,5);
  for(const wallets of [[owner,owner],['bad']])assert.throws(()=>validateConfig({...f.config,wallets}));
  for(const rpc of ['http://example.com','https://127.0.0.1','https://localhost','https://[::1]','https://u:p@example.com'])assert.throws(()=>validateConfig({...f.config,rpc}));
});
module.exports={fixture};
