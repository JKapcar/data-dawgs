const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../dfs-builder.js'),D=require('../dfs-diagnostics.js');
const header='Player,DK Pos,Team,Opp,DK Salary,DK Proj,Large Field';
const rows=[['Ash','QB','AAA','BBB',6500,22,18],['Birch','RB','AAA','BBB',6000,18,24],['Cedar','RB','CCC','DDD',5800,17,0],['Dune','WR','AAA','BBB',5700,16,22],['Elm','WR','BBB','AAA',5200,15,12],['Fern','WR','CCC','DDD',4600,12,''],['Grove','TE','AAA','BBB',3900,11,7],['Heath','WR','DDD','CCC',4300,10,8],['Iris','DST','EEE','FFF',3200,8,6]];
const csv=header+'\n'+rows.map(r=>r.join(',')).join('\n');
const options={site:'dk_classic',units:'pp',slate:'Synthetic 2026-10-12',source:'Test',asOf:'2026-10-12T12:00:00Z'};
const load=(text=csv,opts={})=>B.importPool(B.inspect(text),{...options,...opts});
test('shared CSV parser preserves BOM, commas, quoted newlines and escapes; rejects malformed records',()=>{
 const p=B.inspect('\uFEFF'+header+'\r\n"Ash, ""A""\nQuill",QB,AAA,BBB,"$6,500",22,18%');assert.equal(p.rows[0][0],'Ash, "A"\nQuill');assert.equal(B.importPool(p,options).players[0].sal,6500);
 for(const t of [header+'\n"unclosed',header+'\n"closed"oops,QB,AAA,BBB,1,2,3',header+'\nx,QB',header+',Player\nx,QB,AAA,BBB,1,2,3,y'])assert.throws(()=>B.inspect(t));
 assert.throws(()=>B.inspect('x'.repeat(2000001)));assert.throws(()=>B.inspect(header+'\n'+Array(221).fill(rows[0].join(',')).join('\n')));
});
test('format, slate, units and column mapping are explicit; ambiguity is retained',()=>{
 const p=B.inspect(csv);assert.equal(p.detected,'dk_classic');assert.throws(()=>B.importPool(p,{...options,site:''}),/Confirm DK/);assert.throws(()=>load(csv,{slate:''}),/Name the exact/);assert.throws(()=>load(csv,{units:''}),/units/);
 assert.equal(B.inspect(csv.replaceAll('DK ','')).detected,null);assert.throws(()=>load(csv,{map:{...p.map,proj:p.map.sal}}),/only once/);
 const unknown=B.inspect(csv.replace('Player','Athlete'));assert.equal(unknown.map.name,-1);assert.equal(B.importPool(unknown,{...options,map:{...unknown.map,name:0}}).players[0].name,'Ash');
});
test('missing versus zero ownership, sub-one percentage points, fractions and invalid values',()=>{
 let p=load();assert.equal(p.players[2].own,0);assert.equal(p.players[5].own,null);
 p=load(header+'\nx,QB,AAA,BBB,5000,20,0.48');assert.equal(p.players[0].own,.48);
 p=load(header+'\nx,QB,AAA,BBB,5000,20,0.18',{units:'fraction'});assert.equal(p.players[0].own,18);
 for(const bad of ['101','-1','hello','1.2.3'])assert.throws(()=>load(header+'\nx,QB,AAA,BBB,5000,20,'+bad));
 assert.throws(()=>load(header+'\nx,QB,AAA,BBB,5000,20,18%',{units:'fraction'}),/conflict/);
 p=load(header+'\nx,QB,AAA,BBB,,,');assert.equal(p.players[0].proj,null);assert.equal(p.players[0].sal,null);
});
test('duplicates, ineligible positions, mismatched teams and unsafe numeric inputs reject atomically',()=>{
 assert.throws(()=>load(csv+'\n'+rows[0].join(',')),/duplicate/);assert.throws(()=>load(csv.replace('QB','K')),/eligible/);assert.throws(()=>load(csv.replace('QB,AAA,BBB','QB,AAA,ZZZ')),/Conflicting/);assert.throws(()=>load(csv.replace('6500','65oops')),/invalid number/);
 assert.throws(()=>load(csv,{asOf:'2026-10-12T12:00:00'}),/timezone/);
 assert.throws(()=>load(csv.replace('6500','0')),/range/);assert.throws(()=>load(csv.replaceAll('DK ','FD ')),/another site/);
});
test('legal Classic build; uniqueness, incompatible swap, multi-position, over-cap and game checks',()=>{
 const p=load();let r=B.empty(p);for(let i=0;i<9;i++)r=B.assign(p,r,i,i);let m=B.summary(p,r,'2026-10-12T13:00:00Z');assert.equal(m.canAudit,true);assert.equal(m.salary,45200);assert.equal(m.projection,129);assert.equal(m.ownership,null);assert.equal(m.knownOwnership,8);
 assert.throws(()=>B.assign(p,r,0,1),/eligible/);const swap=B.assign(p,r,3,7);assert.equal(swap[7],3);assert.equal(swap[3],7);assert.equal(new Set(swap).size,9);
 assert.equal(B.summary(p,r.map((id,i)=>i===8?null:id)).canAudit,false);assert.equal(B.summary(p,r.map((id,i)=>i===8?7:id)).canAudit,false);
 const pricey=structuredClone(p);pricey.players[0].sal=20000;assert.equal(B.summary(pricey,r).canAudit,false);
 const missing=structuredClone(p);missing.players[0].opp='';assert.equal(B.summary(missing,r).canAudit,false);
 const conflicting=structuredClone(p);conflicting.players[0].opp='ZZZ';assert.equal(B.summary(conflicting,r).canAudit,false);
 const multi=structuredClone(p);multi.players[7].pos='RB/WR';assert.equal(B.summary(multi,r).canAudit,true);
 assert.equal(B.auditRecord(p,r).entries[0].lifecycle,'proposed');
});
const sdHeader='Name,Position,Team,Opp,Salary,Projection,Total Own,CPT Salary,CPT Projection,CPT Own';
const sdRows=[['A','QB','AAA','BBB',10000,20,60,15000,31,20],['B','WR','AAA','BBB',8000,18,50,12000,27,15],['C','RB','BBB','AAA',7000,16,40,10500,24,10],['D','TE','BBB','AAA',5000,12,30,7500,18,5],['E','K','AAA','BBB',4000,8,20,6000,12,2],['F','DST','BBB','AAA',3000,6,10,4500,9,1]];
const sd=()=>load(sdHeader+'\n'+sdRows.map(r=>r.join(',')).join('\n'),{site:'dk_showdown',convention:'total'});
test('CPT salary/projection apply exactly once including supplied non-1.5 projection and CPT/FLEX swap',()=>{
 const p=sd();let r=[0,1,2,3,4,5];let m=B.summary(p,r);assert.equal(m.salary,42000);assert.equal(m.projection,91);assert.equal(m.ownership,137);assert.equal(m.canAudit,true);
 r=B.assign(p,r,1,0);m=B.summary(p,r);assert.equal(m.salary,41000);assert.equal(m.projection,89);assert.equal(new Set(r).size,6);
 assert.equal(B.auditRecord(p,r).entries[0].cpt,1);
 const text=sdHeader+'\n'+sdRows.map((r,i)=>r.map((v,j)=>i===0&&[7,8].includes(j)?'':v).join(',')).join('\n');const derived=load(text,{site:'dk_showdown',convention:'total'});assert.equal(derived.players[0].cptSal,15000);assert.equal(derived.players[0].cptProj,30);
 assert.throws(()=>load(text),/Showdown/);
});
test('Showdown ownership convention is never inferred and missing CPT ownership stays unknown',()=>{
 const text=sdHeader+'\n'+sdRows.map(r=>r.join(',')).join('\n');assert.throws(()=>load(text,{site:'dk_showdown'}),/general ownership/);
 const p=load(text,{site:'dk_showdown',convention:'unknown'});assert.equal(p.players[0].flexOwn,null);assert.equal(B.summary(p,[0,1,2,3,4,5]).ownership,null);
 assert.throws(()=>load(text.replace('60,15000,31,20','10,15000,31,20'),{site:'dk_showdown',convention:'total'}),/outside/);
});
test('Showdown teams/game limit, unknown matchup and missing salary cannot pass',()=>{
 const p=sd();p.players[0].opp=null;assert.equal(B.summary(p,[0,1,2,3,4,5]).canAudit,false);p.players[0].opp='BBB';p.players[0].cptSal=null;assert.equal(B.summary(p,[0,1,2,3,4,5]).salary,null);
 assert.throws(()=>sdRows.length&&load(sdHeader+'\n'+sdRows.map((r,i)=>r.map((v,j)=>i===0&&j===2?'CCC':v).join(',')).join('\n'),{site:'dk_showdown',convention:'total'}));
});
test('missing Showdown opponents need explicit confirmed matchup; conflicts reject',()=>{
 const text=sdHeader+'\n'+sdRows.map(r=>r.map((v,i)=>i===3?'':v).join(',')).join('\n');
 const p=load(text,{site:'dk_showdown',convention:'total',matchup:'AAA @ BBB'});assert.equal(B.summary(p,[0,1,2,3,4,5]).canAudit,true);assert.equal(p.matchupEvidence,'User confirmed AAA @ BBB');
 assert.throws(()=>load(text,{site:'dk_showdown',convention:'total',matchup:'AAA @ CCC'}),/outside/);assert.throws(()=>load(csv,{matchup:'AAA @ BBB'}),/Showdown/);
});
test('freshness/availability and missing inputs retain uncertainty; no simulated metrics are invented',()=>{
 const p=load();const m=B.summary(p,[0,1,2,3,4,5,6,7,8],'2026-10-12T20:00:00Z');assert.equal(m.checks.find(c=>c.title==='Source freshness').state,'warning');assert.equal(m.checks.find(c=>c.title==='Availability evidence').state,'unknown');assert.equal(m.winRate,undefined);assert.equal(m.duplicationProbability,undefined);
 const missing=structuredClone(p);missing.players[0].proj=null;assert.equal(B.summary(missing,[0]).projection,null);assert.equal(B.summary(missing,[]).efficiency,null);
});
test('repeated import/reset uses independent input objects',()=>{const a=load(),b=load();a.players[0].proj=999;assert.equal(b.players[0].proj,22);assert.deepEqual(B.empty(b),Array(9).fill(null));assert.equal(D.audit(B.auditRecord(b,[0,1,2,3,4,5,6,7,8])).checks.find(c=>c.title==='Simulation & calibration').state,'unknown');});
test('builder has no network or persistence APIs and exports proposals only',()=>{
 const fs=require('node:fs'),path=require('node:path');for(const f of ['dfs-builder.js','dfs-builder-ui.js'])assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB)\b/);
 const html=fs.readFileSync(path.join(__dirname,'../dfs-diagnostics.html'),'utf8');assert.match(html,/connect-src 'none'/);assert.doesNotMatch(html,/allow-same-origin/);
});
