const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../apy.js'), 'utf8');
const elements = new Map();
function element() {
  return { children: [], dataset: {}, textContent: '', appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); }, get lastElementChild() { return this.children.at(-1); } };
}
elements.set('apyRows', element()); elements.set('apyStatus', element());
let response, pending, calls = 0, timeoutCallback;
const ctx = vm.createContext({ Date, AbortController, ASSETS: { onyc: {mint:'mint',label:'ONyc'}, eusx:{mint:'other',label:'eUSX'} }, selectedAssets: new Set(),
  document: { getElementById:id=>elements.get(id), createElement:element },
  setTimeout:fn=>{timeoutCallback=fn; return 1;}, clearTimeout(){},
  fetch:async(url,options)=>{calls++; if(pending)return pending(options); if(response instanceof Error)throw response; return response;}
});
vm.runInContext(source,ctx);
const run = code=>vm.runInContext(code,ctx);
const now = Math.floor(Date.now()/1000);
const market = (id,expiry,mint='mint')=>({vaultAddress:id,maturityDateUnixTs:expiry,underlyingAsset:{mint},marketStatus:'active',impliedApy:0.1375});
ctx.fixtures=[market('expired',now-1),market('later',now+200),market('b',now+100),market('a',now+100),market('other',now+50,'other')];
assert.equal(run(`nearestApyMarket(fixtures,'mint',${now}).vaultAddress`),'a');
assert.equal(run(`nearestApyMarket(fixtures,'mint',${now+100}).vaultAddress`),'later');
assert.equal(run(`nearestApyMarket(fixtures,'mint',${now+300})`),null);
assert.equal(run('formatImpliedApy(0)'), '0.00%');
assert.equal(run('formatImpliedApy(0.1375)'), '13.75%');
for(const input of ['null','undefined','NaN','Infinity','"0.1"']) assert.equal(run(`formatImpliedApy(${input})`),'—');
assert.equal(run('apyRetryDelay("12",0)'),12000);
assert.equal(run('apyRetryDelay("Thu, 01 Jan 1970 00:01:00 GMT",0)'),60000);
assert.equal(run('apyRetryDelay(null,0)'),30000);
(async()=>{
  response={ok:true,status:200,json:async()=>ctx.fixtures};
  await run('fetchApy()');
  assert.equal(elements.get('apy-onyc').children[3].textContent,'13.75%');
  const row=elements.get('apy-onyc');
  run('selectedAssets.add("onyc");renderApy()');
  assert.equal(elements.get('apy-eusx').hidden,true);
  run('selectedAssets.add("eusx");renderApy()');
  assert.equal(elements.get('apy-eusx').hidden,false);
  assert.equal(elements.get('apy-onyc'),row);
  response=new Error('Network failure'); await run('fetchApy()');
  assert.equal(elements.get('apyStatus').dataset.stale,'true');
  assert.equal(row.children[3].textContent,'13.75%');
  response={ok:false,status:429,headers:{get:()=> '30'}}; await run('fetchApy()');
  const count=calls; await run('fetchApy()'); assert.equal(calls,count);
  run('apyState.retryAt=0');
  pending=options=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'}))));
  const flight=run('fetchApy()'); const before=calls; await run('fetchApy()'); assert.equal(calls,before);
  timeoutCallback(); await flight;
  assert.equal(run('apyState.inFlight'),false);
  assert.match(run('apyState.error'),/quá chậm/);
  pending=null;response={ok:true,status:200,json:async()=>[]};await run('fetchApy()');
  assert.equal(row.children[1].textContent,'Chưa có market còn hạn');
  assert.equal(run('apyState.error'),'');
  console.log('PASS: market selection, rollover, APY formatting, multi-filter, stable rows, network errors, rate limits, timeout, concurrency, recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
