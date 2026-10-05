'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORIGIN='http://127.0.0.1:17643';
function createServer(service,{port=17643}={}){
  const origin=`http://127.0.0.1:${port}`,sessions=new Map();
  const server=http.createServer(async(req,res)=>{
    const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"});res.end(typeof body==='string'?body:JSON.stringify(body));};
    // Prevent DNS rebinding and every non-loopback Host, including alternate host spellings.
    if(req.headers.host!==`127.0.0.1:${port}`)return send(403,{error:'Invalid host'});
    let url;try{url=new URL(req.url,origin);}catch{return send(400,{error:'Invalid URL'});}
    const cookie=req.headers.cookie?.match(/(?:^|;\s*)onre_session=([\da-f]{64})(?:;|$)/)?.[1];
    let session=sessions.get(cookie);
    if(session&&session.expires<Date.now()){sessions.delete(cookie);session=null;}
    if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/connect')){
      // No browser-based automation from third-party frames, fetches, or embeds.
      if(req.headers['sec-fetch-dest']&&req.headers['sec-fetch-dest']!=='document')return send(403,{error:'Open settings in a browser tab'});
      if(!session){const id=crypto.randomBytes(32).toString('hex');session={csrf:crypto.randomBytes(32).toString('hex'),expires:Date.now()+86400000};sessions.set(id,session);res.setHeader('Set-Cookie',`onre_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);}
      for(const [id,s] of sessions)if(s.expires<Date.now())sessions.delete(id);
      return send(200,fs.readFileSync(path.join(__dirname,'settings.html'),'utf8'),'text/html; charset=utf-8');
    }
    if(req.method==='GET'&&['/settings.js','/settings.css'].includes(url.pathname))return send(200,fs.readFileSync(path.join(__dirname,url.pathname.slice(1)),'utf8'),url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');
    if(!session)return send(401,{error:'Open the local settings page first'});
    if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'Invalid origin'});
    if(req.method==='GET'&&url.pathname==='/api/state')return send(200,{...service.view(),csrf:session.csrf});
    if(req.method!=='POST')return send(404,{error:'Not found'});
    if(req.headers.origin!==origin||req.headers['x-onre-csrf']!==session.csrf||!/^application\/json(?:;|$)/.test(req.headers['content-type']||''))return send(403,{error:'Invalid request'});
    try{
      let size=0,body='';for await(const part of req){size+=part.length;if(size>32000)throw Error('Request too large');body+=part;}
      const value=JSON.parse(body);
      switch(url.pathname){
        case '/api/sync':service.sync(value);break;
        case '/api/bot':await service.configureBot(value.token);break;
        case '/api/pair':service.createPair();break;
        case '/api/options':service.options(value);break;
        case '/api/pause':if(typeof value.paused!=='boolean')throw Error('Invalid pause state');service.pause(value.paused);break;
        case '/api/disconnect':service.disconnect();break;
        case '/api/test':await service.test();break;
        default:return send(404,{error:'Not found'});
      }
      return send(200,{...service.view(),csrf:session.csrf});
    }catch(e){
      // Never serialize thrown request URLs, payloads or decrypted credentials.
      const safe=/^(Enter |Invalid |Use a public|Connect a |Link your |This bot |Telegram |Windows credential|Request too large)/.test(e.message||'')?e.message:'Unable to save; check the monitor and try again.';
      return send(400,{error:safe});
    }
  });
  return server;
}
module.exports={createServer,ORIGIN};
