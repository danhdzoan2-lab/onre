'use strict';
let state,csrf='',pendingConfig=null,syncComplete=false;
const nonce=location.hash.slice(1),dashboard='https://onre.vercel.app';
const $=id=>document.getElementById(id);
const date=value=>value?new Date(value).toLocaleString():'—';
async function request(route,value){
  const response=await fetch(route,value===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Onre-CSRF':csrf},body:JSON.stringify(value)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Local monitor unavailable');
  csrf=data.csrf;state=data;render();return data;
}
function render(){
  $('configState').textContent=`${state.config.wallets.length} wallets · Buy Position: ${state.config.buyPosition?'ON':'OFF'} · Sell Position: ${state.config.sellPosition?'ON':'OFF'}`;
  $('syncState').textContent=state.syncedAt?`Last saved sync: ${date(state.syncedAt)}`:'Use Sync Telegram in dashboard Settings.';
  $('scanState').textContent=`${state.paused?'Paused':'Running'} · Last scan: ${date(state.checkedAt)} · Pending messages: ${state.pending}`;
  $('botState').textContent=state.connected?`Linked to @${state.botName}`:state.botConfigured?'Bot saved. Open Telegram and press Start to link your private chat.':'No bot linked.';
  $('pairLink').hidden=!state.pairLink;if(state.pairLink)$('pairLink').href=state.pairLink;
  $('newPair').hidden=!state.botConfigured||state.connected;
  $('pause').textContent=state.paused?'Resume':'Pause';$('pause').disabled=!state.connected;
  $('test').disabled=!state.connected;$('disconnect').disabled=!state.botConfigured;
  if(document.activeElement!==$('interval'))$('interval').value=state.config.interval;
  const rows=state.health.map(h=>{const row=document.createElement('tr');const fresh=!state.paused&&!h.error&&Date.now()-h.checkedAt<=state.config.interval*1000+12000;const values=[h.label,date(h.maturity*1000),state.paused?'Paused':fresh?'Up to date':'Unavailable / outdated',date(h.checkedAt)];values.forEach((text,i)=>{const cell=document.createElement('td');cell.textContent=text;if(i===2)cell.className=fresh?'fresh':'stale';row.append(cell);});return row;});$('markets').replaceChildren(...rows);
  $('error').textContent=state.status;
}
async function action(task){try{$('error').textContent='';await task();}catch(e){$('error').textContent=e.message;}}
async function receive(event){
  if(event.origin!==dashboard||event.source!==window.opener||event.data?.type!=='onre-telegram-config'||event.data.nonce!==nonce||!nonce||syncComplete)return;
  pendingConfig=event.data.config;
  if(!csrf)return;
  syncComplete=true;
  await action(async()=>{try{await request('/api/sync',pendingConfig);window.opener.postMessage({type:'onre-telegram-saved',nonce},dashboard);}catch(e){syncComplete=false;throw e;}});
}
window.addEventListener('message',receive);
$('botForm').addEventListener('submit',e=>{e.preventDefault();const token=$('token').value.trim();$('token').value='';void action(()=>request('/api/bot',{token}));});
$('intervalForm').addEventListener('submit',e=>{e.preventDefault();void action(()=>request('/api/options',{interval:Number($('interval').value)}));});
$('pause').addEventListener('click',()=>void action(()=>request('/api/pause',{paused:!state.paused})));
$('test').addEventListener('click',()=>void action(async()=>{await request('/api/test',{});$('error').textContent='Test message sent.';}));
$('disconnect').addEventListener('click',()=>{if(confirm('Disconnect Telegram and stop its alerts?'))void action(()=>request('/api/disconnect',{}));});
$('newPair').addEventListener('click',()=>void action(()=>request('/api/pair',{})));
void action(async()=>{
  await request('/api/state');
  if(window.opener&&/^[\w-]{20,80}$/.test(nonce))window.opener.postMessage({type:'onre-telegram-ready',nonce},dashboard);
});
setInterval(()=>void action(()=>request('/api/state')),5000);
