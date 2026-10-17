// Canonical answer contracts are independent of presentation. Proposed mechanisms are
// listed for design discovery only; they cannot be authored as supported controls yet.
export const mechanisms=Object.freeze({
 choice:{label:'Compare & choose',status:'implemented',answer:'choice'},
 scale:{label:'Set a measured value',status:'implemented',answer:'number'},
 rank:{label:'Order priorities',status:'implemented',answer:'order'},
 budget:{label:'Allocate a fixed budget',status:'implemented',answer:'allocations'},
 buckets:{label:'Sort into named groups',status:'implemented',answer:'assignments'},
 forecast:{label:'Forecast with a probability or interval',status:'proposed'},
 scenario:{label:'Explore conditional scenarios',status:'proposed'},
 tradeoff:{label:'Compare a tradeoff frontier',status:'proposed'},
 uncertainty:{label:'Choose information worth collecting',status:'proposed'},
 pairwise:{label:'Compare pairs systematically',status:'proposed'}
});
export const mechanismBacklog=Object.freeze([
 'Decision gates','Pairwise tournament with ties/skips','Priority stack with tied tiers','Limited-slot priority draft',
 'Criteria/evidence matrix','Resource-chip tray with reserve','Constrained work-package loadout','Anchored two-axis preference pad',
 'Measured Pareto-frontier explorer','Scenario-dial console','Sensitivity scanner','Interval rail with explicit units/type',
 'Subjective forecast-distribution canvas','Evidence-influence balance','Claim/challenge board','Next-evidence chooser',
 'Dependency-route map','Milestone runway','Bounds/stopping-rule clamps','Contingency if/then switchboard',
 'Feature/split scope stencil','Responsibility relay: proposed vs accepted owners','Counterargument turntable','Deliberation review',
 'Teach-back reconstruction separate from consent','Stance/confidence split'
].map((label,i)=>Object.freeze({id:'proposal-'+(i+1),label,status:'proposed',efficacy:'not_evaluated'})));
export function validateAnswer(control,options,answer){
 const ids=options.map(o=>o.id),same=xs=>xs.length===ids.length&&new Set(xs).size===ids.length&&xs.every(x=>ids.includes(x));
 const key=mechanisms[control.kind]?.answer;
 if(!key||Object.keys(answer).length!==1||!Object.hasOwn(answer,key))return 'Complete the answer using this decision’s control.';
 if(control.kind==='choice'&&!ids.includes(answer.choice))return 'Choose one listed option.';
 if(control.kind==='scale'&&(!Number.isSafeInteger(answer.number)||answer.number<control.min||answer.number>control.max||(answer.number-control.min)%control.step))return `Choose ${control.min}–${control.max} ${control.unit}, in steps of ${control.step}.`;
 if(control.kind==='rank'&&!same(answer.order))return 'Give every option a different position.';
 if(control.kind==='budget'&&(!same(answer.allocations.map(a=>a.id))||answer.allocations.some(a=>!Number.isSafeInteger(a.amount)||a.amount<0)||answer.allocations.reduce((s,a)=>s+a.amount,0)!==control.total))return `Allocate exactly ${control.total} ${control.unit}.`;
 if(control.kind==='buckets'&&(!same(answer.assignments.map(a=>a.id))||answer.assignments.some(a=>!control.buckets.some(b=>b.id===a.bucket))))return 'Place every option in one named group.';
 return null;
}
export function answerLabel(control,options,answer){
 const label=id=>options.find(o=>o.id===id)?.text||id;
 if(control.kind==='choice')return label(answer.choice);
 if(control.kind==='scale')return `${answer.number} ${control.unit}`;
 if(control.kind==='rank')return answer.order.map((id,i)=>`${i+1}. ${label(id)}`).join('\n');
 if(control.kind==='budget')return answer.allocations.map(a=>`${label(a.id)}: ${a.amount} ${control.unit}`).join('\n');
 return answer.assignments.map(a=>`${label(a.id)}: ${control.buckets.find(b=>b.id===a.bucket)?.label||a.bucket}`).join('\n');
}
