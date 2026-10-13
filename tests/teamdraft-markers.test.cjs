const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'teamdraft.html'), 'utf8');
for (const [, attrs, code] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/type="application\/ld\+json"/.test(attrs) && code.trim()) new vm.Script(code);
}
const code = html.slice(html.indexOf('  function race(){'), html.indexOf('  /* ====================== 2', html.indexOf('  function race(){')));
const env = JSON.parse(fs.readFileSync(path.join(root, 'data/draft-2026.json'), 'utf8'));
function render(data) {
  const nodes = {};
  vm.runInNewContext(code + '\nrace();', {
    D:data, DATED:env, TRACK_MAX:48,
    $:id=>nodes[id] ||= {}, esc:String, oc:()=>'',
    n1:v=>Number(v).toFixed(1), n2:v=>Number(v).toFixed(2)
  });
  return nodes.tdRace.innerHTML;
}
function positions(out, cls) {
  return [...out.matchAll(new RegExp(`class="${cls}"[^>]*left:([\\d.]+)%`, 'g'))].map(m=>Number(m[1]));
}
const data = structuredClone(env.data);
let out = render(data);
const leader = Math.max(...data.draft_order.map(n=>data.drafters[n].projected));
assert.equal(positions(out,'td-preseason').length,8);
assert.deepEqual(new Set(positions(out,'td-rfinish')),new Set([leader/48*100]));
for (const n of data.draft_order) {
  assert.ok(out.includes(`Preseason ${data.drafters[n].ew.toFixed(2)} wins`));
  assert.ok(Math.abs(data.drafters[n].ew-data.drafters[n].roster.reduce((s,t)=>s+data.teams[t].ew,0))<0.011);
}
assert.ok(!out.includes('td-rpar'));
const originalDots = positions(out,'td-preseason');
data.drafters.Matt.projected = 50;
data.drafters.Rob.projected = 50;
out = render(data);
assert.ok(out.includes('Current leader Matt / Rob: 50.00'));
assert.deepEqual(new Set(positions(out,'td-rfinish')),new Set([50/60*100]));
assert.deepEqual(positions(out,'td-preseason').map(v=>Math.round(v*60)),originalDots.map(v=>Math.round(v*48)));
delete data.drafters.Matt.ew;
out = render(data);
assert.equal(positions(out,'td-preseason').length,7);
assert.ok(out.includes('Preseason expectation unavailable'));
delete data.drafters.Rob.projected;
out = render(data);
assert.equal(positions(out,'td-rfinish').length,0);
assert.ok(out.includes('Current target unavailable'));
console.log('PASS: inline JS syntax, frozen preseason provenance, shared live leader, tied leaders, expanded scale, missing-value handling');
console.log(`Payload ${env.as_of}: target ${leader.toFixed(2)} wins`);
