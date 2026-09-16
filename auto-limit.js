/* Live wallet orders are the sole source of My Limit APY. Manual values stay
 * in legacy settings for recovery; only the shared threshold remains editable. */
'use strict';
const autoLimitAlarms=new Map();
function autoLimitOrders(market,assetKey){
  if(!market)return [];
  return [...orderWatchState.records.entries()].filter(([,r])=>r.assetKey===assetKey&&r.vault===market.vaultAddress&&r.maturity===market.maturityDateUnixTs&&market.orderbookAddresses?.includes(r.book)&&walletMonitor.wallets.has(r.owner)&&r.expiry>Date.now()/1000&&r.maturity>Date.now()/1000)
    .map(([key,r])=>({key,r,side:r.orderSide==='sell'?'sell':'buy',apy:buyOrderApy(r.rawPrice),stale:r.status==='Stale'||!r.checkedAt||Date.now()-r.checkedAt>12000}))
    .filter(o=>o.apy!==null).sort((a,b)=>a.side.localeCompare(b.side)||b.r.rawPrice-a.r.rawPrice||a.key.localeCompare(b.key));
}
function removeAutoWalletAlarms(owner){
  for(const [key,meta] of autoLimitAlarms)if(meta.owner===owner){limitAlarm.entries.delete(key);autoLimitAlarms.delete(key);}
}
const renderManualLimitCells=renderLimitCells;
renderLimitCells=function(row,assetKey,market){
  renderManualLimitCells(row,assetKey,market);
  row.autoMarket=market;
  if(!row.autoValues){
    row.limitInputs[0].parentNode.style.display='none';row.limitInputs[0].limitError.hidden=true;
    row.autoValues=document.createElement('div');row.autoValues.style.whiteSpace='pre';row.autoValues.style.lineHeight='1.8';
    row.limitInputs[0].parentNode.parentNode.appendChild(row.autoValues);
    row.limitGap.style.whiteSpace='pre';row.limitGap.style.lineHeight='1.8';
    row.limitInputs[1].addEventListener('input',()=>{
      for(const {r} of autoLimitOrders(row.autoMarket,assetKey))r.limitEdges={};
      saveOrderWatches();
    });
  }
  const levels=new Map();
  for(const o of autoLimitOrders(market,assetKey)){
    const levelKey=o.side+':'+o.r.rawPrice,prior=levels.get(levelKey);
    if(!prior)levels.set(levelKey,{...o});else prior.stale=prior.stale||o.stale;
  }
  const orders=[...levels.values()],apyStale=!!apyState.error||Date.now()-apyState.checkedAt>(typeof apyMaxAge==='function'?apyMaxAge():8000);
  row.autoValues.textContent=orders.length?orders.map(o=>`${o.side==='sell'?'Sell':'Buy'} ${o.apy.toFixed(2)}%${o.stale?' *':''}`).join('\n'):'—';
  row.autoValues.title=orders.some(o=>o.stale)?'Stale data':'From open wallet orders';
  row.limitGap.textContent=orders.length?orders.map(o=>{
    if(!Number.isFinite(market?.impliedApy))return '—';
    const gap=o.side==='sell'?o.apy-market.impliedApy*100:market.impliedApy*100-o.apy;return `${o.side==='sell'?'Sell':'Buy'} ${(gap>=0?'+':'')+gap.toFixed(2)}${o.stale||apyStale?' *':''}`;
  }).join('\n'):'—';
  row.limitGap.title=apyStale||orders.some(o=>o.stale)?'Stale data':'';
};
const renderOriginalAlarmRow=renderLimitAlarmRow;
renderLimitAlarmRow=function(row){
  renderOriginalAlarmRow(row);
  if([...autoLimitAlarms].some(([key,m])=>m.marketKey===row.limitKey&&limitAlarm.entries.has(key)))row.dataset.alarm='true';
};
function evaluateAutoLimitAlerts(fromScan=false){
  const messages=[];
  if(!limitState.enabled||(!fromScan&&orderWatchState.busy)||apyState.error||!apyState.checkedAt||Date.now()-apyState.checkedAt>(typeof apyMaxAge==='function'?apyMaxAge():8000))return messages;
  for(const [assetKey,asset] of Object.entries(ASSETS)){
    const market=farthestApyMarket(apyState.markets||[],asset.mint,Date.now()/1000);
    if(!market)continue;
    const marketKey=limitKey(market),threshold=limitNumber(limitState.records[marketKey]?.threshold);
    for(const {key,r,side,apy,stale} of autoLimitOrders(market,assetKey)){
      if(stale)continue;
      const edges=r.limitEdges||(r.limitEdges={}),reasons=[];
      const check=(name,value,message)=>{if(value===null)return;const previous=edges[name];edges[name]=value;if(value&&previous!==true)reasons.push(message);};
      if(threshold!==null&&Number.isFinite(market.impliedApy)){const gap=side==='sell'?apy-market.impliedApy*100:market.impliedApy*100-apy;check('gap',gap<=threshold,'Gap ≤ '+threshold+' pp');}
      const range=typeof limitRewardRangeCheck==='function'?limitRewardRangeCheck(market,apy,side==='sell'?'sellYT':'buyYT'):null;
      check('range',range?.outside??null,'Outside APY Range');
      if(!reasons.length||(selectedAssets.size&&!selectedAssets.has(assetKey)))continue;
      const alarmKey='auto-limit:'+key,message=`${side==='sell'?'Sell':'Buy'} · ${asset.label} · ${r.owner.slice(0,6)}…${r.owner.slice(-4)} · ${apy.toFixed(2)}% · ${reasons.join(' · ')} · ${apyDate(r.maturity*1000)}`;
      if(!limitAlarm.entries.has(alarmKey)){limitAlarm.entries.set(alarmKey,message);autoLimitAlarms.set(alarmKey,{owner:r.owner,marketKey});messages.push(message);}
    }
  }
  saveOrderWatches();
  return messages;
}
evaluateLimitAlerts=function(){
  const messages=evaluateAutoLimitAlerts();
  if(messages.length){startLimitAlarmAudio();renderLimitAlarm();void notifyLimitAlarm(messages.join('\n'));}
};
