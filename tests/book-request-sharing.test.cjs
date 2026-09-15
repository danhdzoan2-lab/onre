const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 let active=0,peak=0,calls=0,releases=[];
 const ctx=vm.createContext({Date,Map,Promise,Error,AbortController,setTimeout,clearTimeout,getProxy:()=> 'rpc',apyRetryDelay:()=>30000,
 fetch:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));active--;return {ok:true,status:200,json:async()=>[]};}});
 for(const file of ['order-rpc.js','order-placement.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
 const run=s=>vm.runInContext(s,ctx),tick=()=>new Promise(r=>setImmediate(r));
 const requests=run("Promise.all([placementOpenOrders('same'),placementOpenOrders('same'),placementOpenOrders('b'),placementOpenOrders('c'),placementOpenOrders('d'),orderRpc('getBlockTime',[1])])");
 await tick();assert.equal(calls,3);assert.equal(peak,3);
 for(let i=0;i<4;i++){releases.splice(0).forEach(r=>r());await tick();}
 await requests;assert.equal(calls,5,'same-vault in-flight request shared');assert.equal(peak,3,'RPC and API share the limit');
 await run("placementOpenOrders('same')");assert.equal(calls,5,'fresh cache reused');
 ctx.fetch=async()=>({ok:false,status:429,headers:{get:()=> '30'}});
 await assert.rejects(run("placementOpenOrders('limited')"),/rate limited/);
 let retried=false;ctx.fetch=async()=>{retried=true;throw Error('unexpected');};
 await assert.rejects(run("placementOpenOrders('limited')"),/rate limited/);assert.equal(retried,false,'backoff blocks new fetch');
 assert.equal(run('bookRequests.active'),0,'slots released after rejection');
 console.log('PASS: shared API/RPC concurrency, in-flight/cache reuse, Retry-After and slot cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
