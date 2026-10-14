/* NHL research core. Shared browser/Worker implementation; no network, identity or storage. */
(function(root){'use strict';
const VERSION='nhl-rate/0.1',PARAMS={halfLifeDays:30,priorMinutes:180,minGames:3};
// DK scoring and Classic roster rules verified on 2026-10-13; see rule-specific provenance.
// Never describe a roster as provider-verified until this version is source-verified.
const RULES={
 dk:{cap:50000,slots:['C','C','W','W','W','D','D','G','UTIL'],minSkaterTeams:3,verified:true,capVerified:true,slotsVerified:true,utilEligibilityVerified:true,teamConstraintsVerified:true,lockRule:'scheduled-player-game-time',rosterVerifiedAt:'2026-10-13',rosterEvidence:'Current official DK NHL Classic rules screenshots supplied by user and reviewed 2026-10-13: 8 skaters from at least 3 teams, 1 goalie; UTIL C/W/D; no separate total-team cap. Private source images are not published.',scoringVerified:true,scoringVerifiedAt:'2026-10-13',scoringSource:'https://dknetwork.draftkings.com/2025/09/30/nhl-daily-fantasy-101-how-to-play-dfs-on-draftkings/',source:'https://www.draftkings.com/help/rules/nhl',weights:{goals:8.5,assists:5,sog:1.5,blocks:1.3,shPoints:2,shootoutGoals:1.5,saves:.7,ga:-3.5,wins:6,shutouts:4,otLoss:2}},
 fd:{cap:55000,slots:['C','C','W','W','D','D','UTIL','UTIL','G'],maxTeam:4,minTeams:3,verified:false,source:'https://www.fanduel.com/rules',weights:{goals:12,assists:8,sog:1.6,blocks:1.6,ppPoints:.5,shPoints:2,saves:.8,ga:-4,wins:12,shutouts:8}}
};
const EVENTS=['goals','assists','sog','blocks'],norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const num=v=>v===null||v===undefined||String(v).trim()===''?null:(Number.isFinite(Number(String(v).replace(/[$,%]/g,'')))?Number(String(v).replace(/[$,%]/g,'')):null);
const assert=(v,m)=>{if(!v)throw Error(m);};
function csv(text){
 assert(typeof text==='string'&&text.length<=8000000,'CSV exceeds 8 MB');
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==='')quoted=!quoted;else cell+=c;}
 else if(!quoted&&(c===','||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==','){if(row.some(x=>x.trim()))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}}else cell+=c;}
 assert(!quoted,'Unclosed quoted CSV cell');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
