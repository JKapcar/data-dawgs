/* Evidence-driven, session-local contest estimates. No inferred variance, correlations,
   field ownership model, network or persistence. Not connected to the reviewed UI. */
(function(root){
'use strict';
const D=typeof module!=='undefined'&&module.exports?require('../dfs-diagnostics.js'):root.DDFSDiagnostics;
const VERSION='joint-field-v2';
const LIMITS={players:220,worlds:5000,candidates:20,contests:8,fieldSize:20000,iterations:20000,work:40000000,outcomes:200000};
const finite=Number.isFinite;
const timestamp=v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)&&finite(Date.parse(v));
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
const abortError=()=>Object.assign(new Error('Simulation cancelled.'),{name:'AbortError'});
const checkAbort=signal=>{if(signal?.aborted)throw abortError();};
const clone=v=>JSON.parse(JSON.stringify(v));

function canonical(value){
 function encode(v){
  if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
  if(typeof v==='number'){requireValue(finite(v),'Inputs contain a non-finite number.');return JSON.stringify(v);}
  if(Array.isArray(v))return '['+v.map(encode).join(',')+']';
  requireValue(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype,'Inputs must be plain JSON data.');
  return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}';
 }
 const result=encode(value);requireValue(result.length<=20000000,'Evidence bundle exceeds 20 MB.');return result;
}
async function fingerprint(input){
 const text=canonical(input);requireValue(!!root.crypto?.subtle,'SHA-256 is unavailable in this runtime.');
 const bytes=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(VERSION+'\n'+text));
 return 'sha256:'+Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
