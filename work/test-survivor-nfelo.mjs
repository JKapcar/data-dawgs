import fs from 'node:fs';
import { seasonProbability } from './nfelo-season-probability.mjs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync('survivor.html','utf8');
const D=JSON.parse(fs.readFileSync('data/survivor.json')).data;
const NF=JSON.parse(fs.readFileSync('data/nfelo.json')).data;
const box={window:{},console,localStorage:{getItem:()=>JSON.stringify({blendMarket:0,entries:123,used:['CLE']})}};
box.self=box.window;
vm.createContext(box);
for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
 if(script[1].includes('DD-SURVIVOR-PATH-ENGINE START') || script[1].includes('window.DDSurvivor = (function(){')) vm.runInContext(script[1],box);
}
const S=box.window.DDSurvivor;
assert.equal(S.load().blendMarket,undefined);
assert.equal(S.load().entries,123);
assert.equal(S.load().used[0],'CLE');
const alias=t=>({OAK:'LV',LA:'LAR',SD:'LAC',STL:'LAR',WSH:'WAS'}[t]||t);
for(const n of NF.games){
 const g=D.games.find(g=>g.wk===n.week && g.h===alias(n.h)&&g.a===alias(n.a));
 assert.ok(g,n.id);
 const expected=n.nfelo.p_home_close??n.nfelo.p_home_open??n.hwp;
 assert.equal(g.p,expected,n.id);
 for(const blendMarket of [0,0.75,1]) {
  const cfg={...S.DEFAULTS,blendMarket};
  assert.equal(S.gameProb({...g,mk:0.999},cfg,D).p,expected);
  const week=S.weekTable(g.wk,cfg,D);
  assert.equal(week[g.h].p,expected);
  assert.ok(Math.abs(week[g.a].p-(1-expected))<1e-12);
 }
}
assert.equal(D.games.length,272);
assert.equal(Object.keys(NF.season_inputs.ratings).length,32);
for(const g of D.games) {
 const id=`${D.meta.season}_${String(g.wk).padStart(2,'0')}_${g.a}_${g.h}`;
 const expected=seasonProbability(NF.season_inputs,id).p;
 assert.equal(g.season_p,expected);
 assert.equal(g.p,g.nfp??expected);
 assert.ok(Number.isFinite(g.p) && g.p>=0 && g.p<=1);
}
// Independent numeric reference: base gap 100 + HFA 25 + QB gap 20 = 145 Elo.
const fixture={z:400,qb_weight:1,ratings:{H:{base:1500,qb_adj:10},A:{base:1400,qb_adj:-10}},games:{g:{home:'H',away:'A',hfa_elo:25}}};
assert.equal(seasonProbability(fixture,'g').eloDifference,145);
assert.ok(Math.abs(seasonProbability(fixture,'g').p-0.6973450785898532)<1e-12);
fixture.games.g.hfa_elo=0;
assert.equal(seasonProbability(fixture,'g').eloDifference,120);
assert.throws(()=>seasonProbability(fixture,'missing'));
fixture.ratings.H.qb_adj=null;
assert.throws(()=>seasonProbability(fixture,'g'));
const fallback=D.games.find(g=>g.nfp===null);
assert.equal(S.gameProb(fallback,S.DEFAULTS,D).src,'nfelo-season');
assert.ok(Math.abs(S.gameProb(fallback,S.DEFAULTS,D).p-fallback.p)<0.000051);
assert.equal(S.gameProb({...fallback,nfp:0},S.DEFAULTS,D).p,0);
assert.throws(()=>S.gameProb({...fallback,nfp:NaN},S.DEFAULTS,D));
assert.ok(!html.includes('id="cBlend"'));
for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) if(script[1].trim()&&!script[0].includes('application/ld+json')) new vm.Script(script[1]);
console.log(`PASS: ${NF.games.length} exact nfelo forecasts, 272 season projections, both sides, old-setting migration, fallback, invalid probability, inline scripts`);
