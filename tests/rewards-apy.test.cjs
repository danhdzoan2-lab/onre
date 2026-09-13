const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function el(){return {dataset:{},children:[],textContent:'',appendChild(c){this.children.push(c)},replaceChildren(){this.children=[];this.textContent=''},insertBefore(c,b){this.children.splice(this.children.indexOf(b),0,c)}};}
const ctx=vm.createContext({Date,BigInt,apyState:{error:''},document:{createElement:el}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../reward-range.js'),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
for(const [value,expected] of [['148.629957','148.63%'],['0','0.00%'],['null','—'],['undefined','—'],['NaN','—'],['Infinity','—'],['-1','—'],['"32"','—']])assert.equal(run(`formatRewardsApy(${value})`),expected);
ctx.row=el();ctx.row.limitGap=el();ctx.row.appendChild(ctx.row.limitGap);
run(`const m={vaultAddress:'v',orderbookAddresses:['b']};const c={id:'a',vaultAddress:'v',orderbookAddress:'b',campaignType:'orderbook_quote',incentivizedOrderTypes:['buyYT'],startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+100000).toISOString(),fundingAmountRaw:'10',distributedRaw:'1',marketImpliedApy:null,priceBandBps:420,currentRewardsApy:148.629957};rewardRangeState.campaigns=[c];rewardRangeState.checkedAt=Date.now();renderRewardRange(row,m,'10');`);
const text=()=>ctx.row.rewardsApyCell.children[0].children.map(e=>e.textContent);
assert.deepEqual(text(),['148.63%']); // Valid APY independent of missing band input.
assert.equal(ctx.row.children.indexOf(ctx.row.rewardsApyCell),ctx.row.children.indexOf(ctx.row.rewardCell)+1);
const cell=ctx.row.rewardsApyCell;
run(`c.currentRewardsApy=150;renderRewardRange(row,m,'10')`);assert.deepEqual(text(),['150.00%']);assert.equal(ctx.row.rewardsApyCell,cell);
run(`rewardRangeState.campaigns=[{...c,id:'z',currentRewardsApy:0},c];renderRewardRange(row,m,'10')`);assert.deepEqual(text(),['150.00%','0.00%']);
run(`rewardRangeState.error='offline';renderRewardRange(row,m,'10')`);assert.deepEqual(text(),['150.00% *','0.00% *']);assert.equal(cell.children[0].children[0].title,'Stale data');
run(`rewardRangeState.error='';c.endsAt=new Date(0).toISOString();rewardRangeState.campaigns=[c];renderRewardRange(row,m,'10')`);assert.equal(cell.children[0].textContent,'—');
run(`renderRewardRange(row,{vaultAddress:'other',orderbookAddresses:['b']},'10')`);assert.equal(cell.children[0].textContent,'—');
console.log('PASS: full rewards APY, zero/invalid, stable cells, APY-only updates, missing band, ordered campaigns, stale and expired data');
