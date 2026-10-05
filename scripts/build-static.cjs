'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),output=path.join(root,'dist');
// Publish only the browser assets. Never publish companion code or runtime data.
if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())throw Error('Refusing a linked output directory');
fs.mkdirSync(output,{recursive:true});
for(const entry of fs.readdirSync(output)){
  const target=path.join(output,entry);
  if(path.dirname(target)!==output)throw Error('Invalid build output path');
  fs.rmSync(target,{recursive:true,force:true});
}
const files=fs.readdirSync(root,{withFileTypes:true}).filter(f=>f.isFile()&&(f.name==='index.html'||/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/.test(f.name)));
for(const file of files)fs.copyFileSync(path.join(root,file.name),path.join(output,file.name));
console.log(`Built ${files.length} browser assets; Windows monitor is not published.`);
