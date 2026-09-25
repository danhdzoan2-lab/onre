const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let sounds=0,notices=0;
const elements=new Map();const ctx=vm.createContext({Date,Map,BigInt,document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{dataset:{}});return elements.get(id);}},
 ASSETS:{a:{label:'A',mint:'a'}},selectedAssets:new Set(),apyState:{checkedAt:Date.now(),error:'',markets:[]},apyDate:String,
 farthestApyMarket:ms=>ms[0],Notification:Object.assign(function(){notices++;},{permission:'granted'}),renderApy(){}});
for(const file of ['limit-monitor.js','reward-range.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
ctx.sound=()=>{sounds++;};run(`startLimitAlarmAudio=sound;limitState.enabled=true;limitState.options.buyGap=true;limitState.options.buyRange=true;
const m={vaultAddress:'v',orderbookAddresses:['b'],maturityDateUnixTs:9999999999,impliedApy:1};apyState.markets=[m];
const c={id:1,vaultAddress:'v',orderbookAddress:'b',campaignType:'orderbook_quote',incentivizedOrderTypes:['buyYT'],startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+1000000).toISOString(),fundingAmountRaw:'100',distributedRaw:'0',marketImpliedApy:0.02,priceBandBps:100};
rewardRangeState.campaigns=[c];rewardRangeState.checkedAt=Date.now();const band=rewardBand(c);
const key=limitKey(m);limitState.records[key]={apy:'1',threshold:''};evaluateLimitAlerts();`);
assert.equal(sounds,1);assert.match(run('limitAlarm.entries.get(key)'),/outside APY Range/);
run('stopLimitAlarm();evaluateLimitAlerts();');assert.equal(sounds,1);
run(`limitState.records[key].apy=String(band.low);evaluateLimitAlerts();`);assert.equal(run('limitState.edges.get(key+":range")'),false);
run(`limitState.records[key].apy=String(band.high);evaluateLimitAlerts();`);assert.equal(sounds,1);
run(`limitState.records[key].apy='3';evaluateLimitAlerts();`);assert.equal(sounds,2);
run(`stopLimitAlarm();rewardRangeState.error='offline';limitState.records[key].apy=String(band.low);evaluateLimitAlerts();rewardRangeState.error='';limitState.records[key].apy='3';evaluateLimitAlerts();`);assert.equal(sounds,2,'stale data cannot rearm');
run(`limitState.edges.clear();rewardRangeState.checkedAt=0;evaluateLimitAlerts();`);assert.equal(sounds,2);
run(`rewardRangeState.checkedAt=Date.now();rewardRangeState.campaigns=[];evaluateLimitAlerts();`);assert.equal(sounds,2,'no campaign is unknown, not outside');
run(`rewardRangeState.campaigns=[c,{...c,id:2,marketImpliedApy:.04}];limitState.records[key].apy=String(rewardBand(rewardRangeState.campaigns[1]).low);evaluateLimitAlerts();`);assert.equal(sounds,2,'inside any valid campaign is safe');
run(`limitState.records[key].apy='3';evaluateLimitAlerts();`);assert.equal(sounds,3,'between disjoint ranges is outside');
run(`stopLimitAlarm();limitState.edges.clear();rewardRangeState.campaigns=[c,{...c,id:2,marketImpliedApy:null}];evaluateLimitAlerts();`);assert.equal(sounds,3,'unknown campaign cannot assert outside all ranges');
run(`rewardRangeState.campaigns=[c];selectedAssets.add('other');evaluateLimitAlerts();selectedAssets.clear();evaluateLimitAlerts();`);assert.equal(sounds,3,'filter selection does not replay old breach');
run(`limitState.edges.clear();limitState.records[key]={apy:'1',threshold:'100'};evaluateLimitAlerts();`);assert.equal(sounds,4);assert.match(run('limitAlarm.entries.get(key)'),/gap.*outside APY Range/);
run(`stopLimitAlarm();limitState.records[key].threshold='0';limitState.records[key].apy=String(band.low);evaluateLimitAlerts();limitState.records[key].apy='1';evaluateLimitAlerts();`);assert.equal(sounds,5);
run(`stopLimitAlarm();limitState.edges.clear();limitState.enabled=false;evaluateLimitAlerts();`);assert.equal(sounds,5);
assert.equal(notices,5);
console.log('PASS: independent range/gap alarms, both boundaries, no threshold, latch/stop/rearm, stale/unknown data, filters and multiple campaigns');
