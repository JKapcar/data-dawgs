/* Prospective current-starter forecasts. Never reconstruct predictions after kickoff. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),E=require('../guillotine-engine.js');
const ROOT=path.resolve(__dirname,'..'),LEAGUES=['1400972302392262656','1389344040964599808'],FILE=path.join(ROOT,'data/guillotine-receipts.json');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function capture({feed,league,rosters,games,now}){
 const starts=games.filter(g=>g.season===feed.season&&g.week===feed.week&&g.season_type==='REG').map(g=>Date.parse(g.kickoff_at));
 if(!starts.length||starts.some(x=>!Number.isFinite(x)))throw Error('No reliable weekly kickoff gate');
 const first=Math.min(...starts);if(now>=first||now<first-86400000)return null;
 if(!Number.isFinite(Date.parse(feed.fetched_at))||now-Date.parse(feed.fetched_at)>48*3600000)throw Error('Stale feed cannot become a receipt');
 const active=rosters.filter(r=>feed.week===1||(r.players||[]).length);if(active.length<2)return null;
 const players=E.makePlayers(feed,league,now),b=E.board(active,players,league,{week:feed.week,n:10000,rho:E.calibrationFor(feed,league).same_team_rho,seed:league.league_id+':'+feed.season+':'+feed.week});
 return {receipt_id:league.league_id+':'+feed.season+':'+feed.week,league_id:league.league_id,season:feed.season,week:feed.week,captured_at:new Date(now).toISOString(),kickoff_at:new Date(first).toISOString(),last_kickoff_at:new Date(Math.max(...starts)).toISOString(),model_version:E.VERSION,feed_sha256:digest(feed),lineup_sha256:digest(active.map(r=>[r.roster_id,r.starters])),n:b.n,status:'pending',chop_line:b.chop,rows:b.rows.map(x=>{const r=active.find(r=>r.roster_id===x.rid);return {...x,draft_position:r.settings?.draft_position??null,prior_season_points:(r.settings?.fpts??0)+(r.settings?.fpts_decimal??0)/100};})};
}
function grade(receipt,matchups,state,now){
 if(receipt.status==='graded'||Number(state.season)<receipt.season||Number(state.season)===receipt.season&&Number(state.display_week)<=receipt.week||now<Date.parse(receipt.last_kickoff_at)+12*3600000)return receipt;
 const actual=receipt.rows.map(r=>{const m=matchups.find(x=>x.roster_id===r.rid);return {...r,points:m?.points};});
 if(actual.some(r=>!Number.isFinite(r.points)))return receipt;
 const low=Math.min(...actual.map(r=>Math.round(r.points*100))),indexes=actual.map((r,i)=>Math.round(r.points*100)===low?i:null).filter(i=>i!==null);
 const rs=actual.map(r=>({settings:{draft_position:r.draft_position,fpts:r.prior_season_points}})),loser=E.tieLoser(rs,indexes,receipt.week);
 if(loser==null)return {...receipt,status:'waiting-tiebreak'};
 return {...receipt,status:'graded',graded_at:new Date(now).toISOString(),chopped_rid:actual[loser].rid,actual_scores:actual.map(r=>({rid:r.rid,points:r.points})),brier:actual.reduce((s,r,i)=>s+(r.risk-(i===loser?1:0))**2,0)};
}
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Sleeper '+r.status);return r.json();}
async function main(){const now=Date.now(),feed=JSON.parse(fs.readFileSync(path.join(ROOT,'data/guillotine-weekly.json'))).data,games=JSON.parse(fs.readFileSync(path.join(ROOT,'data/nfl-schedule.json'))).data.games;
 feed.calibrations=JSON.parse(fs.readFileSync(path.join(ROOT,'data/guillotine-calibration.json'))).data.league_calibrations||feed.calibrations;
 const state=await get('https://api.sleeper.app/v1/state/nfl');
 if(Number(state.season)!==feed.season||Number(state.display_week)!==feed.week)throw Error('Season/week mismatch; no receipt written');
 let rows=fs.existsSync(FILE)?JSON.parse(fs.readFileSync(FILE)).data:[];
 for(const id of LEAGUES){
 const [league,rosters]=await Promise.all([get('https://api.sleeper.app/v1/league/'+id),get('https://api.sleeper.app/v1/league/'+id+'/rosters')]);
 if(Number(league.season)!==feed.season)continue;
 for(let i=0;i<rows.length;i++)if(rows[i].league_id===id&&rows[i].status!=='graded'&&rows[i].week<Number(state.display_week))rows[i]=grade(rows[i],await get('https://api.sleeper.app/v1/league/'+id+'/matchups/'+rows[i].week),state,now);
 if(!rows.some(r=>r.league_id===id&&r.season===feed.season&&r.week===feed.week)){const row=capture({feed,league,rosters,games,now});if(row)rows.push(row);}
 }
 fs.writeFileSync(FILE,JSON.stringify({tier:'labs',tier_meaning:"Pup \u2014 live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.",graded:false,as_of:new Date(now).toISOString().slice(0,10),source:'Sleeper league current starters and completed matchup points; Data Dawgs weekly player simulation',note:'Prospective pregame forecasts. Roster IDs only; no ownership identities or player rosters. Multiclass Brier is the sum of squared chop-probability errors; lower is better. Repeated full ties await resolution.',canonical_url:'https://datadawgs216.com/data/guillotine-receipts.json',data:rows},null,2)+'\n');
 console.log('Guillotine ledger:',rows.length,'forecasts;',rows.filter(x=>x.status==='graded').length,'graded');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={capture,grade};
