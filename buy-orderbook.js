/* Read-only Farm buy-side view. API quantities mirror Exponent's public Farm
 * book conversion; FIFO is independently checked against linked on-chain offers. */
'use strict';
function buyRawAmount(value) {
  if(typeof value==='number' && (!Number.isSafeInteger(value)||value<0))return null;
  if(!/^\d+$/.test(String(value)))return null;
  const n=BigInt(value);return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;
}
function buyOrderApy(raw) {
  if(!Number.isSafeInteger(raw)||raw<0)return null;
  const apy=100*Math.expm1(raw/1e6);return Number.isFinite(apy)?apy:null;
}
function buyYtEstimate(order,market,now) {
  const amount=buyRawAmount(order.amount_remaining);
  if(amount===null||!Number.isInteger(market.decimals)||market.decimals<0||market.decimals>18)return null;
  if(order.order_type==='sellPT')return amount/10**market.decimals;
  if(order.order_type!=='buyYT'||buyOrderApy(order.price_implied_apy)===null||!(market.syExchangeRate>0)||!Number.isFinite(market.syExchangeRate))return null;
  const seconds=60*Math.round(Math.max(market.maturityDateUnixTs-Math.floor(now),0)/60);
  const price=-Math.expm1(-order.price_implied_apy/1e6*seconds/31536000);
  const result=amount*market.syExchangeRate/price/10**market.decimals;
  return price>0&&Number.isFinite(result)?result:null;
}
function buyOpenOrders(orders,market,now) {
  return orders.filter(o=>o && o.vault_address===market.vaultAddress && market.orderbookAddresses?.includes(o.orderbook_address)
    && ['buyYT','sellPT'].includes(o.order_type) && o.is_removed===false
    && Date.parse(o.expiry_at)/1000>now && buyRawAmount(o.amount_remaining)!==0);
}
function buyQueuePosition(order,market,snapshot,now) {
  if(!snapshot?.book||snapshot.error||Date.now()-snapshot.checkedAt>12000)return null;
  const b=snapshot.book,raw=order.price_implied_apy,created=Date.parse(order.created_at)/1000,expiry=Date.parse(order.expiry_at)/1000;
  if(b.vault!==market.vaultAddress||b.maturity!==market.maturityDateUnixTs||b.priceDecimals!==6||!Number.isInteger(raw)
    ||!Number.isInteger(created)||expiry!==created+order.expiry_seconds||expiry<=now)return null;
  const original=buyRawAmount(order.original_amount),remaining=buyRawAmount(order.amount_remaining);
  if(original===null||remaining===null||remaining>original)return null;
  try{
    const chain=ExponentBook.queue(b,raw,2,now);
    const index=chain.findIndex(o=>o.id===order.offer_idx&&o.owner===order.user_address&&o.created===created&&o.expiry===expiry
      &&o.virtual===(order.order_type==='sellPT'?1:0)&&o.amount===BigInt(remaining)&&o.amount<=BigInt(original));
    return index<0?null:{index:index+1,total:chain.length};
  }catch{return null;}
}
function buyMarkedOrder(order,markers) {
  return markers.find(m=>m.signature===order.tx_signature&&m.book===order.orderbook_address&&m.vault===order.vault_address
    &&m.id===order.offer_idx&&m.owner===order.user_address&&m.price===order.price_implied_apy
    &&m.ts===Date.parse(order.created_at)/1000&&m.expirySeconds===order.expiry_seconds&&order.order_type==='buyYT');
}
function buyGroups(orders,market,snapshots,now,markers=[]) {
  const groups=new Map();
  for(const order of buyOpenOrders(orders,market,now)){
    const apy=buyOrderApy(order.price_implied_apy),bucket=apy===null||!Number.isFinite(apy)?null:Math.round(apy*10);
    const key=bucket===null?'unknown':String(bucket);
    if(!groups.has(key))groups.set(key,{key,apy:bucket===null?null:bucket/10,rows:[],total:0,unknown:false});
    const group=groups.get(key),yt=apy===null?null:buyYtEstimate(order,market,now);
    const position=buyQueuePosition(order,market,snapshots.get(order.orderbook_address),now);
    group.rows.push({order,apy,yt,position,marker:buyMarkedOrder(order,markers)});
    if(yt===null)group.unknown=true;else group.total+=yt;
  }
  for(const g of groups.values())g.rows.sort((a,b)=>b.order.price_implied_apy-a.order.price_implied_apy
    ||String(a.order.orderbook_address).localeCompare(String(b.order.orderbook_address))
    ||(a.position?.index??Infinity)-(b.position?.index??Infinity)
    ||String(a.order.id).localeCompare(String(b.order.id)));
  return [...groups.values()].sort((a,b)=>(b.apy??-Infinity)-(a.apy??-Infinity));
}
if(typeof module!=='undefined')module.exports={buyRawAmount,buyOrderApy,buyYtEstimate,buyOpenOrders,buyQueuePosition,buyMarkedOrder,buyGroups};

