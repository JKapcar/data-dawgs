importScripts('/guillotine-engine.js');
let state=null;
onmessage=async function(e){const {id,op,payload}=e.data;try{
 if(op==='load'){
  const {feed,league,rosters,excluded}=payload,players=GXEngine.makePlayers(feed,league,payload.now),B=GXEngine.board(rosters,players,league,{excluded,n:3000,week:feed.week,rho:feed.calibration.same_team_rho,seed:league.league_id+':'+feed.season+':'+feed.week});state={...payload,players,B};
  postMessage({id,result:{rows:B.rows,chop:B.chop,lo:B.lo,hi:B.hi,n:B.n,players,active:B.active.map(r=>r.roster_id)}});
 }else if(op==='focus'){
  if(!state)throw Error('Load the league first');const {players,B,league,rosters}=state,r=rosters.find(r=>String(r.roster_id)===String(payload.rid));if(!r)throw Error('Choose a team');
  const optimized=GXEngine.optimize(r,players,league,B),current=GXEngine.evaluate(r.starters,B,r.roster_id),plan=GXEngine.waiver(r,rosters,players,league,B,state.transactions,payload.capFraction);
  postMessage({id,result:{optimized,current,plan}});
 }else throw Error('Unknown calculation');
}catch(err){postMessage({id,error:err.message});}};
