/* Exponent simulation: maximum fill/queue scores, squared rate proximity.
 * Public frontend 1224-1e028d42775557fc.js, verified 2026-09-18.
 * Extended campaign endpoint supplies emissionRateRawPerSecond directly.
 * No remaining-budget extrapolation or personal-order calibration. */
'use strict';
const SIMULATION_KEYS=['onyc','sronyc','eusx','usx','srehyusd'];
const SIMULATION_ENDPOINT='https://app.exponent.finance/api/orderbook-emissions/campaigns?includeInactiveTranching=true';
const SIMULATION_STORAGE='exponent-simulation-amounts-v1';
const simulationState={campaigns:null,checkedAt:0,inFlight:false,retryAt:0,error:''};
function simulationAmount(value){
  if(typeof value!=='string'||!/^\d+(\.\d+)?$/.test(value.trim()))return null;
  const n=Number(value);return Number.isFinite(n)&&n>0&&n<=1e12?n:null;
}
function simulationModel(c,market,now=Date.now()){
  if(!c||!market||c.campaignType!=='orderbook_quote'||c.isActive===false||c.vaultAddress!==market.vaultAddress
    ||!market.orderbookAddresses?.includes(c.orderbookAddress)||!(market.maturityDateUnixTs*1000>now)
    ||!c.incentivizedOrderTypes?.some(t=>t==='buyYT'||t==='sellYT')
    ||!(Date.parse(c.startsAt)<=now&&Date.parse(c.endsAt)>now)||rewardBudget(c)!==true)return null;
  // Exponent labels the capital in underlying-token units. Cross-token rewards
  // need verified conversion data; don't compare unlike quantities.
  if(c.emissionMint!==market.underlyingAsset?.mint)return null;
  const rate=typeof c.marketImpliedApy==='number'?(Math.abs(c.marketImpliedApy)<=10?c.marketImpliedApy:c.marketImpliedApy/1e6):Math.log1p(market.impliedApy);
  const band=Math.abs(rate)*c.priceBandBps/10000,cap=c.maxRewardsApyBps/100,base=c.currentRewardsApy??cap;
  const raw=c.emissionRateRawPerSecond;
  if(!((typeof raw==='string'&&/^\d+(\.\d+)?$/.test(raw))||(typeof raw==='number'&&Number.isFinite(raw)))
    ||!Number.isInteger(c.emissionDecimals)||c.emissionDecimals<0||c.emissionDecimals>18)return null;
  const annual=Number(raw)/10**c.emissionDecimals*31536000;
  if(![rate,band,cap,base,annual].every(Number.isFinite)||band<=0||cap<=0||base<=0||annual<=0)return null;
  const low=100*Math.expm1(rate-band),high=100*Math.expm1(rate+band),marketApy=100*Math.expm1(rate),weight=annual/(base/100);
  return [low,high,marketApy,weight].every(Number.isFinite)?{rate,band,cap,annual,weight,low,high,marketApy}:null;
}
function simulationPoint(model,amount,ratio){
  if(!model||!Number.isFinite(amount)||amount<=0||!Number.isFinite(ratio))return null;
  const t=Math.max(0,Math.min(1,ratio)),p=1-Math.abs(2*t-1),q=p*p,total=model.weight+amount*q;
  return {apy:100*Math.expm1(model.rate-model.band+2*model.band*t),share:100*amount*q/total,
    rewards:Math.min(model.cap,100*model.annual/total)*q};
}
function simulationCampaigns(campaigns,market,now=Date.now()){
  return (campaigns||[]).filter(c=>c?.vaultAddress===market?.vaultAddress&&market?.orderbookAddresses?.includes(c.orderbookAddress)
    &&c.campaignType==='orderbook_quote'&&c.isActive!==false&&Date.parse(c.startsAt)<=now&&Date.parse(c.endsAt)>now
    &&rewardBudget(c)!==false&&c.incentivizedOrderTypes?.some(t=>t==='buyYT'||t==='sellYT')).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
}
if(typeof module!=='undefined')module.exports={simulationAmount,simulationModel,simulationPoint,simulationCampaigns};

