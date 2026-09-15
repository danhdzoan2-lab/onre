/* Placement evidence is independent of matching priority. Finalized transactions
 * are cached in memory only; restored watches must obtain evidence again. */
'use strict';
const placementCache=new Map(),placementFlights=new Map();
const placementMarkets=new Map();
async function placementOpenOrders(vault) {
  let state=placementMarkets.get(vault);
  if(state&&Date.now()<state.retryAt)throw Error('Placement source is rate limited');
  if(state?.flight)return state.flight;
  if(state&&Date.now()-state.checkedAt<2000)return state.orders;
  if(!state){state={checkedAt:0,retryAt:0};placementMarkets.set(vault,state);}
  const flight=withBookRequest(async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(`https://app.exponent.finance/api/open-orders/vault/${encodeURIComponent(vault)}`,{signal:controller.signal});
    if(response.status===429){state.retryAt=Date.now()+apyRetryDelay(response.headers.get('Retry-After'));throw Error('Placement source is rate limited');}
    if(!response.ok)throw Error('Open orders unavailable');
    const orders=await response.json();if(!Array.isArray(orders)||orders.some(o=>!o||typeof o!=='object'||Array.isArray(o)))throw Error('Invalid open orders');
    state.orders=orders;state.checkedAt=Date.now();return orders;
  }catch(e){if(!state.retryAt||state.retryAt<Date.now())state.retryAt=Date.now()+5000;throw e;}
  finally{clearTimeout(timer);}
  }).finally(()=>{state.flight=null;});
  state.flight=flight;return flight;
}
async function placementRead(method,params) {
  const key=JSON.stringify([getProxy(),method,params]);
  if(placementCache.has(key))return placementCache.get(key);
  if(placementFlights.has(key))return placementFlights.get(key);
  const pending=orderRpc(method,params).then(value=>{
    if(!value)throw Error('Placement data unavailable');
    if(placementCache.size>=500)placementCache.delete(placementCache.keys().next().value);
    placementCache.set(key,value);return value;
  }).finally(()=>placementFlights.delete(key));
  placementFlights.set(key,pending);return pending;
}
function placementEvent(record,tx) {
  if(!tx||!tx.meta||tx.meta.err||!Number.isSafeInteger(tx.slot))return null;
  if(!tx.transaction?.signatures?.includes(record.signature))return null;
  const matches=ExponentBook.postEvents(tx).filter(e=>e.book===record.book&&e.vault===record.vault
    &&e.owner===record.owner&&e.id===record.offerId&&e.price===record.rawPrice
    &&e.side===2&&e.virtual===0&&e.amount===record.original&&e.expirySeconds===record.expiry-record.created);
  // Ambiguous repeated IDs in one transaction must not pick an arbitrary event.
  return matches.length===1?matches[0]:null;
}
async function getPlacement(record) {
  if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(record.signature))throw Error('Placement signature unavailable');
  const tx=await placementRead('getTransaction',[record.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  const event=placementEvent(record,tx);if(!event)throw Error('Post Offer identity mismatch');
  const block=await placementRead('getBlock',[tx.slot,{transactionDetails:'signatures',rewards:false,commitment:'finalized'}]);
  const indexes=(block.signatures||[]).map((s,i)=>s===record.signature?i:-1).filter(i=>i>=0);
  if(indexes.length!==1)throw Error('Transaction position unavailable');
  return {slot:tx.slot,transactionIndex:indexes[0],outer:event.outer,inner:event.inner};
}
async function reconcileBuyOrders(orders,market,snapshots) {
  const output=orders.map(({_chainCreated,_chainExpiry,...o})=>o);
  // Indexed timestamps can differ from Solana's clock. Repair only when the
  // finalized Post Offer identifies the current on-chain incarnation exactly.
  for(let i=0;i<output.length;i+=3)await Promise.all(output.slice(i,i+3).map(async o=>{
    if(o.order_type!=='buyYT'||buyQueuePosition(o,market,snapshots.get(o.orderbook_address),Date.now()/1000))return;
    const snapshot=snapshots.get(o.orderbook_address),book=snapshot?.book;
    if(!book||snapshot.error||book.vault!==market.vaultAddress||book.maturity!==market.maturityDateUnixTs)return;
    const offer=book.offers.get(o.offer_idx),price=book.prices.find(p=>p.id===offer?.pricePointer)?.price;
    if(!offer||offer.owner!==o.user_address||offer.side!==2||offer.virtual!==0||price!==o.price_implied_apy)return;
    const record=orderWatchRecord(o,market,'proof');if(!record||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(record.signature))return;
    try{
      const tx=await placementRead('getTransaction',[record.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
      const event=placementEvent(record,tx);
      if(!event||tx.blockTime!==offer.created||offer.expiry!==Math.min(offer.created+event.expirySeconds,book.maturity)
        ||snapshot.slot<tx.slot||offer.amount!==BigInt(o.amount_remaining)||offer.amount>BigInt(event.amount))return;
      o._chainCreated=offer.created;o._chainExpiry=offer.expiry;
    }catch{ /* Leave unresolved identities unverified; never guess an offset. */ }
  }));
  return output;
}
function comparePlacements(a,b) {
  for(const key of ['slot','transactionIndex','outer','inner']){
    if(!Number.isSafeInteger(a?.[key])||!Number.isSafeInteger(b?.[key]))return null;
    if(a[key]!==b[key])return Math.sign(a[key]-b[key]);
  }return 0;
}
async function updatePlacement(r,snapshot) {
  r.placementText='Placement: Unverified';
  try {
    const own=await getPlacement(r);
    r.placementText=`Placed: slot ${own.slot} · tx ${own.transactionIndex+1} · instruction ${own.outer+1}.${own.inner+1}`;
    r.placementDetail='Verified Post Offer event. Placement order is not execution priority.';
    // Only compare currently open, identity-verified orders at the exact price.
    // A filtered/collapsed view is not assumed to be a complete historical feed.
    if(!snapshot?.book||snapshot.error||Date.now()-snapshot.checkedAt>12000)return;
    const market={vaultAddress:r.vault,maturityDateUnixTs:r.maturity,orderbookAddresses:[r.book]};
    const orders=await placementOpenOrders(r.vault);
    const peers=buyOpenOrders(orders,market,Date.now()/1000).filter(o=>o.order_type==='buyYT'&&o.orderbook_address===r.book
      &&o.price_implied_apy===r.rawPrice&&o.vault_address===r.vault);
    const ownApi=peers.find(o=>{const p=orderWatchRecord(o,market,r.assetKey);return p&&orderWatchKey(p)===orderWatchKey(r);});
    if(!ownApi||!buyQueuePosition(ownApi,market,snapshot,Date.now()/1000)){
      r.placementDetail+=' Current open-order identity is unverified; no before/after count.';return;
    }
    let before=0,after=0,unknown=0;
    const deadline=Date.now()+6000;
    for(const o of peers){
      const peer=orderWatchRecord(o,market,r.assetKey);
      if(peer&&orderWatchKey(peer)===orderWatchKey(r))continue;
      if(Date.now()>deadline||!peer||!buyQueuePosition(o,market,snapshot,Date.now()/1000)){unknown++;continue;}
      try{const cmp=comparePlacements(await getPlacement(peer),own);if(cmp<0)before++;else if(cmp>0)after++;else unknown++;}
      catch{unknown++;}
    }
    if(Date.now()-snapshot.checkedAt>12000){r.placementDetail+=' Comparison snapshot is stale; counts withheld.';return;}
    r.placementText+=` · Observed: ${before} before / ${after} after${unknown?` / ${unknown} unverified`:''}`;
    r.placementDetail+=' Current API buyYT subset at the same raw price; excludes virtual sellPT. Not a full queue rank.';
  }catch(e){r.placementDetail=e.message;}
}
if(typeof module!=='undefined')module.exports={placementEvent,comparePlacements};
