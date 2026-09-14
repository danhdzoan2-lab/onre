/* Watched orders use immutable order identities and complete on-chain books.
 * Never infer priority from rendered row order, API order, or rounded APY. */
'use strict';
// Release gate: see docs/order-watch-verification.md. Do not enable without
// recorded real-fill evidence for both price priority and linked same-price FIFO.
const ORDER_WATCH_PRIORITY_VERIFIED = false;
const ORDER_WATCH_STORAGE = 'exponent-watched-buy-orders-v1';
const orderWatchState = { records: new Map(), candidates: new Map(), nodes: new Map(), busy: false, storageError: false };
function orderWatchKey(r) {
  return JSON.stringify([r.book,r.vault,r.maturity,r.owner,r.offerId,r.rawPrice,r.created,r.expiry,r.original,r.signature]);
}
function orderWatchRecord(o, market, assetKey) {
  if(typeof o.original_amount==='number'&&!Number.isSafeInteger(o.original_amount))return null;
  const r = {assetKey,book:o.orderbook_address,vault:o.vault_address,maturity:market.maturityDateUnixTs,
    owner:o.user_address,offerId:o.offer_idx,rawPrice:o.price_implied_apy,created:Date.parse(o.created_at)/1000,
    expiry:Date.parse(o.expiry_at)/1000,original:String(o.original_amount),signature:o.tx_signature || '',
    verified:false,front:null,ack:false,status:'Checking',detail:'Waiting for a fresh on-chain snapshot.'};
  if(o.order_type!=='buyYT'||!market.orderbookAddresses?.includes(r.book)||r.vault!==market.vaultAddress
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
function updateWatchGroupPosition(order,market,assetKey,position) {
  const record=orderWatchRecord(order,market,assetKey);if(!record)return;
  const watched=orderWatchState.records.get(orderWatchKey(record));if(!watched)return;
  watched.groupPosition=position;
  renderOrderWatches();
}
function acknowledgeOrderWatches() {
  let changed=false;
  for(const [key,r] of orderWatchState.records)if(limitAlarm.entries.has(orderWatchAlarmKey(key))){r.ack=true;changed=true;}
  if(changed)saveOrderWatches();
}
function orderWatchButton(o,market,assetKey,stale) {
  const r=orderWatchRecord(o,market,assetKey);if(!r)return '';
  const key=orderWatchKey(r),watched=orderWatchState.records.has(key);
  orderWatchState.candidates.set(key,{record:r,checkedAt:Date.now(),stale});
  return `<button type="button" class="order-watch-button" data-order-watch="${escapeHtml(key)}" aria-pressed="${watched}" ${stale&&!watched?'disabled':''}>${watched?'Unwatch':'Watch'}</button>`;
}
function orderWatchRowAttributes(o,market,assetKey) {
  const r=orderWatchRecord(o,market,assetKey);if(!r)return '';
  const key=orderWatchKey(r);
  return `data-watched="${orderWatchState.records.has(key)}" data-order-alarm="${limitAlarm.entries.has(orderWatchAlarmKey(key))}"`;
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
    !ORDER_WATCH_PRIORITY_VERIFIED?'Order priority alarms unavailable — real-fill verification pending.':
    !limitState.enabled?'Order alarms paused. Turn on APY Alarm.':'';
  const list=document.getElementById('orderWatchList');
  for(const [key,r] of orderWatchState.records){
    let node=orderWatchState.nodes.get(key);
    if(!node){
      node=document.createElement('div');node.className='order-watch-item';
      const info=document.createElement('span'),state=document.createElement('span'),remove=document.createElement('button'),placement=document.createElement('span');
      state.setAttribute('role','status');remove.type='button';remove.textContent='Unwatch';remove.addEventListener('click',()=>removeOrderWatch(key));
      placement.className='book-hint order-placement';
      node.append(info,state,remove,placement);node.info=info;node.state=state;node.placement=placement;list.appendChild(node);orderWatchState.nodes.set(key,node);
    }
    node.info.textContent=`${ASSETS[r.assetKey]?.label||r.assetKey} · #${r.offerId} · ${buyOrderApy(r.rawPrice).toFixed(2)}%`;
    node.info.title=`${r.owner} · ${r.book} · ${apyDate(r.maturity*1000)}`;
    const gp=r.groupPosition;
    node.state.textContent=gp?`Group ${gp.apy===null?'—':gp.apy.toFixed(2)+'%'}: ${gp.index} / ${gp.total}${gp.stale||Date.now()-gp.checkedAt>12000?' · Stale':''}`:(limitState.enabled?'Group position: Waiting for data':'Group position: Open market to load');
    node.state.title='Display position within the APY group, not verified execution priority. '+(r.detail||'');
    node.placement.textContent=r.placementText||(limitState.enabled?'Placement: Checking':'On-chain tracking paused · APY Alarm is off');node.placement.title=r.placementDetail||'';
    node.dataset.orderAlarm=String(limitAlarm.entries.has(orderWatchAlarmKey(key)));
  }
  for(const [key,node] of orderWatchState.nodes)if(!orderWatchState.records.has(key)){node.remove();orderWatchState.nodes.delete(key);}
}
async function pollOrderWatches() {
  if(orderWatchState.busy||!orderWatchState.records.size||!limitState.enabled)return;
  orderWatchState.busy=true;
  const proxy=getProxy(),generation=limitAlarm.generation;
  const entries=[...orderWatchState.records.entries()];
  const addresses=[...new Set(entries.filter(([,r])=>r.status!=='Inactive').map(([,r])=>r.book))];
  const snapshots=new Map();
  try {
    // Bounded parallel reads; getOrderBookSnapshot also deduplicates with the UI.
    for(let i=0;i<addresses.length;i+=3)await Promise.all(addresses.slice(i,i+3).map(async address=>{
      try{snapshots.set(address,await getOrderBookSnapshot(address));}
      catch(e){snapshots.set(address,{error:e.message});}
    }));
    if(getProxy()!==proxy)return;
    const messages=[],alarmKeys=[];let changed=false;
    for(const [key,r] of entries){
      if(orderWatchState.records.get(key)!==r||r.status==='Inactive')continue;
      const snapshot=snapshots.get(r.book);
      if(snapshot?.slot&&r.lastSlot&&snapshot.slot<r.lastSlot){r.status='Stale';r.detail='Older snapshot ignored.';continue;}
      if(typeof updatePlacement==='function')await updatePlacement(r,snapshot);
      if(orderWatchState.records.get(key)!==r||!limitState.enabled||getProxy()!==proxy)continue;
      const result=inspectWatchedOrder(r,snapshot);
      r.status=result.status;r.detail=result.detail;
      if(result.identityVerified&&!r.verified){r.verified=true;changed=true;}
      if(snapshot?.slot)r.lastSlot=snapshot.slot;
      if(result.front===null)continue; // Unknown data never re-arms an acknowledged alert.
      if(result.front===false){if(r.front!==false||r.ack){r.front=false;r.ack=false;changed=true;}continue;}
      if(r.front!==true){r.front=true;r.ack=false;changed=true;}
      const alarmKey=orderWatchAlarmKey(key);
      if(!r.ack&&limitState.enabled&&generation===limitAlarm.generation&&!limitAlarm.entries.has(alarmKey)){
        const message=`Watched order at front · ${ASSETS[r.assetKey]?.label||r.assetKey} #${r.offerId} · ${buyOrderApy(r.rawPrice).toFixed(2)}% · Maturity ${apyDate(r.maturity*1000)}.`;
        limitAlarm.entries.set(alarmKey,message);messages.push(message);alarmKeys.push(alarmKey);
      }
    }
    if(changed)saveOrderWatches();
    if(messages.length){startLimitAlarmAudio();renderLimitAlarm();void notifyLimitAlarm(messages.join('\n'),()=>alarmKeys.every(key=>limitAlarm.entries.has(key)));}
  } finally {orderWatchState.busy=false;renderOrderWatches();}
}
function initOrderWatches() {
  try {
    const saved=JSON.parse(localStorage.getItem(ORDER_WATCH_STORAGE)||'{}');
    for(const r of Array.isArray(saved.records)?saved.records:[]){
      if(!validOrderWatch(r)||!Object.hasOwn(ASSETS,r.assetKey))continue;
      orderWatchState.records.set(orderWatchKey(r),{...r,verified:r.verified===true,front:typeof r.front==='boolean'?r.front:null,
        ack:r.ack===true,status:'Checking',detail:'Restored watch; resynchronizing.',lastSlot:0,placementText:'',placementDetail:'',groupPosition:null});
    }
  } catch {orderWatchState.storageError=true;}
  document.getElementById('buyBooks').addEventListener('click',event=>{
    const button=event.target.closest?.('button[data-order-watch]');
    if(button&&!button.disabled)toggleOrderWatch(button.dataset.orderWatch);
  });
  renderOrderWatches();void pollOrderWatches();setInterval(pollOrderWatches,2000);
}
if(typeof module!=='undefined')module.exports={orderWatchKey,orderWatchRecord,validOrderWatch,inspectWatchedOrder};
if(typeof window!=='undefined')window.addEventListener('load',initOrderWatches);
