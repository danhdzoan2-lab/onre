const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let stops=0,prevented=0,propagation=0;
const elements=new Map();
const ctx=vm.createContext({Map,Date,ASSETS:{},apyState:{checkedAt:Date.now()},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../limit-monitor.js'),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
ctx.source={stop(){stops++;},disconnect(){}};
const arm=()=>run(`limitAlarm.entries.set('market','alert');limitAlarm.source=source;limitState.edges.set('market',true);`);
const event=(extra={})=>({code:'Space',key:' ',target:{closest:()=>null},preventDefault(){prevented++;},stopPropagation(){propagation++;},...extra});
const press=e=>{ctx.event=e;run('handleLimitAlarmSpace(event)');};
press(event());assert.equal(prevented,0,'idle Space remains normal');
for(const extra of [{code:'Enter',key:'Enter'},{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{isComposing:true},{target:{isContentEditable:true}},{target:{closest:()=>({tagName:'INPUT'})}}]){
 arm();press(event(extra));assert.equal(stops,0);
}
arm();press(event());assert.equal(stops,1);assert.equal(prevented,1);assert.equal(propagation,1);
assert.equal(run('limitAlarm.entries.size'),0);assert.equal(run('limitState.edges.get("market")'),true,'acknowledgment does not re-arm');
assert.equal(elements.get('limitAlarmPanel').hidden,true);
press(event({repeat:true}));assert.equal(stops,1);
arm();press(event({code:undefined}));assert.equal(stops,2,'key fallback');
console.log('PASS: Space stops active alarm, retains acknowledgment, ignores typing/modifiers/composition and idle state');
