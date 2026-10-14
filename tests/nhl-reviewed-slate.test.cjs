const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const d=require('../dfs-nhl-slate.js');
test('reviewed package preserves cohort, conditional ranks and missing slate fields',()=>{
 assert.equal(d.players.length,80);assert.equal(new Set(d.players.map(p=>p.name)).size,80);
 assert.equal(d.players.filter(p=>p.position==='G').length,8);
 assert.equal(d.players.filter(p=>p.valueRank!=null).length,70);
 assert.equal(d.lineupReady,false);
 for(const p of d.players){assert.equal(p.platformId,null);assert.equal(p.salary,null);assert.equal(p.ownership,null);assert.ok(Number.isFinite(p.points));}
 assert.equal(d.players.find(p=>p.name==='Nathan MacKinnon').points,15.49);
 assert.equal(d.players.find(p=>p.name==='Casey DeSmith').points,11.97);
 assert.equal(d.scenarios.find(p=>p.name==='Cale Makar').points,11.1);
});
test('public package excludes private sources and restricted benchmarks',()=>{
 const s=fs.readFileSync(require.resolve('../dfs-nhl-slate.js'),'utf8');
 for(const bad of ['docs.google.com','libfile_','gmail','DFF 10-13','download_url'])assert.ok(!s.includes(bad));
});
test('rank UI remains independent of builder and historical baseline',()=>{
 const s=fs.readFileSync(require.resolve('../dfs-nhl-slate-ui.js'),'utf8');
 assert.ok(!s.includes('DDNHLSnapshot'));assert.ok(!s.includes('innerHTML'));assert.ok(!s.includes('DDNHL.'));
 const html=fs.readFileSync(require.resolve('../dfs-nhl.html'),'utf8');
 assert.match(html,/Not lineup-ready/);assert.match(html,/DFS CSV/);assert.match(html,/matching dated salary CSV/);
});
