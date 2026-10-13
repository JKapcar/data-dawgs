'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),N=require('../dfs-nhl.js');
const quantile=(a,p)=>{if(!a.length)return null;const s=[...a].sort((a,b)=>a-b),i=(s.length-1)*p,l=Math.floor(i);return s[l]+(s[Math.ceil(i)]-s[l])*(i-l);};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
function stats(values){const m=mean(values);return {n:values.length,sum:values.reduce((s,x)=>s+x,0),sumSquares:values.reduce((s,x)=>s+x*x,0),mean:m,variance:values.length>1?values.reduce((s,x)=>s+(x-m)**2,0)/(values.length-1):null,sd:values.length>1?Math.sqrt(values.reduce((s,x)=>s+(x-m)**2,0)/(values.length-1)):null};}
function objects(text){const [heads,...rows]=N.csv(text);return rows.map(r=>Object.fromEntries(heads.map((h,i)=>[h,r[i]??''])));}
function summarize(rows){
 const scores=stats(rows.map(r=>r.score)),components={},events={},coverage={};
 for(const key of new Set(rows.flatMap(r=>Object.keys(r.components)))){const observed=rows.filter(r=>Number.isFinite(r.components[key]));components[key]=observed.reduce((s,r)=>s+r.components[key],0)/rows.length;coverage[key]={observed:observed.length,total:rows.length};}
 for(const key of new Set(rows.flatMap(r=>Object.keys(r.events)))){const observed=rows.filter(r=>Number.isFinite(r.events[key]));events[key]=observed.length===rows.length?mean(observed.map(r=>r.events[key])):null;}
 return {...scores,p10:quantile(rows.map(r=>r.score),.1),median:quantile(rows.map(r=>r.score),.5),p90:quantile(rows.map(r=>r.score),.9),recent5Minutes:mean(rows.slice(-5).map(r=>r.minutes)),minutes:mean(rows.map(r=>r.minutes)),components,events,componentCoverage:coverage,missing:[...new Set(rows.flatMap(r=>r.missing))],firstDate:rows[0]?.date,lastDate:rows.at(-1)?.date,last10:stats(rows.slice(-10).map(r=>r.score)),seasons:Object.fromEntries([...new Set(rows.map(r=>r.season))].map(y=>[y,stats(rows.filter(r=>r.season===y).map(r=>r.score))]))};
}
function load(directory,asOf){
 const rows=[],receipts=[];let goalieDisagreements=0,unresolvedShutouts=0;
 for(const season of [2025,2026,2027]){
  const read=(prefix,tag)=>{const file=path.join(directory,prefix+'_'+season+'.csv'),text=fs.readFileSync(file,'utf8');receipts.push({file:path.basename(file),url:'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/'+tag+'/'+path.basename(file),sha256:crypto.createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)});const rr=objects(text);if(rr.some(r=>r.season!==String(season-1)+season||r.game_id.slice(0,4)!==String(season-1)))throw Error('Season mismatch: '+file);return {text,rows:rr};};
  const box=read('player_box','nhl_player_boxscores'),goalies=read('goalie_box','nhl_goalie_boxscores'),team=read('team_box','nhl_team_boxscores'),games=read('game_info','nhl_game_info');
  const h=N.history(box.text,asOf,'02'),raw=new Map(box.rows.map(r=>[r.game_id+':'+r.player_id,r])),gs=new Map(goalies.rows.map(r=>[r.game_id+':'+r.player_id,r])),ts=new Map(team.rows.map(r=>[r.game_id+':'+r.team_abbrev,r])),gi=new Map(games.rows.map(r=>[r.game_id,r])),active=new Map();
  for(const r of h.rows.filter(r=>r.pos==='G')){const k=r.gameId+':'+r.team;active.set(k,(active.get(k)||0)+1);}
  const invalidDetails={zeroOrInvalidMinutes:0,goalieArithmetic:0,other:0};const acceptedKeys=new Set(h.rows.map(r=>r.gameId+':'+r.id));for(const o of box.rows.filter(r=>r.game_id.slice(4,6)==='02'&&r.game_date<asOf.slice(0,10))){if(acceptedKeys.has(o.game_id+':'+o.player_id))continue;const m=N.minutes(o.toi);if(m===null||m<=0)invalidDetails.zeroOrInvalidMinutes++;else if(o.saves!==''&&Math.abs(N.num(o.saves)+N.num(o.goals_against)-N.num(o.shots_against))>.01)invalidDetails.goalieArithmetic++;else invalidDetails.other++;}
  const seasonReceipt={season,...h.receipt,invalidDetails,acceptedGames:new Set(h.rows.map(r=>r.gameId)).size,completedRegularGames:games.rows.filter(r=>r.game_id.slice(4,6)==='02'&&r.game_date<asOf.slice(0,10)&&['OFF','FINAL'].includes(r.game_state)).length,skaterAppearances:0,goalieStarts:0,goalieRelief:0,unresolvedShutouts:0};
  for(const r of h.rows){const o=raw.get(r.gameId+':'+r.id),game=gi.get(r.gameId);if(!game||game.game_date!==r.date||!['OFF','FINAL'].includes(game.game_state))throw Error('Missing completed game evidence '+r.gameId);
   let events,kind;if(r.pos==='G'){
    const g=gs.get(r.gameId+':'+r.id);if(!g||g.team_abbrev!==r.team||g.toi!==o.toi||['saves','goals_against','shots_against','decision','starter'].some(k=>String(g[k]).toLowerCase()!==String(o[k]).toLowerCase())){goalieDisagreements++;continue;}
    if(!['W','L','O',''].includes(g.decision))throw Error('Unknown goalie decision');
    const t=ts.get(r.gameId+':'+r.team);let shutouts=null;
    if(r.ga>0||active.get(r.gameId+':'+r.team)>1)shutouts=0;
    else if(t&&N.num(t.goals_against)===0)shutouts=1;
    if(shutouts===null){unresolvedShutouts++;seasonReceipt.unresolvedShutouts++;}
    events={saves:r.saves,ga:r.ga,wins:g.decision==='W'?1:0,otLoss:g.decision==='O'?1:0,shutouts};
    for(const [event,col] of Object.entries({goals:'goals',assists:'assists',sog:'shots_on_goal',blocks:'blocked_shots'}))events[event]=N.num(o[col]);
    kind=r.starter?'goalie_start':'goalie_relief';seasonReceipt[r.starter?'goalieStarts':'goalieRelief']++;
   }else{events={goals:r.goals,assists:r.assists,sog:r.sog,blocks:r.blocks,shPoints:null,shootoutGoals:null};kind='skater_appearance';seasonReceipt.skaterAppearances++;}
   const score=N.score(events,'dk',r.pos==='G',false);rows.push({...r,season,kind,events,components:score.components,missing:score.missing,score:score.subtotal});
  }receipts.push(seasonReceipt);
 }rows.sort((a,b)=>a.date.localeCompare(b.date)||a.gameId.localeCompare(b.gameId));return {rows,receipts,goalieDisagreements,unresolvedShutouts};
}
function evaluate(rows){
 const history=new Map(),metrics={};let pending=[],day=null;
 const flush=()=>{for(const r of pending){const k=r.id+':'+r.kind;if(!history.has(k))history.set(k,[]);history.get(k).push(r);}pending=[];};
 for(const r of rows){if(r.kind==='goalie_relief')continue;if(r.date!==day){flush();day=r.date;}const previous=history.get(r.id+':'+r.kind)||[];
  if(previous.length>=10&&r.season>=2026){const y=previous.map(x=>x.score),m=mean(y),last10=mean(y.slice(-10)),last20=mean(y.slice(-20)),weights=y.map((_,i)=>Math.pow(.5,(y.length-1-i)/20)),ew=y.reduce((s,x,i)=>s+x*weights[i],0)/weights.reduce((a,b)=>a+b,0),ratio=Math.max(.85,Math.min(1.15,mean(previous.slice(-5).map(x=>x.minutes))/mean(previous.map(x=>x.minutes))));
   const lastSeason=previous.filter(x=>x.season===r.season-1);const predictions={player_mean:m,previous_season_or_player_mean:lastSeason.length?mean(lastSeason.map(x=>x.score)):m,last10,last20,ewma20:ew,minutes_adjusted_mean:m*ratio};
   for(const [method,pred] of Object.entries(predictions)){const key=r.season+':'+r.kind+':'+method,v=metrics[key]||(metrics[key]={n:0,abs:0,sq:0,bias:0,covered80:0,width80:0});v.n++;v.abs+=Math.abs(pred-r.score);v.sq+=(pred-r.score)**2;v.bias+=pred-r.score;const lo=quantile(y,.1),hi=quantile(y,.9);v.covered80+=r.score>=lo&&r.score<=hi?1:0;v.width80+=hi-lo;}
  }pending.push(r);
 }
 return {design:'Walk-forward by date; all same-day games withheld together. At least 10 prior appearances/starts. 2026 development comparison; 2027 descriptive holdout. Fixed alternatives, no parameter fitting. Scores are observed-component DK subtotals, not complete fantasy points. Actual future minutes and status are never features.',metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,{n:v.n,mae:v.abs/v.n,rmse:Math.sqrt(v.sq/v.n),bias:v.bias/v.n,empiricalPriorP10P90Coverage:v.covered80/v.n,empiricalPriorP10P90MeanWidth:v.width80/v.n}]))};
}
function build(directory,base,asOf){const data=load(directory,asOf),groups=new Map();for(const r of data.rows){const k=r.id+':'+r.kind;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const model=structuredClone(base);model.asOf=asOf;model.snapshotId='nhl-player-history-2025-2027-'+asOf.slice(0,10);model.baselineVersion='player-history/1';model.params={method:'player_mean',seasons:[2025,2026,2027],positionShrinkageMinutes:0,minGamesWarning:3};model.source='SportsDataverse 2025-2027 regular-season player/goalie/team/game data; player-specific empirical DK baseline';
 model.historicalReceipt={sources:data.receipts,goalieDisagreements:data.goalieDisagreements,unresolvedShutouts:data.unresolvedShutouts,acceptedAppearances:data.rows.length,parameters:{positionShrinkageMinutes:0,forecast:'player_mean',variance:'unbiased sample variance (n-1)',goalies:'starts only, including pulled starts; relief separate',missing:'Known-component historical subtotals; missing components are never described as observed zero'}};
 model.players=model.players.map(p=>{const kind=p.pos==='G'?'goalie_start':'skater_appearance',rr=groups.get(p.nhlId+':'+kind)||[],baseline=summarize(rr);const rates=Object.fromEntries(Object.entries(baseline.events).filter(([,v])=>Number.isFinite(v)).map(([k,v])=>[k,v/baseline.minutes]));return {...p,rates,games:rr.length,minutes:baseline.minutes||p.minutes,baseline:{...baseline,kind,method:'player_mean',conditional:true},relief:p.pos==='G'?summarize(groups.get(p.nhlId+':goalie_relief')||[]):undefined};});
 model.attribution={...model.attribution,changes:'Player-specific multi-season empirical DK known-component means, sample variance and actual threshold bonuses; goalie starts separated from relief. No position-mean shrinkage. No raw rows republished.',sources:data.receipts.filter(r=>r.url).map(r=>r.url)};
 return {model,backtest:evaluate(data.rows)};
}
module.exports={stats,quantile,summarize,load,evaluate,build};
if(require.main===module){const [directory,baseFile,asOf,out]=process.argv.slice(2);if(!out)throw Error('Usage: node tools/nhl-player-history.cjs local-source-directory base-model.js ISO-as-of output-prefix');const result=build(directory,require(path.resolve(baseFile)),asOf);fs.writeFileSync(out+'-model.json',JSON.stringify(result.model));fs.writeFileSync(out+'-backtest.json',JSON.stringify(result.backtest,null,2));console.log(JSON.stringify({players:result.model.players.length,receipt:result.model.historicalReceipt,metrics:result.backtest.metrics},null,2));}
