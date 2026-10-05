'use strict';
const path=require('node:path');
const {MonitorService}=require('./service.cjs'),{createServer}=require('./server.cjs');
async function main(){
  const directory=path.join(process.env.LOCALAPPDATA,'OnReTelegram');
  const service=new MonitorService(directory),server=createServer(service);
  server.on('error',e=>{
    // A duplicate instance exits; the installer and Task Scheduler use single-instance mode.
    if(e.code==='EADDRINUSE')process.exit(0);
    process.stderr.write('OnRe Telegram could not start its local settings server.\n');process.exit(1);
  });
  server.listen(17643,'127.0.0.1',async()=>{await service.ready;service.start();});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{service.stop();server.close(()=>process.exit(0));});
}
if(require.main===module)main().catch(()=>{process.stderr.write('OnRe Telegram startup failed.\n');process.exit(1);});
