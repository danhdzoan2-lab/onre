const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();const element=()=>({innerHTML:'',textContent:'',addEventListener(){}});
const storage=new Map();
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
assert.ok(!html.includes('refreshTime'));
assert.match(html,/SIGNATURE_SCAN_LIMIT = 50/);assert.match(html,/DISPLAY_LIMIT = 50/);
assert.equal((html.match(/id="limitAlerts"/g)||[]).length,1);
assert.equal((html.match(/id="orderMarkersPanel"/g)||[]).length,1);
const ctx=vm.createContext({console,Date,Map,Set,BigInt,Number,JSON,AbortController,Uint8Array,atob,
  ExponentBook:require('../orderbook'),ASSETS:{},apyState:{markets:[],checkedAt:0,error:''},selectedAssets:new Set(),
  document:{addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}},
  window:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setInterval(){},setTimeout,clearTimeout,
  escapeHtml:s=>String(s).replaceAll('<','&lt;'),sh:s=>s,apyDate:s=>String(s),getProxy:()=>'',renderCurrentTransactions(){},
  mapWithConcurrency:async(items,n,fn)=>Promise.all(items.map(fn))});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../order-monitor.js'),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
run(`const m={signature:'5WTKGrr5Mio6RwJYoqbcdnQYsViRAhLdQbHMJkuJVtbphPMWhUQ7YzVXGnYWH7kUnoeL7LwxfbuVBt1ANVEWjo3P',owner:'wallet',book:'b',vault:'v',price:84708,id:28,side:2,virtual:0,amount:'100',ts:100,expirySeconds:100,slot:20,transactionIndex:9,outer:7,inner:5};
const offer={id:28,owner:'wallet',created:100,expiry:200,amount:100n,virtual:0,side:2,pricePointer:1,next:0};
const book={vault:'v',prices:[{id:1,price:84708,buyHead:28,buyTail:28}],offers:new Map([[28,offer]])};`);
assert.equal(run('markerPosition(book,m,110).total'),1);
assert.equal(run('markerPosition(book,{...m,owner:"another"},110).missing'),true);
assert.equal(run('markerPosition(book,{...m,ts:99},110).missing'),true);
assert.equal(run('markerPosition(book,m,201).missing'),true);
assert.equal(run('compareOrderEvent({...m,slot:21},m)'),1);
assert.equal(run('compareOrderEvent({...m,signature:"other",transactionIndex:10},m)'),1);
assert.equal(run('compareOrderEvent({...m,signature:"other",transactionIndex:undefined},m)'),null);
assert.equal(run('compareOrderEvent({...m,inner:6},m)'),1);
run('orderWatch.markers=[m];saveOrderMarkers();orderWatch.markers=[];loadOrderMarkers();');assert.equal(run('orderWatch.markers.length'),1);
run('renderOrderMarkers()');assert.match(elements.get('orderMarkers').innerHTML,/Position unverified/);
run('orderWatch.books.set("b",{book,time:110,checkedAt:Date.now(),error:""});renderOrderMarkers();');assert.match(elements.get('orderMarkers').innerHTML,/Last in queue/);
run('orderWatch.books.get("b").error="Network failed";renderOrderMarkers();');assert.match(elements.get('orderMarkers').innerHTML,/Stale/);
(async()=>{
  run(`let pages=0;orderRpc=async(method,params)=>{if(method==='getSignaturesForAddress'){pages++;return pages===1?[{signature:'new',slot:21},{signature:m.signature,slot:20},{signature:'older',slot:19}]:[{signature:'new',slot:21}];}return {fake:params[0]};};ExponentBook={...ExponentBook,postEvents:tx=>[{...m,signature:tx.fake,slot:tx.fake==='new'?21:20}]};`);
  await run('syncOrderHistory("b",orderWatch.revision)');
  assert.equal(run('orderWatch.history.b.complete'),true);assert.equal(run('orderWatch.history.b.checkpoint'),'new');assert.equal(run('orderWatch.history.b.events.length'),2);
  await run('syncOrderHistory("b",orderWatch.revision)');assert.equal(run('orderWatch.history.b.events.length'),2);
  run('orderWatch.history.b.checkpoint="missing";orderRpc=async()=>[];');
  await assert.rejects(run('syncOrderHistory("b",orderWatch.revision)'),/checkpoint unavailable/);
  console.log('PASS: marker identity/reuse, expiry, on-chain ordering, reload, stale snapshots, pagination checkpoint and deduplication');
})().catch(e=>{console.error(e);process.exitCode=1;});
