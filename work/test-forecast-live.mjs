/* Full assembled runtime, isolated Firebase/KV and clock. Never writes production. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {BOZO_ESPN_TEAM_SEED} from '../bozo-team-registry.mjs';
const read=n=>JSON.parse(fs.readFileSync(new URL('../data/'+n+'.json',import.meta.url)));
const schedule=read('nfl-schedule'),nfelo=read('nfelo'),classic=read('538-classic');
const game=schedule.data.games[0],gid=game.game_id,kick=Date.parse(game.kickoff_at);
let clock=kick-3600e3,db={},kv=new Map(),failSource=false;
nfelo.data.meta.captured_at=new Date(clock-1000).toISOString();
const toto={as_of:'2026-09-09',source:'fixture',data:{entrant:'Toto',model_version:'test-only',forecasts:[{
  game_id:gid,home_team:game.home_team,away_team:game.away_team,home_win_probability:.64,
  captured_at:new Date(clock-1000).toISOString(),input_snapshot_id:'fixture-sha',rationale:'TEST ONLY'}]}};
const parts=p=>p.split('/').filter(Boolean),get=p=>parts(p).reduce((x,k)=>x?.[k],db)??null;
function put(p,v){let a=parts(p),o=db;for(const k of a.slice(0,-1))o=o[k]??={};o[a.at(-1)]=structuredClone(v);}
const env={FB_SECRET:'TEST',BOZO_PEPPER:'TEST',BOZO_ADMIN:'Kap',RL:{
  get:async(k,type)=>kv.has(k)?type==='json'?JSON.parse(kv.get(k)):kv.get(k):null,
  put:async(k,v)=>kv.set(k,v)}};
const sources={'/data/nfl-schedule.json':schedule,'/data/nfelo.json':nfelo,'/data/538-classic.json':classic,'/data/forecast-toto.json':toto};
async function fakeFetch(input,init={}){
  const u=new URL(typeof input==='string'?input:input.url);
  if(u.hostname==='datadawgs216.com')return new Response(JSON.stringify(sources[u.pathname]),{status:failSource?503:sources[u.pathname]?200:404});
  if(!/firebaseio|firebasedatabase/.test(u.hostname))throw new Error('Unexpected network request '+u.hostname);
  const p=decodeURIComponent(u.pathname.replace(/\.json$/,'')),current=get(p),etag=JSON.stringify(JSON.stringify(current));
  if(!init.method||init.method==='GET')return new Response(JSON.stringify(current),{headers:{ETag:etag}});
  if(init.method==='PUT'){
    const match=new Headers(init.headers).get('if-match');
    if(match&&match!==etag)return new Response('{}',{status:412});
    put(p,JSON.parse(init.body));return new Response('{}');
  }
  throw new Error('Unexpected method '+init.method);
}
class Clock extends Date {constructor(...a){super(...(a.length?a:[clock]));} static now(){return clock;}}
const ctx=vm.createContext({crypto:webcrypto,fetch:fakeFetch,Date:Clock,Response,Request,URL,Headers,TextEncoder,TextDecoder,
  console,atob,btoa,setTimeout,clearTimeout,structuredClone,BOZO_ESPN_TEAM_SEED});
vm.runInContext(fs.readFileSync(new URL('../dawg-bot-worker.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace('export default {','const worker = {')+
  '\nglobalThis.api={runForecastLive,forecastLiveRoute,fclGrade,fclRatings,fclCandidates,fclBoards,bozoScheduleKey};',ctx);
const a=ctx.api,root='/forecast/live/nfl/2026';
const board=async path=>{
  const req=new Request('https://toto.jkapcar4.workers.dev'+path);
  const res=await a.forecastLiveRoute(req,new URL(req.url),env,{});assert.equal(res.status,200);return (await res.json()).data;
};
const human=(name,p,touched=true,kind='human')=>({...game,sport:'nfl',entrant:name,entrant_kind:kind,owner:'Kap',touched,
  home_win_probability:p,submitted_at:clock-500,slider_value:p*100,slider_side:'home',idempotency_key:'PRIVATE-ID'});
for(const [name,p,touched,kind] of [['Kap',.62,true,'human'],['Jeff',.7,true,'human'],['Sam',.6,true,'human'],['Lurker',.5,false,'human'],['Bot One',.9,true,'agent']])
  put('/forecast/entries/nfl/2026/1/'+name+'/'+gid,human(name,p,touched,kind));
put('/forecast/bots/EmptyBot',{bot_name:'EmptyBot',owner:'Kap',token_hash:'PRIVATE-TOKEN'});
await a.runForecastLive(env);
assert.equal(Object.keys(get(root+'/models/'+gid)).length,5,'five model/AI receipts captured');
assert.equal(get(root+'/models/'+gid+'/nfelo').home_win_probability,nfelo.data.games.find(g=>g.id===gid).hwp);
const original=JSON.stringify(get(root+'/models/'+gid));
await a.runForecastLive(env);assert.equal(JSON.stringify(get(root+'/models/'+gid)),original,'repeat capture is idempotent');
let b=await board('/forecast/board');
assert.equal(b.games.find(g=>g.game_id===gid).forecasts.length,0,'humans hidden before kickoff');
assert(!JSON.stringify(b).includes('PRIVATE-'),'no tokens or idempotency identifiers');
assert(b.entrants.some(e=>e.name==='EmptyBot'&&e.submitted===0),'registered-only bot visible');
assert.equal(b.entrants.find(e=>e.name==='Kap').next_game_submitted,true,'readiness is an actual next-game receipt');
assert.equal(b.entrants.find(e=>e.name==='EmptyBot').next_game_submitted,false);
assert.equal(b.entrants.find(e=>e.name==='Toto').next_game_submitted,true);
const packet=await board('/forecast/packet');
assert(!JSON.stringify(packet).includes('PRIVATE-'));assert(packet.input_snapshot_id);
assert(!packet.games.some(g=>g.forecasts.length),'input packet cannot see unlocked human picks');
const ratings=a.fclRatings(classic,schedule.data.games);
const stale=structuredClone(nfelo);stale.data.meta.captured_at=new Date(clock-40*3600e3).toISOString();
assert.equal(a.fclCandidates(game,stale,ratings,clock,'test').length,1,'stale nfelo omitted, no archived fallback');
assert.equal(a.fclCandidates(game,nfelo,ratings,kick,'test').length,0,'no candidate at kickoff');
clock=kick+1000;await a.runForecastLive(env);
let lock=get(root+'/locks/'+gid);assert.equal(lock.forecasts.length,10,'five model/AI + four touched entrants + crowd');
assert.equal(lock.forecasts.find(e=>e.model_id==='dd-crowd-nfl').n_touched,3,'bots/untouched excluded from crowd');
assert(!lock.forecasts.some(e=>e.entrant==='Lurker'));
const hash=lock.forecasts_sha256;
put('/forecast/entries/nfl/2026/1/Kap/'+gid,human('Kap',.01));
nfelo.data.games.find(g=>g.id===gid).hwp=.01;toto.data.forecasts[0].home_win_probability=.01;
await a.runForecastLive(env);assert.equal(get(root+'/locks/'+gid).forecasts_sha256,hash,'late updates cannot rewrite locked receipt');
clock=kick+4*3600e3;
kv.set(a.bozoScheduleKey('nfl',2026),JSON.stringify({fetchedAt:new Date(clock).toISOString(),source:'fixture final source',games:[{
  week:game.week,seasonType:'REG',home:{abbr:game.home_team},away:{abbr:game.away_team},startsAt:game.kickoff_at,completed:true,homeScore:24,awayScore:17}]}));
await a.runForecastLive(env);b=await board('/forecast/board');
assert.equal(b.grades.length,10,'first completed game grades before remainder of week');
const kap=b.grades.find(e=>e.entrant==='Kap');assert.equal(kap.points,10.56);assert.equal(kap.brier,.1444);assert.equal(kap.outcome_source,'fixture final source');
assert.equal(b.boards.common_sample.n_games,1);assert.equal(b.boards.totals.find(e=>e.name==='EmptyBot').n,0);
assert(!JSON.stringify(b).includes('PRIVATE-'));
const outcome=JSON.stringify(get(root+'/outcomes/'+gid));await a.runForecastLive(env);assert.equal(JSON.stringify(get(root+'/outcomes/'+gid)),outcome,'outcome receipt immutable');
const doc=JSON.parse(kv.get(a.bozoScheduleKey('nfl',2026)));doc.games[0].homeScore=25;kv.set(a.bozoScheduleKey('nfl',2026),JSON.stringify(doc));
await a.runForecastLive(env);assert.equal(get(root+'/outcomes/'+gid).home_score,24);assert.equal(get(root+'/health').correction_conflicts[0],gid,'correction flagged not silently regraded');
const ties=a.fclGrade(lock,{...game,status:'final',home_score:17,away_score:17});assert(ties.every(r=>r.outcome==='void'&&r.points===null));
const extremes=a.fclGrade({forecasts:[{home_win_probability:0},{home_win_probability:1}]},{...game,status:'final',home_score:24,away_score:17});
assert.equal(extremes[0].points,-75);assert.equal(extremes[1].points,25);assert(extremes.every(r=>Number.isFinite(r.log_loss)));
failSource=true;await assert.rejects(a.runForecastLive(env));assert.equal(get('/forecast/live/lease').until,0,'failed run releases lease');
console.log('PASS: live capture, freshness, Toto isolation, privacy, kickoff locks, crowd, per-game grades, boards, ties, extremes, correction alerts, idempotency and failed-run recovery.');
