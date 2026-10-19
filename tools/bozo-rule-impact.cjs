/* Offline, read-only audit. Uses a sanitized public snapshot; never fetches or writes grades. */
const {execFileSync}=require('node:child_process');
const {build,page,worker,ui,server}=require('../tests/fixtures/bozo-beat-harness.cjs');
const snapshot=require('../tests/fixtures/bozo-main-impact.json');
const base='d9f20d47';
const before=build(...['bozo.html','dawg-bot-worker.js'].map(f=>execFileSync('git',['show',`${base}:${f}`],{encoding:'utf8',maxBuffer:20e6})));
const round=v=>v==null?'unmeasurable':v.toFixed(6);
const week=snapshot.weeks.find(w=>w.week===6);
console.log('# Read-only rule impact — 2026-10-19\n');
console.log('Source: '+snapshot.source+'; baseline commit '+base+'. No records regraded.\n');
console.log('## Week 6: SF hypothetical loss\n');
console.log('Hypothetical entry-normal-v2 only; no live policy is activated. All four losing candidates included. Other winners excluded. SF remains pending in the source; these are scenarios.\n');
console.log('| SF loses by | Old UI Kap SD | Old Worker Kap SD | Proposed Kap SD | Will SD | Tony SD | ItzBornLegend SD | Proposed Worker selection |\n|---:|---:|---:|---:|---:|---:|---:|---|');
for(let loss=1;loss<=15;loss++){
 const r={actual:-loss,result:'lost',won:false};
 const w={...week,season:2026,worstBeatPolicy:{version:'entry-normal-v2',season:2026,week:6},results:{...week.results,Kap:r}};
 const score=n=>server.royaleBeatDeficit(w.picks[n],w.results[n],'entry-normal-v2').v;
 console.log(`| ${loss} | ${round(before.ui.beatOf(w.picks.Kap,r))} | ${round(before.server.royaleBeatDeficit(w.picks.Kap,r).v)} | ${round(score('Kap'))} | ${round(score('WBeamen'))} | ${round(score('Tony'))} | ${round(score('ItzBornLegend'))} | ${server.royaleDecideChop(w,w.order).chopped} |`);
}
console.log('\nOld UI Will = '+round(before.ui.beatOf(week.picks.WBeamen,week.results.WBeamen))+'; old Worker Will = '+round(before.server.royaleBeatDeficit(week.picks.WBeamen,week.results.WBeamen).v)+'. Old UI threshold: 10; old Worker: tie at 9, Kap at 10+. Proposed threshold: 5.\n');
console.log('At SF -9 the old Worker ties Kap/Will at 2/3 SD and restarts Last In across all losers, selecting Tony. The old UI uses CFB SD 16 (Will = 0.6875), so Will wins outright. Even after SD alignment, UI narrows to ties/unmeasurable legs while Worker restarts all losers. This PR preserves the fully measurable tie discrepancy. Version 2 now blocks a reached Worst Beat comparison when a moneyline candidate is unmeasurable.\n');
console.log('## Completed-week replay from available ledger fields\n');
console.log('| Week | Recorded bozo | Baseline Worker replay | Versioned legacy replay | Losing ML scores changed |\n|---:|---|---|---|---|');
for(const w of snapshot.weeks.filter(w=>w.week<6)){
 const changed=Object.entries(w.picks).filter(([n,p])=>p.mkt==='ml'&&w.results[n]?.result==='lost').map(([n,p])=>{
 const a=before.server.royaleBeatDeficit(p,w.results[n]).v,b=server.royaleBeatDeficit(p,w.results[n]).v;
 return a!==b?`${n}: ${round(a)} → ${round(b)}`:null;}).filter(Boolean);
 console.log(`| ${w.week} | ${w.recorded} | ${before.server.royaleDecideChop(w,w.order).chopped} | ${server.royaleDecideChop(w,w.order).chopped} | ${changed.join('; ')||'none'} |`);
}
console.log('\nScope: 40 completed ledger rows, 5 stored historical bozos, plus 8 current picks. No proposed Worker selection changes in this limited replay. Week 1 already disagrees with its stored bozo under the baseline; do not infer historical correctness from this replay. Historical ledger rows omit period and may omit quote provenance (all 40 lack period), so archived full-state evidence is needed before any retrospective ruling. Versioned historical displays now retain legacy arithmetic and SDs. The first draft would have changed BUTTS week 1 and Squatch week 4 moneyline scores; the new exact-week resolver prevents that retrospective change. Stored records are untouched. No other leagues audited.\n');
