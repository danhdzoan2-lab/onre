'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../companion/server.cjs');
test('loopback settings session, CSRF, untrusted origins and safe responses',async()=>{
  let saved=0;
  const service={view:()=>({connected:false,config:{wallets:[]}}),sync:()=>saved++};
  const port=17644,origin=`http://127.0.0.1:${port}`,server=createServer(service,{port});
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  try{
    assert.equal((await fetch(origin+'/api/state')).status,401);
    const page=await fetch(origin+'/');assert.equal(page.status,200);const cookie=page.headers.get('set-cookie').split(';')[0];
    const state=await (await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();assert.ok(state.csrf);assert.equal(state.encryptedToken,undefined);
    const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-Onre-CSRF':state.csrf};
    assert.equal((await fetch(origin+'/api/sync',{method:'POST',headers,body:'{}'})).status,200);assert.equal(saved,1);
    assert.equal((await fetch(origin+'/api/sync',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
    assert.equal((await fetch(origin+'/api/sync',{method:'POST',headers:{...headers,'X-Onre-CSRF':'bad'},body:'{}'})).status,403);
    const invalidHost=await new Promise((resolve,reject)=>{const req=require('node:http').get(origin+'/api/state',{headers:{Cookie:cookie,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
    assert.equal(invalidHost,403);
    assert.equal(saved,1);
    assert.equal((await fetch(origin+'/api/bot',{method:'POST',headers,body:'invalid'})).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
