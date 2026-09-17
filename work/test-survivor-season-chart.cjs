const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {DDSurvivorSeasonChart:C}=require('../survivor-season-chart.js');
const {DDSurvivorPath:E}=require('./survivor-path-engine.js');
const D=JSON.parse(fs.readFileSync('data/survivor.json')).data;
const probability=g=>({p:g.nfp??g.season_p,src:g.nfp!=null?'nfelo':'nfelo-season'});
const legs=C.buildLegs(D,probability);
assert.equal(legs.length,20);
assert.equal(legs.map(l=>l.id).join(','),'W1,W2,W3,W4,W5,W6,W7,W8,W9,W10,W11,TG,W12,W13,W14,W15,XMAS,W16,W17,W18');
assert.equal(legs.find(l=>l.id==='TG').games.length,5);
assert.equal(legs.find(l=>l.id==='XMAS').games.length,4);
const ids=legs.flatMap(l=>l.games.map(g=>g.id));
assert.equal(ids.length,272);assert.equal(new Set(ids).size,272);
for(const l of legs.filter(l=>l.holiday))for(const g of l.games)assert.ok(l.dates.includes(g.d));
const remaining=legs.slice(1),solved=C.optimize(remaining,['JAX'],E.hungarian);
assert.ok(solved.complete);assert.equal(solved.covered,19);
assert.equal(new Set(solved.picks.map(p=>p.team)).size,19);
assert.ok(solved.picks.every(p=>p.team!=='JAX'));
solved.picks.forEach((p,i)=>assert.ok(remaining[i].options.some(o=>o.team===p.team&&o.gameId===p.gameId&&o.p===p.p)));
assert.ok(Math.abs(solved.survival-solved.picks.reduce((p,o)=>p*o.p,1))<1e-15);
// Independently enumerate a small fixture: greedy spends A too early.
const fixture=[{id:'W1',options:[{team:'A',p:.90},{team:'B',p:.85},{team:'C',p:.30}]},
  {id:'TG',options:[{team:'A',p:.95},{team:'B',p:.60}]},
  {id:'W2',options:[{team:'B',p:.65},{team:'C',p:.55}]}];
let best=0;
for(const a of fixture[0].options)for(const b of fixture[1].options)for(const c of fixture[2].options){if(new Set([a.team,b.team,c.team]).size===3)best=Math.max(best,a.p*b.p*c.p);}
const small=C.optimize(fixture,[],E.hungarian);
assert.ok(Math.abs(small.survival-best)<1e-15);
const plotted=C.layout(fixture,small,[]);
assert.equal(plotted.points.filter(p=>p.selected).length,3);
assert.ok(plotted.points.some(p=>p.selected&&p.p<.65));
for(const p of plotted.points)assert.equal(p.y,plotted.y(p.p));
assert.equal(C.layout(fixture,small,[],{only:true}).points.length,3);
const impossible=C.optimize(fixture,['A','B','C'],E.hungarian);
assert.equal(impossible.survival,null);assert.equal(impossible.complete,false);assert.equal(impossible.covered,0);
const missingHoliday=fixture.map(l=>l.id==='TG'?{...l,options:[]}:l);
assert.equal(C.optimize(missingHoliday,[],E.hungarian).picks[1],null);
// Exercise the actual render with minimal DOM nodes; no separate rendering copy.
const nodes={};
for(const id of ['svSeasonStart','svSeasonLine','svSeasonOnly','svSeasonChart','svSeasonSubtitle','svSeasonOdds','svSeasonDetail','svSeasonNote','svSeasonTable'])nodes[id]={value:'',checked:id==='svSeasonLine',innerHTML:'',textContent:'',addEventListener(){}};
const win={SV:D,document:{},DDSurvivor:{gameProb:g=>probability(g),hungarian:E.hungarian}};
const box={window:win,document:{getElementById:id=>nodes[id]},Intl,Date,console};
vm.createContext(box);vm.runInContext(fs.readFileSync('survivor-season-chart.js','utf8'),box);
win.DDSurvivorSeasonChart.update({used:['JAX']});nodes.svSeasonStart.value='W2';win.DDSurvivorSeasonChart.update({used:['JAX']});
assert.equal((nodes.svSeasonChart.innerHTML.match(/data-selected="true"/g)||[]).length,19);
assert.ok(nodes.svSeasonChart.innerHTML.includes('sv-season-route'));
assert.ok(!nodes.svSeasonChart.innerHTML.includes('data-team="JAX"'));
for(const p of solved.picks)assert.ok(fs.existsSync(`assets/helmets/${p.team}_right.webp`));
nodes.svSeasonLine.checked=false;win.DDSurvivorSeasonChart.update({used:['JAX']});
assert.ok(!nodes.svSeasonChart.innerHTML.includes('class="sv-season-route"'));
nodes.svSeasonOnly.checked=true;win.DDSurvivorSeasonChart.update({used:['JAX']});
assert.equal((nodes.svSeasonChart.innerHTML.match(/class="sv-season-point"/g)||[]).length,19);
console.log('Circa chart: calendar, holiday eligibility, exact optimum, spent teams, incomplete paths, sub-65% picks, assets and rendering passed.');
console.log('19-leg example with JAX spent:',solved.picks.map((p,i)=>remaining[i].id+':'+p.team).join(' '));
