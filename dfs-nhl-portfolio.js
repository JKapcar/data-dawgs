/* Private lineup-set diagnostics. No network or account writes. */
(function(root){'use strict';
const N=typeof module!=='undefined'&&module.exports?require('./dfs-nhl.js'):root.DDNHL;
const identity=p=>p.nhlId?'nhl:'+p.nhlId:N.norm(p.name)+'|'+p.team;
function readSet(value){
 if(!value||value.version!==1||!Array.isArray(value.lineups)||!value.lineups.length||value.lineups.length>10)throw Error('Expected version 1 and 1–10 lineups');
 const out={version:1,lineups:value.lineups.map((x,i)=>{const {sport,...raw}=x.draft||{};if(sport&&sport!=='nhl')throw Error('NHL drafts only');const draft=N.privateDraft(raw);return {label:String(x.label||'Lineup '+(i+1)).slice(0,100),draft};})};
 if(out.lineups.some(x=>x.draft.slate.games.some(g=>!N.matchupKey(g))))throw Error('Invalid slate matchup');const key=d=>JSON.stringify([d.platform,d.slate.id,d.slate.date,[...d.slate.games].map(N.matchupKey).sort()]);if(out.lineups.some(x=>key(x.draft)!==key(out.lineups[0].draft)))throw Error('Lineups must share one exact slate');
 return out;
}
function diagnose(value,now=Date.now()){
 const set=readSet(value),exposures=new Map(),teams=new Map();
 const rows=set.lineups.map((x,i)=>{const d=x.draft,ps=d.roster.filter(i=>i!==null).map(i=>d.players[i]),check=N.legality(d.players,d.roster,d.platform,d.slate),scores=ps.map(p=>N.draftProjection(p,d).subtotal),keys=ps.map(identity),warnings=[...check.issues,...check.slateIssues];
 if(new Set(keys).size!==keys.length)warnings.push('Duplicate player identity');
 for(const p of ps){const k=identity(p),o=p.override||p,stamp=Date.parse(o.at||p.sourceAt);if(!exposures.has(k))exposures.set(k,{name:p.name,team:p.team,goalie:p.pos.includes('G'),count:0});exposures.get(k).count++;
 if(!Number.isFinite(stamp)||stamp>now||now-stamp>6*3600000||!o.source)warnings.push(p.name+': availability source missing or stale');
 if(/out|scratch|not starting|questionable|unknown|expected/i.test(o.status||'unknown'))warnings.push(p.name+': '+(o.status||'unknown'));
 if(p.pos.includes('G')&&!/^confirmed$/i.test(o.status||''))warnings.push(p.name+': start not confirmed');
 if(!p.kickoff||N.locked(p,now))warnings.push(p.name+': game time missing or locked');
 if(!d.receipt?.mapping?.id&&!N.supportedSlateRow(p,d,now))warnings.push(p.name+': slate source evidence missing/stale');
 }
 for(const team of new Set(ps.map(p=>p.team)))teams.set(team,(teams.get(team)||0)+1);
 return {index:i,label:x.label,salary:check.salary,remaining:check.remaining,points:ps.length===9&&scores.every(Number.isFinite)?scores.reduce((a,b)=>a+b,0):null,legal:check.legal&&new Set(keys).size===keys.length,warnings:[...new Set(warnings)],keys,players:ps,stacks:N.correlations(d.players,d.roster),projectionAsOf:d.forecast?.asOf||d.model?.asOf||null,synthetic:!!d.synthetic};});
 const n=rows.length;return {rows,overlap:rows.map(a=>rows.map(b=>a.keys.filter(k=>b.keys.includes(k)).length)),exposures:[...exposures.values()].map(x=>({...x,percent:100*x.count/n})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)),teams:[...teams].map(([team,count])=>({team,count,percent:100*count/n})),count:n};
}
function generate(d,{confirmedSlate=false,seed=216}={}){
 const samples=N.sampleOwnership(d,{confirmedSlate,seed,samples:300,includeLineups:true}),unique=new Map();
 for(const s of samples.scenarios)for(const roster of s.lineups){const key=roster.map(i=>identity(d.players[i])).sort().join(';');if(!unique.has(key))unique.set(key,{roster,points:roster.reduce((v,i)=>v+N.draftProjection(d.players[i],d).subtotal,0)});}
 const candidates=[...unique.values()],selected=[];
 while(selected.length<10){const scored=candidates.filter(x=>!selected.includes(x)).map(x=>({x,overlap:selected.length?Math.max(...selected.map(y=>x.roster.filter(i=>y.roster.includes(i)).length)):0})).filter(x=>x.overlap<=7).sort((a,b)=>(b.x.points-2*b.overlap)-(a.x.points-2*a.overlap));if(!scored.length)throw Error('Fewer than ten distinct candidates satisfy the seven-player overlap limit; adjust the pool or import reviewed lineups.');selected.push(scored[0].x);}
 return readSet({version:1,lineups:selected.map((x,i)=>({label:'Candidate '+(i+1),draft:{...d,ownershipModel:null,roster:x.roster,receipt:{...d.receipt,generation:{version:1,seed,scenarios:3,samplesPerScenario:300,maxSharedPlayers:7,overlapPenaltyPoints:2,note:'Sampled candidates, ranked by conditional points minus overlap penalty. Not a global optimizer or cash-probability model.'}}}}))});
}
const api={readSet,diagnose,generate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DDNHLPortfolio=api;
})(typeof globalThis!=='undefined'?globalThis:this);
