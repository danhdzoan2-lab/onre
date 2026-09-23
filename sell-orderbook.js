/* Read-only Farm sell-side view. One vault response is shared with the buy side;
 * same-price order is verified from the linked on-chain sell queue. */
'use strict';
function sellYtEstimate(order,market) {
  const amount=buyRawAmount(order.amount_remaining);
  if(amount===null||!Number.isInteger(market.decimals)||market.decimals<0||market.decimals>18)return null;
  return ['sellYT','buyPT'].includes(order.order_type)?amount/10**market.decimals:null;
}
function sellOpenOrders(orders,market,now) {
  return orders.filter(o=>o&&o.vault_address===market.vaultAddress&&market.orderbookAddresses?.includes(o.orderbook_address)
    &&['sellYT','buyPT'].includes(o.order_type)&&o.is_removed===false&&Date.parse(o.expiry_at)/1000>now&&buyRawAmount(o.amount_remaining)!==0);
}
function sellQueuePosition(order,market,snapshot,now) {
  if(!snapshot?.book||snapshot.error||Date.now()-snapshot.checkedAt>12000)return null;
  const b=snapshot.book,raw=order.price_implied_apy,created=order._chainCreated??Date.parse(order.created_at)/1000,expiry=order._chainExpiry??Date.parse(order.expiry_at)/1000;
  if(b.vault!==market.vaultAddress||b.maturity!==market.maturityDateUnixTs||b.priceDecimals!==6||!Number.isInteger(raw)
    ||!Number.isInteger(created)||expiry!==Math.min(created+order.expiry_seconds,b.maturity)||expiry<=now)return null;
  const original=buyRawAmount(order.original_amount),remaining=buyRawAmount(order.amount_remaining);
  if(original===null||remaining===null||remaining>original)return null;
  try{
    const chain=ExponentBook.queue(b,raw,1,now);
    const index=chain.findIndex(o=>o.id===order.offer_idx&&o.owner===order.user_address&&o.created===created&&o.expiry===expiry
      &&o.virtual===(order.order_type==='buyPT'?1:0)&&o.amount===BigInt(remaining)&&o.amount<=BigInt(original));
    return index<0?null:{index:index+1,total:chain.length};
  }catch{return null;}
}
function sellGroups(orders,market,snapshots,now) {
  const groups=new Map();
  for(const order of sellOpenOrders(orders,market,now)){
    const apy=buyOrderApy(order.price_implied_apy),bucket=apy===null?null:Math.round(apy*10),key=bucket===null?'unknown':String(bucket);
    if(!groups.has(key))groups.set(key,{key,apy:bucket===null?null:bucket/10,rows:[],total:0,unknown:false});
    const group=groups.get(key),yt=apy===null?null:sellYtEstimate(order,market),position=sellQueuePosition(order,market,snapshots.get(order.orderbook_address),now);
    group.rows.push({order,apy,yt,position});if(yt===null)group.unknown=true;else group.total+=yt;
  }
  for(const g of groups.values())g.rows.sort((a,b)=>a.order.price_implied_apy-b.order.price_implied_apy
    ||String(a.order.orderbook_address).localeCompare(String(b.order.orderbook_address))||(a.position?.index??Infinity)-(b.position?.index??Infinity)||String(a.order.id).localeCompare(String(b.order.id)));
  return [...groups.values()].sort((a,b)=>(a.apy??Infinity)-(b.apy??Infinity));
}
function sellVisibleGroups(groups,showAll,isPersonal) {
  return showAll?groups:groups.filter(group=>group.rows.some(row=>isPersonal(row.order)));
}
if(typeof module!=='undefined')module.exports={sellYtEstimate,sellOpenOrders,sellQueuePosition,sellGroups,sellVisibleGroups};

