'use strict';
const ORDER_STORAGE = 'exponent-order-markers-v1';
const orderWatch = {markers:[],history:{},books:new Map(),scans:new Map(),transactions:new Map(),busy:false,historyBusy:false,retryAt:0,error:'',revision:0};
function orderKey(e){return `${e.signature}:${e.outer}:${e.inner}`;}
function validMarker(m){return m && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(m.signature) && m.side===2 && m.virtual===0 && Number.isInteger(m.id) && m.id>0 && Number.isInteger(m.price) && Number.isFinite(m.ts) && /^[0-9]+$/.test(m.amount);}
function loadOrderMarkers(){
  try {const s=JSON.parse(localStorage.getItem(ORDER_STORAGE)||'{}');orderWatch.markers=Array.isArray(s.markers)?s.markers.filter(validMarker):[];orderWatch.history=s.history&&typeof s.history==='object'?s.history:{};for(const h of Object.values(orderWatch.history)){h.complete=false;h.events=Array.isArray(h.events)?h.events.filter(e=>e&&Number.isInteger(e.slot)&&typeof e.signature==='string'):[];}}
  catch{orderWatch.error='Unable to restore markers';}
}
function saveOrderMarkers(){
  try{localStorage.setItem(ORDER_STORAGE,JSON.stringify({markers:orderWatch.markers,history:orderWatch.history}));}
  catch{orderWatch.error='Markers could not be saved. Keep this page open.';}
}
async function orderRpc(method,params){
  const cacheKey=method==='getTransaction'?params[0]:null;
  if(cacheKey&&orderWatch.transactions.has(cacheKey))return orderWatch.transactions.get(cacheKey);
  if(Date.now()<orderWatch.retryAt)throw Error('Orderbook rate limited; waiting to retry');
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),8000);
  try{
    const response=await fetch(getProxy(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:c.signal});
    if(response.status===429){orderWatch.retryAt=Date.now()+apyRetryDelay(response.headers.get('Retry-After'));throw Error('Orderbook rate limited; waiting to retry');}
    if(!response.ok)throw Error(`Orderbook request failed (${response.status})`);
    const j=await response.json();if(j.error){if(j.error.code===429)orderWatch.retryAt=Date.now()+30000;throw Error(j.error.message||'Orderbook RPC error');}
    if(cacheKey&&j.result){orderWatch.transactions.set(cacheKey,j.result);while(orderWatch.transactions.size>500)orderWatch.transactions.delete(orderWatch.transactions.keys().next().value);}
    return j.result;
  }finally{clearTimeout(timer);}
}
function orderMarkButtons(tx){
  return (tx.postOffers||[]).filter(e=>e.id>0&&e.side===2&&!e.virtual&&e.owner===tx.from).map(e=>{
    const m={...e,signature:tx.sig},saved=orderWatch.markers.some(x=>orderKey(x)===orderKey(m));
    return `<button type="button" class="mark-order" data-mark-signature="${escapeHtml(tx.sig)}" data-mark-event="${e.outer}:${e.inner}" ${saved?'disabled':''}>${saved?'Marked':`Mark #${e.id}`}</button>`;
  }).join('');
}
async function importOrderMarker(signature,eventId){
  const tx=await orderRpc('getTransaction',[signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'finalized'}]);
  if(!tx||tx.meta?.err)throw Error('A successful, finalized Post Offer is required');
  const signer=tx.transaction.message.accountKeys[0];
  const events=ExponentBook.postEvents(tx).filter(e=>e.id>0&&e.side===2&&!e.virtual&&e.owner===signer&&(!eventId||`${e.outer}:${e.inner}`===eventId));
  if(!events.length)throw Error('No supported buy-YT Post Offer found. This event cannot be verified yet.');
  for(const e of events){
    const m={...e,signature};if(!validMarker(m))throw Error('Invalid Post Offer data');
    if(orderWatch.markers.some(x=>orderKey(x)===orderKey(m)))continue;
    orderWatch.markers.push(m);
    // A newly added older marker requires a fresh history backfill.
    delete orderWatch.history[m.book];orderWatch.scans.delete(m.book);
  }
  orderWatch.revision++;orderWatch.error='';saveOrderMarkers();renderOrderMarkers();renderCurrentTransactions();void refreshOrderWatch();
}
function orderMarket(m){return (apyState.markets||[]).find(x=>x.vaultAddress===m.vault&&x.orderbookAddresses?.includes(m.book));}
function compareOrderEvent(a,b){
  if(!Number.isInteger(a.slot)||!Number.isInteger(b.slot))return null;
  if(a.slot!==b.slot)return a.slot-b.slot;
  if(a.signature!==b.signature){if(!Number.isInteger(a.transactionIndex)||!Number.isInteger(b.transactionIndex))return null;return a.transactionIndex-b.transactionIndex;}
  return a.outer-b.outer||a.inner-b.inner;
}
function markerPosition(book,m,now){
  if(book.vault!==m.vault)throw Error('Vault mismatch');
  const all=ExponentBook.queue(book,m.price,2,now),index=all.findIndex(o=>o.id===m.id&&o.owner===m.owner&&o.created===m.ts&&o.expiry===m.ts+m.expirySeconds&&o.amount<=BigInt(m.amount)&&!o.virtual);
  if(index<0)return {missing:true};
  return {index,total:all.length,offer:all[index],ahead:all.slice(0,index),behind:all.slice(index+1)};
}
function renderOrderMarkers(){
  const body=document.getElementById('orderMarkers');if(!body)return;
  const esc=escapeHtml;const cards=[];
  for(const m of orderWatch.markers){
    const market=orderMarket(m),asset=Object.entries(ASSETS).find(([,a])=>a.mint===market?.underlyingAsset?.mint);
    if(asset&&selectedAssets.size&&!selectedAssets.has(asset[0]))continue;
    const label=asset?.[1].label||'YT',snapshot=orderWatch.books.get(m.book),fresh=snapshot&&!snapshot.error&&Date.now()-snapshot.checkedAt<12000;
    const history=orderWatch.history[m.book];
    const reused=(history?.events||[]).some(e=>e.book===m.book&&e.id===m.id&&compareOrderEvent(e,m)>0);
    let position='Verifying…',metrics='',note='';
    if(snapshot?.book){
      try{
        const b=snapshot.book,p=reused?{missing:true}:markerPosition(b,m,snapshot.time);
        if(p.missing){position='Not currently queued';note='Removed, filled or expired — reason not yet verified.';}
        else{
          position=`${p.index+1} / ${p.total}${p.index===p.total-1?' · Last in queue':''}`;
          const canEstimate=market&&!apyState.error&&Date.now()-apyState.checkedAt<12000&&Number.isInteger(market.decimals);
          const qty=o=>canEstimate?ExponentBook.ytAmount(b,o,snapshot.time,market.allTimeHighSyExchangeRate):null;
          const sum=xs=>{let n=0;for(const o of xs){const v=qty(o);if(v===null)return null;n+=v;}return n;};
          const format=n=>n===null||!Number.isInteger(market?.decimals)?'—':(n/10**market.decimals).toLocaleString('en-US',{maximumFractionDigits:2});
          metrics=`<div class="order-metrics"><span>My est. YT<strong>${format(qty(p.offer))}</strong></span><span>Ahead · ${p.ahead.length} orders<strong>${format(sum(p.ahead))} YT</strong></span><span>Behind · ${p.behind.length} orders<strong>${format(sum(p.behind))} YT</strong></span></div>`;
          note=p.offer.amount<BigInt(m.amount)?'Remaining amount below original input.':'Same exact price · Buy YT';
        }
      }catch{position='Position unverified';note='Orderbook links could not be verified.';}
    }
    if(!fresh){position=snapshot?.book?`${position} · Stale`:'Position unverified';note=snapshot?.error||'Waiting for a fresh on-chain snapshot.';}
    let later='Syncing posts after marker…';
    if(history?.complete){
      const comparisons=(history.events||[]).filter(e=>e.id>0).map(e=>compareOrderEvent(e,m));
      later=comparisons.some(x=>x===null)?'Later posts: order unverified':`${comparisons.filter(x=>x>0).length} decoded Post Offers after marker · same market`;
    }
    cards.push(`<article class="order-marker"><header><strong>${esc(label)} · Order #${m.id}</strong><span title="Raw price: ${m.price}">${(Math.expm1(m.price/1e6)*100).toFixed(8)}% APY</span><button type="button" data-remove-marker="${esc(orderKey(m))}">Unmark</button></header><p>${market?esc(apyDate(market.maturityDateUnixTs*1000))+' · ':''}<a class="sig-link" target="_blank" rel="noopener noreferrer" href="https://solscan.io/tx/${esc(m.signature)}">${esc(sh(m.signature))}</a> · ${esc(sh(m.owner))}</p><p><strong>${esc(position)}</strong> · ${esc(note)}</p>${metrics}<p>${esc(later)}${history?.error?' · '+esc(history.error):''}</p><p title="YT estimates use the live price, time remaining and reference index; not a guarantee of execution or rewards.">Estimated YT before fees · Queue at this price only</p></article>`);
  }
  const html=cards.join('');if(body.innerHTML!==html)body.innerHTML=html;
  document.getElementById('orderStatus').textContent=orderWatch.error||(orderWatch.markers.length?'':'Mark your Post Offer to check its live queue.');
}
async function syncOrderHistory(book,revision){
  const markers=orderWatch.markers.filter(m=>m.book===book);if(!markers.length)return;
  let h=orderWatch.history[book];if(!h)h=orderWatch.history[book]={events:[],complete:false,checkpoint:null};
  if(h.retryAt>Date.now())return;
  let scan=orderWatch.scans.get(book);
  if(!scan){scan={before:null,head:null,events:[],stop:h.checkpoint,baseline:new Set(markers.map(m=>m.signature)),found:new Set(),oldest:Math.min(...markers.map(m=>m.slot))};orderWatch.scans.set(book,scan);}
  const page=await orderRpc('getSignaturesForAddress',[book,{limit:100,commitment:'finalized',...(scan.before?{before:scan.before}:{})}]);
  if(revision!==orderWatch.revision)return;
  if(!scan.head)scan.head=page[0]?.signature||h.checkpoint;
  let done=false;const todo=[];
  for(const s of page){
    if(s.signature===scan.stop){done=true;break;}
    if(scan.baseline.has(s.signature))scan.found.add(s.signature);
    if(!scan.stop&&s.slot<scan.oldest){done=true;break;}
    if(!s.err)todo.push(s);
  }
  const decoded=await mapWithConcurrency(todo,2,async s=>{
    const tx=await orderRpc('getTransaction',[s.signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'finalized'}]);
    if(!tx)throw Error('Historical transaction unavailable');
    const events=ExponentBook.postEvents(tx);
    if(tx.meta?.logMessages?.includes('Program log: Instruction: PostOffer')&&!events.length)throw Error('Unsupported historical Post Offer; history incomplete');
    return events.filter(e=>e.book===book).map(e=>({...e,signature:s.signature}));
  });
  if(revision!==orderWatch.revision)return;
  scan.events.push(...decoded.flat());
  if(scan.events.length+(h.events?.length||0)>10000)throw Error('History storage limit reached; live queue remains available');
  if(!page.length){if(scan.stop)throw Error('History checkpoint unavailable; history incomplete');done=true;}
  if(done){
    if(!scan.stop&&markers.some(m=>!scan.found.has(m.signature)))throw Error('Marker not found in available history');
    const unique=new Map([...(h.events||[]),...scan.events].map(e=>[orderKey(e),e]));
    h.events=Array.from(unique.values());h.checkpoint=scan.head;h.complete=true;h.error='';orderWatch.scans.delete(book);saveOrderMarkers();
  }else{scan.before=page.at(-1).signature;h.complete=false;}
}
async function refreshOrderWatch(){
  if(orderWatch.busy||!orderWatch.markers.length||Date.now()<orderWatch.retryAt||!getProxy())return;
  orderWatch.busy=true;const revision=orderWatch.revision;
  try{
    for(const address of new Set(orderWatch.markers.map(m=>m.book))){
      try{
        const a=await orderRpc('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);
        if(a?.value?.owner!==ExponentBook.PROGRAM)throw Error('Unexpected orderbook account owner');
        const bytes=Uint8Array.from(atob(a.value.data[0]),c=>c.charCodeAt(0));
        const book=ExponentBook.decodeBook(bytes),time=await orderRpc('getBlockTime',[a.context.slot]);
        if(!Number.isFinite(time))throw Error('Snapshot block time unavailable');
        if(a.context.slot<Math.max(...orderWatch.markers.filter(m=>m.book===address).map(m=>m.slot))||Math.abs(Date.now()/1000-time)>30)throw Error('Orderbook snapshot is stale');
        if(revision!==orderWatch.revision)return;
        orderWatch.books.set(address,{book,time,slot:a.context.slot,checkedAt:Date.now(),error:''});renderOrderMarkers();
      }catch(e){const previous=orderWatch.books.get(address)||{};orderWatch.books.set(address,{...previous,error:e.name==='AbortError'?'Orderbook timed out':e.message});}
    }
  }finally{orderWatch.busy=false;renderOrderMarkers();}
}
async function refreshOrderHistory(){
  if(orderWatch.historyBusy||!orderWatch.markers.length||Date.now()<orderWatch.retryAt||!getProxy())return;
  orderWatch.historyBusy=true;const revision=orderWatch.revision;
  try{for(const address of new Set(orderWatch.markers.map(m=>m.book))){
    try{await syncOrderHistory(address,revision);}catch(e){const h=orderWatch.history[address];if(h&&revision===orderWatch.revision){h.complete=false;h.error=e.message;h.retryAt=Date.now()+30000;orderWatch.scans.delete(address);}}
  }}finally{orderWatch.historyBusy=false;renderOrderMarkers();}
}
document.addEventListener('click',async e=>{
  const mark=e.target.closest('[data-mark-signature]'),remove=e.target.closest('[data-remove-marker]');
  if(mark){try{mark.disabled=true;await importOrderMarker(mark.dataset.markSignature,mark.dataset.markEvent);}catch(error){orderWatch.error=error.message;mark.disabled=false;renderOrderMarkers();}}
  if(remove){orderWatch.markers=orderWatch.markers.filter(m=>orderKey(m)!==remove.dataset.removeMarker);orderWatch.revision++;const books=new Set(orderWatch.markers.map(m=>m.book));for(const key of Object.keys(orderWatch.history))if(!books.has(key)){delete orderWatch.history[key];orderWatch.scans.delete(key);}saveOrderMarkers();renderOrderMarkers();renderCurrentTransactions();}
});
document.getElementById('importOrderForm').addEventListener('submit',async e=>{
  e.preventDefault();const input=document.getElementById('importOrder');const raw=input.value.trim();
  const signature=raw.match(/^(?:https:\/\/solscan\.io\/tx\/)?([1-9A-HJ-NP-Za-km-z]{80,90})(?:\?.*)?$/)?.[1];
  if(!signature){orderWatch.error='Enter a valid Post Offer signature or Solscan link';renderOrderMarkers();return;}
  const button=e.target.querySelector('button');button.disabled=true;
  try{await importOrderMarker(signature);input.value='';}catch(error){orderWatch.error=error.message;renderOrderMarkers();}finally{button.disabled=false;}
});
window.addEventListener('load',()=>{loadOrderMarkers();renderOrderMarkers();void refreshOrderWatch();});
setInterval(()=>{renderOrderMarkers();void refreshOrderWatch();void refreshOrderHistory();},2000);
