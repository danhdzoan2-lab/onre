/* No bot token is ever handled by the public dashboard. */
'use strict';
(() => {
  const origin='http://127.0.0.1:17643';
  document.getElementById('syncTelegram').addEventListener('click',()=>{
    const status=document.getElementById('telegramSyncStatus');
    const nonce=crypto.randomUUID();
    const popup=window.open(`${origin}/connect#${nonce}`,'onreTelegram');
    if(!popup){status.textContent='Allow pop-ups to sync Telegram.';return;}
    status.textContent='Opening Windows monitor. If it is not installed, follow the Telegram setup guide.';
    const config={version:1,wallets:[...walletMonitor.wallets],buyPosition:limitOptionEnabled('buyPosition'),sellPosition:limitOptionEnabled('sellPosition'),rpc:getProxy()};
    const timer=setTimeout(()=>{cleanup();status.textContent='Not synced. Start the Windows monitor and try again.';},60000);
    function cleanup(){clearTimeout(timer);window.removeEventListener('message',receive);}
    function receive(event){
      if(event.origin!==origin||event.source!==popup||event.data?.nonce!==nonce)return;
      if(event.data.type==='onre-telegram-ready')popup.postMessage({type:'onre-telegram-config',nonce,config},origin);
      if(event.data.type==='onre-telegram-saved'){cleanup();status.textContent='Telegram settings synced on this Windows PC.';}
    }
    window.addEventListener('message',receive);
  });
})();
