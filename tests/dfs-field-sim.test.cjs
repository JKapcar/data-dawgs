const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../work/dfs-field-sim.js');
const {fixture,lineup,complete,source}=require('./fixtures/dfs-field-sim/synthetic.cjs');
const fast={yieldControl:()=>Promise.resolve()},copy=structuredClone;
const result=async r=>{const x=await S.run(r,fast);assert.notEqual(x.status,'unavailable',JSON.stringify(x.reasons));return x;};
const candidate=x=>x.results[0].candidates[0],near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('full duplicate tie splits pooled places once; rates distinguish ties, shares, cash and profit',async()=>{
 const x=await result(fixture()),c=candidate(x);assert.equal(x.status,'illustrative_only');assert.equal(x.metadata.calibration,'not_verified');
 assert.equal(c.rates.outrightFirst.estimate,0);assert.equal(c.rates.tiedOrAloneFirst.estimate,1);assert.equal(c.rates.firstPlaceShare.estimate,.5);
 assert.equal(c.rates.top1AnyTie.estimate,1);assert.equal(c.rates.top1FullyInside.estimate,0);assert.equal(c.rates.top1PlaceShare.estimate,.5);
 assert.equal(c.rates.anyPayout.estimate,1);assert.equal(c.rates.paidPlaceShare.estimate,.5);assert.equal(c.rates.profitRate.estimate,0);assert.equal(c.rates.breakEvenRate.estimate,1);
 assert.equal(c.grossPayout.estimate,10);assert.equal(c.netProfit.estimate,0);assert.equal(c.roi.estimate,0);assert.equal(c.meanRank.estimate,1.5);
 assert.equal(c.opponentCopies.estimate,1);assert.equal(c.rates.uniqueInField.estimate,0);assert.equal(c.scoreDistributions.lineupScore.p50,65);
 assert.equal(c.rates.outrightFirst.interval95[0],0);assert.ok(c.rates.outrightFirst.interval95[1]>0,'zero observed wins is not a zero-width interval');
});
test('joint-world sharing preserves exact score ties for different rosters; identical candidates share outcomes',async()=>{
 const r=fixture();r.contests[0].field.entries[0]={...lineup([0,1,2,3,4,6]),participantId:'synthetic-a'};
 r.scoreModel.worlds=[{weight:1,scores:[20,0,10,10,10,10,10,0]},{weight:3,scores:[0,20,10,10,10,10,10,0]}];
 r.candidates.push({...copy(r.candidates[0]),id:'equivalent'});r.settings.iterations=2000;
 const x=await result(r),a=candidate(x),b=x.results[0].candidates[1];assert.deepEqual({...a,id:null},{...b,id:null});assert.equal(a.rates.outrightFirst.estimate,0);assert.equal(a.rates.tiedOrAloneFirst.estimate,1);assert.equal(a.opponentCopies.estimate,0);
 assert.equal(a.scoreDistributions.lineupScore.p10,60);assert.equal(a.scoreDistributions.lineupScore.p90,70);
 assert.deepEqual(await S.run(r,fast),x,'same seed and inputs reproduce byte-identical JSON');
});
test('CPT outcome multiplier applies once; swapping captain changes score and duplicate identity',async()=>{
 const r=fixture();r.pool.players[0].cptProj=90; // Source model projection is not an outcome multiplier.
 r.scoreModel.worlds.forEach(w=>{w.scores=[20,10,10,10,10,10,0,0];});
 r.contests[0].field.entries[0]={...lineup([1,0,2,3,4,5],1),participantId:'synthetic-b'};
 const x=await result(r),c=candidate(x);assert.equal(c.scoreDistributions.lineupScore.p50,80);assert.equal(c.scoreDistributions.opponentMaximum.p50,75);assert.equal(c.rates.outrightFirst.estimate,1);assert.equal(c.opponentCopies.estimate,0);assert.match(x.warnings.join(' '),/CPT projections differ/);
 r.candidates[0]={id:'candidate',participantId:'candidate-owner',...lineup([1,0,2,3,4,5],1)};const d=candidate(await result(r));assert.equal(d.scoreDistributions.lineupScore.p50,75);assert.equal(d.opponentCopies.estimate,1);
 r.scoreModel.worlds.forEach(w=>{w.scores=[.1,.2,.3,0,0,0,0,0];});const exact=candidate(await result(r));assert.equal(exact.rates.tiedOrAloneFirst.estimate,1);near(exact.scoreDistributions.lineupScore.p50,.7);
});
test('paid cutoff, shared cash, net break-even and first-place score have different meanings',async()=>{
 const r=fixture();complete(r,[lineup([0,1,2,3,4,6]),lineup(),lineup([0,1,2,3,4,7])]);
 r.contests[0].payouts=[30,12,0,0];r.contests[0].entryFee=10;r.scoreModel.worlds.forEach(w=>{w.scores[6]=20;w.scores[7]=0;});
 const c=candidate(await result(r));assert.equal(c.meanRank.estimate,2.5);assert.equal(c.rates.anyPayout.estimate,1);assert.equal(c.rates.paidPlaceShare.estimate,.5);assert.equal(c.grossPayout.estimate,6);assert.equal(c.netProfit.estimate,-4);assert.equal(c.rates.breakEvenRate.estimate,0);assert.equal(c.rates.top1AnyTie.estimate,0);
 assert.equal(c.scoreDistributions.cashCutoff.p50,65);assert.equal(c.scoreDistributions.firstPlaceScore.p50,75);assert.equal(c.scoreDistributions.top1Cutoff.p50,75);
});
test('cutoff distributions include the candidate; opponent maximum remains separate',async()=>{
 const r=fixture();r.scoreModel.worlds.forEach(w=>w.scores[6]=0);r.contests[0].field.entries[0]={...lineup([0,1,2,3,4,6]),participantId:'synthetic-low'};
 const c=candidate(await result(r));assert.equal(c.scoreDistributions.cashCutoff.p50,65);assert.equal(c.scoreDistributions.firstPlaceScore.p50,65);assert.equal(c.scoreDistributions.opponentMaximum.p50,55);
});
test('top-1% uses full fields and explicit floor boundary, including small fields',async()=>{
 for(const [size,places]of [[2,1],[99,1],[100,1],[199,1],[200,2],[1000,10]]){
  const r=fixture();complete(r,Array.from({length:size-1},()=>lineup()));const x=await result(r);assert.equal(x.results[0].top1Places,places);near(candidate(x).rates.top1PlaceShare.estimate,places/size);near(candidate(x).meanRank.estimate,(size+1)/2);
 }
});
test('no payouts or fee means missing cash/economics, never silently zero; free entry ROI remains unavailable',async()=>{
 const r=fixture();delete r.contests[0].payouts;delete r.contests[0].entryFee;let c=candidate(await result(r));assert.equal(c.rates.anyPayout,null);assert.equal(c.grossPayout,null);assert.equal(c.scoreDistributions.cashCutoff,null);assert.equal(c.netProfit,null);assert.equal(c.roi,null);
 r.contests[0].payouts=[20,0];c=candidate(await result(r));assert.equal(c.grossPayout.estimate,10);assert.equal(c.netProfit,null);
 r.contests[0].entryFee=0;c=candidate(await result(r));assert.equal(c.netProfit.estimate,10);assert.equal(c.roi,null);
 r.contests[0].payouts=[0,0];c=candidate(await result(r));assert.equal(c.rates.anyPayout.estimate,0);assert.equal(c.scoreDistributions.cashCutoff,null);assert.equal(c.grossPayout.estimate,0);
});
test('weighted participant portfolios preserve entry structure and use a uniform final partial subset',async()=>{
 const r=fixture(),c=r.contests[0];c.fieldSize=4;c.entryLimit=2;c.payouts=[40,0,0,0];c.field={mode:'portfolio_bootstrap',participantScope:'other_participants_only',source:{...source},scoreRelationship:'fixed_before_outcomes',assumption:'iid_participant_portfolios_with_uniform_final_subset',portfolios:[{weight:1,entries:[lineup(),lineup([0,1,2,3,4,6])]}]};
 r.settings.iterations=4000;r.scoreModel.worlds.forEach(w=>w.scores[6]=0);
 const x=await result(r),a=candidate(x);assert.ok(Math.abs(a.opponentCopies.estimate-1.5)<.05);assert.ok(Math.abs(a.grossPayout.estimate-(.5*20+.5*40/3))<.5);assert.match(x.warnings.join(' '),/uniform subset/);
 c.fieldSize=3;c.payouts=[30,0,0];const exact=candidate(await result(r));assert.equal(exact.opponentCopies.estimate,1);assert.equal(exact.grossPayout.estimate,15,'both members stay together in a complete sampled participant portfolio');
});
test('weighted score worlds yield quantiles and conservative sampling intervals; basis is retained',async()=>{
 const r=fixture();r.settings.iterations=5000;r.scoreModel.worlds=[{weight:3,scores:Array(8).fill(0)},{weight:1,scores:Array(8).fill(10)}];
 const x=await result(r),q=candidate(x).scoreDistributions.lineupScore;assert.equal(q.p10,0);assert.equal(q.p50,0);assert.equal(q.p90,65);assert.ok(q.cdfError95>0);assert.equal(q.quantileIntervals95.length,3);
 r.scoreModel.basis='historical_replay';assert.equal((await result(r)).status,'historical_replay');r.scoreModel.basis='forecast_scenarios';assert.equal((await result(r)).status,'model_estimate');assert.equal((await result(r)).metadata.calibration,'not_verified');
});
test('evidence, identity, legality, freshness, ownership-only and partial-field errors block atomically',async()=>{
 const mutations=[
  r=>delete r.scoreModel,r=>{r.scoreModel={type:'ownership_product'};},r=>r.scoreModel.worlds.pop(),r=>r.scoreModel.worlds[0].scores.pop(),r=>r.scoreModel.worlds[0].scores[0]=NaN,r=>r.scoreModel.worlds[0].scores[0]=.123,r=>r.scoreModel.worlds[0].weight=0,r=>r.scoreModel.playerIds.reverse(),r=>r.scoreModel.projectionVersion='old',r=>delete r.scoreModel.captainPolicy,
  r=>delete r.pool.source.asOf,r=>r.pool.source.asOf='2026-10-11T00:00:00Z',r=>r.pool.source.asOf='2026-10-13T00:00:00Z',r=>r.pool.players[0].uid=r.pool.players[1].uid,r=>r.pool.players[0].sal=0,r=>r.pool.players[0].opp='AAA',r=>r.pool.players[0].cptSal=100000,
  r=>r.candidates[0].ids[0]=1,r=>r.candidates[0].cpt=5,r=>delete r.candidates[0].slots,r=>r.candidates[0].slots[0]='QB',r=>r.candidates[0].ids.pop(),
  r=>r.contests[0].field.entries.pop(),r=>r.contests[0].field.entries.push(copy(r.contests[0].field.entries[0])),r=>r.contests[0].field.entries[0].ids[0]=1,r=>delete r.contests[0].field.entries[0].participantId,r=>delete r.contests[0].field.scoreRelationship,
  r=>r.contests[0].fieldSize=20001,r=>r.contests[0].site='fd_classic',r=>r.contests[0].slate='different',r=>r.contests[0].payouts=[20],r=>r.contests[0].payouts=[0,20],r=>r.contests[0].payouts=[20.001,0],r=>r.contests[0].entryFee=-1,r=>r.settings.seed=-1,r=>r.settings.iterations=1
 ];
 for(const change of mutations){const r=fixture();change(r);assert.equal(S.assess(r).status,'unavailable',change.toString());const x=await S.run(r,fast);assert.equal(x.status,'unavailable',change.toString());assert.equal(x.results,null);assert.ok(x.reasons.length);}
 const r=fixture();complete(r,[lineup(),lineup()]);r.contests[0].field.entries.forEach(e=>e.participantId='same-participant');assert.match(S.assess(r).reasons[0],/entry limit/);
});
test('canonical receipt changes for every material input, not object property ordering',async()=>{
 const r=fixture(),original=await S.fingerprint(r);assert.equal(original,await S.fingerprint(Object.fromEntries(Object.entries(r).reverse())));
 for(const change of [r=>r.pool.players[0].proj++,r=>r.pool.players[0].own++,r=>r.pool.source.version+='x',r=>r.pool.slate+='x',r=>r.candidates[0].cpt=1,r=>r.candidates[0].slots.reverse(),r=>r.scoreModel.source.version+='x',r=>r.contests[0].payouts[0]++,r=>r.contests[0].entryFee++,r=>r.contests[0].field.source.version+='x',r=>r.settings.seed++,r=>r.settings.iterations++]){const next=copy(r);change(next);assert.notEqual(await S.fingerprint(next),original,change.toString());}
});
test('DK Classic legality and order-independent copies; no captain multiplier in Classic',async()=>{
 const r=fixture(),positions=['QB','RB','RB','WR','WR','WR','TE','WR','DST'];r.pool.site='dk_classic';
 r.pool.players=positions.map((pos,i)=>({uid:'classic-'+i,name:'Synthetic Classic '+i,pos,team:i===8?'CCC':'AAA',opp:i===8?'DDD':'BBB',sal:5000,proj:10}));
 const e={ids:[0,1,2,3,4,5,6,7,8],slots:['QB','RB','RB','WR','WR','WR','TE','FLEX','DST']};r.candidates=[{id:'classic',participantId:'candidate-owner',...e}];r.contests[0].site='dk_classic';r.contests[0].field.entries=[{participantId:'synthetic-c',ids:e.ids.slice().reverse(),slots:e.slots.slice().reverse()}];r.scoreModel.playerIds=r.pool.players.map(p=>p.uid);r.scoreModel.worlds=[{weight:1,scores:Array(9).fill(10)},{weight:1,scores:Array(9).fill(10)}];
 const c=candidate(await result(r));assert.equal(c.scoreDistributions.lineupScore.p50,90);assert.equal(c.opponentCopies.estimate,1);r.candidates[0].cpt=0;assert.equal(S.assess(r).status,'unavailable');delete r.candidates[0].cpt;
 r.pool.players[8].team='AAA';r.pool.players[8].opp='BBB';assert.match(S.assess(r).reasons[0],/Classic game count/);
});
test('top-1% boundary ties allocate only occupied top places, including ties below the winner',async()=>{
 const r=fixture(),higher=lineup([0,1,2,3,4,6]),lower=lineup([0,1,2,3,4,7]);complete(r,[higher,lineup(),lineup(),...Array.from({length:196},()=>copy(lower))]);r.scoreModel.worlds.forEach(w=>{w.scores[6]=20;w.scores[7]=0;});
 const x=await result(r),c=candidate(x);assert.equal(x.results[0].fieldSize,200);assert.equal(x.results[0].top1Places,2);assert.equal(c.rates.top1AnyTie.estimate,1);assert.equal(c.rates.top1FullyInside.estimate,0);near(c.rates.top1PlaceShare.estimate,1/3);assert.equal(c.rates.tiedOrAloneFirst.estimate,0);assert.equal(c.meanRank.estimate,3);
});
test('large fields run in full, preserve shared score worlds across contests, and honor resource bounds',async()=>{
 const r=fixture();complete(r,Array.from({length:9999},()=>lineup()));const x=await result(r);assert.equal(x.results[0].opponentEntries,9999);near(candidate(x).rates.firstPlaceShare.estimate,.0001);
 const a=fixture();a.contests.push({...copy(a.contests[0]),id:'alternative'});a.scoreModel.worlds[0].scores=Array(8).fill(-1);a.scoreModel.worlds[1].scores=Array(8).fill(20);const shared=await result(a);assert.deepEqual(shared.results[0].candidates,shared.results[1].candidates);assert.equal(candidate(shared).scoreDistributions.lineupScore.p10,-6.5);
 r.settings.iterations=20000;assert.match(S.assess(r).reasons[0],/budget/);a.settings.iterations=20000;a.candidates=Array.from({length:20},(_,i)=>({...copy(a.candidates[0]),id:'alt-'+i}));assert.match(S.assess(a).reasons[0],/storage/);
});
test('portfolio and payout semantics cannot be omitted or used to evade entry limits',()=>{
 const r=fixture();delete r.contests[0].tiePayoutRule;assert.match(S.assess(r).reasons[0],/sharing/);r.contests[0].tiePayoutRule='pool_occupied_places_equally';
 r.contests[0].field={mode:'portfolio_bootstrap',participantScope:'other_participants_only',source:{...source},scoreRelationship:'fixed_before_outcomes',assumption:'iid_participant_portfolios_with_uniform_final_subset',portfolios:[{weight:1,entries:[lineup(),lineup()]}]};assert.match(S.assess(r).reasons[0],/entry limit/);r.contests[0].entryLimit=2;r.contests[0].field.portfolios[0].entries.pop();assert.equal(S.assess(r).status,'ready');delete r.contests[0].field.assumption;assert.match(S.assess(r).reasons[0],/acknowledge/);
});
test('cancellation interrupts the actual loop and no partial estimate is returned',async()=>{
 const a=new AbortController();await assert.rejects(S.run(fixture(),{signal:a.signal,onProgress:()=>a.abort(),yieldControl:()=>Promise.resolve(),batchSize:1}),e=>e.name==='AbortError');
 a.abort();await assert.rejects(S.run(fixture(),{signal:a.signal}),e=>e.name==='AbortError');
});
test('candidate participant is included in entry limits; portfolio bootstrap cannot silently include own entries',()=>{
 const r=fixture();r.contests[0].field.entries[0].participantId=r.candidates[0].participantId;assert.match(S.assess(r).reasons[0],/Adding a candidate/);r.contests[0].entryLimit=2;assert.equal(S.assess(r).status,'ready');assert.match(S.assess(r).warnings.join(' '),/incremental single entry/);
 r.contests[0].field={mode:'portfolio_bootstrap',source:{...source},scoreRelationship:'fixed_before_outcomes',assumption:'iid_participant_portfolios_with_uniform_final_subset',portfolios:[{weight:1,entries:[lineup()]}]};assert.match(S.assess(r).reasons[0],/exclude candidate/);
});
test('CLI saves only to selected private paths, cannot overwrite, and emits unavailable instead of fabricated metrics',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dd-field-sim-test-')),input=path.join(folder,'synthetic.json'),output=path.join(folder,'receipt.json'),missing=path.join(folder,'unavailable.json'),script=path.resolve(__dirname,'../work/run-dfs-field-sim.cjs');
 try{
  fs.writeFileSync(input,JSON.stringify(fixture()));let child=spawnSync(process.execPath,[script,input,output],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(fs.readFileSync(output)).status,'illustrative_only');
  const before=fs.readFileSync(output,'utf8');child=spawnSync(process.execPath,[script,input,output],{encoding:'utf8'});assert.equal(child.status,1);assert.equal(fs.readFileSync(output,'utf8'),before);
  const prohibited=path.resolve(__dirname,'../private-field-must-not-exist-'+Date.now()+'.json');child=spawnSync(process.execPath,[script,input,prohibited],{encoding:'utf8'});assert.equal(child.status,1);assert.match(child.stderr,/private output/);assert.equal(fs.existsSync(prohibited),false);
  const r=fixture();delete r.scoreModel;fs.writeFileSync(input,JSON.stringify(r));child=spawnSync(process.execPath,[script,input,missing],{encoding:'utf8'});assert.equal(child.status,2);const receipt=JSON.parse(fs.readFileSync(missing));assert.equal(receipt.status,'unavailable');assert.equal(receipt.results,null);
 }finally{for(const file of [input,output,missing])if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(folder);}
});
test('controller clears results synchronously on every edit; ignores cancelled/out-of-order executors',async()=>{
 const jobs=[],c=S.createController((input,{signal})=>new Promise(resolve=>jobs.push({input,signal,resolve})));const r=fixture();await c.setInput(r);const p1=c.start();await new Promise(setImmediate);assert.equal(c.state().status,'running');
 const next=copy(r);next.settings.seed=99;const ready=c.setInput(next);assert.equal(c.state().result,null);assert.equal(c.state().status,'checking');assert.equal(jobs[0].signal.aborted,true);await ready;
 const p2=c.start();await new Promise(setImmediate);const x2=await result(jobs[1].input);jobs[1].resolve(x2);await p2;assert.equal(c.state().status,'complete');assert.equal(c.state().result.metadata.seed,99);
 jobs[0].resolve(await result(jobs[0].input));assert.equal(await p1,null);assert.equal(c.state().result.metadata.seed,99);
 const stored=c.state();stored.result.metadata.seed=123;assert.equal(c.state().result.metadata.seed,99,'consumers cannot mutate stored receipt');
 const pending=c.setInput(r);assert.equal(c.state().result,null);await pending;const p3=c.start();await new Promise(setImmediate);c.cancel();jobs[2].resolve(await result(jobs[2].input));assert.equal(await p3,null);assert.equal(c.state().result,null);
});
test('controller rejects wrong receipts, invalid input and reset during hashing; clones caller input',async()=>{
 const r=fixture(),c=S.createController(async input=>({...await result(input),inputHash:'wrong'}));await c.setInput(r);await c.start();assert.equal(c.state().status,'unavailable');assert.equal(c.state().result,null);
 const d=S.createController();const ready=d.setInput(r);r.settings.seed=77;await ready;const x=await d.start();assert.equal(x.metadata.seed,0);
 const invalid=copy(r);delete invalid.scoreModel;await d.setInput(invalid);assert.equal(d.state().result,null);assert.equal(d.state().status,'unavailable');assert.equal(await d.start(),null);
 const hashing=d.setInput(fixture());d.cancel();await hashing;assert.equal(d.state().status,'invalidated');assert.equal(d.state().result,null);
});
