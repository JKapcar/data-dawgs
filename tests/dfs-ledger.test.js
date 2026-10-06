// node tests/dfs-ledger.test.js — results ledger (WO-1) against the synthetic fixture.
const assert=require('assert'),fs=require('fs'),path=require('path');
const L=require('../dfs-ledger.js');
const dir=path.join(__dirname,'fixtures','dfs-ledger'),read=f=>fs.readFileSync(path.join(dir,f),'utf8');
const ws=JSON.parse(read('snapshot.json')),metas=JSON.parse(read('contests.json'));
const ids=['100000001','100000002','100000003'];
const contests=()=>ids.map(id=>({csv:read('contest-standings-'+id+'.csv'),meta:{...(metas[id]||{}),contest_id:id}}));
const opts={users:['ddtester'],lockTime:'2026-09-07T17:00:00Z',builtAt:'2026-09-08T00:00:00Z'};
let n=0;const t=(name,fn)=>{fn();n++;};

t('lineup strings',()=>{
 assert.deepStrictEqual(L.parseLineup('CPT Ja\'Marr Chase FLEX D.J. Moore FLEX Saints '),[{slot:'CPT',name:"Ja'Marr Chase"},{slot:'FLEX',name:'D.J. Moore'},{slot:'FLEX',name:'Saints'}]);
 assert.deepStrictEqual(L.parseLineup('DST Bills QB Josh Allen RB Bijan Robinson').map(x=>x.slot),['DST','QB','RB']);
 assert.strictEqual(L.parseLineup('LOCKED'),null);assert.strictEqual(L.parseLineup(''),null);
 assert.strictEqual(L.normName('Marvin Harrison Jr.'),L.normName('marvin harrison'));
 assert.strictEqual(L.baseUser('ddtester (12/150)'),'ddtester');
 assert.strictEqual(L.contestIdFromFilename('contest-standings-183456789.csv'),'183456789');
});

t('tie payouts split the occupied places',()=>{
 const rows=[{from:1,to:1,prize:100},{from:2,to:2,prize:50},{from:3,to:10,prize:10}];
 assert.strictEqual(L.tiePayout(rows,1,2),75);assert.strictEqual(L.tiePayout(rows,10,3),10/3);assert.strictEqual(L.tiePayout(null,1,1),null);
});

t('standings parse: field, copies, ties, ownership table',()=>{
 const s=L.parseStandings(read('contest-standings-100000001.csv'));
 assert.strictEqual(s.field_size,20);assert.strictEqual(s.showdown,true);assert.strictEqual(s.ownership.length,26);
 const tied=s.entries.filter(e=>e.points===120);assert.strictEqual(tied.length,3);assert.ok(tied.every(e=>e.rank===8&&e.tied===3&&e.copies===3));
});

const before=JSON.stringify(ws),ledger=L.buildLedger(ws,contests(),opts),E=ledger.entries;
t('snapshot is read, not modified or re-run',()=>{
 assert.strictEqual(JSON.stringify(ws),before);
 const row=E.find(r=>r.entry_id==='5000102'),sim=ws.simulation.perLineup.find(r=>r.i===0);
 assert.strictEqual(row.workspace_index,0);
 assert.strictEqual(row.pred_cash,sim.cash);assert.strictEqual(row.pred_top1pct,sim.top1);assert.strictEqual(row.pred_dupes,sim.dupes);
 assert.strictEqual(row.model_version,'engine2/wsfixture-showdown@r5/seed216/sims1600');assert.strictEqual(row.prelock_verified,true);
});

t('every entry identified and joined honestly',()=>{
 assert.strictEqual(E.length,5);
 assert.deepStrictEqual(ledger.contests.map(c=>c.our_entries),[2,1,2]);
 assert.deepStrictEqual(ledger.summary.join_status,{joined:3,not_simulated:1,not_in_snapshot_lineups:1});
 const notSim=E.find(r=>r.join_status==='not_simulated'),manual=E.find(r=>r.join_status==='not_in_snapshot_lineups');
 for(const r of [notSim,manual]){assert.strictEqual(r.pred_cash,null);assert.strictEqual(r.pred_top1pct,null);assert.ok(r.proj>0&&r.salary>0);}
 assert.strictEqual(manual.cpt,'Gabe Niles');
});

