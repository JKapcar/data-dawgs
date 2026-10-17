const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const db=require('../pack-catalog.js'),core=require('../pack-core.js');
test('unknown evidence stays unknown, checked date does not reset a changed version',()=>{
 assert.equal(core.evidenceState({status:'unknown',checkedAt:'2026-10-17'},'2026-10-17'),'unknown');
 assert.equal(core.evidenceState({status:'verified',checkedAt:'2025-01-01'},'2026-10-17'),'stale');
 assert.equal(core.evidenceState({status:'version-changed',checkedAt:'2026-10-17'},'2026-10-17'),'version-changed');
});
test('no tests means null, never a fabricated zero performance',()=>{
 assert.equal(core.pairMetrics([]).coFailure,null);assert.equal(core.pairMetrics([]).rescue,null);assert.equal(core.reviewMetrics([]).netGain,null);
 assert.equal(core.pairMetrics([{aPassed:true,bPassed:true,excludedReason:null}]).rescue,null);
});
test('rescue opportunity is directional and distinct from co-failure',()=>{
 const rows=[{aPassed:false,bPassed:true,excludedReason:null},{aPassed:false,bPassed:false,sameWrongAnswer:true,excludedReason:null},{aPassed:true,bPassed:false,excludedReason:'invalid ground truth'}];
 const m=core.pairMetrics(rows);assert.equal(m.coFailure,.5);assert.equal(m.rescue,.5);assert.equal(m.rescueDenominator,2);assert.equal(m.excluded,1);assert.equal(m.sameWrong,1);
 assert.equal(core.pairMetrics(rows.map(r=>({...r,aPassed:r.bPassed,bPassed:r.aPassed}))).rescue,0);
});
test('net gain subtracts newly introduced failures over all valid reviews',()=>{
 const rows=[{beforePassed:false,afterPassed:true,excludedReason:null},{beforePassed:true,afterPassed:false,excludedReason:null},{beforePassed:true,afterPassed:true,excludedReason:null},{beforePassed:false,afterPassed:true,excludedReason:'invalid'}];
 assert.deepEqual(core.reviewMetrics(rows),{valid:3,excluded:1,corrected:1,introduced:1,netGain:0});
 assert.equal(core.reviewMetrics([{beforePassed:true,afterPassed:false,excludedReason:null}]).netGain,-1);
});
test('vendor advertised capability cannot pass a mandatory tool gate',()=>{
 for(const p of db.profiles){assert.equal(core.taskFit(p,['coding']).status,'blocked');assert.equal(core.taskFit(p,['browser']).status,'blocked');}
 assert.equal(core.taskFit({capabilities:{coding:'verified',browser:'unavailable'}},['coding','browser']).status,'blocked');
});
test('catalog references resolve and all capability statements carry evidence',()=>{
 for(const c of db.claims){assert(c.evidenceIds.length);for(const id of c.evidenceIds)assert(db.evidence.some(e=>e.id===id));}
 for(const p of db.profiles)for(const id of p.claimIds)assert(db.claims.some(c=>c.id===id));
 for(const collection of [db.profiles,db.claims,db.evidence])assert.equal(new Set(collection.map(x=>x.id)).size,collection.length);
 assert.equal(db.runs.length+db.pairedOutcomes.length+db.reviewedRevisions.length,0);
});
test('public feature has no account reads, private transports or persistence',()=>{
 const code=['pack-guide.js','pack-core.js','pack-catalog.js'].map(f=>fs.readFileSync(require('node:path').join(__dirname,'..',f),'utf8')).join('\n');
 for(const pattern of [/localStorage/,/sessionStorage/,/document\.cookie/,/fetch\s*\(/,/XMLHttpRequest/,/\/api\/pound/,/\/privatePounds/,/Authorization/,/Bearer /,/sk-[a-zA-Z0-9]{20}/])assert(!pattern.test(code),String(pattern));
 assert(!JSON.stringify(db).includes('actor_uid'));assert(!JSON.stringify(db).includes('permissions'));
});