const ALIASES={salarySource:['salarysource'],salaryAsOf:['salaryasof'],eligibilitySource:['eligibilitysource'],eligibilityAsOf:['eligibilityasof'],id:['id','playerid','dkid','fdid'],nhlId:['nhlid','nhlplayerid'],name:['name','player','playername','nickname'],pos:['position','pos','rosterposition','dkpos','fdpos'],team:['team','teamabbrev','teamabbreviation'],opp:['opp','opponent'],salary:['salary','dksalary','fdsalary'],game:['gameinfo','game','matchup'],slateId:['slateid','draftgroupid'],date:['date','slatedate','gamedate'],own:['ownership','own','projectedownership'],minutes:['minutes','toi','projectedminutes'],playProb:['playprob','playingprobability','startprob'],line:['line','evenstrengthline'],pp:['pp','ppline'],status:['status','goalieStatus'],sourceAt:['sourceat','asof'],source:['source'],kickoff:['kickoff','starttime','gamestart','gametime']};
function kickoff(value){
 const t=String(value||'').trim();if(!t)return null;
 if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(t)){const n=Date.parse(t);return Number.isFinite(n)?new Date(n).toISOString():null;}
 const m=t.match(/\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+ET\b/i);if(!m)return null;
 const month=+m[1],day=+m[2],year=+m[3],hour=(+m[4]%12)+(m[6].toUpperCase()==='PM'?12:0),minute=+m[5];if(month<1||month>12||day<1||day>31||+m[4]<1||+m[4]>12||minute>59)return null;
 const wall=Date.UTC(year,month-1,day,hour,minute),fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});let n=wall;
 for(let i=0;i<3;i++){const q=Object.fromEntries(fmt.formatToParts(n).map(x=>[x.type,x.value]));n+=wall-Date.UTC(+q.year,+q.month-1,+q.day,+q.hour,+q.minute);}
 const q=Object.fromEntries(fmt.formatToParts(n).map(x=>[x.type,x.value]));return +q.year===year&&+q.month===month&&+q.day===day&&+q.hour===hour&&+q.minute===minute?new Date(n).toISOString():null;
}
function locked(p,now=Date.now()){return !!p&&Number.isFinite(Date.parse(p.kickoff))&&Date.parse(p.kickoff)<=now;}
function checkRosterChange(previous, next, now=Date.now()){
 previous.roster.forEach((i,s)=>{const p=previous.players[i];if(i!==null&&locked(p,now))assert(next.players[next.roster[s]]?.id===p.id,'Locked player cannot be removed or moved: '+p.name);});
 next.roster.forEach((i,s)=>{const p=next.players[i];if(i!==null&&locked(p,now))assert(previous.players[previous.roster[s]]?.id===p.id,'Locked player cannot be added: '+p.name);});
}
function parsePool(text,platform){
 assert(RULES[platform],'Choose DK or FD');const rows=csv(text);assert(rows.length>1,'CSV needs a header and player rows');
 const start=rows.findIndex(r=>r.some(c=>ALIASES.salary.includes(norm(c)))&&r.some(c=>ALIASES.name.includes(norm(c))));assert(start>=0,'Cannot find player name and salary columns');
 const headers=rows[start],mapping={};
 const formatColumns=headers.map((h,i)=>['rosterposition','contesttype','contestformat','format'].includes(norm(h))?i:-1).filter(i=>i>=0);
 const showdown=rows.slice(0,start+1).some(r=>r.some(c=>/\bshowdown\b|^(CPT|CAPTAIN|FLEX)$/i.test(c.trim())))||rows.slice(start+1).some(r=>formatColumns.some(i=>/\b(showdown|CPT|CAPTAIN|FLEX)\b/i.test(r[i]||'')));
 assert(!showdown,'This tool supports NHL Classic only. Showdown / Captain / FLEX formats need a separate lineup builder.');
 for(const [k,aliases] of Object.entries(ALIASES)){const indexes=headers.map((h,i)=>aliases.includes(norm(h))?i:-1).filter(i=>i>=0);if(indexes.length>1&&k!=='pos')throw Error('Ambiguous '+k+' columns; retain one column');mapping[k]=indexes[0]??-1;}
 for(const k of ['name','salary','pos','team'])assert(mapping[k]>=0,'Missing '+k+' column');
 const players=[],rejected=[],ids=new Set();for(let i=start+1;i<rows.length;i++){const r=rows[i],get=k=>String(r[mapping[k]]??'').trim();try{
 assert(r.length===headers.length,'Column count differs from header');let pos=get('pos').toUpperCase().split(/[\/;, ]+/).filter(Boolean).map(x=>['LW','RW','L','R'].includes(x)?'W':x);pos=[...new Set(pos.filter(x=>x!=='UTIL'))];assert(pos.length&&pos.every(x=>['C','W','D','G'].includes(x))&&!(pos.includes('G')&&pos.length>1),'Unsupported position');
 const salary=num(get('salary'));assert(salary>0&&Number.isInteger(salary)&&salary<=RULES[platform].cap,'Invalid salary');const name=get('name'),team=get('team').toUpperCase();assert(name&&/^[A-Z]{2,4}$/.test(team),'Missing name/team');
 const id=get('id')||platform+':'+team+':'+norm(name);assert(!ids.has(id),'Duplicate player ID');
 const matchup=get('game').match(/\b([A-Z]{2,4})@([A-Z]{2,4})\b/),opp=get('opp').replace(/^@/,'').toUpperCase()||(matchup?(matchup[1]===team?matchup[2]:matchup[2]===team?matchup[1]:''):'');assert(!opp||opp!==team,'Opponent equals team');
 const own=num(get('own'));assert(!get('own')||own!==null,'Invalid ownership number');assert(own===null||own>=0&&own<=100,'Ownership must be percent 0–100');
 ids.add(id);players.push({platformId:get('id')||null,salarySource:get('salarySource'),salaryAsOf:get('salaryAsOf'),eligibilitySource:get('eligibilitySource'),eligibilityAsOf:get('eligibilityAsOf'),kickoff:kickoff(get('kickoff')||get('game')),id,nhlId:get('nhlId')||null,name,pos,team,opp,salary,own,slateId:get('slateId'),date:get('date'),minutes:num(get('minutes')),playProb:num(get('playProb')),line:get('line'),pp:get('pp'),status:get('status')||'unknown',sourceAt:get('sourceAt')||null,source:get('source'),platform,override:null});
 }catch(e){rejected.push({row:i+1,reason:e.message});}}
 assert(players.length<=600,'Maximum 600 players');return {players,rejected,parsed:players.length,total:rows.length-start-1,mapping:Object.fromEntries(Object.entries(mapping).filter(([,v])=>v>=0).map(([k,v])=>[k,headers[v]])),platform};
}
function minutes(v){if(typeof v==='number')return Number.isFinite(v)&&v>=0&&v<=100?v:null;const m=String(v??'').match(/^(\d{1,3}):([0-5]\d)$/);return m?Number(m[1])+Number(m[2])/60:null;}
function history(text,asOf,gameType='02'){
 assert(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(asOf)&&Number.isFinite(Date.parse(asOf)),'As-of needs an ISO timestamp with timezone');assert(['02','03'].includes(gameType),'Use regular season 02 or playoffs 03 separately');
 const rows=csv(text),heads=rows.shift(),accepted=[],rejected={future:0,type:0,invalid:0,duplicate:0},seen=new Set(),cutoff=new Date(asOf).toISOString().slice(0,10);let maxDate=null;
 for(const r of rows){const o=Object.fromEntries(heads.map((h,i)=>[h,r[i]??'']));if(/^\d{4}-\d{2}-\d{2}$/.test(o.game_date)&&(!maxDate||o.game_date>maxDate))maxDate=o.game_date;
 if(!/^\d{10}$/.test(o.game_id)||!/^\d+$/.test(o.player_id)||!/^\d{4}-\d{2}-\d{2}$/.test(o.game_date)){rejected.invalid++;continue;}
 if(o.game_id.slice(4,6)!==gameType){rejected.type++;continue;}if(o.game_date>=cutoff){rejected.future++;continue;}
 const key=o.game_id+':'+o.player_id;if(seen.has(key)){rejected.duplicate++;continue;}seen.add(key);
 const goalie=['saves','shots_against','goals_against'].some(k=>o[k]!=null&&o[k]!==''),m=minutes(o.toi),pos=goalie?'G':o.position==='D'?'D':['C','L','R','LW','RW','W'].includes(o.position)?'F':null;
 const values=goalie?{saves:num(o.saves),ga:num(o.goals_against),shotsAgainst:num(o.shots_against)}:{goals:num(o.goals),assists:num(o.assists),sog:num(o.shots_on_goal),blocks:num(o.blocked_shots)};
 if(!pos||m===null||m<=0||Object.values(values).some(v=>v===null||v<0)||goalie&&Math.abs(values.saves+values.ga-values.shotsAgainst)>.01){rejected.invalid++;continue;}
 accepted.push({id:o.player_id,name:o.player_name,team:o.team_abbrev,pos,minutes:m,date:o.game_date,gameId:o.game_id,...values,win:goalie?(o.decision==='W'?1:0):null,starter:goalie?String(o.starter).toLowerCase()==='true':null});}
 return {rows:accepted,receipt:{asOf,gameType,total:rows.length,accepted:accepted.length,rejected,maxDate,trainingMaxDate:accepted.reduce((a,r)=>!a||r.date>a?r.date:a,null),note:'Entire as-of UTC date excluded: boxscores lack completion timestamps. No postgame minutes used as features.'}};
}
function train(rows,asOf){
 const cutoff=Date.parse(asOf),date=new Date(cutoff).toISOString().slice(0,10),safe=rows.filter(r=>r.date<date),groups=new Map(),priors={};
 for(const r of safe){if(!groups.has(r.id))groups.set(r.id,[]);groups.get(r.id).push(r);const p=priors[r.pos]||(priors[r.pos]={minutes:0,n:0,events:{}});p.minutes+=r.minutes;p.n++;for(const k of r.pos==='G'?['saves','ga','shotsAgainst']:EVENTS)p.events[k]=(p.events[k]||0)+r[k];}
 const players=[];for(const [id,rr] of groups){rr.sort((a,b)=>a.date.localeCompare(b.date));const latest=rr.at(-1),p=priors[latest.pos],weights=rr.map(r=>Math.pow(.5,(cutoff-Date.parse(r.date))/86400000/PARAMS.halfLifeDays)),wm=rr.reduce((s,r,i)=>s+weights[i]*r.minutes,0),wn=weights.reduce((a,b)=>a+b,0),rates={};
 for(const k of latest.pos==='G'?['saves','ga','shotsAgainst']:EVENTS)rates[k]=(rr.reduce((s,r,i)=>s+weights[i]*r[k],0)+PARAMS.priorMinutes*p.events[k]/p.minutes)/(wm+PARAMS.priorMinutes);
 players.push({nhlId:id,name:latest.name,team:latest.team,pos:latest.pos,games:rr.length,minutes:wm/wn,rates,lastGame:latest.date,winRate:latest.pos==='G'?rr.reduce((s,r)=>s+r.win,0)/rr.length:null});}
 return {version:VERSION,asOf,params:PARAMS,players,source:'SportsDataverse NHL player boxscores',ungraded:true};
}
function match(player,model,idMap={}){
 const id=player.nhlId||idMap[player.platform+':'+player.id];let candidates=id?model.players.filter(p=>p.nhlId===String(id)):model.players.filter(p=>p.team===player.team&&norm(p.name)===norm(player.name));
 if(candidates.length!==1)return {player:null,method:id?'ID unresolved':'Name/team unresolved',reason:candidates.length?'Ambiguous identity':'No exact identity; abbreviated/fuzzy names are never silently joined'};
 const p=candidates[0];if(p.team!==player.team||((p.pos==='G')!==player.pos.includes('G')))return {player:null,method:'Conflict',reason:'ID matched but team or goalie classification conflicts; reconcile explicitly'};
 return {player:p,method:id?'NHL ID':'Exact name + team',reason:null};
}
function tail(lambda,k){assert(Number.isFinite(lambda)&&lambda>=0,'Invalid event mean');let p=Math.exp(-lambda),cdf=p;for(let i=1;i<k;i++){p*=lambda/i;cdf+=p;}return Math.max(0,Math.min(1,1-cdf));}
function score(events,platform,goalie=false,expected=false){
 const rule=RULES[platform];assert(rule,'Unknown scoring platform');const components={},missing=[];
 for(const [k,w] of Object.entries(rule.weights)){if(!(goalie&&platform==='dk')&&goalie!==['saves','ga','wins','shutouts','otLoss'].includes(k))continue;const v=events[k];if(!Number.isFinite(v)){missing.push(k);continue;}components[k]=w*v;}
 if(platform==='dk')for(const [key,k,bonus,label] of [...(goalie?[['saves',35,3,'35+ saves']]:[]),['goals',3,3,'hat trick'],['sog',5,3,'5+ shots'],['blocks',3,3,'3+ blocks']]){if(Number.isFinite(events[key]))components[label]=bonus*(expected?tail(events[key],k):+(events[key]>=k));else missing.push(label);}
 if(platform==='dk'){if(Number.isFinite(events.goals)&&Number.isFinite(events.assists))components['3+ points']=3*(expected?tail(events.goals+events.assists,3):+(events.goals+events.assists>=3));else missing.push('3+ points');}
 return {components,subtotal:Object.values(components).reduce((a,b)=>a+b,0),total:missing.length?null:Object.values(components).reduce((a,b)=>a+b,0),missing,verified:!!rule.scoringVerified};
}
function project(p,model){
 const target=p.date||(p.kickoff?new Date(p.kickoff).toISOString().slice(0,10):null);
 if(target&&model.asOf.slice(0,10)>target)return {points:null,subtotal:null,components:{},flags:['Historical slate predates model as-of; load a pre-slate model to prevent leakage'],match:'As-of conflict'};

 const joined=match(p,model),o=p.override||{},base=joined.player,flags=[];if(!base)return {points:null,subtotal:null,flags:[joined.reason],match:joined.method,components:{}};
 const goalie=p.pos.includes('G'),m=o.minutes??p.minutes??base.minutes,prob=o.playProb??p.playProb;
 if(prob===null||prob===undefined)flags.push(goalie?'Starting probability unknown':'Playing probability unknown');if(base.games<PARAMS.minGames)flags.push('Small historical sample');if(!o.at&&!p.sourceAt)flags.push('Role/news timestamp unknown');if(!o.source&&!p.source)flags.push('Role/news source unknown');if(/^(out|scratched|not starting)$/i.test(o.status||p.status||'')&&prob>0)flags.push('Availability conflicts with positive playing probability');
 if(!Number.isFinite(m)||m<0||m>100)return {points:null,subtotal:null,flags:['Invalid projected minutes'],components:{}};
 if(prob!=null&&(!Number.isFinite(prob)||prob<0||prob>1))return {points:null,subtotal:null,flags:['Playing probability must be 0–1'],components:{}};
 if(base.baseline){
  const b=base.baseline;if(!b.n||!Number.isFinite(b.mean))return {points:null,subtotal:null,flags:['No historical appearances in this population'],components:{}};
  const requested=o.minutes??p.minutes,ratio=!goalie&&requested!=null?Math.max(.85,Math.min(1.15,requested/b.minutes)):1,scale=prob??1;
  if(ratio!==1)flags.push('Manual minutes adjustment capped at +/-15%; linear score approximation, including nonlinear bonuses');
  if(goalie&&requested!=null)flags.push('Goalie minutes override does not scale the start-conditioned historical score');
  flags.push(...b.missing.map(k=>'Unobserved historical component: '+k),'Empirical game-to-game SD is not a standard error or calibrated forecast interval');
  const components=Object.fromEntries(Object.entries(b.components).map(([k,v])=>[k,v*ratio*scale]));
  return {points:prob==null||b.missing.length?null:b.mean*ratio*scale,subtotal:b.mean*ratio*scale,conditional:prob==null,components,events:b.events,minutes:b.minutes*ratio,playProb:prob??null,games:b.n,lastGame:b.lastDate,match:joined.method,flags,model:'player-history/1',asOf:model.asOf,historical:b,adjustment:ratio};
 }
 const events=Object.fromEntries(Object.entries(base.rates).map(([k,v])=>[k,v*m]));
 if(goalie){events.wins=o.winProb??null;events.shutouts=o.shutoutProb??null;events.otLoss=o.otLossProb??null;flags.push('Goalie win/shutout inputs require explicit estimates; relief appearances not modeled');}
 else{events.shPoints=o.shPoints??null;events.ppPoints=o.ppPoints??null;events.shootoutGoals=o.shootoutGoals??null;}
 const s=score(events,p.platform,goalie,true),scale=prob??1,components=Object.fromEntries(Object.entries(s.components).map(([k,v])=>[k,v*scale]));
 flags.push(...s.missing.map(k=>'Missing '+k));if(!s.verified)flags.push('Scoring rules provisional');if(!RULES[p.platform].verified)flags.push('Roster rules provisional');
 if((o.at||p.sourceAt)&&Date.parse(model.asOf)-Date.parse(o.at||p.sourceAt)>6*3600000)flags.push('Role/news older than six hours');
 if((o.at||p.sourceAt)&&Date.parse(o.at||p.sourceAt)>Date.parse(model.asOf))flags.push('Role evidence is after projection as-of');
 return {points:prob==null||s.total===null?null:s.total*scale,subtotal:s.subtotal*scale,conditional:prob==null,components,events,minutes:m,playProb:prob??null,games:base.games,lastGame:base.lastGame,match:joined.method,flags,model:VERSION,asOf:model.asOf};
}
function eligible(p,slot){return slot==='UTIL'?!p.pos.includes('G'):p.pos.includes(slot);}
function matchupKey(game){if(typeof game!=='string'||!/^([A-Z]{2,4})@([A-Z]{2,4})$/.test(game))return null;const teams=game.split('@');return teams[0]===teams[1]?null:teams.sort().join('@');}
function legality(players,roster,platform,slate={}){
 const r=RULES[platform],issues=[];assert(r,'Unknown platform');const picked=roster.filter(x=>x!==null).map(i=>players[i]);if(roster.length!==r.slots.length||picked.length!==r.slots.length)issues.push('Fill all nine roster slots');
 if(new Set(roster.filter(x=>x!==null)).size!==picked.length)issues.push('Duplicate player');roster.forEach((i,s)=>{if(i!==null&&(!players[i]||!eligible(players[i],r.slots[s])))issues.push('Ineligible '+r.slots[s]+' slot');});
 const valid=picked.filter(Boolean),salary=valid.reduce((s,p)=>s+p.salary,0),teams={};valid.forEach(p=>teams[p.team]=(teams[p.team]||0)+1);if(salary>r.cap)issues.push('Salary cap exceeded');if(r.maxTeam&&Object.values(teams).some(n=>n>r.maxTeam))issues.push('Too many players from one team');if(r.minSkaterTeams&&new Set(valid.filter(p=>!p.pos.includes('G')).map(p=>p.team)).size<r.minSkaterTeams)issues.push('Need skaters from at least '+r.minSkaterTeams+' NHL teams');if(r.minTeams&&Object.keys(teams).length<r.minTeams)issues.push('Need at least '+r.minTeams+' teams');
 const slateIssues=[];if(!slate.id||!slate.date||!Array.isArray(slate.games)||!slate.games.length)slateIssues.push('Exact slate ID, date and game list required');
 for(const p of valid){if(p.platform!==platform)slateIssues.push(p.name+': platform differs');if(!p.slateId||p.slateId!==slate.id)slateIssues.push(p.name+': slate ID missing/mismatch');if(!p.date||p.date!==slate.date)slateIssues.push(p.name+': slate date missing/mismatch');if(p.kickoff&&(!Number.isFinite(Date.parse(p.kickoff))||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.kickoff))!==slate.date))slateIssues.push(p.name+': scheduled game date mismatch');if(!p.opp||!(slate.games||[]).map(matchupKey).includes(matchupKey(p.team+'@'+p.opp))||!matchupKey(p.team+'@'+p.opp))slateIssues.push(p.name+': game not verified in exact slate');}
 return {legal:issues.length===0,providerVerified:r.verified,issues,slateIssues:[...new Set(slateIssues)],salary,remaining:r.cap-salary,ready:false};
}
function correlations(players,roster){const ps=roster.filter(i=>i!==null).map(i=>players[i]).filter(Boolean),notes=[];for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const a=ps[i],b=ps[j],ao=a.override||a,bo=b.override||b;if(a.team===b.team&&!a.pos.includes('G')&&!b.pos.includes('G')){if(ao.line&&ao.line===bo.line)notes.push(a.name+' + '+b.name+': same even-strength line');if(ao.pp&&ao.pp===bo.pp)notes.push(a.name+' + '+b.name+': same power-play unit');}if((a.pos.includes('G')&&a.opp===b.team)||(b.pos.includes('G')&&b.opp===a.team))notes.push(a.name+' + '+b.name+': goalie versus opposing skater');}return [...new Set(notes)];}
function validate(value){
 assert(value&&value.version===1,'Expected NHL draft version 1');assert(JSON.stringify(value).length<=2000000,'NHL draft exceeds 2 MB');
 const allowed=['version','platform','players','roster','slate','model','receipt','synthetic','forecast','ownershipModel'];assert(Object.keys(value).every(k=>allowed.includes(k)),'Unsupported NHL draft field');assert(RULES[value.platform],'Unknown platform');assert(Array.isArray(value.players)&&value.players.length<=600,'Invalid player pool');
 const ids=new Set();for(const p of value.players){assert(p&&typeof p.id==='string'&&p.id.length<=160&&!ids.has(p.id),'Invalid / duplicate player ID');ids.add(p.id);assert(typeof p.name==='string'&&p.name.length<=160&&typeof p.team==='string'&&typeof p.opp==='string','Invalid identity');assert(Array.isArray(p.pos)&&p.pos.length>0&&p.pos.every(x=>['C','W','D','G'].includes(x))&&!(p.pos.includes('G')&&p.pos.length>1),'Invalid position');assert(p.platform===value.platform,'Mixed platform pool');assert(Number.isInteger(p.salary)&&p.salary>0&&p.salary<=RULES[value.platform].cap,'Invalid salary');assert(p.own===null||Number.isFinite(p.own)&&p.own>=0&&p.own<=100,'Invalid ownership');
 assert(p.kickoff==null||typeof p.kickoff==='string'&&Number.isFinite(Date.parse(p.kickoff)),'Invalid game start');
 for(const k of ['minutes','playProb'])assert(p[k]==null||Number.isFinite(p[k])&&p[k]>=0&&p[k]<=(k==='minutes'?100:1),'Invalid '+k);
 for(const k of ['salarySource','salaryAsOf','eligibilitySource','eligibilityAsOf'])assert(p[k]==null||typeof p[k]==='string'&&p[k].length<=1000,'Invalid slate provenance');assert(p.platformId==null||typeof p.platformId==='string'&&p.platformId.length<=160,'Invalid platform ID');
 if(p.override){assert(typeof p.override.at==='string'&&Number.isFinite(Date.parse(p.override.at)),'Override timestamp required');for(const [k,v] of Object.entries(p.override)){if(['minutes','playProb','winProb','shutoutProb','otLossProb','shPoints','ppPoints','shootoutGoals'].includes(k))assert(v===null||Number.isFinite(v)&&v>=0&&v<=(k.includes('Prob')?1:100),'Invalid override '+k);else assert(['at','source','line','pp','status'].includes(k)&&typeof v==='string'&&v.length<=200,'Invalid role override');}}
 }
 assert(Array.isArray(value.roster)&&value.roster.length===9,'Nine roster slots required');const used=new Set();value.roster.forEach((i,s)=>{if(i===null)return;assert(Number.isInteger(i)&&value.players[i]&&!used.has(i)&&eligible(value.players[i],RULES[value.platform].slots[s]),'Duplicate / ineligible roster slot');used.add(i);});
 assert(value.slate&&typeof value.slate.id==='string'&&typeof value.slate.date==='string'&&Array.isArray(value.slate.games)&&value.slate.games.every(g=>typeof g==='string'),'Invalid slate');
 if(value.model){assert(value.model.version===VERSION&&Number.isFinite(Date.parse(value.model.asOf))&&Array.isArray(value.model.players)&&value.model.players.length<=2000,'Invalid model');for(const p of value.model.players){assert(typeof p.nhlId==='string'&&['F','D','G'].includes(p.pos)&&typeof p.name==='string'&&typeof p.team==='string'&&Number.isFinite(p.minutes)&&p.minutes>0&&p.minutes<=100&&Number.isInteger(p.games)&&p.games>0,'Invalid model player');assert(p.rates&&Object.values(p.rates).every(n=>Number.isFinite(n)&&n>=0&&n<=10),'Invalid model rates');assert(p.lastGame<value.model.asOf.slice(0,10),'Model contains as-of/future game');if(p.baseline){const b=p.baseline;assert(Number.isInteger(b.n)&&b.n===p.games&&Number.isFinite(b.mean)&&Number.isFinite(b.minutes)&&b.minutes>0&&b.lastDate<value.model.asOf.slice(0,10),'Invalid historical baseline');assert(b.variance===null||Number.isFinite(b.variance)&&b.variance>=0,'Invalid historical variance');assert(b.sd===null||Number.isFinite(b.sd)&&b.sd>=0,'Invalid historical SD');assert(b.components&&Object.values(b.components).every(Number.isFinite)&&Math.abs(Object.values(b.components).reduce((s,v)=>s+v,0)-b.mean)<1e-6,'Historical components do not reconcile');assert(Array.isArray(b.missing)&&b.missing.every(x=>typeof x==='string'),'Invalid missing-component receipt');}}}
 if(value.forecast){const f=value.forecast;assert(f.version===1&&typeof f.source==='string'&&f.source.length<=1000&&Number.isFinite(Date.parse(f.asOf))&&f.date===value.slate.date&&Array.isArray(f.players)&&f.players.length<=value.players.length,'Invalid reviewed forecast');const seen=new Set();for(const r of f.players){assert(ids.has(r.id)&&!seen.has(r.id)&&Number.isFinite(r.points)&&r.points>=-100&&r.points<=200,'Invalid reviewed projection');seen.add(r.id);}}
 if(value.ownershipModel){const o=value.ownershipModel;assert(o.version===1&&o.kind==='uncalibrated-legal-lineup-heuristic'&&typeof o.key==='string'&&Number.isFinite(Date.parse(o.asOf))&&Number.isInteger(o.seed)&&o.seed>=0&&o.seed<=4294967295&&o.confirmedSlate===true&&Number.isInteger(o.samples)&&o.samples>=20&&o.samples<=1000&&Array.isArray(o.scenarios)&&o.scenarios.length===3&&Array.isArray(o.rows)&&o.rows.length===value.players.length,'Invalid ownership heuristic');
 if(o.assumption){validateOwnershipAssumption(value,o.assumption);assert(o.assumptionKey===JSON.stringify(o.assumption),'Ownership assumption changed');}
 const seen=new Set();for(const r of o.rows){assert(ids.has(r.id)&&!seen.has(r.id)&&[r.mean,r.low,r.high].every(x=>Number.isFinite(x)&&x>=0&&x<=100)&&r.low<=r.mean+1e-9&&r.mean<=r.high+1e-9,'Invalid ownership range');seen.add(r.id);}
 for(const [j,x] of o.scenarios.entries()){assert(x.name===['projection','value','stack'][j]&&x.samples===o.samples&&Array.isArray(x.percent)&&x.percent.length===value.players.length&&x.percent.every(v=>Number.isFinite(v)&&v>=0&&v<=100)&&Math.abs(x.percent.reduce((a,b)=>a+b,0)-900)<1e-6&&Math.abs(x.percent.reduce((a,b,i)=>a+(value.players[i].pos.includes('G')?b:0),0)-100)<1e-6,'Invalid ownership scenario totals');}
 for(let i=0;i<o.rows.length;i++){const r=o.rows[i],v=o.scenarios.map(x=>x.percent[i]);assert(r.id===value.players[i].id&&Math.abs(r.mean-v.reduce((a,b)=>a+b,0)/3)<1e-6&&r.low===Math.min(...v)&&r.high===Math.max(...v),'Ownership scenarios do not reconcile');}}
 // Reject prototype-bearing JSON keys at any depth; preserve explicit nulls through storage.
 const scan=(v,d=0)=>{assert(d<20,'NHL state too deeply nested');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){assert(!['__proto__','prototype','constructor'].includes(k),'Unsafe state key');scan(x,d+1);}};scan(value);return JSON.parse(JSON.stringify(value));
}

