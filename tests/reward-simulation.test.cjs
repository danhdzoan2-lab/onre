const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const ctx=vm.createContext({Date,BigInt,Math});
for(const file of ['reward-range.js','reward-simulation.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
run(`const now=Date.now();const market={vaultAddress:'v',orderbookAddresses:['b'],underlyingAsset:{mint:'m'},maturityDateUnixTs:now/1000+10000,impliedApy:.09};
const c={id:'c',vaultAddress:'v',orderbookAddress:'b',campaignType:'orderbook_quote',isActive:true,startsAt:new Date(now-10000).toISOString(),endsAt:new Date(now+10000).toISOString(),fundingAmountRaw:'4930438233415',distributedRaw:'3509285961972',emissionMint:'m',emissionDecimals:9,emissionRateRawPerSecond:'1902175',priceBandBps:600,marketImpliedApy:85930,maxRewardsApyBps:8000,currentRewardsApy:80,incentivizedOrderTypes:['buyYT','sellYT']};const model=simulationModel(c,market,now);`);
assert.ok(run('model'));
for(const t of [0,.1,.25,.5,.75,.9,1]){
 const actual=run(`simulationPoint(model,1000,${t})`);
 // Literal reference calculation from Exponent frontend Y(model,t).
 const n=1-Math.abs(2*t-1),q=n**2,annual=1902175/1e9*31536000,total=annual/.8+1000*q;
 assert.ok(Math.abs(actual.rewards-Math.min(annual/total*100,80)*q)<1e-10);
 assert.ok(Math.abs(actual.share-1000*q/total*100)<1e-10);
 assert.ok(Math.abs(actual.apy-100*Math.expm1(.08593*(1-.06)+.08593*.12*t))<1e-10);
}
assert.equal(run('simulationPoint(model,1000,0).rewards'),0);
assert.equal(run('simulationPoint(model,1000,1).rewards'),0);
assert.equal(run('simulationPoint(model,1000,-1).share'),0);
assert.ok(run('simulationPoint(model,100000,.5).rewards<simulationPoint(model,1000,.5).rewards'));
assert.ok(run('simulationPoint(model,100000,.5).share>simulationPoint(model,1000,.5).share'));
for(const change of ["emissionRateRawPerSecond:undefined","emissionRateRawPerSecond:null","emissionRateRawPerSecond:'bad'","emissionMint:'other'","emissionDecimals:99","isActive:false","vaultAddress:'other'","orderbookAddress:'other'","endsAt:new Date(now).toISOString()","startsAt:new Date(now+1).toISOString()","priceBandBps:0","currentRewardsApy:0"])
 assert.equal(run(`simulationModel({...c,${change}},market,now)`),null,change);
assert.ok(run("simulationModel({...c,incentivizedOrderTypes:['sellYT']},market,now)"));
assert.equal(run("simulationCampaigns([c,{...c,id:'d'}, {...c,id:'expired',endsAt:new Date(0).toISOString()}],market,now).length"),2);
for(const v of ['', '0','-1','Infinity','1e3','bad','1000000000001']){ctx.v=v;assert.equal(run('simulationAmount(v)'),null);}
assert.equal(run("simulationAmount('1000.5')"),1000.5);
assert.equal(run("simulationAmount(' 1000 ')"),1000);
assert.equal(run('simulationPoint(model,NaN,.5)'),null);
assert.equal(run('simulationPoint(model,0,.5)'),null);
assert.equal(run('simulationModel(c,{...market,maturityDateUnixTs:now/1000},now)'),null);
console.log('PASS: Exponent squared model reference, variable capital, cap, boundaries, emission validation, campaign identity, expiry, currencies, and input validation');
