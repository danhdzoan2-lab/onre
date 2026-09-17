const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({Date,BigInt});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../reward-range.js'),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
run(`const now=Date.now();const order={id:127369,offer_idx:28,vault_address:'v',orderbook_address:'b',order_type:'buyYT'};
const campaign={id:'c',campaignType:'orderbook_quote',vaultAddress:'v',orderbookAddress:'b',incentivizedOrderTypes:['buyYT','sellYT'],startsAt:new Date(now-1000).toISOString(),endsAt:new Date(now+10000).toISOString(),fundingAmountRaw:'100',distributedRaw:'10',currentRewardsApy:80,currentRewardsApyByUser:{owner:50},currentRewardsApyByOrderId:{127369:11.255999986,28:99}};
const state={campaigns:[campaign],checkedAt:now,error:''};`);
assert.equal(run('orderRewardsText(order,state,now)'),'11.26%');
assert.equal(run("orderRewardsText({...order,order_type:'sellYT'},state,now)"),'11.26%');
assert.equal(run("orderRewardsText({apiOrderId:127369,vault:'v',book:'b',orderType:'sellYT'},state,now)"),'11.26%');
for(const change of ["id:undefined","id:127370","vault_address:'wrong'","orderbook_address:'wrong'","order_type:'buyPT'"])
 assert.equal(run(`orderRewardsText({...order,${change}},state,now)`),'—');
for(const change of ["error:'offline'","checkedAt:now-10001"])
 assert.equal(run(`orderRewardsText(order,{...state,${change}},now)`),'—');
for(const change of ["isActive:false","endsAt:new Date(now).toISOString()","fundingAmountRaw:'10'","currentRewardsApyByOrderId:{127369:null}"])
 assert.equal(run(`orderRewardsText(order,{...state,campaigns:[{...campaign,${change}}]},now)`),'—');
assert.equal(run('orderRewardsText(order,{...state,campaigns:[{...campaign,currentRewardsApyByOrderId:{127369:0}}]},now)'),'0.00%');
assert.equal(run("orderRewardsText(order,{...state,campaigns:[campaign,{...campaign,id:'d',currentRewardsApyByOrderId:{127369:2}}]},now)"),'11.26% / 2.00%');
console.log('PASS: per-order rewards, API id not slot, buy/sell, exact market, missing/zero/stale/expired and separate campaigns');