if(typeof window!=='undefined'){
  const buyViews=new Map();
  function buyQuantity(n){return n===null?'—':n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function renderBuyMarket(view){
    const stale=!!view.error||!!apyState.error||Date.now()-apyState.checkedAt>12000||Date.now()-view.checkedAt>12000;
    view.status.textContent=view.error?(view.orders?'Stale · ':'')+view.error:apyState.error?'Stale · Market data unavailable':!view.orders?'Loading orders…':stale?'Stale':'';
    if(!view.orders)return;
    const groups=buyGroups(view.orders,view.dataMarket||view.market,view.snapshots,view.checkedAt/1000,orderWatch.markers),live=new Set();
    if(!groups.length&&!view.error&&!apyState.error)view.status.textContent=stale?'Stale · No buy orders in last response':'No open buy orders';
    let groupIndex=0;
    for(const g of groups){
      live.add(g.key);let node=view.groups.get(g.key);
      if(!node){
        const details=document.createElement('details'),summary=document.createElement('summary'),scroll=document.createElement('div');
        details.className='book-group';scroll.className='book-scroll';details.append(summary,scroll);node={details,summary,scroll};view.groups.set(g.key,node);
      }
      const summary=`<span class="amount">${g.apy===null?'—':g.apy.toFixed(2)+'%'}</span><strong>${g.unknown?'—':buyQuantity(g.total)} YT${stale?' *':''}</strong><span class="book-hint">${g.rows.length} orders</span>`;
      if(node.summary.innerHTML!==summary)node.summary.innerHTML=summary;
      node.summary.title=stale?'Stale data':'0.1 percentage-point group · Estimated YT before fees';
      const rows=g.rows.map(({order:o,apy,yt,position,marker})=>{
        const verified=!stale&&position;
        const priceTitle=`Raw price: ${o.price_implied_apy} · ${apy===null?'Unknown APY':apy.toFixed(10)+'%'} · Book: ${o.orderbook_address}`;
        const action=marker?`<button type="button" data-remove-marker="${escapeHtml(orderKey(marker))}">Unmark</button>`
          :o.order_type==='buyYT'&&verified&&/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(o.tx_signature||'')?`<button type="button" data-buy-mark="${escapeHtml(o.tx_signature)}" data-buy-id="${o.offer_idx}">Mark</button>`:'';
        return `<tr class="${marker?'book-marked':''}"><td><a class="sig-link" target="_blank" rel="noopener noreferrer" title="${escapeHtml(o.user_address)}" href="https://solscan.io/account/${encodeURIComponent(o.user_address)}">${escapeHtml(sh(o.user_address))}</a>${marker?'<small>Marked order</small>':''}</td><td>#${escapeHtml(o.offer_idx)} <small>${escapeHtml(o.order_type)}</small>${action}</td><td class="amount" title="${escapeHtml(priceTitle)}">${apy===null?'—':apy.toFixed(2)+'%'}</td><td title="Estimated YT before fees${stale?' · Stale data':''}">${buyQuantity(yt)}${stale&&yt!==null?' *':''}</td><td title="At the exact raw price in this Orderbook; not the whole APY group">${verified?`${position.index} / ${position.total}`:'Unverified'}${stale?'<small>Stale</small>':''}</td></tr>`;
      }).join('');
      const html=`<table class="book-orders"><thead><tr><th>Wallet</th><th>Order ID / Type</th><th>Order APY</th><th>Remaining YT</th><th>Queue Position</th></tr></thead><tbody>${rows}</tbody></table>`;
      if(node.scroll.innerHTML!==html)node.scroll.innerHTML=html;
      // Do not detach unchanged accordions: that resets scroll anchoring/focus.
      if(view.content.children[groupIndex]!==node.details)view.content.insertBefore(node.details,view.content.children[groupIndex]||null);
      groupIndex++;
    }
    for(const [key,node] of view.groups)if(!live.has(key)){node.details.remove();view.groups.delete(key);}
  }
  async function refreshBuyMarket(view){
    if(!view.details.open||view.details.hidden||view.busy||Date.now()<view.retryAt||!view.market)return;
    view.busy=true;const market=view.market,identity=view.identity;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(`https://app.exponent.finance/api/open-orders/vault/${encodeURIComponent(market.vaultAddress)}`,{signal:controller.signal});
      if(response.status===429){view.retryAt=Date.now()+apyRetryDelay(response.headers.get('Retry-After'));throw Error('Rate limited; waiting to retry');}
      if(!response.ok)throw Error(`Unable to load orders (${response.status})`);
      const data=await response.json();if(!Array.isArray(data)||data.some(o=>!o||typeof o!=='object'||Array.isArray(o)))throw Error('Invalid open-order data');
      // Wait for every book, even when one fails, so the next poll never overlaps.
      const results=await Promise.all((market.orderbookAddresses||[]).map(async address=>{
        try{return [address,await getOrderBookSnapshot(address)];}catch(e){return [address,{...orderWatch.books.get(address),error:e.name==='AbortError'?'Orderbook timed out':e.message}];}
      }));
      if(view.identity!==identity)return;
      view.orders=data;view.dataMarket=market;view.snapshots=new Map(results);view.checkedAt=Date.now();view.error=results.some(([,s])=>s.error)?'On-chain queue unavailable; positions unverified':'';
      view.retryAt=0;
    }catch(e){if(view.identity===identity){view.error=e.name==='AbortError'?'Orders request timed out':e.message;if(!view.retryAt)view.retryAt=Date.now()+5000;}}
    finally{clearTimeout(timer);view.busy=false;if(view.identity===identity)renderBuyMarket(view);}
  }
  function renderBuyBooks(){
    const root=document.getElementById('buyBooks');if(!root)return;
    for(const [key,asset] of Object.entries(ASSETS)){
      let view=buyViews.get(key);
      if(!view){
        const details=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p'),content=document.createElement('div');
        details.className='book-market';status.className='book-status';status.setAttribute('role','status');details.append(summary,status,content);root.appendChild(details);
        view={details,summary,status,content,groups:new Map(),snapshots:new Map(),orders:null,checkedAt:0,busy:false,retryAt:0,error:''};buyViews.set(key,view);
        details.addEventListener('toggle',()=>{if(details.open){renderBuyMarket(view);void refreshBuyMarket(view);}});
      }
      const market=farthestApyMarket(apyState.markets||[],asset.mint,Date.now()/1000),identity=market?`${market.vaultAddress}:${market.maturityDateUnixTs}`:'';
      if(view.identity!==identity){view.identity=identity;view.details.open=false;view.orders=null;view.dataMarket=null;view.content.replaceChildren();view.groups.clear();view.error='';view.retryAt=0;view.status.textContent='';}
      view.market=market;view.details.hidden=selectedAssets.size>0&&!selectedAssets.has(key);
      const emptyLabel=apyState.markets?'No active market':apyState.error?'Market data unavailable':'Loading markets…';
      const html=`<strong>${escapeHtml(asset.label)}</strong><span class="book-hint">${market?escapeHtml(apyDate(market.maturityDateUnixTs*1000)):emptyLabel}</span>`;
      if(view.summary.innerHTML!==html)view.summary.innerHTML=html;
      if(view.details.open&&!view.details.hidden){if(market){renderBuyMarket(view);void refreshBuyMarket(view);}else view.status.textContent='No active market';}
    }
  }
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-buy-mark]');if(!button)return;
    button.disabled=true;
    try{
      const tx=await orderRpc('getTransaction',[button.dataset.buyMark,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'finalized'}]);
      const events=ExponentBook.postEvents(tx).filter(o=>o.id===Number(button.dataset.buyId)&&o.side===2&&!o.virtual);
      if(events.length!==1)throw Error('Order event is ambiguous; use the Post Offer transaction to mark it');
      await importOrderMarker(button.dataset.buyMark,`${events[0].outer}:${events[0].inner}`);
      renderBuyBooks();
    }catch(error){orderWatch.error=error.message;renderOrderMarkers();button.disabled=false;}
  });
  window.addEventListener('load',renderBuyBooks);
  window.renderBuyBooks=renderBuyBooks;
  setInterval(renderBuyBooks,2000);
}
