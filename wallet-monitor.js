/* Device-local wallets. Never import legacy manually watched owners. */
'use strict';
const WALLET_MONITOR_STORAGE='exponent-wallet-orders-v1';
const walletMonitor={wallets:new Set(),revision:0,pending:false,error:'',alarmOwners:new Map(),history:new Map(),walletNodes:new Map(),sellNodes:new Map()};
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
saveOrderWatches=function(){
  try{
    for(const [key,r] of orderWatchState.records)walletMonitor.history.set(key,{owner:r.owner,front:r.front,ack:r.ack,expiry:r.expiry,limitEdges:r.limitEdges});
    for(const [key,r] of walletMonitor.history)if(!walletMonitor.wallets.has(r.owner)||r.expiry<Date.now()/1000)walletMonitor.history.delete(key);
    localStorage.setItem(WALLET_MONITOR_STORAGE,JSON.stringify({wallets:[...walletMonitor.wallets],history:[...walletMonitor.history]}));
    orderWatchState.storageError=false;
  }catch{orderWatchState.storageError=true;}
};
const acknowledgeWalletRecords=acknowledgeOrderWatches;
acknowledgeOrderWatches=function(){
  acknowledgeWalletRecords();
  // Closed orders can still have a latched alarm awaiting Stop.
  for(const [key,r] of walletMonitor.history)if(limitAlarm.entries.has(orderWatchAlarmKey(key)))r.ack=true;
  saveOrderWatches();
};
function addMonitorWallet(value){
  const wallet=value.trim();
  if(!validMonitorWallet(wallet)){walletMonitor.error='Enter a valid Solana address.';renderOrderWatches();return false;}
  if(walletMonitor.wallets.has(wallet)){walletMonitor.error='Wallet already added.';renderOrderWatches();return false;}
  walletMonitor.wallets.add(wallet);walletMonitor.revision++;walletMonitor.pending=true;walletMonitor.error='';
  saveOrderWatches();renderOrderWatches();void pollOrderWatches(true);return true;
}
function removeMonitorWallet(wallet){
  walletMonitor.wallets.delete(wallet);walletMonitor.revision++;walletMonitor.error='';
  for(const [key,r] of orderWatchState.records)if(r.owner===wallet)orderWatchState.records.delete(key);
  for(const [key,owner] of walletMonitor.alarmOwners)if(owner===wallet){limitAlarm.entries.delete(key);walletMonitor.alarmOwners.delete(key);}
  if(typeof removeAutoWalletAlarms==='function')removeAutoWalletAlarms(wallet);
  saveOrderWatches();
  if(!limitAlarm.entries.size)stopLimitAlarm();else renderLimitAlarm();
  renderOrderWatches();if(typeof renderBuyBooks==='function')renderBuyBooks();
  if(typeof renderSellBooks==='function')renderSellBooks();
  if(typeof renderApy==='function')renderApy();
  if(walletMonitor.wallets.size){walletMonitor.pending=true;void pollOrderWatches(true);}
}
renderOrderWatches=function(){
  const dot=document.getElementById('bookDataHealth');
  if(dot){
    const fresh=!!apyState.checkedAt&&!apyState.error&&Date.now()-apyState.checkedAt<=(typeof apyMaxAge==='function'?apyMaxAge():12000)&&!walletMonitor.scanError&&[...orderWatchState.records.values()].filter(r=>(r.orderSide||'buy')==='buy').every(r=>r.status!=='Stale'&&r.checkedAt&&Date.now()-r.checkedAt<=12000)&&(!walletMonitor.wallets.size||!!walletMonitor.checkedAt&&Date.now()-walletMonitor.checkedAt<=12000)&&!(typeof window!=='undefined'&&window.buyBookHealth&&[...window.buyBookHealth.values()].some(v=>v.open&&(!v.checkedAt||v.error||Date.now()-v.checkedAt>12000)));
    dot.dataset.fresh=String(fresh);dot.title=fresh?'Data up to date':'Data unavailable or outdated';dot.setAttribute('aria-label',dot.title);
  }
  const sellDot=document.getElementById('sellBookDataHealth');
  if(sellDot){
    const fresh=!!apyState.checkedAt&&!apyState.error&&Date.now()-apyState.checkedAt<=(typeof apyMaxAge==='function'?apyMaxAge():12000)&&!walletMonitor.scanError&&[...orderWatchState.records.values()].filter(r=>r.orderSide==='sell').every(r=>r.status!=='Stale'&&r.checkedAt&&Date.now()-r.checkedAt<=12000)&&!(window.sellBookHealth&&[...window.sellBookHealth.values()].some(v=>v.open&&(!v.checkedAt||v.error||Date.now()-v.checkedAt>12000)));
    sellDot.dataset.fresh=String(fresh);sellDot.title=fresh?'Data up to date':'Data unavailable or outdated';sellDot.setAttribute('aria-label',sellDot.title);
  }
  const root=document.getElementById('watchedBuyOrders');if(!root)return;
  const buyRecords=[...orderWatchState.records].filter(([,r])=>(r.orderSide||'buy')==='buy');
  root.hidden=!buyRecords.length;
  const error=document.getElementById('walletError');
  error.textContent=walletMonitor.error;error.hidden=!error.textContent;
  const wallets=document.getElementById('walletList');
  for(const wallet of walletMonitor.wallets){
    if(walletMonitor.walletNodes.has(wallet))continue;
    const node=document.createElement('span'),label=document.createElement('span'),button=document.createElement('button');
    node.className='wallet-chip';label.textContent=wallet.slice(0,6)+'…'+wallet.slice(-4);label.title=wallet;
    button.type='button';button.textContent='Remove';button.setAttribute('aria-label','Remove wallet '+wallet);button.addEventListener('click',()=>removeMonitorWallet(wallet));
    node.append(label,button);wallets.appendChild(node);walletMonitor.walletNodes.set(wallet,node);
  }
  for(const [wallet,node] of walletMonitor.walletNodes)if(!walletMonitor.wallets.has(wallet)){node.remove();walletMonitor.walletNodes.delete(wallet);}
  const status=document.getElementById('orderWatchStatus');
  // Background scans should not replace a stable list with a flashing
  // "Loading orders" label. Only show an empty-state message before the
  // first order is discovered; existing rows remain visible while refreshing.
  status.textContent=orderWatchState.storageError?'Browser storage unavailable.':'';
  status.hidden=!status.textContent;
  const list=document.getElementById('orderWatchList');
  const records=buyRecords.sort(([,a],[,b])=>a.assetKey.localeCompare(b.assetKey)||a.maturity-b.maturity||a.owner.localeCompare(b.owner)||a.offerId-b.offerId);
  let index=0;
  for(const [key,r] of records){
    let node=orderWatchState.nodes.get(key);
    if(!node){node=document.createElement('tr');node.cellsList=Array.from({length:7},()=>document.createElement('td'));node.append(...node.cellsList);node.tabIndex=0;node.title='Open this order in Buy Orderbook';const open=()=>{if(typeof window.openPersonalBuyOrder==='function')window.openPersonalBuyOrder(key);};node.addEventListener('click',open);node.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();open();}});orderWatchState.nodes.set(key,node);}
    const p=r.groupPosition;
    const yt=Number.isFinite(r.remainingYt)?r.remainingYt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
    const values=[ASSETS[r.assetKey]?.label||r.assetKey,apyDate(r.maturity*1000),r.owner.slice(0,6)+'…'+r.owner.slice(-4),p?`${p.index} / ${p.total}`:'—',buyOrderApy(r.rawPrice).toFixed(2)+'%',orderRewardsText(r),yt];
    node.cellsList.forEach((cell,i)=>{if(cell.textContent!==values[i])cell.textContent=values[i];});
    node.cellsList[2].title=r.owner;node.cellsList[4].className='amount';node.cellsList[3].title='';node.cellsList[5].title='';
    node.cellsList[3].className=p?.index===1&&p.total>=2?'position-first':p?.index===2?'position-next':'';
    node.dataset.orderAlarm=String(limitAlarm.entries.has(orderWatchAlarmKey(key))||(typeof hasAutoLimitAlarm==='function'&&hasAutoLimitAlarm(key)));
    if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);index++;
  }
  for(const [key,node] of orderWatchState.nodes)if(!orderWatchState.records.has(key)){node.remove();orderWatchState.nodes.delete(key);}
  renderPersonalSellOrders();
};
function renderPersonalSellOrders(){
  const root=document.getElementById('watchedSellOrders'),list=document.getElementById('sellOrderWatchList');if(!root||!list)return;
  const records=[...orderWatchState.records].filter(([,r])=>r.orderSide==='sell').sort(([,a],[,b])=>a.assetKey.localeCompare(b.assetKey)||a.maturity-b.maturity||a.owner.localeCompare(b.owner)||a.offerId-b.offerId);
  root.hidden=!records.length;let index=0;
  for(const [key,r] of records){
    let node=walletMonitor.sellNodes.get(key);
    if(!node){node=document.createElement('tr');node.cellsList=Array.from({length:7},()=>document.createElement('td'));node.append(...node.cellsList);node.tabIndex=0;node.title='Open this order in Sell Orderbook';const open=()=>window.openPersonalSellOrder?.(key);node.addEventListener('click',open);node.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();open();}});walletMonitor.sellNodes.set(key,node);}
    const p=r.groupPosition,yt=Number.isFinite(r.remainingYt)?r.remainingYt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
    const values=[ASSETS[r.assetKey]?.label||r.assetKey,apyDate(r.maturity*1000),r.owner.slice(0,6)+'…'+r.owner.slice(-4),p?`${p.index} / ${p.total}`:'—',buyOrderApy(r.rawPrice).toFixed(2)+'%',orderRewardsText(r),yt];
    node.cellsList.forEach((cell,i)=>cell.textContent=values[i]);node.cellsList[2].title=r.owner;node.cellsList[3].className=p?.index===1&&p.total>=2?'position-first':p?.index===2?'position-next':'';node.cellsList[4].className='amount';node.dataset.orderAlarm=String(limitAlarm.entries.has(orderWatchAlarmKey(key))||(typeof hasAutoLimitAlarm==='function'&&hasAutoLimitAlarm(key)));
    if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);index++;
  }
  for(const [key,node] of walletMonitor.sellNodes)if(!orderWatchState.records.has(key)){node.remove();walletMonitor.sellNodes.delete(key);}
}
async function scanWalletMarket(market,assetKey){
  const orders=await placementOpenOrders(market.vaultAddress),ordersAt=Date.now();
  const buys=buyOpenOrders(orders,market,ordersAt/1000).filter(o=>o.order_type==='buyYT'&&walletMonitor.wallets.has(o.user_address));
  const sells=sellOpenOrders(orders,market,ordersAt/1000).filter(o=>o.order_type==='sellYT'&&walletMonitor.wallets.has(o.user_address));
  const records=[...buys.map(o=>{const r=orderWatchRecord(o,market,assetKey,'buy');return r?{...r,remainingYt:buyYtEstimate(o,market,ordersAt/1000)}:null;}),...sells.map(o=>{const r=orderWatchRecord(o,market,assetKey,'sell');return r?{...r,remainingYt:sellYtEstimate(o,market)}:null;})].filter(Boolean);
  if(!records.length)return {market,records,groups:[],sellGroups:[],checkedAt:ordersAt};
  try{
    const snapshots=new Map(await Promise.all(market.orderbookAddresses.map(async address=>[address,await getOrderBookSnapshot(address)])));
    const buyReconciled=await reconcileBuyOrders(orders,market,snapshots),sellReconciled=await reconcileSellOrders(orders,market,snapshots);
    if(Date.now()-ordersAt>12000||[...snapshots.values()].some(s=>s.error||Date.now()-s.checkedAt>12000))throw Error('Orderbook data is stale');
    return {market,records,groups:buyGroups(buyReconciled,market,snapshots,Date.now()/1000),sellGroups:sellGroups(sellReconciled,market,snapshots,Date.now()/1000),checkedAt:Date.now()};
  }catch(e){return {market,records,error:e.message};}
}
pollOrderWatches=async function(force=false){
  if(force)walletMonitor.pending=true;
  if(orderWatchState.busy||!walletMonitor.wallets.size||(!limitState.enabled&&!walletMonitor.pending))return;
  if(!apyState.markets||apyState.error||Date.now()-apyState.checkedAt>(typeof apyMaxAge==='function'?apyMaxAge():12000)){
    walletMonitor.scanError='Market data unavailable.';renderOrderWatches();return;
  }
  orderWatchState.busy=true;walletMonitor.loading=true;walletMonitor.pending=false;
  renderOrderWatches();
  const revision=walletMonitor.revision,proxy=getProxy(),generation=limitAlarm.generation;
  const markets=walletMarkets(apyState.markets),messages=[],alarmKeys=[],pendingAlarms=[];
  let errors=0;
  try{
    // Discover independently of table filters and collapsed accordions.
    for(let i=0;i<markets.length;i+=3){
      const batch=markets.slice(i,i+3);
      const results=await Promise.allSettled(batch.map(({market,assetKey})=>scanWalletMarket(market,assetKey)));
      if(revision!==walletMonitor.revision||proxy!==getProxy())return;
      for(let j=0;j<results.length;j++){
        const outcome=results[j],{market}=batch[j];
        if(outcome.status==='rejected'){
          errors++;for(const r of orderWatchState.records.values())if(r.vault===market.vaultAddress){r.status='Stale';if(r.groupPosition)r.groupPosition.stale=true;}continue;
        }
        const data=outcome.value,live=new Set();if(data.error)errors++;
        for(const candidate of data.records){
          if(!walletMonitor.wallets.has(candidate.owner))continue;
          const key=orderWatchKey(candidate);live.add(key);
          let r=orderWatchState.records.get(key);
          if(!r){const saved=walletMonitor.history.get(key);r={...candidate,front:saved?.front??null,ack:saved?.ack===true,limitEdges:saved?.limitEdges||{}};orderWatchState.records.set(key,r);}
          r.apiOrderId=candidate.apiOrderId;r.remainingYt=candidate.remainingYt;r.checkedAt=data.checkedAt||0;
          const groupData=r.orderSide==='sell'?{...data,groups:data.sellGroups||[]}:data;
          const result=data.error?{front:null,status:'Stale',detail:data.error}:watchedGroupResult(r,groupData);
          r.status=result.status;r.detail=result.detail;
          if(result.position)r.groupPosition=result.position;else if(r.groupPosition)r.groupPosition.stale=true;
          const positionKind=r.orderSide==='sell'?'sellPosition':'buyPosition';
          if(!limitState.enabled||(typeof limitOptionEnabled==='function'&&!limitOptionEnabled(positionKind))||generation!==limitAlarm.generation||result.front===null)continue;
          if(!result.front){r.front=false;r.ack=false;continue;}
          if(r.front!==true){r.front=true;r.ack=false;}
          const alarmKey=orderWatchAlarmKey(key);
          if(!r.ack&&!limitAlarm.entries.has(alarmKey)){
            const message=`${r.orderSide==='sell'?'Sell':'Buy'} · ${ASSETS[r.assetKey].label} #${r.offerId} · ${r.owner.slice(0,6)}…${r.owner.slice(-4)} · Group ${result.position.apy.toFixed(2)}% · 1 / ${result.position.total} · ${apyDate(r.maturity*1000)}`;
            pendingAlarms.push({alarmKey,message,owner:r.owner,key,checkedAt:result.position.checkedAt});
          }
        }
        // Successful open-order response is authoritative for removals even
        // when the separate queue read failed. Latched alarms remain until Stop.
        for(const [key,r] of orderWatchState.records)if(r.vault===market.vaultAddress&&!live.has(key)){
          walletMonitor.history.set(key,{owner:r.owner,front:r.front,ack:r.ack,expiry:r.expiry,limitEdges:r.limitEdges});orderWatchState.records.delete(key);
        }
      }
    }
    for(const [key,r] of orderWatchState.records)if(r.maturity<=Date.now()/1000||r.expiry<=Date.now()/1000)orderWatchState.records.delete(key);
    walletMonitor.scanError=errors?'Some markets unavailable · Stale data retained.':'';
    if(!errors)walletMonitor.checkedAt=Date.now();
    saveOrderWatches();
    if(limitState.enabled&&generation===limitAlarm.generation){
      for(const a of pendingAlarms)if(walletMonitor.wallets.has(a.owner)&&orderWatchState.records.has(a.key)&&Date.now()-a.checkedAt<=12000&&!limitAlarm.entries.has(a.alarmKey)){
        limitAlarm.entries.set(a.alarmKey,a.message);walletMonitor.alarmOwners.set(a.alarmKey,a.owner);messages.push(a.message);alarmKeys.push(a.alarmKey);
      }
      if(typeof evaluateAutoLimitAlerts==='function')messages.push(...evaluateAutoLimitAlerts(true));
      if(messages.length){startLimitAlarmAudio();renderLimitAlarm();void notifyLimitAlarm(messages.join('\n'));}
    }
  }finally{
    orderWatchState.busy=false;walletMonitor.loading=false;renderOrderWatches();
    if(typeof renderBuyBooks==='function')renderBuyBooks();
    if(typeof renderSellBooks==='function')renderSellBooks();
    if(typeof renderApy==='function')renderApy();
    if(walletMonitor.pending)void pollOrderWatches();
  }
};
function initWalletMonitor(){
  try{
    const saved=JSON.parse(localStorage.getItem(WALLET_MONITOR_STORAGE)||'{}');
    for(const wallet of saved.wallets||[])if(validMonitorWallet(wallet))walletMonitor.wallets.add(wallet);
    for(const entry of saved.history||[]){if(!Array.isArray(entry)||entry.length!==2)continue;const [key,r]=entry;if(typeof key==='string'&&r&&walletMonitor.wallets.has(r.owner)&&Number.isFinite(r.expiry))walletMonitor.history.set(key,{owner:r.owner,expiry:r.expiry,ack:r.ack===true,front:typeof r.front==='boolean'?r.front:null,limitEdges:r.limitEdges&&typeof r.limitEdges==='object'?r.limitEdges:{}});}
  }catch{orderWatchState.storageError=true;}
  document.getElementById('walletForm').addEventListener('submit',event=>{event.preventDefault();const input=document.getElementById('walletAddress');if(addMonitorWallet(input.value))input.value='';});
  document.getElementById('refreshWalletOrders').addEventListener('click',()=>void pollOrderWatches(true));
  walletMonitor.pending=walletMonitor.wallets.size>0;renderOrderWatches();void pollOrderWatches();
  setInterval(()=>void pollOrderWatches(),2000);
}
