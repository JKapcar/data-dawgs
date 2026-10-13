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
const ALIASES={id:['id','playerid','dkid','fdid'],nhlId:['nhlid','nhlplayerid'],name:['name','player','playername','nickname'],pos:['position','pos','rosterposition','dkpos','fdpos'],team:['team','teamabbrev','teamabbreviation'],opp:['opp','opponent'],salary:['salary','dksalary','fdsalary'],game:['gameinfo','game','matchup'],slateId:['slateid','draftgroupid'],date:['date','slatedate','gamedate'],own:['ownership','own','projectedownership'],minutes:['minutes','toi','projectedminutes'],playProb:['playprob','playingprobability','startprob'],line:['line','evenstrengthline'],pp:['pp','ppline'],status:['status','goalieStatus'],sourceAt:['sourceat','asof'],source:['source'],kickoff:['kickoff','starttime','gamestart','gametime']};
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
 ids.add(id);players.push({kickoff:kickoff(get('kickoff')||get('game')),id,nhlId:get('nhlId')||null,name,pos,team,opp,salary,own,slateId:get('slateId'),date:get('date'),minutes:num(get('minutes')),playProb:num(get('playProb')),line:get('line'),pp:get('pp'),status:get('status')||'unknown',sourceAt:get('sourceAt')||null,source:get('source'),platform,override:null});
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
function legality(players,roster,platform,slate={}){
 const r=RULES[platform],issues=[];assert(r,'Unknown platform');const picked=roster.filter(x=>x!==null).map(i=>players[i]);if(roster.length!==r.slots.length||picked.length!==r.slots.length)issues.push('Fill all nine roster slots');
 if(new Set(roster.filter(x=>x!==null)).size!==picked.length)issues.push('Duplicate player');roster.forEach((i,s)=>{if(i!==null&&(!players[i]||!eligible(players[i],r.slots[s])))issues.push('Ineligible '+r.slots[s]+' slot');});
 const valid=picked.filter(Boolean),salary=valid.reduce((s,p)=>s+p.salary,0),teams={};valid.forEach(p=>teams[p.team]=(teams[p.team]||0)+1);if(salary>r.cap)issues.push('Salary cap exceeded');if(r.maxTeam&&Object.values(teams).some(n=>n>r.maxTeam))issues.push('Too many players from one team');if(r.minSkaterTeams&&new Set(valid.filter(p=>!p.pos.includes('G')).map(p=>p.team)).size<r.minSkaterTeams)issues.push('Need skaters from at least '+r.minSkaterTeams+' NHL teams');if(r.minTeams&&Object.keys(teams).length<r.minTeams)issues.push('Need at least '+r.minTeams+' teams');
 const slateIssues=[];if(!slate.id||!slate.date||!Array.isArray(slate.games)||!slate.games.length)slateIssues.push('Exact slate ID, date and game list required');
 for(const p of valid){if(p.platform!==platform)slateIssues.push(p.name+': platform differs');if(!p.slateId||p.slateId!==slate.id)slateIssues.push(p.name+': slate ID missing/mismatch');if(!p.date||p.date!==slate.date)slateIssues.push(p.name+': slate date missing/mismatch');if(!p.opp||!(slate.games||[]).includes([p.team,p.opp].sort().join('@')))slateIssues.push(p.name+': game not verified in exact slate');}
 return {legal:issues.length===0,providerVerified:r.verified,issues,slateIssues:[...new Set(slateIssues)],salary,remaining:r.cap-salary,ready:false};
}
function correlations(players,roster){const ps=roster.filter(i=>i!==null).map(i=>players[i]).filter(Boolean),notes=[];for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const a=ps[i],b=ps[j],ao=a.override||a,bo=b.override||b;if(a.team===b.team&&!a.pos.includes('G')&&!b.pos.includes('G')){if(ao.line&&ao.line===bo.line)notes.push(a.name+' + '+b.name+': same even-strength line');if(ao.pp&&ao.pp===bo.pp)notes.push(a.name+' + '+b.name+': same power-play unit');}if((a.pos.includes('G')&&a.opp===b.team)||(b.pos.includes('G')&&b.opp===a.team))notes.push(a.name+' + '+b.name+': goalie versus opposing skater');}return [...new Set(notes)];}
function validate(value){
 assert(value&&value.version===1,'Expected NHL draft version 1');assert(JSON.stringify(value).length<=500000,'NHL draft exceeds 500 KB');
 const allowed=['version','platform','players','roster','slate','model','receipt','synthetic'];assert(Object.keys(value).every(k=>allowed.includes(k)),'Unsupported NHL draft field');assert(RULES[value.platform],'Unknown platform');assert(Array.isArray(value.players)&&value.players.length<=600,'Invalid player pool');
 const ids=new Set();for(const p of value.players){assert(p&&typeof p.id==='string'&&p.id.length<=160&&!ids.has(p.id),'Invalid / duplicate player ID');ids.add(p.id);assert(typeof p.name==='string'&&p.name.length<=160&&typeof p.team==='string'&&typeof p.opp==='string','Invalid identity');assert(Array.isArray(p.pos)&&p.pos.length>0&&p.pos.every(x=>['C','W','D','G'].includes(x))&&!(p.pos.includes('G')&&p.pos.length>1),'Invalid position');assert(p.platform===value.platform,'Mixed platform pool');assert(Number.isInteger(p.salary)&&p.salary>0&&p.salary<=RULES[value.platform].cap,'Invalid salary');assert(p.own===null||Number.isFinite(p.own)&&p.own>=0&&p.own<=100,'Invalid ownership');
 assert(p.kickoff==null||typeof p.kickoff==='string'&&Number.isFinite(Date.parse(p.kickoff)),'Invalid game start');
 for(const k of ['minutes','playProb'])assert(p[k]==null||Number.isFinite(p[k])&&p[k]>=0&&p[k]<=(k==='minutes'?100:1),'Invalid '+k);
 if(p.override){assert(typeof p.override.at==='string'&&Number.isFinite(Date.parse(p.override.at)),'Override timestamp required');for(const [k,v] of Object.entries(p.override)){if(['minutes','playProb','winProb','shutoutProb','otLossProb','shPoints','ppPoints','shootoutGoals'].includes(k))assert(v===null||Number.isFinite(v)&&v>=0&&v<=(k.includes('Prob')?1:100),'Invalid override '+k);else assert(['at','source','line','pp','status'].includes(k)&&typeof v==='string'&&v.length<=200,'Invalid role override');}}
 }
 assert(Array.isArray(value.roster)&&value.roster.length===9,'Nine roster slots required');const used=new Set();value.roster.forEach((i,s)=>{if(i===null)return;assert(Number.isInteger(i)&&value.players[i]&&!used.has(i)&&eligible(value.players[i],RULES[value.platform].slots[s]),'Duplicate / ineligible roster slot');used.add(i);});
 assert(value.slate&&typeof value.slate.id==='string'&&typeof value.slate.date==='string'&&Array.isArray(value.slate.games)&&value.slate.games.every(g=>typeof g==='string'),'Invalid slate');
 if(value.model){assert(value.model.version===VERSION&&Number.isFinite(Date.parse(value.model.asOf))&&Array.isArray(value.model.players)&&value.model.players.length<=2000,'Invalid model');for(const p of value.model.players){assert(typeof p.nhlId==='string'&&['F','D','G'].includes(p.pos)&&typeof p.name==='string'&&typeof p.team==='string'&&Number.isFinite(p.minutes)&&p.minutes>0&&p.minutes<=100&&Number.isInteger(p.games)&&p.games>0,'Invalid model player');assert(p.rates&&Object.values(p.rates).every(n=>Number.isFinite(n)&&n>=0&&n<=10),'Invalid model rates');assert(p.lastGame<value.model.asOf.slice(0,10),'Model contains as-of/future game');}}
 // Reject prototype-bearing JSON keys at any depth; preserve explicit nulls through storage.
 const scan=(v,d=0)=>{assert(d<20,'NHL state too deeply nested');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){assert(!['__proto__','prototype','constructor'].includes(k),'Unsafe state key');scan(x,d+1);}};scan(value);return JSON.parse(JSON.stringify(value));
}
const api={VERSION,PARAMS,RULES,EVENTS,csv,num,norm,kickoff,locked,checkRosterChange,parsePool,minutes,history,train,match,tail,score,project,eligible,legality,correlations,validate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DDNHL=api;
})(typeof globalThis!=='undefined'?globalThis:this);
