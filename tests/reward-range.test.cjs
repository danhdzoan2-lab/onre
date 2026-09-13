const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
let response, calls=0, pending, timeout;
const ctx=vm.createContext({Date,BigInt,AbortController,limitNumber:s=>typeof s==='string'&&/^\d+(\.\d+)?$/.test(s)?Number(s):null,
  apyRetryDelay:()=>30000,apyDate:String,renderApy(){},document:{getElementById(){return null;}},
  setTimeout:f=>{timeout=f;return 1;},clearTimeout(){},fetch:async(u,o)=>{calls++;if(pending)return pending(o);if(response instanceof Error)throw response;return response;}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../reward-range.js'),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
run(`const fixture={id:'eusx',vaultAddress:'vault',orderbookAddress:'book',campaignType:'orderbook_quote',incentivizedOrderTypes:['buyYT','sellYT'],startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+100000).toISOString(),fundingAmountRaw:'100000000000000000000',distributedRaw:'1',marketImpliedApy:83973,priceBandBps:420};const market={vaultAddress:'vault',orderbookAddresses:['book']};const band=rewardBand(fixture);`);
assert.ok(Math.abs(run('band.low')-8.377046668995893)<1e-10);
assert.ok(Math.abs(run('band.high')-9.144211818969808)<1e-10);
assert.equal(run(`rewardPosition(band,String(band.low))`),'Within range');
assert.equal(run(`rewardPosition(band,String(band.high))`),'Within range');
assert.equal(run(`rewardPosition(band,'8.37')`),'Below range');
assert.equal(run(`rewardPosition(band,'9.15')`),'Above range');
assert.equal(run(`rewardPosition(band,'')`),'Enter My APY');
assert.equal(run(`rewardBand({...fixture,marketImpliedApy:null})`),null);
assert.equal(run(`rewardCandidates([fixture],market,Date.now()).length`),1);
for(const change of ["vaultAddress:'other'","orderbookAddress:'other'","incentivizedOrderTypes:['sellYT']","endsAt:new Date(0).toISOString()","startsAt:new Date(Date.now()+10000).toISOString()","distributedRaw:fixture.fundingAmountRaw"]){
 assert.equal(run(`rewardCandidates([{...fixture,${change}}],market,Date.now()).length`),0);
}
assert.equal(run(`rewardCandidates([fixture,{...fixture,id:'second'}],market,Date.now()).length`),2);
assert.equal(run(`rewardCandidates([fixture],{...market,vaultAddress:'strcx'},Date.now()).length`),0);
(async()=>{
response={ok:true,json:async()=>({campaigns:[run('fixture')]})};await run('fetchRewardRanges()');
assert.equal(run('rewardRangeState.campaigns.length'),1);
response=new Error('offline');await run('fetchRewardRanges()');assert.equal(run('rewardRangeState.campaigns.length'),1);assert.equal(run('rewardRangeState.error'),'offline');
response={status:429,headers:{get:()=>null}};await run('fetchRewardRanges()');const before=calls;await run('fetchRewardRanges()');assert.equal(calls,before);
run('rewardRangeState.retryAt=0');pending=o=>new Promise((res,rej)=>o.signal.addEventListener('abort',()=>rej(Object.assign(new Error(),{name:'AbortError'}))));
const flight=run('fetchRewardRanges()');const count=calls;await run('fetchRewardRanges()');assert.equal(calls,count);timeout();await flight;
assert.match(run('rewardRangeState.error'),/timed out/);assert.equal(run('rewardRangeState.inFlight'),false);
pending=null;response={ok:true,json:async()=>({campaigns:[]})};await run('fetchRewardRanges()');assert.equal(run('rewardRangeState.error'),'');
console.log('PASS: reward formula, inclusive bounds, campaign matching, budgets, multiple campaigns, errors, rate limits, timeout, concurrency');
})().catch(e=>{console.error(e);process.exitCode=1;});
