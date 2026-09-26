const assert=require('node:assert/strict');
const {bookPositionLayout}=require('../position-groups');
const {orderWatchRecord,watchedGroupResult}=require('../order-watch');
const now=Math.floor(Date.now()/1000);
const market={vaultAddress:'9woPcp5X2aGZE6kZ9htFwepLDoeEi3WWcWZJZpmRYCXu',maturityDateUnixTs:now+10000,
  orderbookAddresses:['6o9P9WBeVn6eQcv7Z5LKdfSsy5KE4c1sv7N2qxh4k22d']};
const owners=['3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof','FxzLN1PTmdztV7PFBBL8XUo8WXBzgNMoK8ofLBhbkgtp'];
const raw=apy=>Math.round(Math.log1p(apy/100)*1e6);
const order=(id,apy,side='sell')=>({id,offer_idx:id,order_type:side==='sell'?'sellYT':'buyYT',
  user_address:owners[id===6?0:1],vault_address:market.vaultAddress,orderbook_address:market.orderbookAddresses[0],
  price_implied_apy:raw(apy),original_amount:'100',amount_remaining:'100',created_at:new Date((now-100)*1000).toISOString(),
  expiry_at:new Date((now+1000)*1000).toISOString(),expiry_seconds:1100,tx_signature:'tx'+id});
const group=(apy,orders)=>({key:String(apy),apy,rows:orders.map(order=>({order,yt:10})),total:10*orders.length,unknown:false});
const sell=[group(12.3,[order(1,12.3)]),group(12.4,[order(2,12.4),order(3,12.4)]),
  group(12.5,[order(4,12.5),order(5,12.5),order(6,12.5)]),group(12.6,[order(7,12.6)])];
const personal=sell[2].rows[2].order,record=orderWatchRecord(personal,market,'sronyc','sell');
const layout=bookPositionLayout(sell,order=>order===personal);
assert.equal(layout.focusedGroups.length,1);
assert.equal(layout.focusedGroups[0].rows.length,6);
assert.equal(layout.focusedGroups[0].total,60);
assert.deepEqual([layout.focusedGroups[0].startApy,layout.focusedGroups[0].endApy],[12.3,12.5]);
assert.deepEqual([layout.positions.get(personal).index,layout.positions.get(personal).total],[6,6]);
assert.deepEqual([layout.positions.get(sell[3].rows[0].order).index,layout.positions.get(sell[3].rows[0].order).total],[1,1],
  'Show all leaves later APY levels in their own groups');
const result=watchedGroupResult(record,{market,groups:sell,checkedAt:Date.now(),personalRecords:[record]});
assert.equal(result.front,false);assert.deepEqual([result.position.index,result.position.total],[6,6]);
const buy=[group(12.5,[order(1,12.5,'buy')]),group(12.4,[order(2,12.4,'buy'),order(3,12.4,'buy')]),
  group(12.3,[order(4,12.3,'buy'),order(5,12.3,'buy'),order(6,12.3,'buy')])];
const buyPersonal=buy[2].rows[2].order,buyRecord=orderWatchRecord(buyPersonal,market,'sronyc','buy');
assert.deepEqual([watchedGroupResult(buyRecord,{market,groups:buy,checkedAt:Date.now(),personalRecords:[buyRecord]}).position.index,
  bookPositionLayout(buy,order=>order===buyPersonal).positions.get(buyPersonal).total],[6,6]);
const first=order(6,12.5),behind=order(7,12.5),firstRecord=orderWatchRecord(first,market,'sronyc','sell');
assert.equal(watchedGroupResult(firstRecord,{market,groups:[group(12.5,[first,behind])],checkedAt:Date.now(),personalRecords:[firstRecord]}).front,true);
assert.equal(watchedGroupResult(firstRecord,{market,groups:[group(12.5,[first])],checkedAt:Date.now(),personalRecords:[firstRecord]}).front,false,
  '1/1 does not alarm');
assert.equal(watchedGroupResult(firstRecord,{market,groups:[group(12.5,[first,behind])],checkedAt:0,personalRecords:[firstRecord]}).front,null,
  'stale data cannot trigger or rearm an alarm');
const multiple=bookPositionLayout(sell,order=>order===sell[1].rows[0].order||order===personal);
assert.equal(multiple.focusedGroups.length,1);assert.equal(multiple.focusedGroups[0].rows.length,6,
  'multiple personal levels share one front-to-farthest-personal group');
console.log('PASS: cumulative Buy/Sell group positions, front alarm, 1/1, stale data, Show all and multiple personal levels');
