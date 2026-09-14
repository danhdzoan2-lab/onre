const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let calls=0,hold,release,responseError=null;
const book={vault:'v'},ctx=vm.createContext({Date,Map,Uint8Array,atob,AbortController,setTimeout,clearTimeout,
 getProxy:()=> 'https://example.test',apyRetryDelay:()=>30000,
 ExponentBook:{PROGRAM:'program',decodeBook:()=>book},
 fetch:async(url,options)=>{calls++;if(hold)await new Promise(r=>{release=r;});if(responseError)return responseError;
 const method=JSON.parse(options.body).method;
 return {ok:true,json:async()=>({result:method==='getAccountInfo'?{value:{owner:'program',data:['','base64']},context:{slot:123}}:Math.floor(Date.now()/1000)})};}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../order-rpc.js'),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
(async()=>{
 assert.equal(calls,0,'no background requests');
 hold=true;const first=run('getOrderBookSnapshot("b")'),second=run('getOrderBookSnapshot("b")');assert.equal(calls,1);
 hold=false;release();const [a,b]=await Promise.all([first,second]);assert.equal(a,b);assert.equal(a.book,book);assert.equal(calls,2);
 await run('getOrderBookSnapshot("b")');assert.equal(calls,2,'fresh snapshot reused');
 run('orderRpcState.books.get("b").checkedAt=0');responseError={status:429,headers:{get:()=> '30'}};
 await assert.rejects(run('getOrderBookSnapshot("b")'),/rate limited/);
 assert.equal(run('orderRpcState.books.get("b").book'),book,'retain previous snapshot');
 const count=calls;await assert.rejects(run('getOrderBookSnapshot("b")'),/rate limited/);assert.equal(calls,count);
 await assert.rejects(run('orderRpc("getTransaction",[])'),/Unsupported/);
 assert.equal(run('orderRpcState.flights.size'),0);
 console.log('PASS: on-demand read-only snapshots, shared requests, cache, backoff and stale retention');
})().catch(e=>{console.error(e);process.exitCode=1;});