t('actual results, payouts and ROI',()=>{
 const win=E.find(r=>r.entry_id==='5000100');
 assert.deepStrictEqual([win.actual_rank,win.actual_points,win.payout,win.roi,win.cash,win.top1pct],[1,150.2,150,6.5,true,true]);
 const tie=E.find(r=>r.entry_id==='5000102');
 assert.deepStrictEqual([tie.actual_rank,tie.payout,tie.copies,tie.dupes_observed],[8,10,3,2]);
 const se=E.find(r=>r.contest_id==='100000002');assert.deepStrictEqual([se.actual_rank,se.payout,se.roi,se.cash],[6,0,-1,false]);
 const noMeta=E.filter(r=>r.contest_id==='100000003');assert.ok(noMeta.every(r=>r.entry_fee===null&&r.payout===null&&r.roi===null&&r.cash===null&&r.cash_residual===null));
 assert.ok(noMeta.every(r=>r.copies===2||r.copies===1));
});

t('missing model outputs stay null, never invented',()=>{
 for(const r of E){assert.strictEqual(r.pred_top10pct,null);assert.strictEqual(r.pred_top0_1pct,null);assert.strictEqual(r.top10pct_residual,null);assert.strictEqual(r.top0_1pct_residual,null);}
 const r=E.find(r=>r.entry_id==='5000102');
 assert.ok(Math.abs(r.pred_dupes_scaled-40*19/20000)<1e-12);assert.strictEqual(r.pred_basis_match,false);
 assert.ok(Math.abs(r.cash_residual-(1-.31))<1e-12);assert.ok(Math.abs(r.top1pct_residual-(0-.02))<1e-12);
});

t('ownership residuals per player and slot',()=>{
 const o=ledger.ownership.find(x=>x.contest_id==='100000001'&&x.player==='Alex Quill'&&x.slot==='CPT');
 assert.deepStrictEqual([o.proj_own,o.obs_own,o.error],[22,21,-1]);
 const f=ledger.ownership.find(x=>x.contest_id==='100000001'&&x.player==='Alex Quill'&&x.slot==='FLEX');assert.strictEqual(f.proj_own,38);
 assert.strictEqual(ledger.ownership.length,78);assert.strictEqual(ledger.summary.ownership.CPT.n,39);
});

t('contest metadata: rake, tier',()=>{
 const [a,b,c]=ledger.contests;
 assert.strictEqual(a.total_prizes,330);assert.ok(Math.abs(a.rake-(1-330/400))<1e-12);assert.strictEqual(a.paid_places,10);
 assert.strictEqual(b.tier,'single_entry');assert.strictEqual(c.rake,null);
});

t('post-lock snapshot refused unless explicitly allowed',()=>{
 assert.throws(()=>L.buildLedger(ws,contests(),{...opts,lockTime:'2026-09-07T16:00:00Z'}),/after lock/);
 const forced=L.buildLedger(ws,contests(),{...opts,lockTime:'2026-09-07T16:00:00Z',allowPostLock:true});
 assert.ok(forced.entries.every(r=>r.prelock_verified===false));
 assert.ok(L.buildLedger(ws,contests(),{users:['ddtester']}).entries.every(r=>r.prelock_verified===null));
 assert.throws(()=>L.buildLedger(ws,contests(),{lockTime:opts.lockTime}),/username/);
});

t('audit CSV matches the reference fixture',()=>{
 // Fixtures are stored LF (.gitattributes); the export itself is CRLF.
 assert.strictEqual(L.auditCSV(ledger,true),read('expected-audit-full.csv').replace(/\r?\n/g,'\r\n'));
 const short=L.auditCSV(ledger,false).split('\r\n');
 assert.strictEqual(short[0],'Contest,CPT,FLEX,Salary,Pred Top1%,Pred Cash,Pred Dupes,Actual Finish,Actual Percentile,Copies,Payout,ROI');
 assert.strictEqual(short.length,7);
});

t('standings of other entrants are not retained',()=>{
 const s=JSON.stringify(ledger);for(const name of ['rival1','rival2','shark','fish1'])assert.ok(!s.includes(name));
});

console.log('dfs-ledger: '+n+' checks passed');
