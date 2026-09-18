const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
class Element{
 constructor(){this.children=[];this.dataset={};this.open=false;this.hidden=false;this.events={};}
 append(...nodes){for(const n of nodes){if(n.parent)n.parent.children=n.parent.children.filter(x=>x!==n);n.parent=this;this.children.push(n);}}
 addEventListener(name,fn){this.events[name]=fn;}
}
const root=new Element(),keys=['onyc','sronyc','eusx','usx','srehyusd','strcx'];
const assets=Object.fromEntries(keys.map(key=>[key,{mint:key,label:key}]));
const now=Date.now()/1000,markets=keys.flatMap(key=>[1,2].map(n=>({vaultAddress:key+n,underlyingAsset:{mint:key},maturityDateUnixTs:now+n*86400})));
const c={window:{},document:{createElement:()=>new Element(),getElementById:()=>root},ASSETS:assets,apyState:{markets},selectedAssets:new Set(),escapeHtml:String,apyDate:String,Date,Map,
 farthestApyMarket:(list,mint)=>list.filter(m=>m.underlyingAsset.mint===mint).sort((a,b)=>b.maturityDateUnixTs-a.maturityDateUnixTs)[0]};
vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../market-layout.js'),'utf8'),c);
const layout=c.window.marketLayout;layout.sync();
assert.deepEqual(root.children.map(n=>n.dataset.token),keys.slice(0,5));
assert.ok(root.children.every(n=>!n.open));
const token=layout.get('sronyc'),buy=layout.mount('sronyc','buy'),sell=layout.mount('sronyc','sell'),sim=layout.mount('sronyc','simulation');
assert.deepEqual(token.body.children.map(n=>n.dataset.section),['simulation','buy','sell']);
token.details.open=true;assert.ok(buy.open&&sell.open&&sim.open);
layout.sync();assert.equal(token.details.open,true);assert.equal(layout.market('sronyc').vaultAddress,'sronyc2');
layout.navigate({assetKey:'sronyc',vault:'sronyc1'});assert.equal(layout.market('sronyc').vaultAddress,'sronyc1');
c.selectedAssets.add('eusx');layout.sync();assert.ok(token.details.hidden);assert.ok(token.details.open);
c.selectedAssets.clear();layout.sync();assert.equal(token.details.hidden,false);
token.details.open=false;assert.equal(buy.open,false);assert.equal(sell.open,false);assert.equal(sim.open,false);
markets.find(m=>m.vaultAddress==='sronyc1').maturityDateUnixTs=now-1;
assert.equal(layout.market('sronyc').vaultAddress,'sronyc2');
layout.navigate({assetKey:'strcx',vault:'strcx1'});assert.equal(root.children.length,6);assert.ok(layout.get('strcx').details.open);
assert.equal(layout.mount('sronyc','buy'),buy,'Refresh retains the same section DOM');
console.log('PASS: shared token layout, section order, lazy state, filters, exact maturity, expiry fallback, and legacy STRCx navigation');
