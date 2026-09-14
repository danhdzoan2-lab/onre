const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const record={signature:'1'.repeat(64),book:'b',vault:'v',owner:'o',offerId:2,rawPrice:65000,original:'123',created:100,expiry:200};
const event={book:'b',vault:'v',owner:'o',id:2,price:65000,amount:'123',side:2,virtual:0,expirySeconds:100,outer:1,inner:3};
let events=[event],calls=[];
const tx={slot:900,meta:{err:null},transaction:{signatures:[record.signature]}};
const context=vm.createContext({module:{exports:{}},ExponentBook:{postEvents:()=>events},getProxy:()=> 'proxy',
  orderRpc:async(method)=>{calls.push(method);return method==='getTransaction'?tx:{signatures:['other',record.signature]};},Date,Map,Promise,Number,Math,Error});
vm.runInContext(fs.readFileSync('order-placement.js','utf8'),context);
const {placementEvent,comparePlacements}=context.module.exports;
assert.ok(placementEvent(record,tx));
assert.equal(placementEvent(record,{...tx,meta:{err:'failed'}}),null);
assert.equal(placementEvent({...record,original:'124'},tx),null);
assert.equal(placementEvent({...record,expiry:201},tx),null);
events=[event,event];assert.equal(placementEvent(record,tx),null);events=[event];
const a={slot:1,transactionIndex:5,outer:1,inner:3};
assert.equal(comparePlacements(a,{...a,slot:2}),-1);
assert.equal(comparePlacements(a,{...a,transactionIndex:4}),1);
assert.equal(comparePlacements(a,{...a,inner:4}),-1);
assert.equal(comparePlacements(a,a),0);
assert.equal(comparePlacements(a,{slot:1}),null);
context.record=record;
(async()=>{
  const result=await vm.runInContext('getPlacement(record)',context);
  assert.equal(result.transactionIndex,1);assert.equal(result.inner,3);
  await vm.runInContext('getPlacement(record)',context);assert.equal(calls.length,2,'finalized proof cached');
  console.log('PASS: placement identity, failed/ambiguous events, exact block ordering and finalized cache');
})().catch(e=>{console.error(e);process.exitCode=1;});
