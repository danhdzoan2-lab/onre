const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../refresh-settings.js'), 'utf8');
function fixture(stored = null, blocked = false) {
  let next = 0, calls = 0;
  const timers = new Map(), elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value:'', dataset:{}, events:{}, attributes:{},
      addEventListener(key, fn) { this.events[key] = fn; }, setAttribute(key, value) { this.attributes[key] = value; }});
    return elements.get(id);
  };
  const ctx = vm.createContext({document:{getElementById:element}, fetchInFlight:false,
    getProxy:()=>true, fetchAll:()=>{calls++;},
    localStorage:{getItem:()=>{if(blocked) throw Error('blocked'); return stored;}, setItem:(key,value)=>{if(blocked) throw Error('blocked'); stored=value;}},
    setInterval:(fn,ms)=>{timers.set(++next,{fn,ms});return next;}, clearInterval:id=>timers.delete(id)});
  vm.runInContext(source, ctx);
  const run = text => vm.runInContext(text, ctx);
  run('initTransactionRefresh();');
  return {ctx, run, element, timers, saved:()=>stored, calls:()=>calls};
}
const f=fixture(), input=f.element('transactionRefreshSeconds');
assert.equal(input.value,'2');assert.equal([...f.timers.values()][0].ms,2000);
input.value='30';f.element('saveTransactionRefresh').events.click();
assert.equal(f.saved(),'30');assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].ms,30000);
assert.equal(f.calls(),0,'Save does not create an extra fetch');
const timer=[...f.timers.values()][0]; timer.fn();assert.equal(f.calls(),1);
f.ctx.fetchInFlight=true;timer.fn();assert.equal(f.calls(),1,'no overlapping request');f.ctx.fetchInFlight=false;
f.ctx.getProxy=()=>false;timer.fn();assert.equal(f.calls(),1,'no proxy means no polling');
for(const bad of ['', '0', '-2', '1', '2.5', '1e2', 'Infinity', '3601', 'abc']) {
  input.value=bad;f.run('saveTransactionRefresh();');
  assert.equal(f.saved(),'30');assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].ms,30000);
  assert.equal(input.attributes['aria-invalid'],'true');
}
input.value='3600';let prevented=false;input.events.keydown({key:'Enter',preventDefault(){prevented=true;}});
assert.ok(prevented);assert.equal(f.saved(),'3600');assert.equal(f.timers.size,1);
assert.equal(fixture(f.saved()).element('transactionRefreshSeconds').value,'3600','reload restores setting');
assert.equal(fixture('invalid').element('transactionRefreshSeconds').value,'2');
const blocked=fixture(null,true);blocked.element('transactionRefreshSeconds').value='15';blocked.run('saveTransactionRefresh();');
assert.equal([...blocked.timers.values()][0].ms,15000);assert.match(blocked.element('transactionRefreshStatus').textContent,/session only/);
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert.ok(html.includes('initTransactionRefresh();'));
assert.ok(!html.includes('POLL_INTERVAL_MS'));
assert.ok(html.indexOf('id="transactionRefreshSeconds"')>html.indexOf('<details class="settings">'));
console.log('PASS: saved transaction interval, reload, validation, one timer, Enter, no overlap, missing proxy and storage failure');
