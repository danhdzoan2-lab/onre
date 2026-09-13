const assert=require('node:assert/strict');
const d=require('../orderbook');
const payload='7iazyA59wwtANXrYycUsJfa5rvZs4Zgw8bPbf9p6hrQ5A11GFKRrCJxwSbk5Fpug4T4KxELtjWE1VzvJWf9wZTrYxCL6vJZX8A6mxcsodjqgSxpSKb4LhYqycTAV32Nf549JuiQ9sYRECHtqN43fB3rGcpMVkdZwqDCBE3NKxJpBUC5ydwxYrk2nHiyUhcNJSNLHowZMVGnHVkSmTTBKUXyZxVkHB5xqhCD3QXWz4sbFx6rguFtuA9SaMpq5B6b3cU6daRBrU17Xkoavkzs';
const tx={slot:446645939,transactionIndex:1191,blockTime:1789284523,meta:{err:null,innerInstructions:[{index:7,instructions:[{programId:d.PROGRAM,data:payload}]}]}};
const [event]=d.postEvents(tx);
assert.equal(event.owner,'3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof');
assert.equal(event.book,'ndAp6RJ1Q2wkoczCdXQteZk2UMnmDNWQDCCCKyLtymv');
assert.equal(event.id,28);assert.equal(event.price,84708);assert.equal(event.side,2);assert.equal(event.virtual,0);
assert.equal(event.amount,'10095523225482');assert.equal(event.syIndex,1.018622084945);
assert.equal(event.expirySeconds,604800);assert.equal(event.out,'0');
assert.ok(Math.abs(Math.expm1(event.price/1e6)*100-8.839920772459143)<1e-10);
assert.equal(d.postEvents({...tx,meta:{...tx.meta,err:{failure:1}}}).length,0);
assert.equal(d.postEvents({...tx,meta:{innerInstructions:[{index:1,instructions:[{programId:d.PROGRAM,data:'invalid0'}]}]}}).length,0);
assert.equal(d.postEvents({...tx,meta:{innerInstructions:[{index:1,instructions:[{programId:'fake',data:payload}]}]}}).length,0);
assert.equal(d.postEvents({...tx,meta:{innerInstructions:[{index:7,instructions:[{programId:d.PROGRAM,data:payload},{programId:d.PROGRAM,data:payload}]}]}}).length,2);
// Synthetic account using independently specified C-layout offsets.
const bytes=Buffer.alloc(317688);
bytes.writeDoubleLE(0.01,16);bytes.writeDoubleLE(0.02,24);bytes[32]=6;
Buffer.from(d.unbase58(event.vault)).copy(bytes,1168);
bytes.writeBigUInt64LE(1018622084945n,1488);bytes.writeBigUInt64LE(1018622084945n,1520);
bytes.writeUInt32LE(1799578800,1608);bytes.writeUInt32LE(1,1616);bytes.writeBigUInt64LE(1n,1632);
const priceStart=1648;bytes.writeUInt32LE(84708,priceStart+16);bytes.writeUInt32LE(24,priceStart+24);bytes.writeUInt32LE(28,priceStart+32);
const offerStart=priceStart+36000+16;
function offer(id,next,amount,created){const p=offerStart+(id-1)*40;bytes.writeUInt32LE(next,p+4);bytes.writeUInt32LE(1,p+8);bytes.writeUInt32LE(1,p+12);bytes.writeBigUInt64LE(amount,p+16);bytes.writeUInt32LE(created+604800,p+24);bytes.writeUInt32LE(created,p+28);bytes[p+33]=2;}
offer(24,28,9999999999n,event.ts-30);offer(28,0,BigInt(event.amount),event.ts);
const userStart=offerStart+100000+16;Buffer.from(d.unbase58(event.owner)).copy(bytes,userStart+8);
const book=d.decodeBook(bytes);assert.equal(book.vault,event.vault);assert.equal(book.syIndex,event.syIndex);
const q=d.queue(book,84708,2,event.ts);assert.deepEqual(q.map(o=>o.id),[24,28]);assert.equal(q[1].owner,event.owner);
assert.equal(d.ytAmount(book,q[1],event.ts),null); // Missing reference index is never guessed.
assert.ok(d.ytAmount(book,q[1],event.ts,event.syIndex)>370000e9);
assert.equal(d.ytAmount(book,{...q[1],virtual:1},event.ts,event.syIndex),null);
assert.equal(d.ytAmount(book,q[1],book.maturity,event.syIndex),null);
assert.deepEqual(d.queue(book,84708,2,event.ts+604801),[]);
book.offers.get(24).next=24;assert.throws(()=>d.queue(book,84708,2,event.ts),/chain/);
book.offers.get(24).next=0;assert.throws(()=>d.queue(book,84708,2,event.ts),/tail/);
book.offers.get(24).next=28;book.offers.get(28).pricePointer=2;assert.throws(()=>d.queue(book,84708,2,event.ts),/chain/);
assert.throws(()=>d.decodeBook(bytes.subarray(0,bytes.length-1)));
console.log('PASS: real Post Offer fixture; raw price, owner, side, id; binary book layout, queue links, expiry, missing index and corrupt data');