function supportedSlateRow(p,d,now=Date.now()){
 const source=v=>typeof v==='string'&&/^https:\/\/[^\s]+$/.test(v),fresh=v=>Number.isFinite(Date.parse(v))&&Date.parse(v)<=now&&now-Date.parse(v)<=36*3600000;
 return source(p.salarySource)&&source(p.eligibilitySource)&&fresh(p.salaryAsOf)&&fresh(p.eligibilityAsOf)&&p.date===d.slate.date&&p.slateId===d.slate.id&&!!d.slate.id;
}
function reviewedJoin(d,pack){
 assert(!d.synthetic&&d.platform==='dk','Use a real DraftKings CSV');
 assert(d.receipt?.mapping?.id||d.players.every(p=>supportedSlateRow(p,d)),'Platform ID column or dated salary/eligibility source evidence required');
 assert(pack&&pack.slateDate&&Array.isArray(pack.players),'Reviewed package required');
 const gameKey=p=>[p.team,p.opp].sort().join('@'),expected=pack.games.map(g=>g.split('@').sort().join('@')).sort();
 assert(d.players.length&&d.players.every(p=>(/^\d+$/.test(p.id)||supportedSlateRow(p,d))&&p.kickoff&&new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.kickoff))===pack.slateDate),'CSV IDs and Eastern game dates must match the reviewed slate');
 assert(JSON.stringify([...new Set(d.players.map(gameKey))].sort())===JSON.stringify(expected),'CSV games must exactly match the reviewed slate');
 const rows=d.players.map(p=>{const matches=pack.players.filter(q=>norm(q.name)===norm(p.name)&&q.team===p.team&&q.opponent===p.opp);const q=matches.length===1?matches[0]:null;return q&&p.pos.includes(q.position)?{id:p.id,points:q.points,flag:q.flag||'',line:q.line||'',pp:q.pp||''}:null;}).filter(Boolean);
 assert(rows.length,'No unambiguous eligible reviewed matches');
 return validate({...d,slate:{...d.slate,date:pack.slateDate,games:expected},forecast:{version:1,source:pack.source,asOf:pack.reviewedAt,date:pack.slateDate,players:rows}});
}
function draftProjection(p,d){
 if(!d.forecast)return d.model?project(p,d.model):{points:null,subtotal:null,components:{},flags:['No historical model loaded']};
 const row=d.forecast.players.find(q=>q.id===p.id);
 return {points:null,subtotal:row?.points??null,components:row?{'Reviewed matchup mean':row.points}:{},minutes:null,playProb:null,match:row?'Exact name / team / opponent / position':'Unmatched reviewed forecast',flags:[row?'Conditional on active / starting. Reviewed forecast; not independently calibrated.':'No reviewed projection matched this player.',row?.flag||'',d.forecast.source+' / '+d.forecast.asOf].filter(Boolean)};
}
function privateDraft(d){
 const clean=validate(d);if(clean.model)clean.model.players=clean.model.players.filter(m=>clean.players.some(p=>p.nhlId===m.nhlId||norm(p.name)===norm(m.name)&&p.team===m.team));
 assert(JSON.stringify(clean).length<=550000,'Workspace exceeds 550 KB; reduce the player pool or historical model');return clean;
}


