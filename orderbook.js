/* Read-only Exponent Orderbook decoding. Layout verified against Exponent's
 * public SDK chunk 7687-061c0358270b90cd.js (13 Sep 2026).
 * Queue order comes from linked offers, never timestamps or offer indexes. */
(function(root) {
  'use strict';
  const PROGRAM = 'XPBookgQTN2p8Yw1C2La35XkPMmZTCEYH77AdReVvK1';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58(bytes) {
    let n=0n; for(const x of bytes) n=n*256n+BigInt(x);
    let s=''; while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}
    for(const x of bytes){if(x)break;s='1'+s;} return s;
  }
  function unbase58(s) {
    let n=0n; for(const c of s){const i=alphabet.indexOf(c);if(i<0)throw Error('Invalid base58');n=n*58n+BigInt(i);}
    const a=[];while(n){a.unshift(Number(n%256n));n/=256n;}
    for(const c of s){if(c!=='1')break;a.unshift(0);}return Uint8Array.from(a);
  }
  function reader(bytes) {
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let p=0;
    return {skip(n){p+=n;if(p>bytes.length)throw Error('Truncated orderbook');},get offset(){return p;},
      u8(){const n=v.getUint8(p);p++;return n;},u32(){const n=v.getUint32(p,true);p+=4;return n;},
      u64(){const n=v.getBigUint64(p,true);p+=8;return n;},f64(){const n=v.getFloat64(p,true);p+=8;return n;},
      key(){if(p+32>bytes.length)throw Error('Truncated key');const s=base58(bytes.slice(p,p+32));p+=32;return s;},
      fixed(){let n=0n;for(let i=0;i<4;i++)n+=this.u64()<<BigInt(64*i);return Number(n)/1e12;}};
  }
  function decodeBook(bytes) {
    const r=reader(bytes);r.skip(8);const threshold=r.u64(),makerFee=r.f64(),takerFee=r.f64(),priceDecimals=r.u8();
    r.skip(15);const finalIndex=r.fixed();r.skip(1088);
    const vault=r.key();r.skip(9*32);const syIndex=r.fixed(),lastIndex=r.fixed();r.skip(7*8);
    const maturity=r.u32();r.skip(4);const treeRoot=r.u32();r.skip(12);const treeSize=Number(r.u64());r.skip(8);
    const nodes=[];
    for(let i=1;i<=1000;i++) {const left=r.u32(),right=r.u32(),parent=r.u32();r.skip(4);nodes.push({id:i,left,right,parent,price:r.u32(),sellHead:r.u32(),buyHead:r.u32(),sellTail:r.u32(),buyTail:r.u32()});}
    const active=new Set(),stack=[treeRoot];
    while(stack.length){const i=stack.pop();if(!i)continue;if(active.has(i)||!nodes[i-1])throw Error('Invalid price tree');active.add(i);stack.push(nodes[i-1].left,nodes[i-1].right);}
    if(active.size!==treeSize)throw Error('Price tree size mismatch');r.skip(16);
    const offers=new Map();
    for(let id=1;id<=2500;id++){r.skip(4);const next=r.u32(),userPointer=r.u32(),pricePointer=r.u32(),amount=r.u64(),expiry=r.u32(),created=r.u32(),virtual=r.u8(),side=r.u8(),fillOrKill=r.u8();r.skip(5);if(userPointer)offers.set(id,{id,next,userPointer,pricePointer,amount,expiry,created,virtual,side,fillOrKill});}
    r.skip(16);const users=[];
    for(let i=0;i<1500;i++){r.skip(8);users.push(r.key());r.skip(80);}
    r.skip(8);if(r.offset!==bytes.length)throw Error('Unsupported orderbook layout');
    for(const o of offers.values()){o.owner=users[o.userPointer-1];if(!o.owner)throw Error('Invalid owner pointer');}
    return {vault,maturity,syIndex,lastIndex,finalIndex,makerFee,takerFee,threshold,priceDecimals,prices:nodes.filter(n=>active.has(n.id)),offers};
  }
  function queue(book,price,side=2,now=Date.now()/1000){
    const node=book.prices.find(n=>n.price===price);if(!node)return [];
    let id=side===2?node.buyHead:node.sellHead;const tail=side===2?node.buyTail:node.sellTail,seen=new Set(),out=[];let last=0;
    while(id){const o=book.offers.get(id);if(!o||seen.has(id)||o.pricePointer!==node.id||o.side!==side)throw Error('Invalid offer chain');seen.add(id);last=id;if(o.expiry>=now&&o.amount>0n)out.push(o);id=o.next;}
    if(last!==tail)throw Error('Offer tail mismatch');return out;
  }
  function ytAmount(book,offer,now=Date.now()/1000,allTimeHighIndex){
    if(offer.virtual||offer.side!==2)return null;
    const node=book.prices.find(n=>n.id===offer.pricePointer);if(!node||book.maturity<=now)return null;
    if(!(allTimeHighIndex>0)||!Number.isFinite(allTimeHighIndex))return null;
    const index=Math.max(book.syIndex,allTimeHighIndex);
    const price=-Math.expm1(-(node.price/1e6)*(book.maturity-now)/31536000)/index;
    if(!(price>0)||!Number.isFinite(price)||offer.amount>BigInt(Number.MAX_SAFE_INTEGER))return null;
    return Math.floor(Number(offer.amount)/price);
  }
  function postEvents(tx) {
    if(!tx||tx.meta?.err)return [];
    const keys=(tx.transaction?.message?.accountKeys||[]).map(k=>typeof k==='string'?k:k.pubkey);
    if(typeof tx.transaction?.message?.accountKeys?.[0]==='string')keys.push(...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[]));
    const events=[];
    for(const group of tx.meta.innerInstructions||[])for(let i=0;i<group.instructions.length;i++){
      try {
      const ix=group.instructions[i];if((ix.programId||keys[ix.programIdIndex])!==PROGRAM||!ix.data)continue;
      const bytes=unbase58(ix.data);const hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
      if(hex!=='e445a52e51cb9a1d198f66ce79aabdf8')continue;
      const r=reader(bytes);r.skip(16);const owner=r.key(),book=r.key(),vault=r.key(),price=r.u32(),amount=r.u64(),side=r.u8(),virtual=r.u8(),expirySeconds=r.u32();
      // FillOrKill enum variant 0 followed by its boolean field.
      const option=r.u8(),fillOrKill=r.u8();if(option!==0||fillOrKill>1)continue;
      const stripped=r.u64(),merged=r.u64(),out=r.u64(),some=r.u8();if(some!==1)continue;const id=r.u32(),filled=r.u32();if(filled!==0)continue;
      const lastPrice=r.u32(),syIndex=r.fixed();if(r.offset!==bytes.length)continue;
      events.push({owner,book,vault,price,amount:amount.toString(),side,virtual,expirySeconds,id,stripped:stripped.toString(),merged:merged.toString(),out:out.toString(),lastPrice,syIndex,outer:group.index,inner:i,slot:tx.slot,transactionIndex:tx.transactionIndex,ts:tx.blockTime});
      } catch { /* Unsupported or truncated events must never break the feed. */ }
    }return events;
  }
  const api={PROGRAM,base58,unbase58,decodeBook,queue,ytAmount,postEvents};
  if(typeof module!=='undefined')module.exports=api;else root.ExponentBook=api;
})(typeof window==='undefined'?globalThis:window);
