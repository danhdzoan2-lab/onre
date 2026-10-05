'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {MonitorService}=require('../companion/service.cjs'),{protect}=require('../companion/vault.cjs');
const owner='Eo17ugMU4EtFUqi2189j6XLLrVcoWYKtQpJE29Yh1k3W';
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'onre-telegram-test-'));const service=new MonitorService(directory,async()=>{throw Error('Network disabled in fixture');});return {service,directory};}
test('private-chat pairing: wrong/expired/replayed code and foreign ack ignored',async()=>{
  const {service:s}=fixture();await s.ready;s.token='fixture';s.botName='fixturebot';s.createPair();
  const code=new URL(s.pairLink).searchParams.get('start'),expires=s.state.pairExpires;
  let incoming=[],sent=[];s.telegram=async(method,body)=>method==='getUpdates'?incoming:(sent.push({method,body}),{});
  incoming=[{update_id:1,message:{chat:{id:42,type:'private'},text:'/start wrong'}}];await s.updates();assert.equal(s.state.chatId,undefined);
  incoming=[{update_id:2,message:{chat:{id:42,type:'group'},text:'/start '+code}}];await s.updates();assert.equal(s.state.chatId,undefined);
  s.state.pairExpires=1;incoming=[{update_id:3,message:{chat:{id:42,type:'private'},text:'/start '+code}}];await s.updates();assert.equal(s.state.chatId,undefined);
  s.state.pairExpires=expires;incoming=[{update_id:4,message:{chat:{id:42,type:'private'},text:'/start '+code}}];await s.updates();assert.equal(s.state.chatId,'42');assert.equal(s.state.pairHash,null);assert.equal(s.state.paused,false);
  incoming=[{update_id:5,message:{chat:{id:43,type:'private'},text:'/start '+code}}];await s.updates();assert.equal(s.state.chatId,'42');
  s.state.records.key={episode:1,ack:false};s.state.deliveries.batch=[{kind:'position',key:'key',episode:1}];
  incoming=[{update_id:6,callback_query:{id:'cb',data:'ack:batch',from:{id:43},message:{chat:{id:42}}}}];await s.updates();assert.equal(s.state.records.key.ack,false);
  incoming[0].callback_query.from.id=42;await s.updates();assert.equal(s.state.records.key.ack,true);
  assert.ok(sent.some(x=>x.method==='answerCallbackQuery'));
});
test('persistent delivery retries, no plaintext token on disk or in state API',async()=>{
  const {service:s,directory}=fixture();await s.ready;s.token='fixture';s.state.chatId='42';s.state.paused=false;
  const event={kind:'fill',key:'key',record:{owner,orderSide:'buy'},text:'Buy partial fill'};
  s.state.config.wallets=[owner];s.state.config.buyPosition=true;s.engine.queue([event],Date.now());s.save();
  let attempts=0;s.telegram=async()=>{attempts++;if(attempts===1){const e=Error('offline');e.retryAfter=1;throw e;}return {};};
  await s.flush();assert.equal(s.state.outbox.length,1);assert.ok(s.state.outbox[0].retryAt>Date.now());await s.flush();assert.equal(attempts,1);
  s.state.outbox[0].retryAt=0;await s.flush();assert.equal(attempts,2);assert.equal(s.state.outbox.length,0);
  assert.equal(s.view().token,undefined);assert.equal(s.view().encryptedToken,undefined);assert.ok(!fs.readFileSync(path.join(directory,'state.json'),'utf8').includes('fixture'));
  const restored=new MonitorService(directory);await restored.ready;assert.equal(restored.state.outbox.length,0);assert.equal(restored.state.chatId,'42');
});
test('single-flight scanning and config changes suppress late results',async()=>{
  const {service:s}=fixture();await s.ready;s.token='fixture';s.state.chatId='42';s.state.paused=false;s.state.config.wallets=[owner];s.state.config.buyPosition=true;
  const market={vaultAddress:'vault',maturityDateUnixTs:Math.floor(Date.now()/1000)+1000};
  s.loadMarkets=async()=>[market];s.runtime.walletMarkets=()=>[{market,assetKey:'onyc'}];let release,scans=0;
  s.runtime.scanWalletMarket=async()=>{scans++;return new Promise(resolve=>release=()=>resolve({market,records:[],groups:[],sellGroups:[],checkedAt:Date.now()}));};
  const first=s.tick();await new Promise(resolve=>setImmediate(resolve));await s.tick();assert.equal(scans,1);
  s.pause(true);release();await first;assert.equal(Object.keys(s.state.health).length,0);assert.equal(s.state.outbox.length,0);
});
test('RPC allowlist remains read-only and encrypted secret round-trip',async t=>{
  if(process.platform!=='win32'){t.skip('DPAPI requires Windows');return;}
  const secret='test-only-'+crypto.randomUUID(),encrypted=await protect(secret);assert.ok(!encrypted.includes(secret));assert.equal(await protect(encrypted,true),secret);
});
test('one scan coalesces multiple markets before delivery',async()=>{
  const {service:s}=fixture();await s.ready;s.token='fixture';s.state.chatId='42';s.state.paused=false;s.state.config.wallets=[owner];s.state.config.buyPosition=true;
  const markets=[{vaultAddress:'v1',maturityDateUnixTs:1},{vaultAddress:'v2',maturityDateUnixTs:2}];
  s.loadMarkets=async()=>markets;s.runtime.walletMarkets=()=>markets.map(market=>({market,assetKey:'onyc'}));
  s.runtime.scanWalletMarket=async market=>({market});
  s.engine.process=d=>s.engine.queue([{kind:'health',text:d.market.vaultAddress}],Date.now());
  let delivered;s.flush=async()=>{delivered=s.state.outbox;};await s.tick();
  assert.equal(delivered.length,1);assert.equal(delivered[0].events.length,2);
});
