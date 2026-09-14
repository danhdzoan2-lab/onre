const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const helper = html.slice(html.indexOf('  async function showBrowserNotification('), html.indexOf('  let seenSigs'));
const code = fs.readFileSync(path.join(__dirname, '../limit-monitor.js'), 'utf8');
async function main() {
  const notices = [], status = {};
  const Notification = Object.assign(function(title, options) { notices.push({title, options, fallback: true}); }, {permission: 'granted'});
  const ctx = vm.createContext({Date, Map, Notification, console, setTimeout: () => 0,
    window: {Notification, addEventListener() {}},
    navigator: {serviceWorker: {ready: Promise.resolve({showNotification: async (title, options) => notices.push({title, options})})}},
    document: {getElementById: id => id === 'limitNotificationStatus' ? status : null},
    ASSETS: {}, apyState: {checkedAt: Date.now(), error: ''}});
  vm.runInContext(helper + code, ctx);
  const run = s => vm.runInContext(s, ctx);
  run("limitState.enabled=true; limitAlarm.entries.set('a','alarm');");
  await run("notifyLimitAlarm('srONyc: gap +0.20 pp; threshold 0.5 pp. Maturity 10 Jan 2027.');");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].fallback, undefined, 'uses the High Volume service-worker path');
  assert.equal(notices[0].title, 'APY Alarm');
  for (const key of ['silent', 'renotify', 'requireInteraction']) assert.equal(notices[0].options[key], true);
  assert.match(notices[0].options.body, /srONyc.*threshold.*Maturity/);
  // No AudioContext exists: desktop alerts must remain independent of audio.
  Notification.permission = 'denied';
  await run("notifyLimitAlarm('blocked');");
  assert.equal(notices.length, 1); assert.match(status.textContent, /blocked/);
  Notification.permission = 'granted';
  let ready;
  ctx.navigator.serviceWorker.ready = new Promise(resolve => { ready = resolve; });
  const pending = run("notifyLimitAlarm('cancelled');");
  run('stopLimitAlarm();');
  ready({showNotification: async () => { throw new Error('must not deliver after Stop'); }});
  await pending; assert.equal(notices.length, 1);
  run("limitAlarm.entries.set('a','new');");
  ctx.navigator.serviceWorker.ready = Promise.reject(new Error('SW unavailable'));
  await run("notifyLimitAlarm('fallback');");
  assert.equal(notices.length, 2); assert.equal(notices[1].fallback, true);
  // Transaction callers retain their original options and default guard.
  ctx.navigator = {};
  await run("showBrowserNotification('High volume transaction', {body:'unchanged'});");
  assert.equal(notices.length, 3); assert.deepEqual(Object.keys(notices[2].options), ['body']);
  console.log('PASS: APY Windows notification path, persistent/renotify options, muted audio, denied permission, Stop race, fallback and unchanged transaction options');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
