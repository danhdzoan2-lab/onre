const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = new Map();
function el() { return { children: [], dataset: {}, style: {}, value: '', textContent: '', appendChild(x) { this.children.push(x); }, setAttribute() {}, addEventListener(name, fn) { this[name] = fn; } }; }
for (const id of ['limitWalletStatus', 'limitAlertStatus']) elements.set(id, el());
let notices = 0;
const ctx = vm.createContext({ Date, Map, BigInt, Number, JSON,
  document: {createElement: el, getElementById: id => elements.get(id)},
  localStorage: {setItem() {}}, renderApy() {},
  Notification: Object.assign(function() { notices++; }, {permission: 'granted'}),
  ASSETS: {onyc: {label: 'ONyc', mint: 'mint'}}, selectedAssets: new Set(),
  apyState: {error: '', checkedAt: Date.now(), markets: []},
  farthestApyMarket: ms => ms[0], apyDate: String
});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../limit-monitor.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);
// Keep these threshold/audio-note regression tests independent of the latched alarm lifecycle.
run(`startLimitAlarmAudio = playLimitApyAlert; limitAlarm.entries.has=()=>false; limitAlarm.entries.set=()=>{};`);
const wallet = '3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof';
assert.equal(run(`validLimitWallet('${wallet}')`), true);
assert.equal(run(`validLimitWallet('bad')`), false);
for (const v of ['', ' ', '-1', 'NaN', 'Infinity', '1e4', '10x']) assert.equal(run(`limitNumber(${JSON.stringify(v)})`), null);
assert.equal(run(`limitNumber('0')`), 0);
run(`setLimitWallet('${wallet}'); limitState.enabled=true;
apyState.markets=[{vaultAddress:'v', maturityDateUnixTs:Date.now()/1000+1000, impliedApy:.102}];
const market=apyState.markets[0]; const key=limitKey(limitState.wallet,market);
limitState.records[key]={apy:'10',threshold:'0.1'}; evaluateLimitAlerts();`);
assert.equal(notices, 0);
run(`market.impliedApy=.1011; evaluateLimitAlerts();`);
assert.equal(notices, 0);
run(`market.impliedApy=.101; evaluateLimitAlerts(); evaluateLimitAlerts();`);
assert.equal(notices, 1);
run(`market.impliedApy=.102; evaluateLimitAlerts(); apyState.error='offline'; market.impliedApy=.098; evaluateLimitAlerts();`);
assert.equal(notices, 1);
run(`apyState.error=''; evaluateLimitAlerts();`);
assert.equal(notices, 2);
run(`setLimitWallet(''); evaluateLimitAlerts();`);
assert.equal(notices, 2);
run(`setLimitWallet('${wallet}'); evaluateLimitAlerts();`);
assert.equal(notices, 3); // Restored wallet alerts once when the signed gap is already <= threshold.
run(`evaluateLimitAlerts()`);
assert.equal(notices, 3);
assert.notEqual(run(`limitKey('${wallet}',market)`), run(`limitKey('${wallet}',{...market,maturityDateUnixTs:1})`));
ctx.row = el();
run(`renderLimitCells(row,'onyc',market); row.limitInputs[0].value='10.03'; row.limitInputs[0].input(); renderLimitCells(row,'onyc',market);`);
assert.equal(ctx.row.limitInputs[0].value, '10.03');
run(`renderLimitCells(row,'onyc',{...market,maturityDateUnixTs:1})`);
assert.equal(ctx.row.limitInputs[0].value, '');
run(`renderLimitCells(row,'onyc',market)`);
assert.equal(ctx.row.limitInputs[0].value, '10.03');
run(`market.impliedApy=.10; evaluateLimitAlerts(); selectedAssets.add('other'); market.impliedApy=.098; evaluateLimitAlerts();`);
assert.equal(notices, 4); // Editing a valid APY re-arms the next fresh evaluation.
console.log('Limit monitor tests passed');
for (const [m, manual, threshold, expected] of [[10.1,10,.1,true],[9.9,10,.1,true],[10.11,10,.1,false],[9.89,10,.1,true],[10,10,0,true],[10.001,10,0,false],[9,10,.1,true],[10.53,10.03,.4,false],[10.43,10.03,.4,true]]) {
  assert.equal(run(`limitGapAtOrBelow(${m},${manual},${threshold})`), expected);
}
run(`row.limitInputs[1].value='-0.1'; row.limitInputs[1].input(); renderLimitCells(row,'onyc',market);`);
assert.match(ctx.row.limitInputs[1].limitError.textContent, /không âm/);
run(`evaluateLimitAlerts()`);
assert.equal(notices, 4);
// One sound + notification for two markets; denied notifications do not mute sound.
run(`selectedAssets.clear(); limitState.edges.clear();
ASSETS.second={label:'Second',mint:'second'};
const second={...market,vaultAddress:'v2',underlyingAsset:{mint:'second'},impliedApy:.102};
market.underlyingAsset={mint:'mint'}; market.impliedApy=.102;
apyState.markets.push(second);
farthestApyMarket=(ms,mint)=>ms.find(m=>m.underlyingAsset.mint===mint);
limitState.records[key]={apy:'10',threshold:'0.1'};
limitState.records[limitKey(limitState.wallet,second)]={apy:'10',threshold:'0.1'};`);
let tones = [];
ctx.fakeAudio = {state:'running',currentTime:0,destination:{},
  createOscillator(){const osc={frequency:{value:0},connect(){},disconnect(){},start(){tones.push(osc.frequency.value);},stop(){}};return osc;},
  createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}};}
};
run(`limitAudio=fakeAudio; evaluateLimitAlerts(); market.impliedApy=.101; second.impliedApy=.098; evaluateLimitAlerts(); evaluateLimitAlerts();`);
assert.equal(notices,5);
assert.deepEqual(tones,[1046.5,1318.5,1568]);
run(`market.impliedApy=.102; second.impliedApy=.102; evaluateLimitAlerts(); Notification.permission='denied'; market.impliedApy=.10; evaluateLimitAlerts();`);
assert.equal(notices,5);
assert.equal(tones.length,6);
run(`market.impliedApy=.102; evaluateLimitAlerts(); apyState.checkedAt=1; market.impliedApy=.10; evaluateLimitAlerts();`);
assert.equal(tones.length,6);
run(`apyState.checkedAt=Date.now(); selectedAssets.add('second'); evaluateLimitAlerts(); selectedAssets.clear(); evaluateLimitAlerts();`);
assert.equal(tones.length,6); // Filtered crossing is not replayed.
console.log('PASS: signed <= boundary, negative gap, invalid inputs, grouped sound, denied notification, stale data, filter replay');
run(`limitState.enabled=false; limitState.edges.clear(); evaluateLimitAlerts();`);
assert.equal(tones.length,6);
run(`limitState.enabled=true; limitState.edges.clear(); apyState.error='offline'; evaluateLimitAlerts();`);
assert.equal(tones.length,6);
run(`apyState.error=''; evaluateLimitAlerts(); evaluateLimitAlerts();`);
assert.equal(tones.length,9); // Enabling while already <= threshold alerts once, only with fresh data.
console.log('PASS: already at/below threshold on enable, no repeat, no stale initial alert');
elements.set('limitAudioStatus',el());
run(`startLimitAlarmAudio=()=>{};`); // Unlock tests below exercise only the one-shot test chime.
(async()=>{
  ctx.fakeAudio.resume=async()=>{ctx.fakeAudio.state='running';};
  ctx.fakeAudio.state='suspended';
  assert.equal(await run('unlockLimitAudio()'),true);
  ctx.fakeAudio.state='suspended';
  ctx.fakeAudio.resume=async()=>{throw new Error('blocked');};
  assert.equal(await run('unlockLimitAudio()'),false);
  assert.match(elements.get('limitAudioStatus').textContent,/âm thanh/);
  run('playLimitApyAlert()');
  assert.equal(tones.length,9);
  console.log('PASS: audio unlock and blocked playback guidance');
})().catch(error=>{console.error(error);process.exitCode=1;});