if(typeof window!=='undefined'){
  const views=new Map();let saved={};
  try{saved=JSON.parse(localStorage.getItem(SIMULATION_STORAGE)||'{}')||{};}catch{}
  if(typeof saved!=='object'||Array.isArray(saved))saved={};
  const pct=(n,d=2)=>n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})+'%';
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function drawChart(card){
    const m=card.model,amount=card.amount;if(!m)return;
    const width=Math.max(280,card.chart.clientWidth||600),height=240,left=58,right=18,top=24,bottom=45;
    const peak=simulationPoint(m,amount,.5).rewards,ymax=Math.max(peak,1e-6)*1.1;
    const x=apy=>left+(apy-m.low)/(m.high-m.low)*(width-left-right),y=r=>height-bottom-r/ymax*(height-top-bottom);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Estimated rewards APY versus order APY; maximum fill and queue scores');
    const add=(tag,attrs,text)=>{const e=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.appendChild(e);return e;};
    for(const r of [0,peak/2,peak]){add('line',{x1:left,x2:width-right,y1:y(r),y2:y(r),class:'sim-grid'});add('text',{x:left-8,y:y(r)+4,'text-anchor':'end'},pct(r));}
    const points=Array.from({length:161},(_,i)=>simulationPoint(m,amount,i/160)),path=points.map((p,i)=>`${i?'L':'M'}${x(p.apy)},${y(p.rewards)}`).join(' ');
    add('path',{d:`${path} L${width-right},${height-bottom} L${left},${height-bottom} Z`,class:'sim-area'});
    add('path',{d:path,class:'sim-line'});
    add('line',{x1:x(m.marketApy),x2:x(m.marketApy),y1:top,y2:height-bottom,class:'sim-center'});
    for(const [value,anchor]of [[m.low,'start'],[m.marketApy,'middle'],[m.high,'end']])add('text',{x:x(value),y:height-25,'text-anchor':anchor},pct(value));
    add('text',{x:(left+width-right)/2,y:height-5,'text-anchor':'middle'},'Order APY (%)');
    card.guide=add('line',{y1:top,y2:height-bottom,class:'sim-guide'});
    card.marker=add('circle',{r:4,class:'sim-marker'});
    card.coords={x,y,width,left,right};card.chart.replaceChildren(svg);updateSelection(card);
  }
  function updateSelection(card){
    const p=simulationPoint(card.model,card.amount,card.ratio);if(!p)return;
    card.values.textContent=`Order APY ${pct(p.apy)} · Share ${pct(p.share,4)} · Est. Rewards APY ${pct(p.rewards)}`;
    card.slider.setAttribute('aria-valuetext',`Order APY ${pct(p.apy)}, estimated rewards APY ${pct(p.rewards)}`);
    const {x,y}=card.coords;card.guide.setAttribute('x1',x(p.apy));card.guide.setAttribute('x2',x(p.apy));card.marker.setAttribute('cx',x(p.apy));card.marker.setAttribute('cy',y(p.rewards));
  }
  function makeCard(){
    const root=node('div','sim-campaign'),heading=node('div','sim-campaign-heading'),title=node('span'),market=node('span','sim-market'),range=node('div','sim-range'),chart=node('div','sim-chart'),slider=node('input'),values=node('div','sim-values');
    heading.append(title,market);slider.type='range';slider.min='0';slider.max='1000';slider.step='1';slider.value='500';slider.setAttribute('aria-label','Explore order APY');values.setAttribute('aria-live','off');
    root.append(heading,range,chart,slider,values);const card={root,title,market,range,chart,slider,values,ratio:.5};
    slider.addEventListener('input',()=>{card.ratio=Number(slider.value)/1000;updateSelection(card);});
    const point=e=>{if(!card.model)return;const rect=chart.getBoundingClientRect(),{width,left,right}=card.coords;
      const fraction=Math.max(0,Math.min(1,((e.clientX-rect.left)*width/rect.width-left)/(width-left-right)));
      const apy=card.model.low+fraction*(card.model.high-card.model.low);
      card.ratio=Math.max(0,Math.min(1,(Math.log1p(apy/100)-card.model.rate+card.model.band)/(2*card.model.band)));
      slider.value=String(card.ratio*1000);updateSelection(card);};
    chart.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||e.buttons)point(e);});chart.addEventListener('pointerdown',point);
    if(typeof ResizeObserver!=='undefined'){card.observer=new ResizeObserver(()=>{if(card.root.isConnected&&card.model)drawChart(card);});card.observer.observe(chart);}
    return card;
  }
  function paint(view){
    if(!view.details.open||view.details.hidden)return;
    const state=simulationState,now=Date.now(),maxAge=typeof apyMaxAge==='function'?apyMaxAge():12000;
    const stale=!!state.error||!state.checkedAt||now-state.checkedAt>maxAge||!!apyState.error||now-apyState.checkedAt>maxAge;
    view.dot.dataset.fresh=String(!stale);view.dot.title=stale?'Simulation data unavailable or outdated':'Simulation data up to date';view.dot.setAttribute('aria-label',view.dot.title);
    const campaigns=simulationCampaigns(state.campaigns,view.market,now),live=new Set();
    view.status.textContent=!view.market?'No active maturity':!state.campaigns?'Simulation unavailable':!campaigns.length?'No active limit-order rewards':'';
    for(const c of campaigns){
      live.add(c.id);let card=view.cards.get(c.id);if(!card){card=makeCard();view.cards.set(c.id,card);view.body.appendChild(card.root);}
      const model=simulationModel(c,view.market,now);
      card.title.textContent=c.incentivizedOrderTypes.filter(t=>['buyYT','sellYT'].includes(t)).map(t=>t==='buyYT'?'Buy':'Sell').join(' / ');
      card.title.title=`Campaign ${c.id} · Book ${c.orderbookAddress}`;
      card.root.hidden=false;
      if(!model){card.model=null;card.signature=null;card.market.textContent='Simulation unavailable';card.range.textContent='';card.chart.replaceChildren();card.slider.hidden=true;card.values.textContent='';continue;}
      card.model=model;card.amount=view.amount;card.slider.hidden=false;
      card.market.textContent=`Market Implied APY ${pct(model.marketApy)}`;card.range.textContent=`Eligible range ${formatInwardRange(model.low,model.high)}`;
      const signature=JSON.stringify([model,view.amount]);if(signature!==card.signature){card.signature=signature;drawChart(card);}
    }
    for(const [id,card]of view.cards)if(!live.has(id)){card.observer?.disconnect();card.root.remove();view.cards.delete(id);}
  }
  async function fetchSimulationCampaigns(){
    const s=simulationState,now=Date.now(),interval=(typeof apyRefreshSeconds==='number'?apyRefreshSeconds:2)*1000;
    if(s.inFlight||now<s.retryAt||now-s.checkedAt<interval||![...views.values()].some(v=>v.details.open&&!v.details.hidden&&v.market))return;
    s.inFlight=true;
    const request=async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      try{const response=await fetch(SIMULATION_ENDPOINT,{signal:controller.signal});if(response.status===429){s.retryAt=Date.now()+apyRetryDelay(response.headers.get('Retry-After'));throw Error('Rate limited');}
        if(!response.ok)throw Error(`Campaign request failed (${response.status})`);const data=await response.json();
        if(!Array.isArray(data.campaigns)||data.campaigns.some(c=>!c||typeof c!=='object'||Array.isArray(c)))throw Error('Invalid campaign data');
        s.campaigns=data.campaigns;s.checkedAt=Date.now();s.error='';s.retryAt=0;
      }finally{clearTimeout(timer);}};
    try{if(typeof withBookRequest==='function')await withBookRequest(request);else await request();}
    catch(e){s.error=e.name==='AbortError'?'Campaign request timed out':e.message;if(s.retryAt<Date.now())s.retryAt=Date.now()+5000;}
    finally{s.inFlight=false;for(const view of views.values())paint(view);}
  }
  window.renderRewardSimulations=function(){
    const layout=window.marketLayout;layout?.sync();
    const root=document.getElementById('marketTokens')||document.getElementById('rewardSimulations');if(!root)return;
    for(const key of (layout?layout.keys():SIMULATION_KEYS)){
      const asset=ASSETS[key];if(!asset)continue;let view=views.get(key);
      if(!view){
        const details=layout?layout.mount(key,'simulation'):node('details','sim-token'),summary=node(layout?'h3':'summary',layout?'market-section-title':''),label=node('strong'),maturity=node('span','book-hint'),dot=node('span','data-health'),content=node('div','sim-content'),form=node('label','sim-capital'),input=node('input'),unit=node('span'),error=node('span','sim-error'),status=node('div','sim-status'),body=node('div'),note=node('p','sim-note','Assumes maximum fill and queue scores. Not guaranteed rewards.');
        dot.setAttribute('role','img');summary.append(label,maturity,dot);input.type='number';input.min='0.000000001';input.max='1000000000000';input.step='any';input.inputMode='decimal';input.setAttribute('aria-label',`Simulated capital in ${asset.label}`);
        const amount=simulationAmount(String(saved[key]??''))??1000;input.value=String(amount);unit.textContent=asset.label;form.append(document.createTextNode('Simulated capital '),input,unit);error.setAttribute('role','status');content.append(form,error,status,body,note);details.append(summary,content);if(!layout)root.appendChild(details);
        view={details,label,maturity,dot,input,error,status,body,cards:new Map(),amount};views.set(key,view);
        input.addEventListener('input',()=>{const n=simulationAmount(input.value);input.setAttribute('aria-invalid',String(n===null));error.textContent=n===null?'Enter a positive amount up to 1,000,000,000,000.':'';if(n===null)return;
          view.amount=n;saved[key]=n;try{localStorage.setItem(SIMULATION_STORAGE,JSON.stringify(saved));}catch{error.textContent='Browser storage unavailable.';}paint(view);});
        details.addEventListener('toggle',()=>{if(details.open){paint(view);for(const card of view.cards.values())if(card.model)drawChart(card);void fetchSimulationCampaigns();}});
      }
      view.details.hidden=selectedAssets.size>0&&!selectedAssets.has(key);view.label.textContent=layout?'Simulated Rewards':asset.label;
      view.market=layout?layout.market(key):farthestApyMarket(apyState.markets||[],asset.mint,Date.now()/1000);
      view.maturity.hidden=!!layout;
      view.maturity.textContent=view.market?apyDate(view.market.maturityDateUnixTs*1000):'No active maturity';
      paint(view);
    }
    void fetchSimulationCampaigns();
  };
  window.addEventListener('load',window.renderRewardSimulations);
}
