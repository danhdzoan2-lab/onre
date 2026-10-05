'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('public sync verifies popup, origin, nonce and only acknowledges saved config',()=>{
  const nodes={syncTelegram:{addEventListener:(name,handler)=>nodes.syncTelegram.click=handler},telegramSyncStatus:{textContent:''}},posted=[],handlers=new Map();
  const popup={postMessage:(m,origin)=>posted.push({m,origin})};
  const window={open:()=>popup,addEventListener:(n,h)=>handlers.set(n,h),removeEventListener:n=>handlers.delete(n)};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../telegram-sync.js'),'utf8'),{document:{getElementById:id=>nodes[id]},crypto:{randomUUID:()=> 'nonce'},window,walletMonitor:{wallets:new Set(['wallet'])},limitOptionEnabled:n=>n==='buyPosition',getProxy:()=> 'https://example.com',setTimeout:()=>1,clearTimeout(){}});
  nodes.syncTelegram.click();const receive=handlers.get('message');
  for(const e of [{origin:'https://evil.example',source:popup},{origin:'http://127.0.0.1:17643',source:{} }])receive({...e,data:{nonce:'nonce',type:'onre-telegram-ready'}});
  assert.equal(posted.length,0);
  const event={origin:'http://127.0.0.1:17643',source:popup,data:{nonce:'nonce',type:'onre-telegram-ready'}};receive(event);
  assert.equal(posted.length,1);assert.equal(posted[0].m.config.sellPosition,false);assert.equal(posted[0].m.config.token,undefined);
  receive({...event,data:{nonce:'nonce',type:'onre-telegram-saved'}});assert.match(nodes.telegramSyncStatus.textContent,/synced/);
  assert.equal(handlers.has('message'),false);
});
