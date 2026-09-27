const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../wallet-refresh.js'),'utf8');
function fixture(stored=null,blocked=false){
  const elements=new Map(),timers=new Map();let next=0,polls=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,events:{},attributes:{},
      addEventListener(name,fn){this.events[name]=fn;},setAttribute(name,value){this.attributes[name]=value;}});
    return elements.get(id);
  };
  const ctx=vm.createContext({document:{getElementById:element},pollOrderWatches:()=>{polls++;},
    localStorage:{getItem:()=>{if(blocked)throw Error('blocked');return stored;},setItem:(key,value)=>{if(blocked)throw Error('blocked');stored=value;}},
    setInterval:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearInterval:id=>timers.delete(id)});
  vm.runInContext(source,ctx);vm.runInContext('initWalletOrderRefresh()',ctx);
  return {ctx,element,timers,saved:()=>stored,polls:()=>polls};
}
const f=fixture(),input=f.element('walletOrderRefreshSeconds'),save=f.element('saveWalletOrderRefresh');
assert.equal(input.value,'2');assert.equal([...f.timers.values()][0].ms,2000);
input.value='10';save.events.click();assert.equal(f.saved(),'10');assert.equal(f.timers.size,1);
assert.equal([...f.timers.values()][0].ms,10000);assert.equal(f.polls(),0,'Save does not trigger another scan');
[...f.timers.values()][0].fn();assert.equal(f.polls(),1);
for(const bad of ['','0','1','-1','2.5','1e2','3601','abc']){
  input.value=bad;save.events.click();assert.equal(f.saved(),'10');assert.equal(f.timers.size,1);
  assert.equal([...f.timers.values()][0].ms,10000);assert.equal(input.attributes['aria-invalid'],'true');
}
input.value='30';let prevented=false;input.events.keydown({key:'Enter',preventDefault(){prevented=true;}});
assert.equal(prevented,true);assert.equal(f.saved(),'30');assert.equal(f.timers.size,1);
assert.equal(fixture(f.saved()).element('walletOrderRefreshSeconds').value,'30','reload restores saved cadence');
assert.equal(fixture('bad').element('walletOrderRefreshSeconds').value,'2','invalid saved value falls back to default');
const blocked=fixture(null,true);blocked.element('walletOrderRefreshSeconds').value='15';blocked.element('saveWalletOrderRefresh').events.click();
assert.equal([...blocked.timers.values()][0].ms,15000);assert.match(blocked.element('walletOrderRefreshStatus').textContent,/session only/);
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert.ok(html.indexOf('id="walletOrderRefreshSeconds"')>html.indexOf('id="apyRefreshSeconds"'));
assert.ok(html.indexOf('src="wallet-refresh.js"')<html.indexOf('src="wallet-monitor.js"'));
const monitor=fs.readFileSync(path.join(__dirname,'../wallet-monitor.js'),'utf8');
assert.match(monitor,/function initWalletMonitor\(\)\s*\{\s*initWalletOrderRefresh\(\)/);
assert.doesNotMatch(monitor,/setInterval\(\(\)=>void pollOrderWatches\(\),2000\)/);
console.log('PASS: independent wallet scan cadence, Save/Enter, persistence, validation and session-only fallback');
