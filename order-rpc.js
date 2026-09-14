/* On-demand, read-only snapshots for expanded Buy Orderbook markets. */
'use strict';
const orderRpcState={books:new Map(),flights:new Map(),retryAt:0};
async function orderRpc(method,params){
  if(!['getAccountInfo','getBlockTime','getTransaction','getBlock'].includes(method))throw Error('Unsupported read-only book request');
  if(Date.now()<orderRpcState.retryAt)throw Error('Orderbook rate limited; waiting to retry');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(getProxy(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:controller.signal});
    if(response.status===429){orderRpcState.retryAt=Date.now()+apyRetryDelay(response.headers.get('Retry-After'));throw Error('Orderbook rate limited; waiting to retry');}
    if(!response.ok)throw Error(`Orderbook request failed (${response.status})`);
    const data=await response.json();
    if(data.error){if(data.error.code===429)orderRpcState.retryAt=Date.now()+30000;throw Error(data.error.message||'Orderbook RPC error');}
    return data.result;
  }finally{clearTimeout(timer);}
}
async function getOrderBookSnapshot(address){
  const proxy=getProxy(),key=`${proxy}:${address}`,previous=orderRpcState.books.get(address);
  if(previous&&!previous.error&&previous.proxy===proxy&&Date.now()-previous.checkedAt<1800)return previous;
  if(orderRpcState.flights.has(key))return orderRpcState.flights.get(key);
  const flight=(async()=>{
    try{
      const account=await orderRpc('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);
      if(account?.value?.owner!==ExponentBook.PROGRAM)throw Error('Unexpected orderbook account owner');
      const book=ExponentBook.decodeBook(Uint8Array.from(atob(account.value.data[0]),c=>c.charCodeAt(0)));
      const time=await orderRpc('getBlockTime',[account.context.slot]);
      if(!Number.isFinite(time)||Math.abs(Date.now()/1000-time)>30)throw Error('Orderbook snapshot is stale');
      const snapshot={book,time,slot:account.context.slot,checkedAt:Date.now(),error:'',proxy};
      if(getProxy()===proxy)orderRpcState.books.set(address,snapshot);
      return snapshot;
    }catch(e){
      if(getProxy()===proxy)orderRpcState.books.set(address,{...orderRpcState.books.get(address),error:e.name==='AbortError'?'Orderbook timed out':e.message});
      throw e;
    }finally{orderRpcState.flights.delete(key);}
  })();
  orderRpcState.flights.set(key,flight);return flight;
}
