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
const wallet = '3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof';
assert.equal(run(`validLimitWallet('${wallet}')`), true);
assert.equal(run(`validLimitWallet('bad')`), false);
for (const v of ['', ' ', '-1', 'NaN', 'Infinity', '1e4', '10x']) assert.equal(run(`limitNumber(${JSON.stringify(v)})`), null);
assert.equal(run(`limitNumber('0')`), 0);
run(`setLimitWallet('${wallet}'); limitState.enabled=true;
apyState.markets=[{vaultAddress:'v', maturityDateUnixTs:Date.now()/1000+1000, impliedApy:.12}];
const market=apyState.markets[0]; const key=limitKey(limitState.wallet,market);
limitState.records[key]={apy:'10',threshold:'0.1'}; evaluateLimitAlerts();`);
assert.equal(notices, 0);
run(`market.impliedApy=.101; evaluateLimitAlerts(); evaluateLimitAlerts();`);
assert.equal(notices, 1);
run(`market.impliedApy=.12; evaluateLimitAlerts(); apyState.error='offline'; market.impliedApy=.10; evaluateLimitAlerts();`);
assert.equal(notices, 1);
run(`apyState.error=''; evaluateLimitAlerts();`);
assert.equal(notices, 2);
run(`setLimitWallet(''); evaluateLimitAlerts();`);
assert.equal(notices, 2);
run(`setLimitWallet('${wallet}'); evaluateLimitAlerts();`);
assert.equal(notices, 2); // Restored wallet starts with a baseline, not an alert.
assert.notEqual(run(`limitKey('${wallet}',market)`), run(`limitKey('${wallet}',{...market,maturityDateUnixTs:1})`));
ctx.row = el();
run(`renderLimitCells(row,'onyc',market); row.limitInputs[0].value='10.03'; row.limitInputs[0].input(); renderLimitCells(row,'onyc',market);`);
assert.equal(ctx.row.limitInputs[0].value, '10.03');
run(`renderLimitCells(row,'onyc',{...market,maturityDateUnixTs:1})`);
assert.equal(ctx.row.limitInputs[0].value, '');
run(`renderLimitCells(row,'onyc',market)`);
assert.equal(ctx.row.limitInputs[0].value, '10.03');
run(`market.impliedApy=.12; evaluateLimitAlerts(); selectedAssets.add('other'); market.impliedApy=.10; evaluateLimitAlerts();`);
assert.equal(notices, 2);
console.log('Limit monitor tests passed');
