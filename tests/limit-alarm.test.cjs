const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let starts=0,stops=0,notices=0;
const elements=new Map(['limitAlarmPanel','limitAlarmItems','limitAlarmData','limitAudioStatus','limitAlertStatus','limitWalletStatus'].map(k=>[k,{}]));
const ctx=vm.createContext({Date,Map,BigInt,document:{getElementById:k=>elements.get(k)},localStorage:{setItem(){}},renderApy(){},apyDate:String,
ASSETS:{a:{label:'A',mint:'a'},b:{label:'B',mint:'b'}},selectedAssets:new Set(),apyState:{checkedAt:Date.now(),error:'',markets:[]},
farthestApyMarket:(ms,mint)=>ms.find(m=>m.mint===mint),Notification:Object.assign(function(){notices++;},{permission:'granted'}),
audio:{state:'running',sampleRate:1000,destination:{},createBuffer:(c,n)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource:()=>({connect(){},disconnect(){},start(){starts++;},stop(){stops++;}})}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../limit-monitor.js'),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
run(`limitAudio=audio;limitState.enabled=true;
apyState.markets=['a','b'].map(mint=>({mint,vaultAddress:mint,maturityDateUnixTs:9999999999,impliedApy:.1}));
for(const m of apyState.markets)limitState.records[limitKey(m)]={apy:'10',threshold:'0.1'};
evaluateLimitAlerts();evaluateLimitAlerts();`);
assert.equal(starts,1);assert.equal(notices,1);assert.equal(run('limitAlarm.source.loop'),true);
assert.equal(run('limitAlarm.source.buffer.getChannelData(0).length'),880);
assert.equal(run('limitAlarm.entries.size'),2);
run(`apyState.markets.forEach(m=>m.impliedApy=.2);evaluateLimitAlerts();apyState.error='offline';renderLimitAlarm();`);
assert.equal(stops,0);assert.match(elements.get('limitAlarmData').textContent,/mất kết nối/);
run(`selectedAssets.add('other');renderLimitAlarm();`);assert.equal(stops,0);
run(`stopLimitAlarm();`);assert.equal(stops,1);assert.equal(elements.get('limitAlarmPanel').hidden,true);
run(`apyState.error='';selectedAssets.clear();apyState.markets.forEach(m=>m.impliedApy=.1);evaluateLimitAlerts();`);
assert.equal(starts,2); // Above then at/below re-arms.
run(`stopLimitAlarm();evaluateLimitAlerts();`);assert.equal(starts,2); // Still triggered stays acknowledged.
run(`limitState.edges.clear();evaluateLimitAlerts();`);assert.equal(starts,3); // Explicit settings reset.
run(`limitState.enabled=false;stopLimitAlarm();`);assert.equal(stops,3);assert.equal(run('limitAlarm.entries.size'),0);
run(`limitAlarm.entries.set('blocked','test');audio.state='suspended';startLimitAlarmAudio();`);assert.equal(starts,3);
assert.match(elements.get('limitAudioStatus').textContent,/mở khóa/);
run(`stopLimitAlarm();audio.state='running';startLimitAlarmAudio();`);assert.equal(starts,3);
console.log('PASS: single 2s audio loop, grouped markets, latched recovery/errors, immediate stop, rearm, wallet switch, blocked sound');
