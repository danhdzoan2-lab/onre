'use strict';
const TOKEN_ORDER=['onyc','sronyc','eusx','usx','srehyusd'];
const COMMANDS=[
  {command:'orders',description:'View personal Buy and Sell order positions'},
  {command:'buy',description:'View personal Buy orders (optional token)'},
  {command:'sell',description:'View personal Sell orders (optional token)'},
  {command:'apy',description:'View Market Implied APY (optional token)'},
  {command:'status',description:'View monitor, sync and market data status'},
  {command:'help',description:'Show commands and examples'}
];
const HELP='📖 OnRe · Commands\n\n📋 /orders — personal Buy + Sell orders\n🟢 /buy — personal Buy positions\n🔴 /sell — personal Sell positions\n📈 /apy — Market Implied APY\n🖥️ /status — monitor and data status\n❓ /help — this guide\n\n🔎 Filter by token: /buy ONyc, /sell srONyc, /orders eUSX, /apy srEHYUSD.\nTokens: ONyc, srONyc, eUSX, USX, srEHYUSD.\n\nOrders cover all unexpired maturities of your last synced wallets. /apy uses the farthest active maturity, like the dashboard. Times: Vietnam (UTC+7).\nRead-only queries also work while paused or Position alerts are OFF. They do not acknowledge alarms or change fill baselines. Keep this Windows PC awake and online.';
function shortWallet(address){
  return typeof address==='string'&&address.length>12?`${address.slice(0,6)}…${address.slice(-4)}`:address||'—';
}
function parseCommand(text,botName,assets){
  if(typeof text!=='string'||text.length>120)return null;
  const match=text.trim().match(/^\/([a-z]+)(?:@([\w]+))?(?:\s+([\w]+))?$/i);
  if(!match||match[2]&&match[2].toLowerCase()!==botName.toLowerCase())return null;
  const name=match[1].toLowerCase();
  if(name==='start')return {name:'help'};
  if(!COMMANDS.some(c=>c.command===name))return {error:'Unknown command. Use /help.'};
  if(!match[3]||match[3].toLowerCase()==='all')return {name};
  if(name==='help'||name==='status')return {error:`Use /${name} without a token.`};
  const token=Object.keys(assets).find(key=>key.toLowerCase()===match[3].toLowerCase()||assets[key].label.toLowerCase()===match[3].toLowerCase());
  return token?{name,token}:{error:'Unknown token. Use ONyc, srONyc, eUSX, USX or srEHYUSD.'};
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
  const lines=['📈 OnRe · Market Implied APY',`🕒 Updated: ${runtime.apyDate(checkedAt)} (UTC+7)${stale?' · ⚠️ STALE — refresh failed':''}`,''];
  for(const key of keys){
    const market=runtime.farthestApyMarket(markets,runtime.assets[key].mint,now/1000);
    lines.push(market?`🪙 ${runtime.assets[key].label} · ${runtime.formatImpliedApy(market.impliedApy)}\n📅 Maturity: ${runtime.apyDate(market.maturityDateUnixTs*1000)}`:`🪙 ${runtime.assets[key].label} · No active market`,'');
  }
  lines.push('Farthest active maturity · Vietnam time');return lines.join('\n');
}
function orderReport(runtime,bundles,command,config,paused,now=Date.now()){
  const side=command.name==='buy'?'buy':command.name==='sell'?'sell':null;
  const lines=[`📋 OnRe · Personal ${side?side==='buy'?'Buy':'Sell':'Buy / Sell'} Orders`,...(paused?['⏸️ Monitor paused · manual read only']:[]),''];
  if(!config.wallets.length)return lines.concat('👛 No synced wallets. Add wallets on the dashboard and use Sync Telegram.').join('\n');
  let count=0,unavailable=0;
  for(const bundle of bundles){
    const {data,assetKey}=bundle,stale=bundle.stale||!data.checkedAt||now-data.checkedAt>12000;
    const records=(data.records||[]).filter(r=>config.wallets.includes(r.owner)&&(!side||r.orderSide===side)&&r.expiry>now/1000&&r.maturity>now/1000);
    if(stale){unavailable++;lines.push(`🪙 ${runtime.assets[assetKey].label} · ${runtime.apyDate(data.market.maturityDateUnixTs*1000)}\n⚠️ STALE — refresh failed; previous data only${data.checkedAt?' · '+runtime.apyDate(data.checkedAt):''}`);}
    for(const r of records){
      count++;let position=r.groupPosition,status='STALE';
      if(!stale){
        const groups=r.orderSide==='sell'?data.sellGroups:data.groups;
        const result=runtime.watchedGroupResult(r,{...data,groups,personalRecords:data.records});
        const prefix=groups?.flatMap(g=>g.rows).slice(0,result.position?.total||0);
        const verified=now-data.checkedAt<=12000&&prefix?.length&&prefix.every(row=>row.position)&&result.front!==null;
        position=verified?result.position:null;status=verified?'Verified':'Queue unverified';
      }
      const apy=100*Math.expm1(r.rawPrice/1e6),amount=typeof r.remainingYt==='number'&&Number.isFinite(r.remainingYt)?r.remainingYt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
      lines.push(`${r.orderSide==='sell'?'🔴 Sell':'🟢 Buy'} · ${runtime.assets[r.assetKey].label}`,
        `📅 Maturity: ${runtime.apyDate(r.maturity*1000)}`,
        `👛 Wallet: ${shortWallet(r.owner)}`,
        `📈 Order #${r.offerId} · APY ${Number.isFinite(apy)?apy.toFixed(2)+'%':'—'}`,
        `📍 Position: ${position?`${position.index} / ${position.total}`:'—'} · ${status} ${status==='Verified'?'✅':'⚠️'}`,
        `💰 Remaining YT: ${amount}`,
        ...(!stale?[`🕒 Updated: ${runtime.apyDate(data.checkedAt)} (UTC+7)`]:[]),'');
    }
  }
  if(!count)lines.push(unavailable?'⚠️ No verified order list available. Failed markets are not treated as empty.':'📭 No open personal orders found.');
  lines.push('Positions use the same front-to-personal group as the dashboard.');return lines.join('\n');
}
function statusReport(runtime,state,now=Date.now()){
  const lines=['🖥️ OnRe · Monitor status',`${state.paused?'⏸️':'▶️'} Monitoring: ${state.paused?'PAUSED':'RUNNING'}`,`🟢 Buy Position: ${state.config.buyPosition?'ON':'OFF'} · 🔴 Sell Position: ${state.config.sellPosition?'ON':'OFF'}`,
    `👛 Wallets: ${state.config.wallets.length} · ⏱️ Scan: ${state.config.interval}s`,
    `🔄 Last sync: ${state.syncedAt?runtime.apyDate(state.syncedAt):'Never'}`,
    `🕒 Last scan: ${state.checkedAt?runtime.apyDate(state.checkedAt):'Not yet'}`,''];
  const health=Object.values(state.health).sort((a,b)=>a.assetKey.localeCompare(b.assetKey)||a.maturity-b.maturity);
  for(const h of health){
    const age=h.checkedAt?Math.max(0,Math.floor((now-h.checkedAt)/1000)):null;
    const fresh=!state.paused&&!h.error&&age!==null&&age<=Math.max(12,state.config.interval+8);
    lines.push(`🪙 ${runtime.assets[h.assetKey]?.label||h.assetKey} · ${runtime.apyDate(h.maturity*1000)}\n${fresh?'✅ Fresh':h.error?'⚠️ Unavailable / unverified':'⚠️ Outdated / not yet checked'}${age===null?'':` · ${age}s since verified scan`}`);
  }
  if(!health.length)lines.push('ℹ️ No market scan status yet.');
  lines.push('','Uses the last synced Windows configuration. Query commands do not change alarms.');return lines.join('\n');
}
module.exports={COMMANDS,HELP,shortWallet,parseCommand,chunks,apyReport,orderReport,statusReport};
