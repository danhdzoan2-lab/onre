const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),timers=new Map(),storage=new Map([['exponent-apy-refresh-seconds-v1','30']]);let id=0;
const ctx=vm.createContext({Map,Date,Number,Math,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},document:{getElementById:k=>{if(!elements.has(k))elements.set(k,{value:'',listeners:{},setAttribute(){},addEventListener(e,f){this.listeners[e]=f;}});return elements.get(k);}},setInterval:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearInterval:n=>timers.delete(n)});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../apy.js'),'utf8'),ctx);
vm.runInContext('initApyRefresh()',ctx);assert.equal([...timers.values()][0].ms,30000);assert.equal(vm.runInContext('apyMaxAge()',ctx),38000);
const input=elements.get('apyRefreshSeconds'),button=elements.get('saveApyRefresh');input.value='10';button.listeners.click();assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,10000);assert.equal(storage.get('exponent-apy-refresh-seconds-v1'),'10');
for(const invalid of ['','-1','0','1','1.5','abc','3601']){input.value=invalid;button.listeners.click();assert.equal([...timers.values()][0].ms,10000);}
input.value='2';input.listeners.keydown({key:'Enter',preventDefault(){}});assert.equal([...timers.values()][0].ms,2000);
console.log('PASS: APY refresh saved interval, validation, Enter, single timer and cadence-aware freshness');
