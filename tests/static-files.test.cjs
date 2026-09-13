const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
 const src=match[1].match(/src="([^"]+)"/);
 if(src){assert.ok(fs.existsSync(path.join(root,src[1])),`Missing ${src[1]}`);new vm.Script(fs.readFileSync(path.join(root,src[1]),'utf8'),{filename:src[1]});}
 else new vm.Script(match[2]);
}
assert.equal((html.match(/id="buyBooks"/g)||[]).length,1);
assert.ok(html.indexOf('id="apyRows"')<html.indexOf('id="buyBooks"'));
assert.ok(html.indexOf('id="buyBooks"')<html.indexOf('id="orderMarkersPanel"'));
console.log('PASS: script syntax, local references and Buy Orderbook placement');
