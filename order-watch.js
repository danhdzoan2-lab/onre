/* Watched orders use immutable order identities and complete on-chain books.
 * Never infer priority from rendered row order, API order, or rounded APY. */
'use strict';
// Release gate: see docs/order-watch-verification.md. Do not enable without
// recorded real-fill evidence for both price priority and linked same-price FIFO.
const ORDER_WATCH_PRIORITY_VERIFIED = false;
const ORDER_WATCH_STORAGE = 'exponent-watched-buy-orders-v1';
const orderWatchState = { records: new Map(), candidates: new Map(), nodes: new Map(), busy: false, storageError: false };
function orderWatchKey(r) {
  const identity=[r.book,r.vault,r.maturity,r.owner,r.offerId,r.rawPrice,r.created,r.expiry,r.original,r.signature];
  return JSON.stringify(r.orderSide==='sell'?['sell',...identity]:identity);
}
function orderWatchRecord(o, market, assetKey, orderSide='buy') {
  if(typeof o.original_amount==='number'&&!Number.isSafeInteger(o.original_amount))return null;
  const r = {assetKey,book:o.orderbook_address,vault:o.vault_address,maturity:market.maturityDateUnixTs,
    owner:o.user_address,offerId:o.offer_idx,rawPrice:o.price_implied_apy,created:Date.parse(o.created_at)/1000,
    expiry:Date.parse(o.expiry_at)/1000,original:String(o.original_amount),signature:o.tx_signature || '',
    orderSide,orderType:o.order_type,verified:false,front:null,ack:false,status:'Checking',detail:'Waiting for a fresh on-chain snapshot.'};
  const expected=orderSide==='sell'?'sellYT':'buyYT';
  if(o.order_type!==expected||!market.orderbookAddresses?.includes(r.book)||r.vault!==market.vaultAddress
    ||r.expiry!==r.created+o.expiry_seconds||!validOrderWatch(r))return null;
  return r;
}
function validOrderWatch(r) {
  return r && typeof r.assetKey==='string' && [r.book,r.vault,r.owner].every(s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s))
    && Number.isInteger(r.offerId)&&r.offerId>0&&r.offerId<=2500
    && Number.isInteger(r.rawPrice)&&r.rawPrice>=0&&r.rawPrice<=4294967295
    && Number.isFinite(100*Math.expm1(r.rawPrice/1000000))
    && [r.created,r.expiry,r.maturity].every(n=>Number.isInteger(n)&&n>0)&&r.expiry>r.created
    && typeof r.original==='string'&&/^\d{1,20}$/.test(r.original)&&BigInt(r.original)>0n
    && BigInt(r.original)<=18446744073709551615n&&typeof r.signature==='string'&&r.signature.length<=100;
}
function inspectWatchedOrder(r, snapshot, now=Date.now()/1000, priorityVerified=ORDER_WATCH_PRIORITY_VERIFIED) {
  const result=(status,detail,front=null)=>({status,detail,front});
  if(!snapshot?.book||snapshot.error||!snapshot.checkedAt||Date.now()-snapshot.checkedAt>12000
    ||!Number.isFinite(snapshot.time)||Math.abs(now-snapshot.time)>30)
    return result('Stale','Fresh on-chain data unavailable.');
  const b=snapshot.book;
  if(b.vault!==r.vault||b.maturity!==r.maturity||b.priceDecimals!==6)
    return result('Unverified','Book, maturity or price format does not match.');
  if(r.maturity<=now||r.expiry<=now)return result('Inactive','The watched order or market has expired.');
  let levels;
  try {
    const prices=new Set(), seen=new Set();
    levels=b.prices.map(p=>{
      if(!Number.isInteger(p.price)||prices.has(p.price))throw Error('Invalid price tree');
      prices.add(p.price);
      const offers=ExponentBook.queue(b,p.price,2,now);
      for(const o of offers){
        if(seen.has(o.id)||![0,1].includes(o.virtual)||!Number.isInteger(o.created)||o.created>o.expiry)throw Error('Invalid queue');
        seen.add(o.id);
      }
      return {price:p.price,offers};
    }).sort((a,b)=>b.price-a.price);
    // A live buy offer detached from the tree makes the snapshot ambiguous.
    for(const o of b.offers.values())if(o.side===2&&o.amount>0n&&o.expiry>=now&&!seen.has(o.id))throw Error('Detached offer');
  } catch { return result('Unverified','The complete buy-side queue could not be validated.'); }
  const level=levels.find(p=>p.price===r.rawPrice);
  const offer=level?.offers.find(o=>o.id===r.offerId);
  if(!offer) return result(r.verified?'Inactive':'Unverified',r.verified?'Order no longer present; fill/cancel reason is unknown.':'Order identity has not been verified.');
  if(offer.owner!==r.owner||offer.created!==r.created||offer.expiry!==r.expiry||offer.virtual!==0||offer.amount>BigInt(r.original))
    return result(r.verified?'Inactive':'Unverified','Offer ID or creation identity does not match; no replacement is followed.');
  if(!priorityVerified)return {...result('Unverified','Priority alarm unavailable: real-fill verification is pending.'),identityVerified:true};
  const first=levels.find(p=>p.offers.length)?.offers[0];
  const front=first===offer;
  return {...result(front?'At front':'Behind',front?'First live buy-side order in this Orderbook.':'A higher price or an earlier same-price order is ahead.',front),identityVerified:true};
}
function saveOrderWatches() {
  try {
    const records=[...orderWatchState.records.values()].map(({status,detail,lastSlot,placementText,placementDetail,groupPosition,...r})=>r);
    localStorage.setItem(ORDER_WATCH_STORAGE,JSON.stringify({records}));orderWatchState.storageError=false;
  } catch { orderWatchState.storageError=true; }
}
function orderWatchAlarmKey(key) { return 'order-watch:'+key; }
function updateWatchGroupPosition(order,market,assetKey,position,orderSide='buy') {
  const record=orderWatchRecord(order,market,assetKey,orderSide);if(!record)return;
  const watched=orderWatchState.records.get(orderWatchKey(record));if(!watched)return;
  if(watched.groupPosition?.checkedAt>position.checkedAt)return;
  watched.groupPosition=position;
  renderOrderWatches();
}
function acknowledgeOrderWatches() {
  let changed=false;
  for(const [key,r] of orderWatchState.records)if(limitAlarm.entries.has(orderWatchAlarmKey(key))){r.ack=true;changed=true;}
  if(changed)saveOrderWatches();
}
function orderWatchButton(o,market,assetKey,stale) {
  return '';
}
function orderWatchRowAttributes(o,market,assetKey) {
  const r=orderWatchRecord(o,market,assetKey);if(!r)return '';
  const key=orderWatchKey(r);
  return `data-order-key="${escapeHtml(key)}" data-watched="${orderWatchState.records.has(key)}" data-order-alarm="${limitAlarm.entries.has(orderWatchAlarmKey(key))||limitAlarm.entries.has('auto-limit:'+key)}"`;
}
function removeOrderWatch(key) {
  orderWatchState.records.delete(key);
  limitAlarm.entries.delete(orderWatchAlarmKey(key));
  saveOrderWatches();
  if(!limitAlarm.entries.size)stopLimitAlarm();else renderLimitAlarm();
  renderOrderWatches();
  if(typeof renderBuyBooks==='function')renderBuyBooks();
}
function toggleOrderWatch(key) {
  if(orderWatchState.records.has(key)){removeOrderWatch(key);return;}
  const candidate=orderWatchState.candidates.get(key);
  if(!candidate||candidate.stale||Date.now()-candidate.checkedAt>12000)return;
  orderWatchState.records.set(key,{...candidate.record});saveOrderWatches();renderOrderWatches();
  if(typeof renderBuyBooks==='function')renderBuyBooks();
  void pollOrderWatches();
}
function renderOrderWatches() {
  const root=document.getElementById('watchedBuyOrders');if(!root)return;
  root.hidden=orderWatchState.records.size===0;
  const note=document.getElementById('orderWatchStatus');
  note.textContent=orderWatchState.storageError?'Watch storage unavailable; changes apply to this session only.':
    '';
  note.hidden=!note.textContent;
  const list=document.getElementById('orderWatchList');
  for(const [key,r] of orderWatchState.records){
    let node=orderWatchState.nodes.get(key);
    if(!node){
      node=document.createElement('div');node.className='order-watch-item';
      const info=document.createElement('span'),state=document.createElement('span'),remove=document.createElement('button');
      state.setAttribute('role','status');remove.type='button';remove.textContent='Unwatch';remove.addEventListener('click',()=>removeOrderWatch(key));
      node.append(info,state,remove);node.info=info;node.state=state;list.appendChild(node);orderWatchState.nodes.set(key,node);
    }
    node.info.textContent=`${ASSETS[r.assetKey]?.label||r.assetKey} · #${r.offerId} · ${buyOrderApy(r.rawPrice).toFixed(2)}%`;
    node.info.title=`${r.owner} · ${r.book} · ${apyDate(r.maturity*1000)}`;
    const gp=r.groupPosition;
    node.state.textContent=gp?`Group ${gp.apy===null?'—':gp.apy.toFixed(2)+'%'}: ${gp.index} / ${gp.total}${gp.stale||Date.now()-gp.checkedAt>12000?' · Stale':''}`:(limitState.enabled?'Group position: Waiting for data':'Group position: Open market to load');
    node.state.title='Display position within the APY group, not verified execution priority. '+(r.detail||'');
    node.dataset.orderAlarm=String(limitAlarm.entries.has(orderWatchAlarmKey(key)));
  }
  for(const [key,node] of orderWatchState.nodes)if(!orderWatchState.records.has(key)){node.remove();orderWatchState.nodes.delete(key);}
}
async function pollOrderWatches() {
  if(orderWatchState.busy||!orderWatchState.records.size||!limitState.enabled)return;
  orderWatchState.busy=true;
  const proxy=getProxy(),generation=limitAlarm.generation;
  const entries=[...orderWatchState.records.entries()];
  try {
    const messages=[],alarmKeys=[];let changed=false;
    const results=new Map();
    for(const [key,r] of entries){
      if(orderWatchState.records.get(key)!==r)continue;
      let result;
      try{
        const identity=JSON.stringify([r.vault,r.maturity]);
        if(!results.has(identity))results.set(identity,await loadWatchedGroups(r));
        result=watchedGroupResult(r,results.get(identity));
      }catch(e){result={front:null,status:'Stale',detail:e.message};}
      if(orderWatchState.records.get(key)!==r||!limitState.enabled||getProxy()!==proxy)continue;
      r.status=result.status;r.detail=result.detail;
      if(result.position)r.groupPosition=result.position;
      else if(r.groupPosition)r.groupPosition.stale=true;
      if(result.front===null)continue; // Unknown data never re-arms an acknowledged alert.
      if(result.front===false){if(r.front!==false||r.ack){r.front=false;r.ack=false;changed=true;}continue;}
      if(r.front!==true){r.front=true;r.ack=false;changed=true;}
      const alarmKey=orderWatchAlarmKey(key);
      if(!r.ack&&limitState.enabled&&generation===limitAlarm.generation&&!limitAlarm.entries.has(alarmKey)){
        const message=`Watched order first in APY group · ${ASSETS[r.assetKey]?.label||r.assetKey} #${r.offerId} · Group ${result.position.apy.toFixed(2)}% · 1 / ${result.position.total} · Maturity ${apyDate(r.maturity*1000)}. Display position, not execution priority.`;
        limitAlarm.entries.set(alarmKey,message);messages.push(message);alarmKeys.push(alarmKey);
      }
    }
    if(changed)saveOrderWatches();
    if(messages.length){startLimitAlarmAudio();renderLimitAlarm();void notifyLimitAlarm(messages.join('\n'),()=>alarmKeys.every(key=>limitAlarm.entries.has(key)));}
  } finally {orderWatchState.busy=false;renderOrderWatches();}
}
async function loadWatchedGroups(r) {
  if(apyState.error||Date.now()-apyState.checkedAt>12000)throw Error('Market data is stale');
  const market=(apyState.markets||[]).find(m=>m.vaultAddress===r.vault&&m.maturityDateUnixTs===r.maturity);
  if(!market||!market.orderbookAddresses?.includes(r.book))throw Error('Watched market unavailable');
  const orders=await placementOpenOrders(r.vault),ordersAt=Date.now(),snapshots=new Map();
  // Use exactly the same grouping and sorting as the table, including other
  // books and virtual sellPT orders. A failed read must not reorder an alert.
  for(const address of market.orderbookAddresses){
    const snapshot=await getOrderBookSnapshot(address);
    if(snapshot.error||Date.now()-snapshot.checkedAt>12000)throw Error('Orderbook data is stale');
    snapshots.set(address,snapshot);
  }
  if(Date.now()-ordersAt>12000||[...snapshots.values()].some(s=>Date.now()-s.checkedAt>12000))throw Error('Orderbook data is stale');
  const reconciled=r.orderSide==='sell'?await reconcileSellOrders(orders,market,snapshots):await reconcileBuyOrders(orders,market,snapshots);
  if(Date.now()-ordersAt>12000||[...snapshots.values()].some(s=>Date.now()-s.checkedAt>12000))throw Error('Orderbook data is stale');
  return {market,groups:r.orderSide==='sell'?sellGroups(reconciled,market,snapshots,Date.now()/1000):buyGroups(reconciled,market,snapshots,Date.now()/1000),checkedAt:Date.now()};
}
function watchedGroupResult(r,data) {
  if(!data||Date.now()-data.checkedAt>12000)return {front:null,status:'Stale',detail:'Group data is stale'};
  if(r.expiry<=Date.now()/1000||r.maturity<=Date.now()/1000)return {front:null,status:'Inactive',detail:'Order expired'};
  for(const g of data.groups){
    const index=g.rows.findIndex(({order})=>{const candidate=orderWatchRecord(order,data.market,r.assetKey,r.orderSide||'buy');return candidate&&orderWatchKey(candidate)===orderWatchKey(r);});
    if(index>=0&&Number.isFinite(g.apy)){
      const hasQueueCompetition=g.rows.length>=2;
      return {front:hasQueueCompetition&&index===0,status:index===0?(hasQueueCompetition?'First in group':'Only order in group'):'Behind in group',detail:hasQueueCompetition?'Display position only; not execution priority.':'No alarm: this APY group has only one open order.',position:{index:index+1,total:g.rows.length,apy:g.apy,checkedAt:data.checkedAt,stale:false}};
    }
  }
  return {front:null,status:'Inactive',detail:'Watched order not present; no replacement followed'};
}
function initOrderWatches() {
  initWalletMonitor();
}
if(typeof module!=='undefined')module.exports={orderWatchKey,orderWatchRecord,validOrderWatch,inspectWatchedOrder,watchedGroupResult};
if(typeof window!=='undefined')window.addEventListener('load',initOrderWatches);
