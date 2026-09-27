/* Wallet order discovery has its own browser-local cadence. */
'use strict';
const WALLET_ORDER_REFRESH_STORAGE='exponent-wallet-order-refresh-seconds-v1';
let walletOrderRefreshSeconds=2,walletOrderRefreshTimer=null;
function parseWalletOrderRefreshSeconds(value){
  if(typeof value!=='string'||!/^\d+$/.test(value.trim()))return null;
  const seconds=Number(value);
  return Number.isInteger(seconds)&&seconds>=2&&seconds<=3600?seconds:null;
}
function restartWalletOrderRefresh(seconds){
  if(walletOrderRefreshTimer!==null)clearInterval(walletOrderRefreshTimer);
  walletOrderRefreshSeconds=seconds;
  walletOrderRefreshTimer=setInterval(()=>void pollOrderWatches(),seconds*1000);
}
function initWalletOrderRefresh(){
  const input=document.getElementById('walletOrderRefreshSeconds'),status=document.getElementById('walletOrderRefreshStatus');
  let saved;try{saved=localStorage.getItem(WALLET_ORDER_REFRESH_STORAGE);}catch{}
  restartWalletOrderRefresh(parseWalletOrderRefreshSeconds(saved)??2);
  input.value=String(walletOrderRefreshSeconds);input.setAttribute('aria-invalid','false');status.textContent='';status.hidden=true;
  const save=()=>{
    const seconds=parseWalletOrderRefreshSeconds(input.value);
    input.setAttribute('aria-invalid',String(seconds===null));
    if(seconds===null){status.textContent='Enter a whole number from 2 to 3,600.';status.hidden=false;return;}
    restartWalletOrderRefresh(seconds);input.value=String(seconds);
    try{localStorage.setItem(WALLET_ORDER_REFRESH_STORAGE,String(seconds));status.textContent='';status.hidden=true;}
    catch{status.textContent=`Refresh every ${seconds}s · Storage unavailable; applies to this session only.`;status.hidden=false;}
  };
  document.getElementById('saveWalletOrderRefresh').addEventListener('click',save);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save();}});
}
if(typeof module!=='undefined')module.exports={parseWalletOrderRefreshSeconds};
