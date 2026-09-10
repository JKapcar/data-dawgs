// The embedded page scripts are production source; module-only tests miss broken wiring.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'dfs.html'), 'utf8');
let count = 0;
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=|application\/(?:ld\+)?json/i.test(match[1])) continue;
  // Include the text/plain solver engine, which the app compiles at startup.
  new vm.Script(match[2], { filename: `dfs.html script ${++count}` });
}
if (!count) throw new Error('No DFS scripts found');
console.log(`${count} production DFS scripts compile`);

const assert=require('node:assert/strict');
const engine=html.split('<script type="text/plain" id="ddfsEngine">')[1].split('</script>')[0].trim();
assert.equal(engine,fs.readFileSync(path.join(__dirname,'dfs-engine.js'),'utf8').trim());
console.log('Production worker engine matches tested source');
