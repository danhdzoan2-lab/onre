'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('wallet scanner only reconciles relevant side and front-to-personal levels',async()=>{
  const orders=[{id:'before',order_type:'sellPT',user_address:'other',apy:12.6},{id:'mine',order_type:'buyYT',user_address:'me',apy:12.5},{id:'after',order_type:'buyYT',user_address:'other',apy:12.4},{id:'sell',order_type:'sellYT',user_address:'other',apy:8}].map(o=>({...o,amount_remaining:'100'}));
  const requests=[];
  const groups=list=>list.map(order=>({apy:order.apy,rows:[{order,position:{index:1,total:1}}],total:100}));
  const ctx=vm.createContext({Date,Map,Set,BigInt,Number,Promise,
    placementOpenOrders:async()=>orders,buyOpenOrders:list=>list.filter(o=>['buyYT','sellPT'].includes(o.order_type)),sellOpenOrders:list=>list.filter(o=>['sellYT','buyPT'].includes(o.order_type)),
    orderWatchRecord:(o,m,k,side)=>({key:o.id,original:'100',owner:o.user_address,assetKey:k,orderSide:side}),orderWatchKey:r=>r.key,buyYtEstimate:()=>100,sellYtEstimate:()=>100,
    getOrderBookSnapshot:async()=>({checkedAt:Date.now(),slot:1}),
    buyGroups:list=>groups(list.filter(o=>['buyYT','sellPT'].includes(o.order_type))),sellGroups:list=>groups(list.filter(o=>['sellYT','buyPT'].includes(o.order_type))),
    reconcileBuyOrders:async list=>{requests.push(['buy',list.map(o=>o.id)]);return list;},reconcileSellOrders:async list=>{requests.push(['sell',list.map(o=>o.id)]);return list;},
    bookPositionLayout:require('../position-groups.js').bookPositionLayout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../wallet-core.js'),'utf8'),ctx);
  ctx.market={vaultAddress:'v',orderbookAddresses:['b']};ctx.wallets=new Set(['me']);
  const result=await vm.runInContext("scanWalletMarket(market,'onyc',wallets)",ctx);
  assert.deepEqual(requests.map(([side,ids])=>[side,Array.from(ids)]),[['buy',['before','mine']],['sell',[]]]);
  assert.equal(result.records.length,1);assert.equal(result.error,undefined);
  assert.equal(result.groups.length,2,'virtual competitors ahead remain included');
});
