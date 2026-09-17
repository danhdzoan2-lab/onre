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
  const b=snapshot.book,raw=order.price_implied_apy,created=order._chainCreated??Date.parse(order.created_at)/1000,expiry=order._chainExpiry??Date.parse(order.expiry_at)/1000;
  if(b.vault!==market.vaultAddress||b.maturity!==market.maturityDateUnixTs||b.priceDecimals!==6||!Number.isInteger(raw)
    ||!Number.isInteger(created)||expiry!==Math.min(created+order.expiry_seconds,b.maturity)||expiry<=now)return null;
  const original=buyRawAmount(order.original_amount),remaining=buyRawAmount(order.amount_remaining);
  if(original===null||remaining===null||remaining>original)return null;
  try{
    const chain=ExponentBook.queue(b,raw,2,now);
    const index=chain.findIndex(o=>o.id===order.offer_idx&&o.owner===order.user_address&&o.created===created&&o.expiry===expiry
      &&o.virtual===(order.order_type==='sellPT'?1:0)&&o.amount===BigInt(remaining)&&o.amount<=BigInt(original));
    return index<0?null:{index:index+1,total:chain.length};
  }catch{return null;}
}
function buyGroups(orders,market,snapshots,now) {
  const groups=new Map();
  for(const order of buyOpenOrders(orders,market,now)){
    const apy=buyOrderApy(order.price_implied_apy),bucket=apy===null||!Number.isFinite(apy)?null:Math.round(apy*10);
    const key=bucket===null?'unknown':String(bucket);
    if(!groups.has(key))groups.set(key,{key,apy:bucket===null?null:bucket/10,rows:[],total:0,unknown:false});
    const group=groups.get(key),yt=apy===null?null:buyYtEstimate(order,market,now);
    const position=buyQueuePosition(order,market,snapshots.get(order.orderbook_address),now);
    group.rows.push({order,apy,yt,position});
    if(yt===null)group.unknown=true;else group.total+=yt;
  }
  for(const g of groups.values())g.rows.sort((a,b)=>b.order.price_implied_apy-a.order.price_implied_apy
    ||String(a.order.orderbook_address).localeCompare(String(b.order.orderbook_address))
    ||(a.position?.index??Infinity)-(b.position?.index??Infinity)
    ||String(a.order.id).localeCompare(String(b.order.id)));
  return [...groups.values()].sort((a,b)=>(b.apy??-Infinity)-(a.apy??-Infinity));
}
if(typeof module!=='undefined')module.exports={buyRawAmount,buyOrderApy,buyYtEstimate,buyOpenOrders,buyQueuePosition,buyGroups};

