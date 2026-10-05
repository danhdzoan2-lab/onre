'use strict';
const TOKEN_ORDER=['onyc','sronyc','eusx','usx','srehyusd'];
const COMMANDS=[
  {command:'orders',description:'Buy + Sell orders'},
  {command:'buy',description:'Buy orders'},
  {command:'sell',description:'Sell orders'},
  {command:'apy',description:'Market Implied APY'},
  {command:'status',description:'Monitor status'},
  {command:'help',description:'Commands and examples'}
];
const HELP='📖 Commands\n\n📋 /orders — Buy + Sell orders\n🟢 /buy — Buy orders\n🔴 /sell — Sell orders\n📈 /apy — Market Implied APY\n🖥️ /status — Monitor status\n❓ /help — Help\n\n🔎 Examples: /buy ONyc · /sell srONyc · /apy eUSX\nTokens: ONyc, srONyc, eUSX, USX, srEHYUSD.\n\nOrders: all active maturities. APY: farthest active maturity.\nRead-only; alarms unchanged. PC must be awake and online.';
function shortWallet(address){
  return typeof address==='string'&&address.length>12?`${address.slice(0,6)}…${address.slice(-4)}`:address||'—';
}
function parseCommand(text,botName,assets){
  if(typeof text!=='string'||text.length>120)return null;
  const match=text.trim().match(/^\/([a-z]+)(?:@([\w]+))?(?:\s+([\w]+))?$/i);
  if(!match||match[2]&&match[2].toLowerCase()!==botName.toLowerCase())return null;
  const name=match[1].toLowerCase();
  if(name==='start')return {name:'help'};
  if(!COMMANDS.some(c=>c.command===name))return {error:'⚠️ Unknown command. Use /help.'};
  if(!match[3]||match[3].toLowerCase()==='all')return {name};
  if(name==='help'||name==='status')return {error:`⚠️ Use /${name} without a token.`};
  const token=Object.keys(assets).find(key=>key.toLowerCase()===match[3].toLowerCase()||assets[key].label.toLowerCase()===match[3].toLowerCase());
  return token?{name,token}:{error:'⚠️ Unknown token. Use /help for the list.'};
}
function chunks(text,limit=3800){
  const result=[];let current='';
  for(const line of text.split('\n')){
    if(current.length+line.length+1>limit){result.push(current);current='';}
    current+=(current?'\n':'')+line;
  }
  if(current)result.push(current);return result;
}
function apyReport(runtime,markets,checkedAt,stale,token,now=Date.now()){
  const keys=token?[token]:TOKEN_ORDER;
  const lines=['📈 Market Implied APY',`🕒 Updated: ${runtime.apyDate(checkedAt)} (UTC+7)${stale?' · ⚠️ STALE — refresh failed':''}`,''];
  for(const key of keys){
    const market=runtime.farthestApyMarket(markets,runtime.assets[key].mint,now/1000);
    lines.push(market?`🪙 ${runtime.assets[key].label} · ${runtime.formatImpliedApy(market.impliedApy)}\n📅 ${runtime.apyDate(market.maturityDateUnixTs*1000)}`:`🪙 ${runtime.assets[key].label} · No active market`,'');
  }
  return lines.join('\n').trimEnd();
}
function orderReport(runtime,bundles,command,config,paused,now=Date.now(),rewards=null){
  const side=command.name==='buy'?'buy':command.name==='sell'?'sell':null;
  const lines=[`📋 Personal ${side?side==='buy'?'Buy':'Sell':'Buy / Sell'} Orders`,...(paused?['⏸️ Monitor paused · manual query']:[]),''];
  if(!config.wallets.length)return lines.concat('👛 No synced wallets. Add wallets, then Sync Telegram.').join('\n');
  let count=0,unavailable=0;
  for(const bundle of bundles){
    const {data,assetKey}=bundle,stale=bundle.stale||!data.checkedAt||now-data.checkedAt>12000;
    const records=(data.records||[]).filter(r=>config.wallets.includes(r.owner)&&(!side||r.orderSide===side)&&r.expiry>now/1000&&r.maturity>now/1000);
    if(stale){unavailable++;lines.push(`🪙 ${runtime.assets[assetKey].label}\n⚠️ STALE — refresh failed; previous data only`);}
    for(const r of records){
      count++;let position=r.groupPosition,status='STALE';
      if(!stale){
        const groups=r.orderSide==='sell'?data.sellGroups:data.groups;
        const result=runtime.watchedGroupResult(r,{...data,groups,personalRecords:data.records});
        const prefix=groups?.flatMap(g=>g.rows).slice(0,result.position?.total||0);
        const verified=now-data.checkedAt<=12000&&prefix?.length&&prefix.every(row=>row.position)&&result.front!==null;
        position=verified?result.position:null;status=verified?'Verified':'Queue unverified';
      }
      const apy=100*Math.expm1(r.rawPrice/1e6);
      const market=bundle.market||data.market,marketCheckedAt=bundle.marketCheckedAt??data.checkedAt;
      const currentMarket=!(bundle.marketStale??stale)&&Number.isFinite(marketCheckedAt)&&marketCheckedAt>0&&now-marketCheckedAt<=30000
        &&market?.vaultAddress===r.vault&&market.maturityDateUnixTs===r.maturity
        &&market.underlyingAsset?.mint===runtime.assets[r.assetKey]?.mint&&market.orderbookAddresses?.includes(r.book);
      lines.push(`${r.orderSide==='sell'?'🔴 Sell':'🟢 Buy'} · ${runtime.assets[r.assetKey].label} · Limit APY ${Number.isFinite(apy)?apy.toFixed(2)+'%':'—'}`,
        `👛 Wallet: ${shortWallet(r.owner)}`,
        `📈 Current Implied APY: ${currentMarket?runtime.formatImpliedApy(market.impliedApy):'—'}`,
        `🎁 Rewards APY: ${!stale&&rewards?runtime.orderRewardsText(r,rewards,now):'—'}`,
        `📍 Position: ${position?`${position.index} / ${position.total}`:'—'} · ${status} ${status==='Verified'?'✅':'⚠️'}`,'');
    }
  }
  if(!count)lines.push(unavailable?'⚠️ Order list unavailable; failed markets may still have orders.':'📭 No open personal orders found.');
  return lines.join('\n').trimEnd();
}
function statusReport(runtime,state,now=Date.now()){
  const lines=['🖥️ Monitor Status',`${state.paused?'⏸️':'▶️'} Monitoring: ${state.paused?'PAUSED':'RUNNING'}`,`🟢 Buy Position: ${state.config.buyPosition?'ON':'OFF'} · 🔴 Sell Position: ${state.config.sellPosition?'ON':'OFF'}`,
    `👛 Wallets: ${state.config.wallets.length} · ⏱️ Scan: ${state.config.interval}s`,
    `🔄 Last sync: ${state.syncedAt?runtime.apyDate(state.syncedAt):'Never'}`,
    `🕒 Last scan: ${state.checkedAt?runtime.apyDate(state.checkedAt):'Not yet'}`,''];
  const health=Object.values(state.health).sort((a,b)=>a.assetKey.localeCompare(b.assetKey)||a.maturity-b.maturity);
  for(const h of health){
    const age=h.checkedAt?Math.max(0,Math.floor((now-h.checkedAt)/1000)):null;
    const fresh=!state.paused&&!h.error&&age!==null&&age<=Math.max(12,state.config.interval+8);
    lines.push(`🪙 ${runtime.assets[h.assetKey]?.label||h.assetKey} · ${runtime.apyDate(h.maturity*1000)}\n${fresh?'✅ Fresh':h.error?'⚠️ Unavailable / unverified':'⚠️ Outdated / not checked'}${age===null?'':` · ${age}s ago`}`);
  }
  if(!health.length)lines.push('ℹ️ No market scan status yet.');
  return lines.join('\n').trimEnd();
}
module.exports={COMMANDS,HELP,shortWallet,parseCommand,chunks,apyReport,orderReport,statusReport};
