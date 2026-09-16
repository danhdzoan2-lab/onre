const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
 const src=match[1].match(/src="([^"]+)"/);
 if(src){assert.ok(fs.existsSync(path.join(root,src[1])),`Missing ${src[1]}`);new vm.Script(fs.readFileSync(path.join(root,src[1]),'utf8'),{filename:src[1]});}
 else new vm.Script(match[2]);
}
assert.equal((html.match(/id="buyBooks"/g)||[]).length,1);
assert.equal((html.match(/id="sellBooks"/g)||[]).length,1);
const apySection=html.slice(html.indexOf('aria-labelledby="apyTitle"'),html.indexOf('id="apyRows"'));
for(const token of ['all','onyc','strcx','sronyc','eusx','usx','srehyusd']){
 assert.equal((html.match(new RegExp(`id="${token}FilterBtn"`,'g'))||[]).length,1);
 assert.ok(apySection.includes(`id="${token}FilterBtn"`));
}
assert.ok(!html.includes('Exponent Markets ↗'));
assert.ok(html.indexOf('id="apyRows"')<html.indexOf('id="buyBooks"'));
assert.ok(html.indexOf('id="buyBooks"')<html.indexOf('id="panelTitle"'));
assert.ok(html.indexOf('id="buyBooks"')<html.indexOf('id="sellBooks"'));
assert.doesNotMatch(html,/orderMarkers|orderMarkButtons|importOrder|order-monitor\.js/);
assert.doesNotMatch(fs.readFileSync(path.join(root,'buy-orderbook.js'),'utf8'),/data-buy-mark|data-remove-marker|localStorage/);
assert.ok(html.includes('src="order-watch.js"'));
assert.ok(html.includes('src="wallet-monitor.js"'));
for(const id of ['walletForm','walletAddress','walletList','refreshWalletOrders'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
assert.match(fs.readFileSync(path.join(root,'order-watch.js'),'utf8'),/function orderWatchButton\([^)]*\)\s*\{\s*return '';\s*\}/);
assert.equal((html.match(/id="watchedBuyOrders"/g)||[]).length,1);
assert.equal((html.match(/id="watchedSellOrders"/g)||[]).length,1);
assert.match(html,/SIGNATURE_SCAN_LIMIT = 50/);assert.match(html,/DISPLAY_LIMIT = 50/);
console.log('PASS: script syntax, six filters, wallet controls, and no manual Watch buttons');
