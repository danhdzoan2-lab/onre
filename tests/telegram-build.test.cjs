'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('production publish includes shared browser code but excludes Windows monitor and credentials',()=>{
  execFileSync(process.execPath,[path.join(__dirname,'../scripts/build-static.cjs')]);
  const output=path.join(__dirname,'../dist'),files=fs.readdirSync(output);
  for(const name of ['index.html','assets.js','wallet-core.js','telegram-sync.js','sw.js'])assert.ok(files.includes(name));
  assert.ok(!files.includes('companion')&&!files.includes('tests')&&!files.includes('state.json')&&!files.some(n=>n.startsWith('.')));
  const html=fs.readFileSync(path.join(output,'index.html'),'utf8');
  for(const m of html.matchAll(/<script[^>]+src="([^"]+)"/g))assert.ok(fs.existsSync(path.join(output,m[1])));
});
