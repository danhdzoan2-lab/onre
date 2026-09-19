/* Shared token/maturity selection for simulation and both orderbook sides. */
'use strict';
window.marketLayout=(()=>{
  const keys=['onyc','sronyc','eusx','usx','srehyusd'],views=new Map();
  function get(key){
    if(views.has(key))return views.get(key);
    const root=document.getElementById('marketTokens');if(!root)return null;
    const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');
    details.className='market-token';details.dataset.token=key;details.append(summary,body);root.append(details);
    const v={details,summary,body,sections:new Map(),vault:null};views.set(key,v);
    details.addEventListener('toggle',renderAll);return v;
  }
  function market(key){
    const v=get(key),now=Date.now()/1000,list=apyState.markets||[];
    return list.find(m=>m.vaultAddress===v?.vault&&m.underlyingAsset?.mint===ASSETS[key].mint&&m.maturityDateUnixTs>now)
      ||farthestApyMarket(list,ASSETS[key].mint,now);
  }
  function sync(){
    for(const key of [...keys,...(views.has('strcx')?['strcx']:[])]){
      const v=get(key);if(!v)continue;const m=market(key);
      v.details.hidden=selectedAssets.size>0&&!selectedAssets.has(key);
      const html=`<strong>${escapeHtml(ASSETS[key].label)}</strong><span class="book-hint">${m?escapeHtml(apyDate(m.maturityDateUnixTs*1000)):'No active market'}</span>`;
      if(v.summary.innerHTML!==html)v.summary.innerHTML=html;
    }
  }
  function mount(key,side){
    const v=get(key);if(!v)return null;if(v.sections.has(side))return v.sections.get(side);
    const section=document.createElement(side==='simulation'?'section':'details');section.className='market-section';section.dataset.section=side;
    // Simulation follows the token; each book is an independent, closed disclosure.
    if(side==='simulation')Object.defineProperty(section,'open',{get:()=>v.details.open,set:()=>{}});
    v.sections.set(side,section);
    for(const name of ['simulation','buy','sell']){const n=v.sections.get(name);if(n)v.body.append(n);}
    return section;
  }
  function navigate(record){const v=get(record.assetKey);if(!v)return;v.vault=record.vault;v.details.open=true;sync();}
  function renderAll(){sync();window.renderBuyBooks?.();window.renderSellBooks?.();window.renderRewardSimulations?.();}
  return {get,market,mount,sync,navigate,renderAll,keys:()=>[...keys,...(views.has('strcx')?['strcx']:[])]};
})();