// Uncalibrated field assumptions, not observed ownership or a predictive simulator.
function ownershipKey(d){
 const s=JSON.stringify([d.platform,d.synthetic,d.slate,d.receipt?.mapping?.id,d.forecast?.asOf,d.forecast?.source,d.model?.asOf,d.model?.version,d.players.map(p=>[p.id,p.nhlId,p.name,p.team,p.opp,p.pos,p.salary,p.platformId,p.salarySource,p.salaryAsOf,p.eligibilitySource,p.eligibilityAsOf,p.kickoff,p.date,p.slateId,p.override,p.status,p.source,p.sourceAt,p.line,p.pp,draftProjection(p,d).subtotal])]);
 let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(16);
}
function defaultOwnershipAssumption(d){
 assert(d.receipt?.publicPackage,'Automatic ownership requires the reviewed public source package');
 const ps=d.players.filter(p=>{const o=p.override||p;return p.selectableByDefault!==false&&!/^(out|scratched|not starting|confirmed_out|confirmed_scratch)$/i.test(o.status||'')&&(!p.pos.includes('G')||/^(confirmed|confirmed_starter|reported_starter)$/i.test(o.status||''));});
 return {version:1,mode:'conditional-participants',origin:'model-default',acknowledged:false,participantIds:ps.map(p=>p.id),goalieIds:ps.filter(p=>p.pos.includes('G')).map(p=>p.id)};
}
function validateOwnershipAssumption(d,a){
 const automatic=a?.origin==='model-default';
 assert(a&&a.version===1&&a.mode==='conditional-participants'&&(automatic?a.acknowledged===false:a.acknowledged===true),'Acknowledge conditional participant assumptions');
 assert(Object.keys(a).every(k=>['version','mode','origin','acknowledged','participantIds','goalieIds'].includes(k))&&(!a.origin||automatic),'Unsupported participant assumption');
 if(automatic)assert(JSON.stringify(a)===JSON.stringify(defaultOwnershipAssumption(d)),'Default model participants no longer match the current source package');
 for(const k of ['participantIds','goalieIds'])assert(Array.isArray(a[k])&&a[k].length>0&&new Set(a[k]).size===a[k].length&&a[k].every(id=>typeof id==='string'&&d.players.some(p=>p.id===id)),'Invalid '+k);
 const goalies=d.players.filter(p=>a.participantIds.includes(p.id)&&p.pos.includes('G'));
 assert(goalies.length===a.goalieIds.length&&goalies.every(p=>a.goalieIds.includes(p.id)),'Explicitly select every assumed starting goalie');
 assert(new Set(goalies.map(p=>p.team)).size===goalies.length,'At most one assumed starting goalie per team');
}
function ownershipGate(d,{confirmedSlate=false,now=Date.now(),assumption=null}={}){
 const issues=[];try{validate({...d,ownershipModel:null});}catch(e){return {ok:false,issues:[e.message],eligible:[]};}
 if(assumption){try{validateOwnershipAssumption(d,assumption);}catch(e){return {ok:false,issues:[e.message],eligible:[]};}}
 if(d.platform!=='dk')issues.push('DraftKings Classic only.');
 if(!confirmedSlate)issues.push('Confirm the exact slate ID/date and complete salaries/DK eligibility against your cited source or platform CSV.');
 if(!d.players.length||!d.receipt?.mapping?.id&&!d.players.every(p=>supportedSlateRow(p,d,now)))issues.push('Load a platform CSV or dated salary/eligibility source evidence for every row.');
 if(!d.slate.id||!/^\d{4}-\d{2}-\d{2}$/.test(d.slate.date)||!d.slate.games.length)issues.push('Apply the exact slate ID, date and games in Slate details.');
 if(Date.parse(d.forecast?.asOf||d.model?.asOf)>now)issues.push('Projection as-of is in the future.');
 const games=[...new Set(d.players.map(p=>[p.team,p.opp].sort().join('@')))].sort();
 if(JSON.stringify(games)!==JSON.stringify([...new Set(d.slate.games.map(matchupKey))].sort()))issues.push('Uploaded games must exactly equal the target slate.');
 const eligible=[],identities=new Set();
 for(let i=0;i<d.players.length;i++){
  const p=d.players[i],o=p.override||p,keys=['name:'+norm(p.name)+'|'+p.team,...(p.nhlId?['nhl:'+p.nhlId]:[])];
  if(keys.some(k=>identities.has(k)))issues.push(p.name+': duplicate player identity.');keys.forEach(k=>identities.add(k));
  if(!d.synthetic&&!(d.receipt?.mapping?.id&&/^\d+$/.test(p.id))&&!supportedSlateRow(p,d,now))issues.push(p.name+': missing platform-ID evidence or dated salary/eligibility source URLs for this exact slate.');
  if(assumption&&!assumption.participantIds.includes(p.id))continue;
  const start=Date.parse(p.kickoff),date=Number.isFinite(start)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start)):null;
  if(date!==d.slate.date||start<=now||p.date&&p.date!==d.slate.date||p.slateId&&p.slateId!==d.slate.id)issues.push(p.name+': missing, locked or mismatched slate/game time.');
  const stamp=Date.parse(o.at||p.sourceAt),status=(o.status||'').trim().toLowerCase();
  if(!o.source||!Number.isFinite(stamp)||stamp>now||now-stamp>6*3600000)issues.push(p.name+': availability needs a named source and timestamp within 6 hours.');
  if(/^(out|scratched|not starting|confirmed_out|confirmed_scratch)$/.test(status))continue;
  if(!assumption&&!(p.pos.includes('G')?status==='confirmed':['active','confirmed'].includes(status)))issues.push(p.name+': mark active, confirmed starter (G), out, scratched or not starting after checking availability.');
  if(!Number.isFinite(draftProjection(p,d).subtotal))issues.push(p.name+': projection missing.');
  eligible.push(i);
 }
 if(eligible.length<9||new Set(eligible.filter(i=>!d.players[i].pos.includes('G')).map(i=>d.players[i].team)).size<3)issues.push('Infeasible pool: need nine available players and at least three skater teams.');
 return {ok:!issues.length,issues:[...new Set(issues)],eligible};
}
function sampleOwnership(d,{confirmedSlate=false,now=Date.now(),seed=216,samples=300,includeLineups=false,assumption=null}={}){
 const gate=ownershipGate(d,{confirmedSlate,now,assumption});assert(gate.ok,gate.issues.join(' / '));
 assert(Number.isInteger(samples)&&samples>=20&&samples<=1000,'Use 20–1000 samples per scenario');assert(Number.isInteger(seed)&&seed>=0&&seed<=4294967295,'Seed must be an unsigned integer');
 let rng=seed>>>0;const random=()=>{let t=rng+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
 const ps=d.players,slots=RULES.dk.slots,pool=gate.eligible,points=ps.map(p=>draftProjection(p,d).subtotal);
 const rank=(i,value)=>{const peers=pool.filter(j=>ps[j].pos.some(p=>ps[i].pos.includes(p)));const x=value(i);return peers.reduce((n,j)=>n+(value(j)<x?1:value(j)===x?.5:0),0)/peers.length;};
 const ranks=ps.map((p,i)=>({points:pool.includes(i)?rank(i,j=>points[j]):0,value:pool.includes(i)?rank(i,j=>points[j]/ps[j].salary):0}));
 const scenarios=[];
 for(const name of ['projection','value','stack']){
  const counts=ps.map(()=>0),lineups=[];let accepted=0,attempts=0;
  while(accepted<samples&&attempts++<samples*12){
   const roster=Array(9).fill(null),used=new Set();let nodes=0;
   const search=(depth,salary)=>{
    if(++nodes>2500)return false;
    if(depth===9)return legality(ps,roster,'dk',d.slate).legal;
    const remaining=slots.map((slot,s)=>({s,ids:roster[s]===null?pool.filter(i=>!used.has(i)&&eligible(ps[i],slot)):[]})).filter(x=>roster[x.s]===null).sort((a,b)=>a.ids.length-b.ids.length||a.s-b.s);
    if(remaining.some(x=>!x.ids.length)||salary+remaining.reduce((n,x)=>n+Math.min(...x.ids.map(i=>ps[i].salary)),0)>RULES.dk.cap)return false;
    const {s,ids}=remaining[0];
    const ordered=ids.map(i=>{const r=ranks[i],role=ps[i].override||ps[i];let w=Math.exp(2*(name==='value'?.25*r.points+.75*r.value:.8*r.points+.2*r.value));
     if(name==='stack'&&!ps[i].pos.includes('G')&&[...used].some(j=>{const b=ps[j],o=b.override||b;return !b.pos.includes('G')&&b.team===ps[i].team&&(role.line&&role.line===o.line||role.pp&&role.pp===o.pp);}))w*=2;
     return {i,key:-Math.log(Math.max(random(),1e-12))/w};}).sort((a,b)=>a.key-b.key||a.i-b.i);
    for(const {i} of ordered){if(nodes>2500)break;if(salary+ps[i].salary>RULES.dk.cap)continue;roster[s]=i;used.add(i);if(search(depth+1,salary+ps[i].salary))return true;used.delete(i);roster[s]=null;}return false;
   };
   if(search(0,0)){accepted++;roster.forEach(i=>counts[i]++);if(includeLineups)lineups.push([...roster]);}
  }
  assert(accepted===samples,'No complete sample: legal lineup search exhausted its bounded budget. Pool may be infeasible; no ownership estimate produced.');
  scenarios.push({name,samples:accepted,attempts,percent:counts.map(c=>100*c/accepted),...(includeLineups?{lineups}:{})});
 }
 return {version:1,kind:'uncalibrated-legal-lineup-heuristic',...(assumption?{assumption:JSON.parse(JSON.stringify(assumption)),assumptionKey:JSON.stringify(assumption),condition:assumption.origin==='model-default'?'Conditional model default: projected participants and source-listed starting goalies; not user-confirmed. Recorded statuses are unchanged.':'Conditional on explicitly selected participants and starting goalies; recorded statuses are unchanged.',confirmationBasis:assumption.origin==='model-default'?'dated-source-evidence':'explicit-review'}:{}),key:ownershipKey(d),asOf:new Date(now).toISOString(),seed,samples,synthetic:!!d.synthetic,confirmedSlate:true,confidence:'low; assumptions unvalidated against contest fields',scenarios,rows:ps.map((p,i)=>({id:p.id,mean:scenarios.reduce((s,x)=>s+x.percent[i],0)/3,low:Math.min(...scenarios.map(x=>x.percent[i])),high:Math.max(...scenarios.map(x=>x.percent[i]))}))};
}
function currentOwnership(d,now=Date.now()){
 const o=d.ownershipModel;if(o?.assumption&&o.assumptionKey!==JSON.stringify(o.assumption))return null;if(!o||o.key!==ownershipKey(d)||Date.parse(o.asOf)>now||now-Date.parse(o.asOf)>6*3600000)return null;
 return ownershipGate(d,{confirmedSlate:o.confirmedSlate,now,assumption:o.assumption||null}).ok?o:null;
}

function projectionRows(d){
 const heuristic=currentOwnership(d);
 return d.players.map(p=>{const v=draftProjection(p,d),b=d.model?match(p,d.model).player?.baseline:null,o=heuristic?.rows.find(r=>r.id===p.id);return {id:p.id,platformId:p.platformId===null?null:(p.platformId||(/^\d+$/.test(p.id)?p.id:null)),salarySource:p.salarySource||null,eligibilitySource:p.eligibilitySource||null,name:p.name,team:p.team,position:p.pos.join('/'),salary:p.salary,projectedPoints:v.subtotal,projectionBasis:d.forecast?'Reviewed conditional matchup mean':'Historical partial-DK mean',projectionAsOf:d.forecast?.asOf||d.model?.asOf||null,ceiling:b&&b.n>=10?b.p90:null,ceilingPercentile:90,ceilingBasis:'Empirical historical partial-DK P90; linear interpolation at (n-1)*0.90; skater appearances / goalie starts; not a calibrated matchup forecast',ceilingN:b?.n??0,ceilingReason:!b?'No matched empirical history':b.n<10?'Fewer than 10 historical samples':'',sourceOwnership:p.own??null,estimatedMean:o?.mean??null,estimatedLow:o?.low??null,estimatedHigh:o?.high??null,ownershipCondition:heuristic?.condition||null,estimatedOwnership:o?.mean??p.own??null,ownershipLow:o?.low??null,ownershipHigh:o?.high??null,ownershipSeed:heuristic?.seed??null,ownershipAsOf:heuristic?.asOf??null,ownershipBasis:o?'Uncalibrated legal-lineup heuristic v1; equal scenario mix; low confidence; range is scenario sensitivity, not a confidence interval':p.own==null?'Unavailable: run gated legal-lineup heuristic or supply an estimate':'User CSV estimate; not independently verified',value:v.subtotal==null?null:v.subtotal/p.salary*1000,flag:v.flags.join(' / ')};});
}
function projectionTableCsv(rows){
 const cols=['id','platformId','salarySource','eligibilitySource','name','team','position','sourcePosition','positionBasis','salary','projectedPoints','projectionBasis','projectionAsOf','ceiling','ceilingPercentile','ceilingBasis','ceilingN','ceilingReason','estimatedOwnership','ownershipLow','ownershipHigh','ownershipSeed','ownershipAsOf','ownershipBasis','value','flag'];
 const cell=v=>'"'+((typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'":'')+String(v??'')).replaceAll('"','""')+'"';return [cols.join(','),...rows.map(r=>cols.map(k=>cell(r[k])).join(','))].join('\r\n');
}
function qualitativePair(a,b){
 if(a.id===b.id)return {symbol:'—',label:'Same player; no coefficient estimated'};
 const ag=a.pos.includes('G'),bg=b.pos.includes('G'),ao=a.override||a,bo=b.override||b;
 if(ag||bg){if(ag&&bg)return {symbol:'?',label:'Goalie pair: no empirical estimate'};if(a.team===b.team)return {symbol:'±',label:'Own goalie / skater: shared win context may help, but scoring and saves have different drivers; qualitative hypothesis'};if(a.team===b.opp)return {symbol:'−',label:'Opposing goalie / skater: goals and saves create opposing scoring interests; qualitative hypothesis'};return {symbol:'?',label:'Different games: no empirical estimate'};}
 if(a.team===b.team&&ao.pp&&ao.pp===bo.pp)return {symbol:'+',label:'Same PP unit: shared power-play goals/assists may co-occur; qualitative hypothesis, role must be current'};
 if(a.team===b.team&&ao.line&&ao.line===bo.line)return {symbol:'+',label:'Same even-strength line: shared ice time and goals/assists may co-occur; qualitative hypothesis, role must be current'};
 return {symbol:'?',label:a.team===b.team?'Other teammates: shared team environment, direction and strength unmeasured':'Opposing/different-team skaters: game environment and deployment matter; unmeasured'};
}

function projectionCsv(model){
 const header=['NHL_ID','Name','CurrentSourceTeam','ModelPosition_NotDKEligibility','Population','SampleN','MeanPartialDKPoints','EmpiricalGameToGameSD','SampleVariancePointsSquared','ScoreSum','ScoreSumSquares','HistoricalMeanMinutes','Recent5MeanMinutes','EmpiricalP10','EmpiricalMedian','EmpiricalP90','Last10MeanPartialDK','Last10N','FirstDate','LastDate','AsOf','ForecastPlayingOrStartingProbability','FullProjectedDKPoints','DKSalary','SlateID','MissingComponents'];
 const components=[...new Set(model.players.flatMap(p=>Object.keys(p.baseline?.components||{})))].sort();header.push(...components.map(k=>'MeanDKComponent_'+k));
 const rows=model.players.filter(p=>p.baseline).map(p=>{const b=p.baseline;return [p.nhlId,p.name,p.team,p.pos,b.kind,b.n,b.mean,b.sd,b.variance,b.sum,b.sumSquares,b.minutes,b.recent5Minutes,b.p10,b.median,b.p90,b.last10.mean,b.last10.n,b.firstDate,b.lastDate,model.asOf,null,null,null,null,b.missing.join('; '),...components.map(k=>b.components[k]??null)];});
 const cell=v=>{if(v==null)return '';const s=String(v);return '"'+s.replace(/"/g,'""')+'"';};return [header,...rows].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
const api={matchupKey,defaultOwnershipAssumption,supportedSlateRow,ownershipKey,ownershipGate,sampleOwnership,currentOwnership,projectionRows,projectionTableCsv,qualitativePair,reviewedJoin,draftProjection,privateDraft,projectionCsv,VERSION,PARAMS,RULES,EVENTS,csv,num,norm,kickoff,locked,checkRosterChange,parsePool,minutes,history,train,match,tail,score,project,eligible,legality,correlations,validate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DDNHL=api;
})(typeof globalThis!=='undefined'?globalThis:this);
