/* DOM-free wallet discovery and fill evidence, shared by browser and Windows monitor. */
'use strict';
function validWalletFillState(value){
  return value&&typeof value.remaining==='string'&&/^\d{1,20}$/.test(value.remaining)&&BigInt(value.remaining)>0n&&BigInt(value.remaining)<=18446744073709551615n&&Number.isSafeInteger(value.slot)&&value.slot>0;
}
function attachWalletFillEvidence(records,groups,snapshots,market){
  const byKey=new Map(records.map(r=>[orderWatchKey(r),r]));
  for(const group of groups)for(const row of group.rows){
    if(!row.position)continue;
    const side=row.order.order_type==='sellYT'?'sell':'buy';
    const candidate=orderWatchRecord(row.order,market,'proof',side);if(!candidate)continue;
    const record=byKey.get(orderWatchKey(candidate)),snapshot=snapshots.get(row.order.orderbook_address);
    const amount=row.order.amount_remaining;
    if(!record||!snapshot||snapshot.error||Date.now()-snapshot.checkedAt>12000||typeof amount==='number'&&!Number.isSafeInteger(amount))continue;
    const evidence={remaining:String(amount),slot:snapshot.slot};
    if(validWalletFillState(evidence)&&BigInt(evidence.remaining)<=BigInt(record.original))record.fillEvidence=evidence;
  }
}
function walletPartialFill(r,evidence,enabled){
  if(!validWalletFillState(evidence)||BigInt(evidence.remaining)>BigInt(r.original))return false;
  const previous=r.fillState;
  if(!validWalletFillState(previous)){r.fillState=evidence;return false;}
  if(evidence.slot<=previous.slot)return false;
  if(BigInt(evidence.remaining)>BigInt(previous.remaining))return false;
  if(enabled&&BigInt(evidence.remaining)<BigInt(previous.remaining))return true;
  r.fillState=evidence;return false;
}
function validMonitorWallet(value){
  try{return typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)&&ExponentBook.unbase58(value).length===32;}catch{return false;}
}
function walletMarkets(markets,now=Date.now()/1000){
  const mints=new Map(Object.entries(ASSETS).map(([key,a])=>[a.mint,key])),seen=new Set();
  return (markets||[]).filter(m=>{
    if(!mints.has(m?.underlyingAsset?.mint)||!(m.maturityDateUnixTs>now)||!m.orderbookAddresses?.length||seen.has(m.vaultAddress))return false;
    seen.add(m.vaultAddress);return true;
  }).map(m=>({market:m,assetKey:mints.get(m.underlyingAsset.mint)}));
}
async function scanWalletMarket(market,assetKey,wallets=walletMonitor.wallets){
  const orders=await placementOpenOrders(market.vaultAddress),ordersAt=Date.now();
  const buys=buyOpenOrders(orders,market,ordersAt/1000).filter(o=>o.order_type==='buyYT'&&wallets.has(o.user_address));
  const sells=sellOpenOrders(orders,market,ordersAt/1000).filter(o=>o.order_type==='sellYT'&&wallets.has(o.user_address));
  const records=[...buys.map(o=>{const r=orderWatchRecord(o,market,assetKey,'buy');return r?{...r,remainingYt:buyYtEstimate(o,market,ordersAt/1000)}:null;}),...sells.map(o=>{const r=orderWatchRecord(o,market,assetKey,'sell');return r?{...r,remainingYt:sellYtEstimate(o,market)}:null;})].filter(Boolean);
  if(!records.length)return {market,records,groups:[],sellGroups:[],checkedAt:ordersAt};
  try{
    const snapshots=new Map(await Promise.all(market.orderbookAddresses.map(async address=>[address,await getOrderBookSnapshot(address)])));
    // Only the front-to-personal range can affect wallet positions/fills. Do not
    // fetch historical placement proofs for the opposite side or later levels.
    const buyRange=bookPositionLayout(buyGroups(orders,market,snapshots,Date.now()/1000),o=>o.order_type==='buyYT'&&wallets.has(o.user_address)).focusedGroups;
    const sellRange=bookPositionLayout(sellGroups(orders,market,snapshots,Date.now()/1000),o=>o.order_type==='sellYT'&&wallets.has(o.user_address)).focusedGroups;
    const buyReconciled=await reconcileBuyOrders(buyRange.flatMap(g=>g.rows.map(row=>row.order)),market,snapshots),sellReconciled=await reconcileSellOrders(sellRange.flatMap(g=>g.rows.map(row=>row.order)),market,snapshots);
    if(Date.now()-ordersAt>12000||[...snapshots.values()].some(s=>s.error||Date.now()-s.checkedAt>12000))throw Error('Orderbook data is stale');
    const groups=buyGroups(buyReconciled,market,snapshots,Date.now()/1000),sell=sellGroups(sellReconciled,market,snapshots,Date.now()/1000);
    attachWalletFillEvidence(records,[...groups,...sell],snapshots,market);
    return {market,records,groups,sellGroups:sell,checkedAt:Date.now()};
  }catch(e){return {market,records,error:e.message};}
}
