// Seeds one REGISTERED hypothesis per family through the local loopback runner, then exports
// the commands and resulting records as JSON for the owner to load. It never contacts the
// hosted tenant, never reads competition data, and refuses a state directory inside the repo.
//   LAB_STATE_DIR=/somewhere/outside/the/repo node research-lab/seed-registered.mjs [out.json]
import {writeFileSync,mkdirSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createLab} from './server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stateDir=process.env.LAB_STATE_DIR;
if(!stateDir)throw new Error('Set LAB_STATE_DIR to a directory outside the repository');
const resolved=path.resolve(stateDir);if(resolved===root||resolved.startsWith(root+path.sep))throw new Error('LAB_STATE_DIR must be outside the repository');
const out=path.resolve(process.argv[2]||path.join(root,'research-lab','seed','registered-hypotheses-2026-10-16.json'));

// Shared design: target T1, with T2 as the cohort-wide missingness anchor. Approved 2026-10-16.
const shared={
 target:'T1: WR separation over expected on breaking routes (rookie season). T2, rookie snap share, is scored alongside for every athlete in the cohort as the missingness anchor.',
 predictionTime:'Pre-draft: after the combine, before the draft. No later information.',
 cohort:'Wide receivers with combine_results rows, draft classes 2023-2025.',
 featureCutoff:'combine_results + combine_tracking only. No pro day, no college production, no post-draft or in-season fields; post-play-fields.json is excluded by rule.',
 splitPolicy:'2023-2024 draft classes = develop; 2025 = untouched holdout, split by athlete, opened once after registration is frozen.',
 baseline:'Stopwatch card (forty, ten_yd_split, combine_height, combine_weight, position) linear model, plus a cohort-mean naive benchmark. Market baseline = card + draft_overall_pick.',
 metric:'Holdout MAE and R-squared versus the card baseline and versus the market baseline; paired bootstrap by athlete for the difference.',
 exclusions:'Athletes without combine_tracking are kept in T2 and reported as missing for T1, never imputed. No athlete appears in both develop and holdout.'
};
const seeds=[
 ['speed-retention','Speed kept through the break predicts separation','Hypothesis: the share of top drill speed a receiver keeps through a change of direction in combine_tracking predicts T1 beyond the stopwatch card. Falsified if the holdout gain over the card baseline is not above zero with the bootstrap interval.'],
 ['accel-decel-cut','Deceleration into the cut and re-acceleration out of it','Hypothesis: peak deceleration entering a cut and acceleration leaving it, from combine_tracking, predict T1 beyond the card. Falsified as above; reported per measure, no post-hoc combination.'],
 ['missingness','Who skips combine tracking is not random','Hypothesis: absence of combine_tracking is associated with T2 rookie snap share, so complete-case T1 estimates are biased. Reports T2 by missingness group across the whole cohort before any T1 claim.'],
 ['external-market','Tracking adds information the draft market missed','Hypothesis: combine_tracking features improve on the market baseline (card + draft_overall_pick) for T1. Falsified if the holdout gain over the market baseline is not above zero.'],
 ['other','Body orientation at the break','Hypothesis: alignment of orientation (o) and direction (dir) through the break in combine_tracking predicts T1 beyond the card. Measures alignment only; it is not hip-shoulder decoupling.']
];
const server=createLab({directory:resolved});await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 const commands=seeds.map(([family,title,method])=>({type:'hypothesis',key:'registered-2026-10-16-'+family,payload:{title,method,status:'registered',family,...shared}}));
 const records=[];
 for(const command of commands){const r=await fetch(origin+'/api/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(command)});const j=await r.json();if(!r.ok)throw new Error(j.error);records.push(j);}
 const exported={as_of:'2026-10-16',source:'research-lab/seed-registered.mjs through the local loopback runner (tenant local-research, signed local owner)',
  note:'Registered designs only. No data was read and nothing was run. Load by replaying `commands` as the signed owner; the connector cannot register. Not written to the live tenant.',
  target:'T1',anchor:'T2',commands,records};
 mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(exported,null,1)+'\n');console.log('wrote '+path.relative(root,out)+' ('+records.length+' registered hypotheses)');
}finally{await new Promise(r=>server.close(r));}
