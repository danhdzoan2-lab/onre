const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const market={vaultAddress:'vault',maturityDateUnixTs:Date.now()/1000+10000,orderbookAddresses:['book'],impliedApy:.075};
const records=new Map(),entries=new Map();let saved=0;
const ctx=vm.createContext({Date,Map,Set,Number,Math,ASSETS:{t:{mint:'mint',label:'Token'}},orderWatchState:{records,busy:false},walletMonitor:{wallets:new Set(['wallet'])},limitState:{enabled:true,records:{[JSON.stringify(['vault',market.maturityDateUnixTs])]:{apy:'999',threshold:'0.5'}}},limitAlarm:{entries},apyState:{markets:[market],checkedAt:Date.now()},selectedAssets:new Set(),
 buyOrderApy:p=>100*Math.expm1(p/1e6),limitKey:m=>JSON.stringify([m.vaultAddress,m.maturityDateUnixTs]),limitNumber:v=>v===undefined?null:Number(v),limitGapAtOrBelow:(m,a,t)=>m-a<=t+1e-12,
 farthestApyMarket:()=>market,renderLimitCells(){},renderLimitAlarmRow(){},evaluateLimitAlerts(){},saveOrderWatches(){saved++;},apyDate:String,
 limitRewardRangeCheck:(m,a)=>({outside:a<6||a>8}),startLimitAlarmAudio(){},renderLimitAlarm(){},notifyLimitAlarm(){}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../auto-limit.js'),'utf8'),ctx);ctx.market=market;const run=s=>vm.runInContext(s,ctx);
const order=apy=>({assetKey:'t',vault:'vault',book:'book',maturity:market.maturityDateUnixTs,expiry:market.maturityDateUnixTs,owner:'wallet',rawPrice:Math.round(Math.log1p(apy/100)*1e6),checkedAt:Date.now(),status:'Behind'});
assert.equal(run('evaluateAutoLimitAlerts().length'),0,'legacy manual APY is not used');
records.set('a',order(7.1));records.set('b',order(5.9));records.set('other',{...order(20),maturity:market.maturityDateUnixTs+1});
assert.equal(run("autoLimitOrders(market,'t').length"),2,'exact maturity match');
assert.equal(run('evaluateAutoLimitAlerts().length'),2,'independent gap and range order alarms');
entries.clear();assert.equal(run('evaluateAutoLimitAlerts().length'),0,'Stop does not rearm edges');
records.get('a').status='Stale';market.impliedApy=.1;run('evaluateAutoLimitAlerts()');records.get('a').status='Behind';market.impliedApy=.075;
assert.equal(run('evaluateAutoLimitAlerts().length'),0,'stale source does not clear edge');
market.impliedApy=.1;run('evaluateAutoLimitAlerts()');market.impliedApy=.075;assert.equal(run('evaluateAutoLimitAlerts().length'),1,'exit and reentry rearms');
entries.clear();records.delete('a');records.set('replacement',order(7.1));assert.equal(run('evaluateAutoLimitAlerts().length'),1,'replacement is a new identity');
records.get('replacement').checkedAt=Date.now()-13000;assert.equal(run("autoLimitOrders(market,'t').find(o=>o.key==='replacement').stale"),true);
run("removeAutoWalletAlarms('wallet')");assert.equal(entries.size,0);
records.clear();assert.equal(run("autoLimitOrders(market,'t').length"),0);assert.ok(saved>0);
console.log('PASS: automatic APY only, per-order gap/range, exact maturity, stale/Stop edges and replacement identity');
