const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{
 constructor(){this.children=[];this.innerHTML='';this.textContent='';this.open=false;this.hidden=false;this.events={};}
 append(...xs){for(const x of xs)this.appendChild(x);}
 appendChild(x){if(x.parent)x.parent.children=x.parent.children.filter(y=>y!==x);x.parent=this;this.children.push(x);return x;}
 insertBefore(x,before){if(!before)return this.appendChild(x);if(x.parent)x.parent.children=x.parent.children.filter(y=>y!==x);x.parent=this;this.children.splice(this.children.indexOf(before),0,x);return x;}
 replaceChildren(){this.children=[];}
 remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}
 setAttribute(){} addEventListener(name,fn){this.events[name]=fn;}
}
const root=new Element(),assets={onyc:{label:'ONyc',mint:'m1'},strcx:{label:'STRCx',mint:'m2'},sronyc:{label:'srONyc',mint:'m3'},eusx:{label:'eUSX',mint:'m4'},usx:{label:'USX',mint:'m5'}};
const market={vaultAddress:'v',maturityDateUnixTs:Date.now()/1000+86400,orderbookAddresses:['b'],decimals:9,syExchangeRate:1};
let calls=0,respond,timer,tick,response={ok:true,json:async()=>[]};
const context={window:{addEventListener(){}},document:{createElement:()=>new Element(),getElementById:()=>root,addEventListener(){}},
 Date,Map,Set,BigInt,Number,AbortController,ASSETS:assets,selectedAssets:new Set(),apyState:{markets:[market],checkedAt:Date.now(),error:''},
 farthestApyMarket:()=>market,apyDate:String,escapeHtml:String,sh:String,orderWatch:{markers:[],books:new Map()},
 getOrderBookSnapshot:async()=>({error:''}),apyRetryDelay:()=>30000,
 setInterval:fn=>{tick=fn;},setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},
 fetch:(url,options)=>{calls++;return new Promise((resolve,reject)=>{respond=()=>resolve(response);options.signal.addEventListener('abort',()=>reject(Object.assign(Error('timeout'),{name:'AbortError'})));});}};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../buy-orderbook.js'),'utf8'),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 context.window.renderBuyBooks();assert.equal(root.children.length,5);assert.equal(calls,0);
 const detail=root.children[2];detail.open=true;context.window.renderBuyBooks();assert.equal(calls,1);
 tick();tick();assert.equal(calls,1,'in-flight request must not overlap');
 respond();await flush();assert.equal(detail.children[1].textContent,'No open buy orders');
 detail.open=false;tick();assert.equal(calls,1,'closed market must not poll');
 detail.open=true;context.selectedAssets.add('onyc');tick();assert.equal(detail.hidden,true);assert.equal(calls,1,'filtered market must not poll');
 context.selectedAssets.clear();response={status:429,headers:{get:()=>null}};tick();assert.equal(calls,2);respond();await flush();
 assert.match(detail.children[1].textContent,/Stale.*Rate limited/);tick();assert.equal(calls,2,'Retry-After backoff');
 market.vaultAddress='next-vault';tick();assert.equal(detail.open,false,'rollover closes old market');assert.equal(detail.children[2].children.length,0);
 assert.equal(calls,2);detail.open=true;tick();assert.equal(calls,3,'new maturity can load independently');timer();await flush();assert.match(detail.children[1].textContent,/timed out/);
 console.log('PASS: five markets, lazy loading, collapse, filter selection, no overlap, stale errors, backoff and maturity reset');
})().catch(e=>{console.error(e);process.exitCode=1;});
