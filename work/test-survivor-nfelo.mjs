import fs from 'node:fs';
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
const fallback=D.games.find(g=>g.nfp===null);
assert.equal(S.gameProb(fallback,S.DEFAULTS,D).src,'model');
assert.ok(Math.abs(S.gameProb(fallback,S.DEFAULTS,D).p-fallback.p)<0.000051);
assert.equal(S.gameProb({...fallback,nfp:0},S.DEFAULTS,D).p,0);
assert.throws(()=>S.gameProb({...fallback,nfp:NaN},S.DEFAULTS,D));
assert.ok(!html.includes('id="cBlend"'));
for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) if(script[1].trim()&&!script[0].includes('application/ld+json')) new vm.Script(script[1]);
console.log(`PASS: ${NF.games.length} exact nfelo forecasts, both sides, old-setting migration, fallback, invalid probability, inline scripts`);
