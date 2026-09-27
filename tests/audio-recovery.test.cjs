const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const handlers={window:{},document:{}},elements=new Map();
const element=id=>{
  if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',events:{},attributes:{},addEventListener(name,fn){this.events[name]=fn;},setAttribute(name,value){this.attributes[name]=value;}});
  return elements.get(id);
};
let allowAudio=false,contexts=0,starts=0,stops=0,chimes=0;
class AudioContext{
  constructor(){this.state='suspended';this.sampleRate=1000;this.destination={};this.currentTime=0;contexts++;AudioContext.current=this;}
  resume(){
    if(!allowAudio)return Promise.reject(Error('Autoplay blocked'));
    this.state='running';this.onstatechange?.();return Promise.resolve();
  }
  createBuffer(_channels,length){return {getChannelData:()=>new Float32Array(length)};}
  createBufferSource(){return {connect(){},disconnect(){},start(){starts++;},stop(){stops++;}};}
  createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){chimes++;},stop(){this.onended?.();}};}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
}
const stored=JSON.stringify({alarmOptions:{buyPosition:true}});
const ctx=vm.createContext({Date,Map,Set,Promise,ASSETS:{},apyState:{checkedAt:Date.now(),error:''},
  window:{AudioContext,addEventListener(name,fn){handlers.window[name]=fn;}},
  document:{visibilityState:'visible',getElementById:element,addEventListener(name,fn){handlers.document[name]=fn;}},
  localStorage:{getItem:key=>key==='exponent-limit-monitor-v2'?stored:null,setItem(){}},
  setInterval(){},renderApy(){}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../limit-monitor.js'),'utf8'),ctx);
const run=source=>vm.runInContext(source,ctx);
const settle=async()=>{await Promise.resolve();await Promise.resolve();};
(async()=>{
  handlers.window.load();
  assert.equal(run('limitState.enabled'),true,'saved alarm remains enabled');
  assert.equal(contexts,0,'load cannot assume browser audio permission');
  assert.equal(element('enableLimitAudio').hidden,false,'explicit audio action is shown after reload');
  assert.match(element('limitAudioStatus').textContent,/needs a click/);
  run("limitAlarm.entries.set('buy','Buy position 1 / 2');startLimitAlarmAudio()");
  assert.equal(starts,0);
  assert.match(element('limitAudioStatus').textContent,/paused/);
  allowAudio=true;
  handlers.document.pointerdown({type:'pointerdown',target:{closest:()=>null}});await settle();
  assert.equal(contexts,1);
  assert.equal(starts,1,'first page gesture starts a previously latched alarm without toggling it');
  assert.equal(element('enableLimitAudio').hidden,true);
  AudioContext.current.state='suspended';AudioContext.current.onstatechange();
  assert.equal(element('enableLimitAudio').hidden,false);
  handlers.document.visibilitychange();await settle();
  assert.equal(AudioContext.current.state,'running','returning to visible tab resumes audio');
  assert.equal(starts,1,'existing looping alarm resumes without duplicate source');
  AudioContext.current.state='closed';AudioContext.current.onstatechange();
  handlers.window.pageshow();await settle();
  assert.equal(contexts,2,'closed audio context is recreated');
  assert.equal(stops,1,'old source is detached');
  assert.equal(starts,2,'active alarm starts on replacement context');
  run('stopLimitAlarm()');
  assert.equal(stops,2);
  AudioContext.current.state='suspended';AudioContext.current.onstatechange();
  allowAudio=true;
  await element('enableLimitAudio').events.click();
  assert.equal(chimes,4,'explicit button plays a short audible test when no alarm is active');
  assert.equal(starts,2,'test chime does not start a continuous alarm');
  AudioContext.current.state='suspended';
  run("limitAlarm.entries.set('sell','Sell position 1 / 2');startLimitAlarmAudio()");await settle();
  assert.equal(starts,3,'new alarm automatically retries a previously unlocked suspended context');
  console.log('PASS: saved ON prompts for sound, page gesture unlocks active alarm, tab return resumes, closed context recovers and test button chimes');
})().catch(error=>{console.error(error);process.exitCode=1;});
