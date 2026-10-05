'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
// Load exactly the dashboard's DOM-free functions in an isolated context.
// No eval of API data, browser storage, HTML, or downloaded code is involved.
function createRuntime(rpc,request=fetch){
  const context=vm.createContext({Date,Map,Set,BigInt,Number,Promise,Uint8Array,AbortController,setTimeout,clearTimeout,
    atob,fetch:request,getProxy:()=>rpc,ExponentBook:require('../orderbook.js')});
  for(const file of ['assets.js','apy.js','reward-range.js','position-groups.js','buy-orderbook.js','sell-orderbook.js','order-watch.js','order-rpc.js','order-placement.js','wallet-core.js']){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  return vm.runInContext('({assets:ASSETS,farthestApyMarket,formatImpliedApy,apyDate,apyRetryDelay,orderRewardsText,validMonitorWallet,walletMarkets,scanWalletMarket,orderWatchKey,watchedGroupResult,walletPartialFill,validWalletFillState,withBookRequest})',context);
}
function validateConfig(value,previous={interval:5}){
  if(!value||value.version!==1||!Array.isArray(value.wallets)||value.wallets.length>100)throw Error('Invalid configuration');
  const runtime=createRuntime('https://invalid.example');
  if(value.wallets.some(w=>!runtime.validMonitorWallet(w))||new Set(value.wallets).size!==value.wallets.length)throw Error('Invalid or duplicate wallet');
  if(typeof value.buyPosition!=='boolean'||typeof value.sellPosition!=='boolean')throw Error('Invalid alarm settings');
  const url=new URL(value.rpc);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||!url.hostname.includes('.')||url.hostname.endsWith('.local')||url.hostname.endsWith('.localhost')||/^\d/.test(url.hostname)||url.hostname.includes(':'))throw Error('Use a public HTTPS RPC proxy');
  return {version:1,wallets:value.wallets,buyPosition:value.buyPosition,sellPosition:value.sellPosition,rpc:url.href,interval:previous.interval||5};
}
module.exports={createRuntime,validateConfig};
