const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let now=100000,calls=0,scans=0,paint=0,fail=false,pending=null;
const events={},timers=new Map();let timerId=0;
class Clock extends Date{static now(){return now;}}
const ctx=vm.createContext({Date:Clock,AbortController,Promise,
  document:{visibilityState:'visible',getElementById:()=>null,addEventListener:(name,fn)=>events[name]=fn},
  window:{addEventListener:(name,fn)=>events[name]=fn,marketLayout:{renderAll:()=>paint++}},
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
  fetch:async(_url,options)=>{calls++;if(pending)return pending(options);return fail?{ok:false,status:429,headers:{get:()=> '30'}}:{ok:true,status:200,json:async()=>[]};},
  limitState:{enabled:true},pollOrderWatches:async force=>{assert.equal(force,true);scans++;},renderOrderWatches(){}});
for(const file of ['apy.js','wallet-refresh.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
const run=code=>vm.runInContext(code,ctx);
(async()=>{
  ctx.document.visibilityState='hidden';await events.visibilitychange({type:'visibilitychange'});
  assert.equal(calls,0,'hiding the tab does not force a new request');
  ctx.document.visibilityState='visible';
  let release;
  pending=()=>new Promise(resolve=>release=()=>resolve({ok:true,status:200,json:async()=>[]}));
  const visible=events.visibilitychange({type:'visibilitychange'}),focus=events.focus({type:'focus'});
  assert.equal(calls,1,'visibility and focus share one refresh');assert.equal(scans,0,'wallet waits for APY');
  release();await Promise.all([visible,focus]);pending=null;
  assert.equal(scans,1);assert.equal(paint,1);
  now+=10000;ctx.limitState.enabled=false;await events.focus({type:'focus'});
  assert.equal(calls,2);assert.equal(scans,1,'alarm OFF does not start automatic wallet scanning');
  now+=10000;ctx.limitState.enabled=true;fail=true;await events.focus({type:'focus'});
  const limitedCalls=calls;assert.equal(scans,1,'failed APY cannot trigger a wallet scan');
  now+=2000;await events.focus({type:'focus'});assert.equal(calls,limitedCalls,'return respects Retry-After');
  now+=31000;fail=false;
  pending=options=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('timeout'),{name:'AbortError'}))));
  const oldFlight=run('fetchApy()');now+=15000;pending=null;
  await events.focus({type:'focus'});await oldFlight;
  assert.equal(scans,2,'overdue request is aborted, then fresh APY enables wallet recovery');
  assert.equal(run('apyState.error'),'');assert.equal(run('apyState.inFlight'),false);
  now+=10000;ctx.document.visibilityState='hidden';await events.online({type:'online'});assert.equal(scans,2);
  console.log('PASS: tab return sequences APY then wallets, deduplicates focus, respects OFF/Retry-After and recovers an overdue request');
})().catch(error=>{console.error(error);process.exitCode=1;});
