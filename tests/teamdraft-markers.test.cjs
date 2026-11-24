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
assert.equal((out.match(/<button type="button" class="td-preseason"/g)||[]).length,8);
assert.ok(out.includes('Change +'));
assert.ok(out.includes('Change -'));
for (const n of data.draft_order) {
  const delta = data.drafters[n].projected-data.drafters[n].ew;
  assert.ok(out.includes(`Change ${delta>=0?'+':''}${delta.toFixed(2)} wins vs preseason`));
}
assert.ok(!/<button[^>]*class="td-rrow/.test(out),'Avoid nested buttons');
assert.match(html,/\.td-rfinish\{[^}]*z-index:0/);
assert.match(html,/\.td-race \.td-seg,\.td-race \.td-ghost\{z-index:1\}/);
assert.match(html,/\.td-rtot\{left:0!important;right:auto/);
// Exercise delegated tap and Escape handling without a browser dependency.
const handlers = {};
const calls = [];
const interactions = html.slice(html.indexOf('  const tipOff ='),html.indexOf('  document.addEventListener("mousemove"'));
const tip = {style:{opacity:'0'}};
vm.runInNewContext(interactions, {tip,document:{addEventListener:(type,fn)=>handlers[type]=fn},
  tipAt:(...args)=>{calls.push(args);tip.style.opacity='1';}});
const dot = {dataset:{tip:'Preseason 35.59; current 39.96; change +4.37'},getBoundingClientRect:()=>({left:100,bottom:200})};
handlers.click({target:{closest:()=>dot}});
assert.deepEqual(calls[0],[dot.dataset.tip,100,194]);
assert.equal(tip.style.opacity,'1');
handlers.keydown({key:'Escape'});
assert.equal(tip.style.opacity,'0');
handlers.click({target:{closest:()=>dot}});
handlers.click({target:{closest:()=>null}});
assert.equal(tip.style.opacity,'0');
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

// The real strip renderer must show 18 calendar weeks, not just 17 games.
const stripStart = html.indexOf('  function strip(){');
const strip = html.slice(stripStart, html.indexOf('  function curves(){', stripStart));
const stripNodes = {};
const teamCodes = Object.keys(env.data.teams);
vm.runInNewContext(strip + '\nstrip();', {
  D:env.data, selTeams:()=>teamCodes, selOwner:()=>null, teamsOf:()=>[], ownerOf:()=>null,
  $:id=>stripNodes[id] ||= {}, esc:String, oc:()=>'', pct:p=>String(p)
});
const stripMarkup = stripNodes.tdStrip.innerHTML;
const headings = [...stripMarkup.matchAll(/class="td-wk">(\d+)<\/span>/g)].map(m=>+m[1]);
assert.deepEqual(headings, Array.from({length:18}, (_,i)=>i+1));
const teamRows = stripMarkup.split('<span class="td-slab">').slice(1);
assert.equal(teamRows.length,32);
for (const [i,t] of teamCodes.entries()) {
  const schedule = env.data.teams[t].schedule;
  const cells = [...teamRows[i].matchAll(/<span class="td-g ([^"]*)"(?:\s+data-tip="([^"]*)")?>/g)];
  assert.equal(cells.length,18,t);
  assert.equal(cells.filter(m=>m[1]==='bye').length,1,t);
  for (const [i,cell] of cells.entries()) {
    const w = i+1;
    const game = schedule.find(g=>g.week===w);
    if (game) assert.ok(cell[2].includes(`Week ${w}</b><br>${t} ${game.home?"vs":"at"} ${game.opp}`),`${t} Week ${w} opponent and alignment`);
    else assert.equal(cell[1],'bye',`${t} missing game is the bye`);
  }
}
assert.match(html,/\.td-srow\{[^}]*repeat\(18,minmax\(30px,1fr\)\)/);
console.log('PASS: 18 aligned week headers and cells for every team; Week 18 shows actual matchup and each bye stays in its calendar slot');