function rng(seed){let x=seed>>>0;return ()=>{x=(x+0x6D2B79F5)|0;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
function distribution(items){let sum=0;const cumulative=items.map(x=>{requireValue(finite(x.weight)&&x.weight>0,'Every scenario/portfolio weight must be explicit and positive.');sum+=x.weight;return sum;});requireValue(finite(sum),'Weights overflow.');return random=>{const target=random()*sum;let l=0,h=cumulative.length-1;while(l<h){const m=(l+h)>>>1;if(target<cumulative[m])h=m;else l=m+1;}return l;};}
function rosterKey(e){return (e.cpt==null?'classic':e.cpt+'c')+'|'+e.ids.slice().sort((a,b)=>a-b).join(',');}
function sourceCheck(source,label,settings,receipts){
 requireValue(source&&typeof source.name==='string'&&source.name.trim()&&typeof source.version==='string'&&source.version.trim()&&timestamp(source.asOf),label+' needs a source name, version and ISO source time with timezone.');
 const age=(Date.parse(settings.evaluatedAt)-Date.parse(source.asOf))/3600000;
 requireValue(age>=0,label+' source time is in the future.');
 requireValue(age<=settings.maxAgeHours,label+' is stale under the supplied freshness policy.');
 receipts.push({label,...clone(source),ageHours:age});
}
function moneyCents(n,label){requireValue(finite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100))&&Math.abs(n*100-Math.round(n*100))<1e-6,label+' must be nonnegative currency with at most two decimals.');return Math.round(n*100);}
function prepare(r){
 requireValue(r?.version===1,'Expected evidence bundle version 1.');
 const {pool,scoreModel,contests,candidates,settings}=r,receipts=[];
 requireValue(settings&&Number.isInteger(settings.seed)&&settings.seed>=0&&settings.seed<=0xffffffff,'An explicit unsigned 32-bit seed is required (zero is valid).');
 requireValue(Number.isInteger(settings.iterations)&&settings.iterations>=200&&settings.iterations<=LIMITS.iterations,'Choose 200ΓÇô20,000 iterations explicitly.');
 requireValue(timestamp(settings.evaluatedAt)&&finite(settings.maxAgeHours)&&settings.maxAgeHours>0,'Set evaluation time and a positive source-age limit explicitly.');
 requireValue(pool&&D.rules[pool.site]&&typeof pool.slate==='string'&&pool.slate.trim(),'A confirmed DK NFL slate and format are required.');
 requireValue(Array.isArray(pool.players)&&pool.players.length>0&&pool.players.length<=LIMITS.players,'Supply 1ΓÇô220 players.');
 sourceCheck(pool.source,'Player snapshot',settings,receipts);
 const players=pool.players,ids=players.map(p=>p?.uid);
 requireValue(ids.every(id=>typeof id==='string'&&id.trim())&&new Set(ids).size===ids.length,'Every player needs a unique stable uid.');
 const names=players.map(p=>String(p.name||'').trim().toLowerCase().replace(/[.']/g,'')+'|'+p.team);
 requireValue(new Set(names).size===names.length,'Duplicate player identities are not allowed.');
 requireValue(players.every(p=>typeof p.name==='string'&&p.name.trim()&&typeof p.pos==='string'&&typeof p.team==='string'&&typeof p.opp==='string'&&D.game(p)),'Explicit player names, positions, teams and opponents are required.');
 requireValue(players.every(p=>Number.isInteger(p.sal)&&p.sal>0&&(pool.site!=='dk_showdown'||Number.isInteger(p.cptSal)&&p.cptSal>0)),'Official base salaries and, for Showdown, CPT salaries must be positive integers.');
 requireValue(Array.isArray(candidates)&&candidates.length>0&&candidates.length<=LIMITS.candidates,'Supply 1ΓÇô20 alternative candidate lineups.');
 const candidateIds=new Set();
 function validateRoster(e,label){
  requireValue(e&&Array.isArray(e.ids)&&e.ids.every(id=>Number.isInteger(id)&&id>=0&&id<players.length),label+' has invalid player references.');
  requireValue(Array.isArray(e.slots),label+' needs explicit slot assignments.');
  const checks=D.roster(pool,e).filter(c=>['Roster & eligibility','Salary','Showdown teams','Showdown matchup','Classic game count','Team / opponent mapping'].includes(c.title));
  requireValue(checks.every(c=>c.state==='pass'),label+': '+checks.filter(c=>c.state!=='pass').map(c=>c.title+' ΓÇö '+c.evidence).join('; '));
  requireValue(pool.site==='dk_showdown'||e.cpt==null,label+' cannot name a captain in Classic.');
  return {ids:e.ids.slice().sort((a,b)=>a-b),cpt:pool.site==='dk_showdown'?e.cpt:null,key:rosterKey(e)};
 }
 const candidatePlans=candidates.map(c=>{requireValue(typeof c.id==='string'&&c.id&&!candidateIds.has(c.id),'Candidate IDs must be unique.');requireValue(typeof c.participantId==='string'&&c.participantId.trim(),'Every candidate needs a participant ID for entry-limit checks.');candidateIds.add(c.id);return {id:c.id,participantId:c.participantId,...validateRoster(c,'Candidate '+c.id)};});
 requireValue(scoreModel?.type==='joint_worlds','Joint player-outcome scenarios are missing. Projection means alone cannot supply variance or correlation.');
 sourceCheck(scoreModel.source,'Joint score model',settings,receipts);
 requireValue(['forecast_scenarios','historical_replay','synthetic'].includes(scoreModel.basis),'Declare whether score worlds are forecast scenarios, historical replay or synthetic.');
 requireValue(scoreModel.projectionVersion===pool.source.version,'Joint score model must name the current player-snapshot version.');
 requireValue(JSON.stringify(scoreModel.playerIds)===JSON.stringify(ids),'Joint-world player IDs/order must exactly match the current pool.');
 requireValue(Number.isInteger(scoreModel.scoreDecimals)&&scoreModel.scoreDecimals>=0&&scoreModel.scoreDecimals<=4,'Specify base-score precision (0ΓÇô4 decimal places).');
 requireValue(Array.isArray(scoreModel.worlds)&&scoreModel.worlds.length>=2&&scoreModel.worlds.length<=LIMITS.worlds,'Supply 2ΓÇô5,000 explicitly weighted joint score worlds, not a mean-only projection.');
 if(pool.site==='dk_showdown')requireValue(scoreModel.captainPolicy==='official_1_5','Confirm official 1.5├ù scoring; supplied CPT projections are not a second score multiplier.');
 const scale=10**scoreModel.scoreDecimals;
 const worlds=scoreModel.worlds.map((w,i)=>{
  requireValue(Array.isArray(w.scores)&&w.scores.length===players.length,'World '+i+' must contain every player once.');
  return w.scores.map(v=>{const n=Math.round(v*scale);requireValue(finite(v)&&Math.abs(v)<=1000&&Number.isSafeInteger(n)&&Math.abs(v*scale-n)<1e-6,'World scores must be finite, within ┬▒1,000 and honor declared precision.');return n;});
 });
 const drawWorld=distribution(scoreModel.worlds),sumWeight=scoreModel.worlds.reduce((s,w)=>s+w.weight,0);
 if(scoreModel.sampling==='generated_independent_once')requireValue(scoreModel.worlds.length===settings.iterations&&scoreModel.worlds.every(w=>w.weight===1),'Generated independent worlds must be equally weighted and used exactly once.');
 const modelMeans=players.map((p,id)=>scoreModel.worlds.reduce((s,w)=>s+w.scores[id]*(w.weight/sumWeight),0));
 const projectionDifferences=players.map((p,id)=>({id:p.uid,projection:finite(p.proj)?p.proj:null,scenarioMean:modelMeans[id],difference:finite(p.proj)?modelMeans[id]-p.proj:null}));
 const warnings=['Uncalibrated estimates conditional on the supplied scenario library and field model. No out-of-sample probability calibration is verified.',
 'Intervals describe Monte Carlo sampling error only; source, finite-library, forecast and opponent-model errors are excluded.',
 'Candidates are alternative single entries, evaluated separately against the same opponent field; this is not a combined portfolio return.'];
 if(scoreModel.basis!=='forecast_scenarios')warnings.push(scoreModel.basis==='synthetic'?'Synthetic scenario results are illustrative only.':'Historical replay is not a forecast for the current slate.');
 if(scoreModel.worlds.length<100)warnings.push('Fewer than 100 source worlds: rare outcomes absent from this library cannot be recovered by more iterations.');
 if(projectionDifferences.some(p=>p.difference!=null&&Math.abs(p.difference)>.1))warnings.push('Scenario means differ from supplied projections; no automatic recentering was applied. Inspect projectionDifferences.');
 if(pool.site==='dk_showdown'&&players.some(p=>finite(p.proj)&&finite(p.cptProj)&&Math.abs(p.cptProj-1.5*p.proj)>.01))warnings.push('Supplied CPT projections differ from 1.5├ù base. The acknowledged official scoring rule applies to scenario outcomes; displayed projection arithmetic may differ.');
 requireValue(Array.isArray(contests)&&contests.length>0&&contests.length<=LIMITS.contests,'Supply 1ΓÇô8 explicit contest profiles.');
 requireValue(contests.length*candidates.length*settings.iterations<=LIMITS.outcomes,'Requested result storage exceeds 200,000 candidate-contest worlds. Reduce candidates, contests or iterations.');
 const contestIds=new Set();let work=0;
 const plans=contests.map(c=>{
  requireValue(typeof c.id==='string'&&c.id&&!contestIds.has(c.id),'Contest IDs must be unique.');contestIds.add(c.id);
  requireValue(['supplied_contest','illustrative'].includes(c.kind),'Declare whether each contest is supplied or illustrative.');
  requireValue(c.site===pool.site&&c.slate===pool.slate,'Every contest must explicitly match the pool site/format and slate.');
  sourceCheck(c.source,'Contest '+c.id,settings,receipts);
  requireValue(Number.isInteger(c.fieldSize)&&c.fieldSize>=2&&c.fieldSize<=LIMITS.fieldSize,'Contest '+c.id+' needs a field size of 2ΓÇô20,000. Larger fields are unavailable, never scaled from a smaller sample.');
  requireValue(Number.isInteger(c.entryLimit)&&c.entryLimit>=1&&c.entryLimit<=c.fieldSize,'Contest '+c.id+' needs a valid per-participant entry limit.');
  work+=c.fieldSize*settings.iterations*candidates.length;
  const payouts=c.payouts==null?null:c.payouts.map?.((n,i)=>moneyCents(n,'Payout at place '+(i+1)));
  requireValue(payouts===null||Array.isArray(payouts)&&payouts.length===c.fieldSize&&payouts.every((v,i)=>!i||payouts[i-1]>=v),'Full non-increasing per-place payouts, including every zero, are required for money outputs.');
  requireValue(c.paidPlaces==null||Number.isInteger(c.paidPlaces)&&c.paidPlaces>=0&&c.paidPlaces<=c.fieldSize,'Paid places must be an integer from zero through field size.');
  requireValue(payouts===null&&c.paidPlaces==null||c.tiePayoutRule==='pool_occupied_places_equally','Confirm pooled equal sharing of all occupied tied places; other prize and tiebreak rules are unsupported.');
  const fee=c.entryFee==null?null:moneyCents(c.entryFee,'Entry fee');
  const paid=payouts?payouts.filter(v=>v>0).length:c.paidPlaces??null,prefix=payouts?[0]:null;if(payouts)for(const p of payouts)prefix.push(prefix[prefix.length-1]+p);
  requireValue(!payouts||c.paidPlaces==null||c.paidPlaces===paid,'Paid places conflict with the supplied payout ladder.');
  requireValue(prefix===null||Number.isSafeInteger(prefix[prefix.length-1]),'Payout total exceeds safe currency precision.');
  const f=c.field;requireValue(f&&['complete','portfolio_bootstrap'].includes(f.mode),'Contest '+c.id+' needs a complete field or an explicit opponent-portfolio model.');
  requireValue(f.scoreRelationship==='fixed_before_outcomes','Acknowledge field composition is fixed before outcomes, independent of the resampled score world. Outcome-conditioned fields are unsupported.');
  sourceCheck(f.source,'Opponent model '+c.id,settings,receipts);
  const unique=[],keyToIndex=new Map();
  function register(e){const r=validateRoster(e,'Opponent in '+c.id);if(!keyToIndex.has(r.key)){keyToIndex.set(r.key,unique.length);unique.push(r);}return keyToIndex.get(r.key);}
  let fixed=null,portfolios=null,drawPortfolio=null;
  if(f.mode==='complete'){
   requireValue(Array.isArray(f.entries)&&f.entries.length===c.fieldSize-1,'Complete field must supply exactly NΓêÆ1 opponents. Partial samples cannot establish full-field ranks.');
   const counts=new Map();fixed=f.entries.map(e=>{requireValue(typeof e.participantId==='string'&&e.participantId.trim(),'Every supplied opponent entry needs a participant ID to verify the entry limit.');counts.set(e.participantId,(counts.get(e.participantId)||0)+1);return register(e);});
   requireValue([...counts.values()].every(n=>n<=c.entryLimit),'Supplied opponent field exceeds the per-participant entry limit.');
   requireValue(candidatePlans.every(candidate=>(counts.get(candidate.participantId)||0)+1<=c.entryLimit),'Adding a candidate would exceed that participant\'s entry limit.');
   if(candidatePlans.some(candidate=>counts.has(candidate.participantId)))warnings.push(c.id+': other entries by a candidate participant are present. The report is only the incremental single entry, not combined portfolio returns.');
  }else{
   requireValue(f.participantScope==='other_participants_only','The opponent bootstrap must explicitly exclude candidate participants. Existing own entries need a complete supplied field.');
   requireValue(f.assumption==='iid_participant_portfolios_with_uniform_final_subset','Explicitly acknowledge the participant bootstrap and final partial-portfolio sampling assumption.');
   requireValue(Array.isArray(f.portfolios)&&f.portfolios.length>0&&f.portfolios.length<=2000,'Supply 1ΓÇô2,000 weighted opponent portfolios.');
   let entryCount=0;portfolios=f.portfolios.map(p=>{requireValue(Array.isArray(p.entries)&&p.entries.length>0&&p.entries.length<=c.entryLimit,'Each sampled portfolio must respect the contest entry limit.');entryCount+=p.entries.length;requireValue(entryCount<=20000,'Portfolio library exceeds 20,000 entries.');return p.entries.map(register);});
   drawPortfolio=distribution(f.portfolios);warnings.push(c.id+': participant portfolios are sampled independently with replacement. Within-portfolio structure is retained; the last partial portfolio uses a uniform subset. Field composition is a supplied model, not established by field size.');
  }
  if(c.kind==='illustrative')warnings.push(c.id+': illustrative contest settings, not verified lobby evidence.');
  return {id:c.id,kind:c.kind,size:c.fieldSize,entryLimit:c.entryLimit,fee,payouts,prefix,paid,topPlaces:Math.max(1,Math.floor(c.fieldSize*.01)),mode:f.mode,unique,fixed,portfolios,drawPortfolio};
 });
 requireValue(work<=LIMITS.work,'Requested full-field workload exceeds the 40 million entry-candidate-world budget. Reduce iterations or compare fewer contests; no field scaling is substituted.');
 return {pool,settings,scoreModel,worlds,scale,drawWorld,candidatePlans,plans,receipts,warnings,projectionDifferences};
}
function assess(input){try{const r=JSON.parse(canonical(input)),p=prepare(r);return {status:'ready',engineVersion:VERSION,warnings:p.warnings,receipts:p.receipts};}catch(e){return {status:'unavailable',engineVersion:VERSION,reasons:[e.message],results:null};}}

// Whole-world resampling preserves the supplied joint dependence. Integer half-ticks
// apply official CPT scoring exactly once and make equal rosters exactly tied.
function scoreRoster(roster,world){return roster.ids.reduce((s,id)=>s+world[id]*2,0)+(roster.cpt==null?0:world[roster.cpt]);}
function countsFor(plan,random){
 const counts=new Int32Array(plan.unique.length);
 if(plan.fixed){for(const i of plan.fixed)counts[i]++;return counts;}
 let remaining=plan.size-1;
 while(remaining){const portfolio=plan.portfolios[plan.drawPortfolio(random)];if(portfolio.length<=remaining){for(const i of portfolio)counts[i]++;remaining-=portfolio.length;}else{
  const subset=portfolio.slice();for(let j=0;j<remaining;j++){const k=j+Math.floor(random()*(subset.length-j));[subset[j],subset[k]]=[subset[k],subset[j]];counts[subset[j]]++;}remaining=0;
 }}return counts;
}
function groupsFor(plan,counts,world){const byScore=new Map();for(let i=0;i<counts.length;i++)if(counts[i]){const score=scoreRoster(plan.unique[i],world);byScore.set(score,(byScore.get(score)||0)+counts[i]);}return [...byScore].map(([score,count])=>({score,count})).sort((a,b)=>b.score-a.score);}
function cutoff(groups,score,k){if(k==null||k<1)return null;let n=0,inserted=false;for(const g of groups){if(!inserted&&score>g.score){n++;inserted=true;if(n>=k)return score;}n+=g.count;if(!inserted&&score===g.score){n++;inserted=true;}if(n>=k)return g.score;}if(!inserted&&++n>=k)return score;throw Error('Incomplete field at cutoff.');}
function outcome(groups,score,plan){
 let above=0,tied=0;for(const g of groups){if(g.score>score)above+=g.count;else if(g.score===score)tied+=g.count;}
 const group=tied+1,best=above+1,worst=above+group;
 const grossCents=plan.prefix?(plan.prefix[above+group]-plan.prefix[above])/group:null;
 const paidPlaces=plan.paid;
 return {outrightFirst:Number(above===0&&tied===0),tiedOrAloneFirst:Number(above===0),firstPlaceShare:above===0?1/group:0,
  top1AnyTie:Number(best<=plan.topPlaces),top1FullyInside:Number(worst<=plan.topPlaces),top1PlaceShare:Math.max(0,Math.min(group,plan.topPlaces-above))/group,
  meanRank:(best+worst)/2,anyPayout:paidPlaces==null?null:Number(best<=paidPlaces),paidPlaceShare:paidPlaces==null?null:Math.max(0,Math.min(group,paidPlaces-above))/group,
  grossPayout:grossCents==null?null:grossCents/100,netProfit:grossCents==null||plan.fee==null?null:(grossCents-plan.fee)/100,
  profitRate:grossCents==null||plan.fee==null?null:Number(grossCents>plan.fee),breakEvenRate:grossCents==null||plan.fee==null?null:Number(grossCents>=plan.fee),
  cashCutoff:cutoff(groups,score,paidPlaces),top1Cutoff:cutoff(groups,score,plan.topPlaces),firstPlaceScore:Math.max(score,groups[0].score),opponentMaximum:groups[0].score};
}
const RATE_KEYS=['outrightFirst','tiedOrAloneFirst','firstPlaceShare','top1AnyTie','top1FullyInside','top1PlaceShare','anyPayout','paidPlaceShare','profitRate','breakEvenRate','uniqueInField'];
const SCORE_KEYS=['cashCutoff','top1Cutoff','firstPlaceScore','opponentMaximum','lineupScore'];
function statistics(values,lo,hi){if(!values.length||values[0]===null)return null;const n=values.length,mean=values.reduce((s,v)=>s+v,0)/n,radius=(hi-lo)*Math.sqrt(Math.log(40)/(2*n));return {estimate:mean,interval95:[Math.max(lo,mean-radius),Math.min(hi,mean+radius)],n,intervalMethod:'Hoeffding; conditional Monte Carlo error only'};}
function rateStatistics(values,binary){
 if(!values.length||values[0]===null)return null;
 if(!binary)return statistics(values,0,1);
 const n=values.length,p=values.reduce((s,v)=>s+v,0)/n,z=1.95996398454,d=1+z*z/n,center=(p+z*z/(2*n))/d,radius=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return {estimate:p,interval95:[Math.max(0,center-radius),Math.min(1,center+radius)],n,intervalMethod:'Wilson 95%; conditional Monte Carlo error only'};
}
function quantiles(values){if(!values.length||values[0]===null)return null;const sorted=values.slice().sort((a,b)=>a-b),n=values.length,epsilon=Math.sqrt(Math.log(40)/(2*n)),at=q=>sorted[Math.max(0,Math.min(n-1,Math.ceil(q*n)-1))];
 return {n,method:'Nearest-rank empirical quantiles; DKW 95% simultaneous CDF band',p10:at(.1),p50:at(.5),p90:at(.9),cdfError95:epsilon,quantileIntervals95:[.1,.5,.9].map(q=>({q,lower:q-epsilon<=0?null:at(q-epsilon),upper:q+epsilon>=1?null:at(q+epsilon)})),note:'Null endpoint means the Monte Carlo band cannot bound that tail. These are score distributions, not guaranteed thresholds.'};}
async function run(input,{signal,onProgress,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0)),batchSize=32}={}){
 checkAbort(signal);let request,inputHash;
 try{request=JSON.parse(canonical(input));inputHash=await fingerprint(request);}catch(e){return {status:'unavailable',engineVersion:VERSION,inputHash:null,reasons:[e.message],results:null};}
 checkAbort(signal);let p;try{p=prepare(request);}catch(e){return {status:'unavailable',engineVersion:VERSION,inputHash,reasons:[e.message],results:null};}
 const worldRandom=rng(p.settings.seed),fieldRandom=rng(p.settings.seed^0x71baf031),divisor=2*p.scale;
 const stores=p.plans.map(plan=>p.candidatePlans.map(()=>Object.fromEntries([...RATE_KEYS,...SCORE_KEYS,'meanRank','grossPayout','netProfit','opponentCopies'].map(k=>[k,[]]))));
 const candidateKeys=p.candidatePlans.map(c=>c.key);let yieldedAt=Date.now();
 for(let iteration=0;iteration<p.settings.iterations;iteration++){
  checkAbort(signal);const world=p.worlds[p.scoreModel.sampling==='generated_independent_once'?iteration:p.drawWorld(worldRandom)],candidateScores=p.candidatePlans.map(c=>scoreRoster(c,world));
  p.plans.forEach((plan,pi)=>{const counts=countsFor(plan,fieldRandom),groups=groupsFor(plan,counts,world);
   p.candidatePlans.forEach((candidate,ci)=>{const score=candidateScores[ci],o=outcome(groups,score,plan),s=stores[pi][ci];
    const copies=plan.unique.reduce((n,lineup,j)=>n+(lineup.key===candidateKeys[ci]?counts[j]:0),0);o.opponentCopies=copies;o.uniqueInField=Number(copies===0);o.lineupScore=score;
    for(const key of Object.keys(s))s[key].push(o[key]==null?null:SCORE_KEYS.includes(key)?o[key]/divisor:o[key]);
   });
  });
  if((iteration+1)%Math.max(1,batchSize)===0||Date.now()-yieldedAt>30){onProgress?.({completed:iteration+1,total:p.settings.iterations,inputHash});await yieldControl();yieldedAt=Date.now();checkAbort(signal);}
 }
 const results=p.plans.map((plan,pi)=>({id:plan.id,kind:plan.kind,fieldSize:plan.size,opponentEntries:plan.size-1,entryLimit:plan.entryLimit,fieldMode:plan.mode,top1Places:plan.topPlaces,paidPlaces:plan.paid,
  entryFee:plan.fee==null?null:plan.fee/100,payoutSourceKnown:plan.payouts!==null,
  unavailable:{cash:plan.paid!=null?null:'Paid-place count missing.',money:plan.payouts&&plan.fee!=null?null:'Full payouts and entry fee are required.',roi:plan.fee>0&&plan.payouts?null:'Positive fee and full payouts are required.',suitability:'No universal contest-fit score or allocation target is modeled.'},
  candidates:p.candidatePlans.map((candidate,ci)=>{const s=stores[pi][ci],rates=Object.fromEntries(RATE_KEYS.map(k=>[k,rateStatistics(s[k],['outrightFirst','tiedOrAloneFirst','top1AnyTie','top1FullyInside','anyPayout','profitRate','breakEvenRate','uniqueInField'].includes(k))])),gross=statistics(s.grossPayout,0,plan.payouts?.[0]/100||0),net=statistics(s.netProfit,-(plan.fee||0)/100,((plan.payouts?.[0]||0)-(plan.fee||0))/100);
   return {id:candidate.id,rates,meanRank:statistics(s.meanRank,1,plan.size),opponentCopies:statistics(s.opponentCopies,0,plan.size-1),grossPayout:gross,netProfit:net,roi:plan.fee>0&&net?{estimate:net.estimate/(plan.fee/100),interval95:net.interval95.map(x=>x/(plan.fee/100))}:null,scoreDistributions:Object.fromEntries(SCORE_KEYS.map(k=>[k,quantiles(s[k])]))};})}));
 return {status:p.scoreModel.basis==='synthetic'?'illustrative_only':p.scoreModel.basis==='historical_replay'?'historical_replay':'model_estimate',engineVersion:VERSION,inputHash,
  metadata:{seed:p.settings.seed,iterations:p.settings.iterations,sourceWorlds:p.worlds.length,scoreBasis:p.scoreModel.basis,calibration:'not_verified',evaluatedAt:p.settings.evaluatedAt,maxAgeHours:p.settings.maxAgeHours,candidateMode:'alternative_single_entries',fieldSizeMethod:'complete fields; no scaled ranks',scoring:'shared joint worlds; captain ├ù1.5 once; exact integer half-tick ties',payouts:'all tied places pooled and divided once; no additional duplicate divisor; fractional cents are modeled without provider rounding',intervalCoverage:'95% per reported mean; not simultaneous across all metrics/candidates'},receipts:p.receipts,projectionDifferences:p.projectionDifferences,warnings:p.warnings,results};
}

// Every input change immediately clears visible results, even while hashing or
// while an uncooperative executor ignores cancellation. No stale result survives.
function createController(executor=run){
 let generation=0,snapshot=null,abort=null,ready=Promise.resolve(),state={status:'idle',inputHash:null,result:null,reasons:[]};
 function invalidate(status='invalidated'){generation++;abort?.abort();abort=null;state={status,inputHash:null,result:null,reasons:[]};}
 function setInput(value){invalidate('checking');const ticket=generation;try{snapshot=JSON.parse(canonical(value));}catch(e){snapshot=null;state={status:'unavailable',inputHash:null,result:null,reasons:[e.message]};return Promise.resolve();}
  const input=snapshot;ready=(async()=>{try{const hash=await fingerprint(input);if(ticket!==generation)return;const report=assess(input);state={status:report.status,inputHash:hash,result:null,reasons:report.reasons||[]};}catch(e){if(ticket===generation)state={status:'unavailable',inputHash:null,result:null,reasons:[e.message]};}})();return ready;
 }
 async function start(){const ticket=generation;await ready;if(ticket!==generation||state.status!=='ready')return null;const hash=state.inputHash,input=snapshot;abort=new AbortController();const signal=abort.signal;state={...state,status:'running',result:null};
  try{const result=await executor(clone(input),{signal});if(ticket!==generation||signal.aborted)return null;if(result?.inputHash!==hash||result?.engineVersion!==VERSION){state={status:'unavailable',inputHash:hash,result:null,reasons:['Discarded a result with a mismatched input hash or engine version.']};return null;}
   if(!['unavailable','model_estimate','historical_replay','illustrative_only'].includes(result.status)||result.status!=='unavailable'&&!Array.isArray(result.results)){state={status:'unavailable',inputHash:hash,result:null,reasons:['Discarded a malformed executor result.']};return null;}
   state=result.status==='unavailable'?{status:'unavailable',inputHash:hash,result:null,reasons:result.reasons}:{status:'complete',inputHash:hash,result:clone(result),reasons:[]};return clone(result);
  }catch(e){if(ticket!==generation||signal.aborted)return null;state={status:'unavailable',inputHash:hash,result:null,reasons:[e.message]};return null;}
 }
 return {setInput,start,cancel(){invalidate();},state:()=>clone(state)};
}
const api={VERSION,LIMITS,canonical,fingerprint,assess,run,createController};
if(typeof module!=='undefined'&&module.exports)module.exports=api;root.DDFSFieldSim=api;
})(typeof globalThis!=='undefined'?globalThis:this);
