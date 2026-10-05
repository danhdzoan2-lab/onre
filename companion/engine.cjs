'use strict';
const crypto=require('node:crypto');
class AlarmEngine{
  constructor(runtime,state){this.runtime=runtime;this.state=state;state.records??={};state.health??={};state.outbox??=[];}
  enabled(r,config){return config.wallets.includes(r.owner)&&config[r.orderSide==='sell'?'sellPosition':'buyPosition'];}
  allowedEvent(e,config){return e.kind==='health'||this.enabled(e.record,config);}
  queue(events,now){
    events=events.filter(e=>e.kind!=='position'||!this.state.outbox.some(b=>b.events.some(old=>old.kind==='position'&&old.key===e.key&&old.episode===e.episode)));
    if(!events.length)return;
    const id=crypto.randomUUID();
    this.state.outbox.push({id,created:now,events,attempts:0,retryAt:0});
    // Bounded outage queue, newest events retained. Telegram cannot deliver exactly-once after an ambiguous network failure.
    if(this.state.outbox.length>100)this.state.outbox.splice(0,this.state.outbox.length-100);
  }
  updateHealth(health,failed,now,events){
    health.error=failed;
    if(failed){
      health.failedSince??=now;
      if(now-health.failedSince>=60000&&!health.warned){health.warned=true;events.push({kind:'health',text:`${this.runtime.assets[health.assetKey].label}: monitoring interrupted; data unavailable, outdated, or queue identity unverified.`});}
    }else{
      if(health.warned)events.push({kind:'health',text:`${this.runtime.assets[health.assetKey].label}: monitoring recovered.`});
      health.failedSince=null;health.warned=false;
    }
  }
  process(data,assetKey,config,now=Date.now()){
    const vault=data.market.vaultAddress,health=this.state.health[vault]??={assetKey,maturity:data.market.maturityDateUnixTs};
    const events=[],live=new Set();
    if(data.error||!data.checkedAt||now-data.checkedAt>12000){
      this.updateHealth(health,true,now,events);
      this.queue(events,now);return;
    }
    health.checkedAt=data.checkedAt;let unverified=false;
    for(const candidate of data.records){
      const key=this.runtime.orderWatchKey(candidate);live.add(key);
      const r=this.state.records[key]??={...candidate,front:null,ack:false,lastNotice:0,episode:0};
      r.checkedAt=data.checkedAt;r.remainingYt=candidate.remainingYt;
      const enabled=this.enabled(r,config),groups=r.orderSide==='sell'?data.sellGroups:data.groups;
      const result=this.runtime.watchedGroupResult(r,{...data,groups,personalRecords:data.records});
      // Unknown FIFO rows ahead must never make a position trigger authoritative.
      const prefix=groups?.flatMap(g=>g.rows).slice(0,result.position?.total||0);
      const verified=prefix?.length&&prefix.every(row=>row.position)&&result.front!==null;
      if(this.runtime.walletPartialFill(r,candidate.fillEvidence,enabled)){
        r.fillState=candidate.fillEvidence;
        const percent=(Number((BigInt(r.original)-BigInt(candidate.fillEvidence.remaining))*10000n/BigInt(r.original))/100).toFixed(2);
        events.push({kind:'fill',key,record:{...r},text:this.describe(r,`Partially filled: ${percent}% of original filled`)});
      }
      r.positionFresh=!!verified;
      if(!verified){unverified=true;continue;}
      r.groupPosition=result.position;
      if(!enabled){r.front=null;continue;}
      if(!result.front){r.front=false;r.ack=false;continue;}
      if(r.front!==true){r.front=true;r.ack=false;r.lastNotice=0;r.episode++;}
      if(!r.ack&&(!r.lastNotice||now-r.lastNotice>=60000)){
        r.lastNotice=now;
        events.push({kind:'position',key,episode:r.episode,record:{...r},text:this.describe(r,`Group Position 1 / ${result.position.total}`)});
      }
    }
    for(const [key,r] of Object.entries(this.state.records))if(r.vault===vault&&!live.has(key)){r.front=null;r.active=false;}
    for(const key of live)this.state.records[key].active=true;
    this.updateHealth(health,unverified,now,events);
    this.queue(events,now);
  }
  describe(r,detail){
    const maturity=new Date(r.maturity*1000).toLocaleString('en-GB',{timeZone:'Asia/Ho_Chi_Minh'});
    return `${r.orderSide==='sell'?'Sell':'Buy'} · ${this.runtime.assets[r.assetKey].label} · ${maturity}\n${r.owner}\nOrder #${r.offerId} · APY ${(100*Math.expm1(r.rawPrice/1e6)).toFixed(2)}% · ${detail}`;
  }
  acknowledge(events){
    for(const e of events){const r=this.state.records[e.key];if(e.kind==='position'&&r&&r.episode===e.episode)r.ack=true;}
    this.state.outbox=this.state.outbox.map(batch=>({...batch,events:batch.events.filter(e=>!(e.kind==='position'&&events.some(a=>a.key===e.key&&a.episode===e.episode)))})).filter(batch=>batch.events.length);
  }
  prune(config,now=Date.now()){
    for(const [key,r] of Object.entries(this.state.records))if(!config.wallets.includes(r.owner)||r.expiry*1000<now||r.maturity*1000<now)delete this.state.records[key];
    this.state.outbox=this.state.outbox.map(b=>({...b,events:b.events.filter(e=>this.allowedEvent(e,config))})).filter(b=>b.events.length);
  }
}
module.exports={AlarmEngine};
