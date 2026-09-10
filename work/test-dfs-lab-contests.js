const assert=require('node:assert/strict'),C=require('../dfs-lab-contests.js');
const P=[{name:'A QB',pos:'QB',team:'A'},{name:'A WR',pos:'WR',team:'A'},{name:'A RB',pos:'RB',team:'A'},{name:'A DST',pos:'DST',team:'A'},{name:'B WR',pos:'WR',team:'B'},{name:'B RB',pos:'RB',team:'B'},{name:'B K',pos:'K',team:'B'}];
const lineups=[{ids:[0,1,2,3,4,5],cpt:1,proj:90},{ids:[0,2,3,4,5,6],cpt:2,proj:93}];
assert.equal(C.matches(lineups[0],P,'pass'),true);assert.equal(C.matches(lineups[1],P,'pass'),false);
assert.equal(C.matches(lineups[0],P,'back'),true);assert.equal(C.matches(lineups[1],P,'run'),true);
assert.match(C.story(lineups[0],P),/receiving production/);assert.match(C.story(lineups[1],P),/rushing volume/);
const sim={contests:{}};
for(const c of C.profiles())sim.contests[c.key]={meta:{top1Resolved:true},perLineup:[
 {i:0,dupes:2,dupeCI:[1,4],train:{[c.metric]:.7,top1:.7},validation:{n:4000,[c.metric]:.2,top1:.2,ci:{[c.metric]:[.15,.25],top1:[.15,.25]}}},
 {i:1,dupes:3,dupeCI:[2,5],train:{[c.metric]:.6,top1:.6},validation:{n:4000,[c.metric]:.8,top1:.8,ci:{[c.metric]:[.75,.85],top1:[.75,.85]}}}
]};
const chosen=C.select(sim,lineups,P,'any');
assert.equal(chosen.length,4);assert.ok(chosen.every(c=>c.i===0),'Selections must not peek at held-out outcomes');
assert.ok(chosen.every(c=>c.value===(c.key==='milly'?.2/5:.2)),'Cards report the held-out result, even when it disappoints');
assert.ok(C.select(sim,lineups,P,'pass').every(c=>c.i===0));
const gpp=C.profiles().find(c=>c.key==='milly'),raw=sim.contests.milly;
const before=JSON.stringify(raw),v=C.view(raw,gpp);
assert.equal(JSON.stringify(raw),before,'Rendering cannot mutate engine evidence');
assert.deepEqual(C.view(v,gpp),v,'Applying the view twice cannot apply the penalty twice');
assert.deepEqual(v.perLineup[0].validation.ci.top1Share,[.15/5,.25/5]);
const sparse={meta:{top1Resolved:true,fullField:false},perLineup:[
 {...raw.perLineup[0],dupes:0,dupeCI:[0,253],train:{top1:.9}},
 {...raw.perLineup[1],dupes:1,dupeCI:[.5,255],train:{top1:.95}}
]};
assert.equal(C.select({contests:{milly:sparse}},lineups,P,'any',[gpp])[0].i,1,'A zero observation cannot erase a wide duplicate-sampling interval');
assert.equal(C.view(sparse,gpp).perLineup[0].train.top1Share,.9/254);
assert.equal(C.view({...sparse,meta:{...sparse.meta,fullField:true}},gpp).perLineup[0].train.top1Share,.9,'A full modelled field has known duplicate counts');
assert.equal(C.view({...sparse,perLineup:[{...sparse.perLineup[0],dupeCI:null}]},gpp).perLineup[0].train.top1Share,null,'Missing field uncertainty cannot silently imply uniqueness');
sim.contests.milly.meta.top1Resolved=false;
assert.match(C.select(sim,lineups,P,'any').find(c=>c.key==='milly').unavailable,/sample/);
const custom=C.profiles({three:{fieldSize:235,paidPlaces:70},milly:{fieldSize:5300,paidPlaces:1060}});
assert.equal(custom[1].fieldSize,235);assert.equal(custom[1].payout.rows[0].prize,3);assert.equal(custom[1].payout.rows[0].to,70);
assert.equal(custom[3].label,'GPP');
console.log('Contest objectives, game-plan matching, holdout-only reporting, duplicate uncertainty and field-resolution gates pass');