if(typeof window!=='undefined'){
  const buyViews=new Map();
  window.buyBookHealth=new Map();
  function buyQuantity(n){return n===null?'—':n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function renderBuyMarket(view){
    window.buyBookHealth.set(view.assetKey,{open:view.details.open&&!view.details.hidden,checkedAt:view.checkedAt,error:!!view.error});
    const stale=!!view.error||!!apyState.error||Date.now()-apyState.checkedAt>(typeof apyMaxAge==='function'?apyMaxAge():12000)||Date.now()-view.checkedAt>12000;
    view.status.textContent=view.error?(view.orders?'Stale · ':'')+view.error:apyState.error?'Stale · Market data unavailable':!view.orders?'Loading orders…':stale?'Stale':'';
    if(!view.orders)return;
    const groups=buyGroups(view.orders,view.dataMarket||view.market,view.snapshots,view.checkedAt/1000),live=new Set();
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
      const rows=g.rows.map(({order:o,apy,yt,position},rowIndex)=>{
        const priceTitle=`Raw price: ${o.price_implied_apy} · ${apy===null?'Unknown APY':apy.toFixed(10)+'%'} · Book: ${o.orderbook_address}`;
        const watch=typeof orderWatchButton==='function'?orderWatchButton(o,view.dataMarket||view.market,view.assetKey,stale):'';
        const attrs=typeof orderWatchRowAttributes==='function'?orderWatchRowAttributes(o,view.dataMarket||view.market,view.assetKey):'';
        if(typeof updateWatchGroupPosition==='function')updateWatchGroupPosition(o,view.dataMarket||view.market,view.assetKey,{index:rowIndex+1,total:g.rows.length,apy:g.apy,stale,checkedAt:view.checkedAt});
        return `<tr ${attrs}><td><a class="sig-link" target="_blank" rel="noopener noreferrer" title="${escapeHtml(o.user_address)}" href="https://solscan.io/account/${encodeURIComponent(o.user_address)}">${escapeHtml(sh(o.user_address))}</a></td><td class="${rowIndex===0&&g.rows.length>=2?'position-first':rowIndex===1?'position-next':''}" title="Display position in this APY group">${rowIndex+1} / ${g.rows.length}${stale?' *':''}</td><td class="amount" title="${escapeHtml(priceTitle)}">${apy===null?'—':apy.toFixed(2)+'%'}</td><td class="amount" title="Current order rewards estimate from Exponent">${orderRewardsText(o)}</td><td title="Estimated YT before fees${stale?' · Stale data':''}">${buyQuantity(yt)}${stale&&yt!==null?' *':''}</td></tr>`;
      }).join('');
      const html=`<table class="book-orders"><thead><tr><th>Wallet</th><th>Group Position</th><th>Order APY</th><th>Rewards APY</th><th>Remaining YT</th></tr></thead><tbody>${rows}</tbody></table>`;
      if(node.scroll.innerHTML!==html){
        const focusKey=document.activeElement?.dataset?.orderWatch;
        node.scroll.innerHTML=html;
        if(focusKey)for(const button of node.scroll.querySelectorAll('button[data-order-watch]'))if(button.dataset.orderWatch===focusKey)button.focus({preventScroll:true});
      }
      // Do not detach unchanged accordions: that resets scroll anchoring/focus.
      if(view.content.children[groupIndex]!==node.details)view.content.insertBefore(node.details,view.content.children[groupIndex]||null);
      groupIndex++;
      if(view.pendingOrder){
        const target=[...node.scroll.querySelectorAll('tr[data-order-key]')].find(row=>row.dataset.orderKey===view.pendingOrder);
        if(target){node.details.open=true;target.tabIndex=-1;target.scrollIntoView({block:'center',behavior:'auto'});target.focus({preventScroll:true});view.pendingOrder=null;}
      }
    }
    for(const [key,node] of view.groups)if(!live.has(key)){node.details.remove();view.groups.delete(key);}
  }
  async function refreshBuyMarket(view){
    if(!view.details.open||view.details.hidden||view.busy||Date.now()<view.retryAt||!view.market)return;
    view.busy=true;const market=view.market,identity=view.identity;
    try{
      const data=await placementOpenOrders(market.vaultAddress);
      // Wait for every book, even when one fails, so the next poll never overlaps.
      const results=await Promise.all((market.orderbookAddresses||[]).map(async address=>{
        try{return [address,await getOrderBookSnapshot(address)];}catch(e){return [address,{...orderRpcState.books.get(address),error:e.name==='AbortError'?'Orderbook timed out':e.message}];}
      }));
      if(view.identity!==identity)return;
      const snapshots=new Map(results);
      const reconciled=typeof reconcileBuyOrders==='function'?await reconcileBuyOrders(data,market,snapshots):data;
      if(view.identity!==identity)return;
      view.orders=reconciled;view.dataMarket=market;view.snapshots=snapshots;view.checkedAt=Date.now();view.error=results.some(([,s])=>s.error)?'On-chain queue unavailable; positions unverified':'';
      view.retryAt=0;
    }catch(e){if(view.identity===identity){view.error=e.name==='AbortError'?'Orders request timed out':e.message;if(!view.retryAt)view.retryAt=Date.now()+5000;}}
    finally{view.busy=false;if(view.identity===identity)renderBuyMarket(view);}
  }
  function renderBuyBooks(){
    const root=document.getElementById('buyBooks');if(!root)return;
    for(const [key,asset] of Object.entries(ASSETS)){
      let view=buyViews.get(key);
      if(!view){
        const details=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p'),content=document.createElement('div');
        details.className='book-market';status.className='book-status';status.setAttribute('role','status');details.append(summary,status,content);root.appendChild(details);
        view={assetKey:key,details,summary,status,content,groups:new Map(),snapshots:new Map(),orders:null,checkedAt:0,busy:false,retryAt:0,error:''};buyViews.set(key,view);
        details.addEventListener('toggle',()=>{if(details.open){renderBuyMarket(view);void refreshBuyMarket(view);}});
      }
      const market=(apyState.markets||[]).find(m=>view.navigationVault===m.vaultAddress&&m.maturityDateUnixTs>Date.now()/1000)||farthestApyMarket(apyState.markets||[],asset.mint,Date.now()/1000),identity=market?`${market.vaultAddress}:${market.maturityDateUnixTs}`:'';
      if(view.identity!==identity){view.identity=identity;view.details.open=false;view.orders=null;view.dataMarket=null;view.content.replaceChildren();view.groups.clear();view.error='';view.retryAt=0;view.status.textContent='';}
      view.market=market;view.details.hidden=selectedAssets.size>0&&!selectedAssets.has(key);
      window.buyBookHealth.set(key,{open:view.details.open&&!view.details.hidden,checkedAt:view.checkedAt,error:!!view.error});
      const emptyLabel=apyState.markets?'No active market':apyState.error?'Market data unavailable':'Loading markets…';
      const html=`<strong>${escapeHtml(asset.label)}</strong><span class="book-hint">${market?escapeHtml(apyDate(market.maturityDateUnixTs*1000)):emptyLabel}</span>`;
      if(view.summary.innerHTML!==html)view.summary.innerHTML=html;
      if(view.details.open&&!view.details.hidden){if(market){renderBuyMarket(view);void refreshBuyMarket(view);}else view.status.textContent='No active market';}
    }
  }
  window.addEventListener('load',renderBuyBooks);
  window.renderBuyBooks=renderBuyBooks;
  window.openPersonalBuyOrder=function(key){
    const r=orderWatchState.records.get(key);if(!r)return;
    const market=(apyState.markets||[]).find(m=>m.vaultAddress===r.vault&&m.maturityDateUnixTs===r.maturity&&m.orderbookAddresses?.includes(r.book));if(!market)return;
    if(selectedAssets.size&&!selectedAssets.has(r.assetKey))setAssetFilter(r.assetKey);
    renderBuyBooks();const view=buyViews.get(r.assetKey);if(!view)return;
    view.navigationVault=r.vault;renderBuyBooks();view.pendingOrder=key;view.details.open=true;renderBuyMarket(view);void refreshBuyMarket(view);
  };
  setInterval(renderBuyBooks,2000);
}
