/* Pure diagnostics. No network, storage, solver changes or universal quality score. */
(function(root){
'use strict';
const finite=Number.isFinite, time=v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const rules={dk_classic:{cap:50000,slots:['QB','RB','RB','WR','WR','WR','TE','FLEX','DST']},dk_showdown:{cap:50000,slots:['CPT','FLEX','FLEX','FLEX','FLEX','FLEX']}};
const check=(state,title,evidence,action)=>({state,title,evidence,action});
function parse(text){
 if(text.length>4000000)throw Error('Audit exceeds the 4 MB device import limit.');
 const a=JSON.parse(text);
 if(a.version!==1||!Array.isArray(a.players)||!Array.isArray(a.entries)||a.players.length>220||a.entries.length>600)throw Error('Expected audit version 1, at most 220 players and 600 entries.');
 if(a.players.some(p=>!p||typeof p!=='object')||a.entries.some(e=>!e||!Array.isArray(e.ids)||e.ids.length>12||e.ids.some(i=>!Number.isInteger(i)||i<0||i>=a.players.length)))throw Error('Invalid player or roster references.');
 if(a.entries.some(e=>e.fee!=null&&(!finite(e.fee)||e.fee<0)))throw Error('Entry fees must be nonnegative numbers or null.');
 if(a.scenarios!=null&&(!Array.isArray(a.scenarios)||a.scenarios.length>20||a.scenarios.some(s=>!s||!Array.isArray(s.projections)||s.projections.length!==a.players.length)))throw Error('Scenario projections must match the player pool (maximum 20).');
 if(a.recommendations!=null&&(!Array.isArray(a.recommendations)||a.recommendations.length>600))throw Error('Invalid recommendation log.');
 if(a.notes!=null&&(!Array.isArray(a.notes)||a.notes.length>600||a.notes.some(n=>!n||typeof n.text!=='string')))throw Error('Invalid notes.');
 if(a.contests!=null&&(!Array.isArray(a.contests)||a.contests.length>600))throw Error('Invalid contests.');
 if(a.entries.some(e=>(e.slots!=null&&(!Array.isArray(e.slots)||e.slots.some(s=>typeof s!=='string')))||(e.lockedSlots!=null&&(!Array.isArray(e.lockedSlots)||e.lockedSlots.some(s=>!Number.isInteger(s)||s<0||s>=e.ids.length)))||(e.lifecycle&&!['proposed','entered','amended','graded'].includes(e.lifecycle))))throw Error('Invalid slots or lifecycle.');
 if((a.recommendations||[]).some(r=>!r||typeof r!=='object')||(a.contests||[]).some(c=>!c||typeof c!=='object'))throw Error('Invalid evidence record.');
 if([...a.entries,...(a.recommendations||[])].some(e=>e.history!=null&&!Array.isArray(e.history)))throw Error('History must be an array.');
 if(a.players.some(p=>['name','team','opp','pos'].some(k=>p[k]!=null&&typeof p[k]!=='string')))throw Error('Player names, positions and matchups must be text.');
 return a;
}
function eligible(p,slot,sd){return sd?true:slot==='FLEX'?['RB','WR','TE'].includes(p.pos):p.pos===slot;}
function game(p){return p&&p.team&&p.opp&&p.team!==p.opp?[p.team,p.opp].sort().join(' / '):null;}
function roster(a,e){
 const r=rules[a.site],ps=e.ids.map(i=>a.players[i]),out=[];
 if(!r)return [check('unknown','Roster rules','This format is unsupported.','Use verified DK Classic or Showdown rules; independently validate other formats.')];
 const sd=a.site==='dk_showdown',slots=e.slots||r.slots;
 const valid=e.ids.length===r.slots.length&&new Set(e.ids).size===e.ids.length&&ps.every(Boolean)&&slots.length===r.slots.length&&slots.slice().sort().join()===r.slots.slice().sort().join()&&ps.every((p,i)=>eligible(p,slots[i],sd))&&(!sd||e.ids.includes(e.cpt)&&e.ids[slots.indexOf('CPT')]===e.cpt);
 out.push(check(valid?'pass':'warning','Roster & eligibility',valid?'Unique players fit every required slot.':'Count, duplicate, captain or position mismatch.','Check official slot assignments and player eligibility.'));
 const salary=ps.length>0&&ps.every(p=>p&&finite(p.sal)&&p.sal>=0)&&(!sd||ps.every((p,i)=>e.ids[i]!==e.cpt||finite(p.cptSal)))?ps.reduce((s,p,i)=>s+(sd&&e.ids[i]===e.cpt?p.cptSal:p.sal),0):null;
 out.push(check(salary==null?'unknown':salary<=r.cap?'pass':'warning','Salary',salary==null?'Official salary or captain salary missing.':`$${salary} / $${r.cap}; $${r.cap-salary} remaining.`,'Refresh official salaries before entry.'));
 const teams=new Set(ps.map(p=>p?.team).filter(Boolean));
 if(sd)out.push(check(ps.some(p=>!p?.team)?'unknown':teams.size===2&&Math.max(...[...teams].map(t=>ps.filter(p=>p.team===t).length))<=5?'pass':'warning','Showdown teams',`${teams.size} named teams. Both teams must be represented, maximum five from one team.`,'Verify the slate has exactly these two teams.'));
 const mapped=ps.length>0&&ps.every(p=>game(p));
 if(sd)out.push(check(!mapped?'unknown':new Set(ps.map(game)).size===1?'pass':'warning','Showdown matchup',mapped?`${new Set(ps.map(game)).size} matchups; exactly one required.`:'Explicit matchup data is missing.','Use only the two opposing teams from this contest’s game.'));
 if(!sd)out.push(check(!mapped?'unknown':new Set(ps.map(game)).size>=2?'pass':'warning','Classic game count',mapped?`${new Set(ps.map(game)).size} games; at least two required.`:'Cannot verify the two-game rule without matchups.','Verify official matchup mapping.'));
 const inconsistent=ps.some(p=>p?.gid&&ps.some(q=>q?.gid===p.gid&&game(p)!==game(q)));
 out.push(check(!mapped?'unknown':inconsistent?'warning':'pass','Team / opponent mapping',!mapped?'Missing team or explicit opponent; game IDs alone do not verify opponents.':inconsistent?'A shared game ID has conflicting opponents.':`Explicit matchups: ${[...new Set(ps.map(game))].join('; ')}. Source accuracy still requires verification.`,'Reconcile against the official slate schedule.'));
 const qbs=ps.filter(p=>p?.pos==='QB');
 out.push(check(!mapped?'unknown':'pass','Stacks & bring-backs',mapped?qbs.map(q=>`${q.name}: ${ps.filter(p=>p.team===q.team&&['WR','TE'].includes(p.pos)).length} WR/TE stack; ${ps.filter(p=>p.team===q.opp&&p.pos!=='DST').length} offensive bring-backs`).join('; ')||'No QB in this roster.':'Cannot establish stacks without explicit matchup data.','Choose correlation for the contest and scenario. A bring-back is contextual, not mandatory.'));
 const conflict=mapped&&ps.some(d=>d.pos==='DST'&&ps.some(p=>p.pos!=='DST'&&p.team===d.opp));
 out.push(check(!mapped?'unknown':conflict?'warning':'pass','Offense against rostered defense',conflict?'An offensive player faces this lineup’s defense.':mapped?'No offense faces this lineup’s defense.':'Opponents are missing.','Review whether this negative correlation is intentional; do not automatically discard the lineup.'));
 return out;
}
function exposure(a){
 const n=a.entries.length,feesKnown=n>0&&a.entries.every(e=>finite(e.fee)&&e.fee>=0),total=feesKnown?a.entries.reduce((s,e)=>s+e.fee,0):null;
 const groups={players:new Map(),pairs:new Map(),games:new Map()};
 for(const e of a.entries){const ids=[...new Set(e.ids)].sort((a,b)=>a-b);const keys={players:ids.map(String),pairs:ids.flatMap((id,i)=>ids.slice(i+1).map(j=>id+':'+j)),games:[...new Set(ids.map(i=>game(a.players[i])).filter(Boolean))]};
 for(const type of Object.keys(groups))for(const key of keys[type]){const v=groups[type].get(key)||{key,count:0,fees:0};v.count++;if(feesKnown)v.fees+=e.fee;groups[type].set(key,v);}}
 const result={n,total,feesKnown,mappingComplete:a.entries.every(e=>e.ids.every(i=>game(a.players[i])))};
 for(const type of Object.keys(groups))result[type]=[...groups[type].values()].map(v=>({...v,countShare:n?v.count/n:null,feeShare:total>0?v.fees/total:null})).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
 result.overlap=[];for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const x=a.entries[i],y=a.entries[j],shared=x.ids.filter(id=>y.ids.includes(id)).length;const gx=new Set(x.ids.map(id=>game(a.players[id])).filter(Boolean)),gy=new Set(y.ids.map(id=>game(a.players[id])).filter(Boolean));result.overlap.push({i,j,shared,games:[...gx].filter(g=>gy.has(g)).length});}
 return result;
}
function swap(a,e,next,now){
 const r=rules[a.site];if(!r)return check('unknown','Swap feasibility','Unsupported format.','Validate with the contest provider.');
 if(e.slotEvidence==='inferred')return check('unknown','Swap feasibility','Captured solver slot order is inferred, not a confirmed entered roster.','Attach actual slot assignments and set slotEvidence to supplied after checking the entry.');
 if(!finite(time(now)))return check('unknown','Swap feasibility','Evaluation time needs an explicit timezone.','Enter an ISO timestamp with Z or an offset.');
 const oldSlots=e.slots||r.slots,newSlots=next.slots||r.slots;
 const all=[...e.ids,...next.ids].map(i=>a.players[i]);
 if(all.some(p=>!p||!finite(time(p.kickoff))))return check('unknown','Swap feasibility','Kickoff is missing or lacks a timezone.','Load official kickoff times for every involved player.');
 for(let i=0;i<e.ids.length;i++)if((time(a.players[e.ids[i]].kickoff)<=time(now)||(e.lockedSlots||[]).includes(i))&&(next.ids[i]!==e.ids[i]||newSlots[i]!==oldSlots[i]))return check('warning','Swap rejected','A locked slot would change.','Keep locked players in their exact slots.');
 for(let i=0;i<next.ids.length;i++)if(next.ids[i]!==e.ids[i]&&time(a.players[next.ids[i]].kickoff)<=time(now))return check('warning','Swap rejected','A proposed player already kicked off.','Choose an eligible later player; refresh contest lock rules.');
 const checks=roster(a,next).filter(c=>['Roster & eligibility','Salary','Showdown teams','Showdown matchup','Classic game count','Team / opponent mapping'].includes(c.title));
 if(checks.some(c=>c.state!=='pass'))return check(checks.some(c=>c.state==='warning')?'warning':'unknown','Swap not executable',checks.filter(c=>c.state!=='pass').map(c=>c.evidence).join(' '),'Resolve roster and salary checks before swapping.');
 return check('pass','Swap mechanically feasible','Salary, positions, kickoff and locked slots passed for the supplied snapshot. No entry was submitted.','Verify provider lock state and manually submit before kickoff.');
}
function sensitivity(a,e){return (a.scenarios||[]).map(s=>({name:s.name||'Unnamed model',source:s.source||'Unknown source',asOf:s.asOf||'Unknown time',points:e.ids.every(id=>finite(s.projections[id]))?e.ids.reduce((n,id)=>n+s.projections[id]*(a.site==='dk_showdown'&&e.cpt===id?1.5:1),0):null}));}
function audit(a,now=new Date().toISOString()){
 const x=exposure(a),checks=[];const used=[...new Set(a.entries.flatMap(e=>e.ids))].map(i=>a.players[i]);
 checks.push(check(used.length&&used.every(p=>finite(p.proj))?'pass':'unknown','Projection inputs',`${used.filter(p=>finite(p.proj)).length} / ${used.length} used players have numeric projections. No missing value is substituted with zero.`,'Resolve missing projections, then compare credible alternative score models in the lineup lens.'));
 checks.push(check(a.entries.length?'pass':'unknown','Snapshot scope',`${a.entries.length} entries; ${a.players.length} players. Candidate lineups remain proposals until evidence is recorded.`,'Capture the intended portfolio; assign fees per entry.'));
 checks.push(check(used.length&&used.every(p=>finite(p.own)&&p.own>=0&&p.own<=100)?'pass':'unknown','Ownership coverage',`${used.filter(p=>finite(p.own)&&p.own>=0&&p.own<=100).length} / ${used.length} used players have valid ownership. Missing is never zero.`,'Import ownership estimates with source time and convention.'));
 const s=a.source||{};checks.push(check(s.name&&finite(time(s.asOf))&&s.version?'pass':'unknown','Source provenance',`Source: ${s.name||'unknown'}; source time: ${s.asOf||'unknown'}; version: ${s.version||'unknown'}; captured: ${a.capturedAt||'unknown'}. Capture time is not source time.`,'Refresh the provider snapshot and verify its timestamp before lock.'));
 const unknown=used.filter(p=>!p.injury||!p.injury.source||!finite(time(p.injury.asOf))||!p.injury.status),injured=used.filter(p=>p.injury&&!['active','healthy'].includes(String(p.injury.status).toLowerCase()));
 checks.push(check(unknown.length?'unknown':injured.length?'warning':used.length?'pass':'unknown','Availability evidence',`${unknown.length} missing sourced status; ${injured.length} non-active designations. This is a supplied report, not a live injury feed.`,'Verify official inactive reports and source time; stale active status is not clearance.'));
 const risk=a.risk||{};checks.push(check(!finite(time(risk.confirmedAt))?'unknown':!finite(risk.maxFeeExposure)||risk.maxFeeExposure<0||risk.maxFeeExposure>1?'unknown':!x.feesKnown||x.total<=0?'unknown':x.players.some(p=>p.feeShare>risk.maxFeeExposure)?'warning':'pass','Your fee exposure limit',risk.confirmedAt?`Confirmed ${risk.confirmedAt}; cap ${finite(risk.maxFeeExposure)?(risk.maxFeeExposure*100).toFixed(1)+'%':'unknown'}.`:'No risk preference confirmed. No optimal cap is assumed.','Set and explicitly confirm your own cap. Diversification changes risk; it does not automatically improve EV.'));
 for(const [key,title,values,available] of [['maxCountExposure','Player count limit',x.players.map(p=>p.countShare),x.n>0],['maxPairFeeExposure','Pair fee limit',x.pairs.map(p=>p.feeShare),x.feesKnown&&x.total>0],['maxGameFeeExposure','Game fee limit',x.games.map(p=>p.feeShare),x.mappingComplete&&x.feesKnown&&x.total>0]])if(risk[key]!=null)checks.push(check(!finite(time(risk.confirmedAt))||!finite(risk[key])||risk[key]<0||risk[key]>1||!available?'unknown':values.some(v=>v>risk[key])?'warning':'pass',title,`User cap ${finite(risk[key])?(risk[key]*100).toFixed(1)+'%':'invalid'}; confirmed ${risk.confirmedAt||'never'}.`,'Review the concentrated entries and scenario tradeoff before changing the portfolio. This preference does not imply EV improvement.'));
 const sim=a.simulation;checks.push(check('unknown','Simulation & calibration',sim?`Supplied provenance: ${JSON.stringify(sim)}. No independently validated field probabilities or calibration receipt in this dashboard.`:'No simulation receipt attached. Seeds, worlds, model version, assumptions and calibration are unknown.','Retain the run receipt. Score-threshold exceedance is not cash, top-1% or win probability. Monte Carlo noise shrinks with more worlds; model uncertainty does not.'));
 const cs=a.contests||[];checks.push(check('unknown','Contest economics',cs.length?`${cs.length} supplied contest records; inspect exact field, payouts, fee, entry cap and source. No verified ROI or duplicate splitting is calculated here.`:'Exact field, payouts and entry limits are missing. Cash probability and ROI are unavailable.','Attach exact lobby evidence and a field-model receipt; do not substitute preset contests.'));
 for(const c of cs){const complete=c.id&&c.source&&finite(time(c.asOf))&&Number.isInteger(c.fieldSize)&&c.fieldSize>0&&Number.isInteger(c.entryLimit)&&c.entryLimit>0&&finite(c.fee)&&c.fee>=0&&Array.isArray(c.payouts)&&c.payouts.length===c.fieldSize&&c.payouts.every(p=>finite(p)&&p>=0);const count=a.entries.filter(e=>e.contestId===c.id).length;checks.push(check(!complete?'unknown':count>c.entryLimit?'warning':'pass','Contest record: '+(c.id||'unnamed'),`${count} assigned entries; field ${c.fieldSize??'unknown'}; entry cap ${c.entryLimit??'unknown'}; fee ${c.fee??'unknown'}. Full per-place payouts ${complete?'supplied':'missing or incomplete'}. Source ${c.source||'unknown'} at ${c.asOf||'unknown'}.`,'Reconcile actual lobby evidence and fees. A complete record is not a calibrated field model.'));}
 const states=a.entries.map(e=>e.lifecycle||'proposed');const unsupported=a.entries.filter(e=>(e.lifecycle&&e.lifecycle!=='proposed')&&(!e.entryEvidence?.source||!finite(time(e.entryEvidence?.asOf))||!e.entryEvidence?.entryId));
 const invalidGrade=a.entries.filter(e=>e.lifecycle==='graded'&&(!e.result?.source||!finite(time(e.result?.asOf))||!finite(e.result?.points)||!finite(e.result?.payout)));
 checks.push(check(unsupported.length||invalidGrade.length?'warning':a.entries.length?'pass':'unknown','Entry lifecycle',`${states.filter(s=>s==='proposed').length} proposed; ${unsupported.length} unsupported status claims; ${invalidGrade.length} unsupported grades. User-supplied evidence is not provider verification.`,'Record entry ID, source and time for entered/amended states; grading needs sourced points and payout. Preserve pregame reasoning regardless of outcome.'));
 return {checks,exposure:x,entries:a.entries.map(e=>roster(a,e)),evaluatedAt:now};
}
function capture(data){return parse(JSON.stringify({version:1,site:data.site,players:data.players,entries:data.lineups.map(l=>{const ids=l.ids.slice(),ordered=[];for(const slot of rules[data.site]?.slots||[]){const at=ids.findIndex(id=>slot==='CPT'?id===l.cpt:slot==='FLEX'?data.site==='dk_showdown'||['RB','WR','TE'].includes(data.players[id]?.pos):data.players[id]?.pos===slot);if(at>=0)ordered.push(ids.splice(at,1)[0]);}return {...l,ids:ordered.length===l.ids.length?ordered:l.ids,slots:rules[data.site]?.slots,slotEvidence:'inferred',fee:null,lifecycle:'proposed'};}),source:{name:data.source||null,asOf:data.asOf||null,version:data.revision||null},originalInputs:data,capturedAt:new Date().toISOString(),settings:data.settings||{},simulation:data.simulation||null,scenarios:[],recommendations:[]}));}
const api={parse,roster,exposure,swap,sensitivity,audit,capture,game,rules};if(typeof module!=='undefined')module.exports=api;root.DDFSDiagnostics=api;
})(typeof self!=='undefined'?self:globalThis);