if(typeof window!=='undefined'){
  const views=new Map();window.sellBookHealth=new Map();
  const qty=n=>n===null?'—':n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  function renderSellMarket(view){
    window.sellBookHealth.set(view.assetKey,{open:view.details.open&&!view.details.hidden,checkedAt:view.checkedAt,error:!!view.error});
    const stale=!!view.error||!!apyState.error||Date.now()-apyState.checkedAt>(typeof apyMaxAge==='function'?apyMaxAge():12000)||Date.now()-view.checkedAt>12000;
    view.status.textContent=view.error?(view.orders?'Stale · ':'')+view.error:apyState.error?'Stale · Market data unavailable':!view.orders?'Loading orders…':stale?'Stale':'';
    if(!view.dot){view.dot=document.createElement('span');view.dot.className='data-health';view.dot.setAttribute('role','img');view.details.appendChild(view.dot);}
    view.dot.dataset.fresh=String(!stale&&!!view.orders);view.dot.title=stale?'Orderbook data unavailable or outdated':'Orderbook data up to date';view.dot.setAttribute('aria-label',view.dot.title);
    if(!view.orders)return;
    const market=view.dataMarket||view.market,allGroups=sellGroups(view.orders,market,view.snapshots,view.checkedAt/1000);
    const personal=order=>{const record=typeof orderWatchRecord==='function'?orderWatchRecord(order,market,view.assetKey,'sell'):null;return !!record&&orderWatchState.records.has(orderWatchKey(record));};
    const groups=sellVisibleGroups(allGroups,view.showAll,personal),live=new Set();
    view.modeText.textContent=view.showAll?'Showing all APY levels':'Showing my APY levels';view.modeButton.textContent=view.showAll?'My levels':'Show all';view.modeButton.setAttribute('aria-pressed',String(view.showAll));
    if(!groups.length&&!view.error&&!apyState.error)view.status.textContent=!view.showAll&&allGroups.length?(stale?'Stale · No personal sell orders in this market':'No personal sell orders in this market'):(stale?'Stale · No sell orders in last response':'No open sell orders');
    let groupIndex=0;
    for(const g of groups){
      live.add(g.key);let node=view.groups.get(g.key);
      if(!node){const details=document.createElement('details'),summary=document.createElement('summary'),scroll=document.createElement('div');details.className='book-group';scroll.className='book-scroll';details.append(summary,scroll);node={details,summary,scroll};view.groups.set(g.key,node);}
      const summary=`<span class="amount">${g.apy===null?'—':g.apy.toFixed(2)+'%'}</span><strong>${g.unknown?'—':qty(g.total)} YT${stale?' *':''}</strong><span class="book-hint">${g.rows.length} orders</span>`;
      if(node.summary.innerHTML!==summary)node.summary.innerHTML=summary;
      node.summary.title=stale?'Stale data':'0.1 percentage-point group · Estimated YT before fees';
      const rows=g.rows.map(({order:o,apy,yt},rowIndex)=>{
        const record=typeof orderWatchRecord==='function'?orderWatchRecord(o,view.dataMarket||view.market,view.assetKey,'sell'):null,key=record?orderWatchKey(record):'';
        const watched=key&&orderWatchState.records.has(key),alarm=key&&(limitAlarm.entries.has(orderWatchAlarmKey(key))||limitAlarm.entries.has('auto-limit:'+key));
        if(typeof updateWatchGroupPosition==='function')updateWatchGroupPosition(o,view.dataMarket||view.market,view.assetKey,{index:rowIndex+1,total:g.rows.length,apy:g.apy,stale,checkedAt:view.checkedAt},'sell');
        return `<tr data-order-key="${escapeHtml(key)}" data-watched="${watched}" data-order-alarm="${alarm}"><td><a class="sig-link" target="_blank" rel="noopener noreferrer" title="${escapeHtml(o.user_address)}" href="https://solscan.io/account/${encodeURIComponent(o.user_address)}">${escapeHtml(sh(o.user_address))}</a></td><td class="${rowIndex===0&&g.rows.length>=2?'position-first':rowIndex===1?'position-next':''}">${rowIndex+1} / ${g.rows.length}</td><td class="amount" title="Raw price: ${o.price_implied_apy}">${apy===null?'—':apy.toFixed(2)+'%'}</td><td class="amount" title="Current order rewards estimate from Exponent">${orderRewardsText(o)}</td><td>${qty(yt)}</td></tr>`;
      }).join('');
      const html=`<table class="book-orders"><thead><tr><th>Wallet</th><th>Group Position</th><th>Order APY</th><th>Rewards APY</th><th>Remaining YT</th></tr></thead><tbody>${rows}</tbody></table>`;
      if(node.scroll.innerHTML!==html){
        const focusedOrder=document.activeElement?.dataset?.orderKey;
        node.scroll.innerHTML=html;
        if(focusedOrder)for(const row of node.scroll.querySelectorAll('tr[data-order-key]'))if(row.dataset.orderKey===focusedOrder){row.tabIndex=-1;row.focus({preventScroll:true});}
      }
      if(view.content.children[groupIndex]!==node.details)view.content.insertBefore(node.details,view.content.children[groupIndex]||null);groupIndex++;
      if(view.pendingOrder){const target=[...node.scroll.querySelectorAll('tr[data-order-key]')].find(row=>row.dataset.orderKey===view.pendingOrder);if(target){node.details.open=true;target.tabIndex=-1;target.scrollIntoView({block:'center'});target.focus({preventScroll:true});view.pendingOrder=null;}}
    }
    for(const [key,node] of view.groups)if(!live.has(key)){node.details.remove();view.groups.delete(key);}
  }
  async function refreshSellMarket(view){
    if(!view.details.open||view.details.hidden||view.busy||Date.now()<view.retryAt||!view.market)return;
    view.busy=true;const market=view.market,identity=view.identity;
    try{
      const data=await placementOpenOrders(market.vaultAddress),results=await Promise.all((market.orderbookAddresses||[]).map(async address=>{try{return [address,await getOrderBookSnapshot(address)];}catch(e){return [address,{error:e.message}];}}));
      if(view.identity!==identity)return;const snapshots=new Map(results),reconciled=typeof reconcileSellOrders==='function'?await reconcileSellOrders(data,market,snapshots):data;
      if(view.identity!==identity)return;
      view.orders=reconciled;view.dataMarket=market;view.snapshots=snapshots;view.checkedAt=Date.now();view.error=results.some(([,s])=>s.error)?'On-chain queue unavailable; positions unverified':'';view.retryAt=0;
    }catch(e){if(view.identity===identity){view.error=e.message;view.retryAt=Date.now()+5000;}}
    finally{view.busy=false;if(view.identity===identity)renderSellMarket(view);}
  }
  function renderSellBooks(){
    const layout=window.marketLayout;layout?.sync();
    const root=document.getElementById('marketTokens')||document.getElementById('sellBooks');if(!root)return;
    for(const key of (layout?layout.keys():Object.keys(ASSETS))){
      const asset=ASSETS[key];
      let view=views.get(key);
      if(!view){
        const details=layout?layout.mount(key,'sell'):document.createElement('details'),summary=document.createElement('summary'),controls=document.createElement('div'),modeText=document.createElement('span'),modeButton=document.createElement('button'),status=document.createElement('p'),content=document.createElement('div');
        if(!layout)details.className='book-market';summary.className='market-section-title';controls.className='sell-level-filter';modeText.className='book-hint';modeText.textContent='Showing my APY levels';modeButton.type='button';modeButton.textContent='Show all';modeButton.setAttribute('aria-pressed','false');modeButton.addEventListener('click',()=>{view.showAll=!view.showAll;renderSellMarket(view);});controls.append(modeText,modeButton);status.className='book-status';details.append(summary,controls,status,content);if(!layout)root.appendChild(details);
        view={assetKey:key,details,summary,controls,modeText,modeButton,status,content,groups:new Map(),snapshots:new Map(),orders:null,checkedAt:0,busy:false,retryAt:0,error:'',showAll:false};views.set(key,view);details.addEventListener('toggle',()=>{if(details.open){renderSellMarket(view);void refreshSellMarket(view);}});
      }
      const market=layout?layout.market(key):(apyState.markets||[]).find(m=>view.navigationVault===m.vaultAddress&&m.maturityDateUnixTs>Date.now()/1000)||farthestApyMarket(apyState.markets||[],asset.mint,Date.now()/1000),identity=market?`${market.vaultAddress}:${market.maturityDateUnixTs}`:'';
      if(view.identity!==identity){view.identity=identity;if(!layout)view.details.open=false;view.orders=null;view.dataMarket=null;view.content.replaceChildren();view.groups.clear();view.error='';view.retryAt=0;view.checkedAt=0;view.status.textContent='';if(view.dot)view.dot.dataset.fresh='false';}
      view.market=market;view.details.hidden=(selectedAssets.size>0&&!selectedAssets.has(key))||!!(layout&&(!layout.active()||!layout.get(key).details.open));window.sellBookHealth.set(key,{open:view.details.open&&!view.details.hidden,checkedAt:view.checkedAt,error:!!view.error});
      view.summary.innerHTML=layout?'Sell Orderbook':`<strong>${escapeHtml(asset.label)}</strong><span class="book-hint">${market?escapeHtml(apyDate(market.maturityDateUnixTs*1000)):'No active market'}</span>`;
      if(view.details.open&&!view.details.hidden){if(market){renderSellMarket(view);void refreshSellMarket(view);}else view.status.textContent='No active market';}
    }
  }
  window.renderSellBooks=renderSellBooks;
  window.openPersonalSellOrder=function(key){const r=orderWatchState.records.get(key);if(!r)return;const market=(apyState.markets||[]).find(m=>m.vaultAddress===r.vault&&m.maturityDateUnixTs===r.maturity);if(!market)return;if(selectedAssets.size&&!selectedAssets.has(r.assetKey))setAssetFilter(r.assetKey);window.marketLayout?.navigate(r);window.marketLayout?.renderAll();renderSellBooks();const view=views.get(r.assetKey);view.navigationVault=r.vault;renderSellBooks();view.pendingOrder=key;view.details.open=true;renderSellMarket(view);void refreshSellMarket(view);};
  window.addEventListener('load',renderSellBooks);setInterval(renderSellBooks,2000);
}
