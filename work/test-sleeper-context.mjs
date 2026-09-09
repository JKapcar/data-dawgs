// Execute the assembled Worker and browser adapter against identical synthetic
// provider responses. No production account, cookie, or league content is stored.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {BOZO_ESPN_TEAM_SEED} from '../bozo-team-registry.mjs';
const source=fs.readFileSync(new URL('../dawg-bot-worker.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../fantasy-warroom.html',import.meta.url),'utf8');
const A='100000000000000001',B='100000000000000002';
const defaultSource=JSON.parse(fs.readFileSync(new URL('../data/datadawg-default.json',import.meta.url),'utf8'));
const kv=new Map(),calls=[];let week=1,rosterVersion=0,failRosters=false,failWeekly=false,swapIdentity=false;
const env={BOZO_PEPPER:'synthetic-test-pepper',RL:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v),list:async({prefix})=>({list_complete:true,keys:[...kv.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})}};
const dictionary={q:{full_name:'Zero QB',position:'QB',active:true,team:'CLE'},r:{full_name:'Negative RB',position:'RB',active:true,team:'CLE'},w:{full_name:'Missing WR',position:'WR',active:true,team:'CLE'},i:{full_name:'Reserved RB',position:'RB',active:true,injury_status:'IR'},f:{full_name:'Available RB',position:'RB',active:true},b:{full_name:'Other QB',position:'QB',active:true},t:{full_name:'Taxi QB',position:'QB',active:true}};
dictionary.q.full_name=defaultSource.data.players.find(p=>p.pos==='QB').name;
dictionary.r.full_name=defaultSource.data.players.find(p=>p.pos==='RB').name;
const rows=Object.entries(dictionary).map(([player_id,player])=>({player_id,player,stats:player_id==='w'?{}:{rush_yd:player_id==='q'?0:player_id==='r'?-10:100}}));
async function upstream(url){
  url=String(url);calls.push(url);const u=new URL(url);
  if(u.hostname.includes('firebaseio.com')){
    const uid=u.pathname.split('/')[2];return Response.json({state:{leagues:uid==='alice'?[{leagueId:A,focusRosterId:1},{leagueId:B,focusRosterId:null}]:uid==='bob'?[{leagueId:B,focusRosterId:2}]:[]}});
  }
  if(u.pathname==='/v1/state/nfl')return Response.json({season:'2026',week,season_type:'regular'});
  if(u.pathname==='/v1/players/nfl')return Response.json(dictionary);
  if(u.pathname.startsWith('/projections/'))return Response.json(failWeekly&&/2026\/\d/.test(u.pathname)?[]:rows);
  if(u.pathname==='/data/datadawg-default.json')return Response.json(defaultSource);
  const match=u.pathname.match(/^\/v1\/league\/(\d+)(.*)$/);
  if(!match)throw Error('Unexpected fixture URL: '+url);
  const [,id,path]=match;
  if(!path)return Response.json({league_id:swapIdentity?B:id,name:'League '+id,season:'2026',sport:'nfl',settings:{playoff_week_start:3,waiver_budget:100,type:0},scoring_settings:{rush_yd:.1,rec:0},roster_positions:['QB','WRRB_FLEX','BN','IR','TAXI']});
  if(path==='/users')return Response.json([{user_id:'u',display_name:'Manager',metadata:{team_name:'Team '+id,secret:'not returned'}}]);
  if(path==='/rosters'){
    if(failRosters)return Response.json(defaultSource);
    return Response.json([{league_id:id,roster_id:1,owner_id:'u',players:id===A?['q','r','w','i','t',...(rosterVersion?['f']:[])]:['b'],starters:id===A?['q','0']:['b','0'],reserve:id===A?['i']:[],taxi:id===A?['t']:[],settings:{wins:0,losses:0,ties:0,fpts:0,fpts_decimal:0,waiver_budget_used:0}}, {league_id:id,roster_id:2,players:[],starters:['0','0'],settings:{}}]);
  }
  if(path.startsWith('/matchups/'))return Response.json([{roster_id:1,matchup_id:1,points:0,starters:['q'],players:['q']},{roster_id:2,matchup_id:1,points:2,players:[]}]);
  if(path.startsWith('/transactions/'))return Response.json([]);
  throw Error('Unexpected fixture route: '+path);
}
const ctx=vm.createContext({BOZO_ESPN_TEAM_SEED,console,URL,Request,Response,Headers,TextEncoder,TextDecoder,crypto:webcrypto,fetch:upstream,structuredClone,AbortSignal,setTimeout,clearTimeout,atob,btoa});
vm.runInContext(source.replace(/^import .*;$/m,'').replace('export default {','const worker = {')+'\nglobalThis.warTool=MCP_TOOLS.find(t=>t.name==="dd_war_room");globalThis.listTool=MCP_TOOLS.find(t=>t.name==="dd_fantasy_leagues");',ctx);
// Only auth verification is stubbed. Real scoped selection, Firebase reads, KV
// encryption, provider loading, cache, valuation join and MCP handlers execute.
vm.runInContext(`sessionAuth=async request=>{const t=request.headers.get('X-Bozo-Session');return t==='expired'?{err:'Expired session',code:401}:t?{uid:t}:{err:'Sign in',code:401};}`,ctx);
const user=uid=>({kind:'user',uid});
const decode=r=>{assert.notEqual(r.isError,true,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
const read=(args,uid='alice')=>ctx.warTool.run(args,env,user(uid));
const listing=decode(await ctx.listTool.run({provider:'sleeper'},env,user('alice')));
assert.equal(listing.leagues.length,2);assert.equal(listing.leagues[0].teamId,1);
assert.equal(decode(await read({provider:'sleeper'})).selectionRequired,true);
assert.equal((await read({provider:'sleeper',league_id:A},'bob')).isError,true,'saved IDs are per account');
assert.equal((await ctx.warTool.run({},env,{kind:'shared'})).isError,true);
const ai=decode(await read({provider:'sleeper',league_id:A}));
assert.deepEqual(ai.identity,{provider:'sleeper',leagueId:A,season:'2026',week:1});
assert.equal(ai.lineup.candidateProjectedPoints,-1);assert.equal(ai.lineup.actualProjectedPoints,null);assert.deepEqual(ai.lineup.candidateAssignments.map(a=>a.playerId),['q','r']);
assert.equal(ai.you,'1');assert.equal(ai.pool.find(p=>p.id==='q').weeklyPoints,0);assert.equal(ai.pool.find(p=>p.id==='r').weeklyPoints,-1);assert.equal(ai.pool.find(p=>p.id==='w').weeklyPoints,null);
assert.equal(ai.pool.some(p=>p.id==='f'),false);assert.equal(ai.teams[0].faab.used,0);assert.equal(ai.teams[0].faab.remaining,null);
assert.equal(ai.context.matchups[0].points,0);assert.equal(ai.teams[0].startingSlots[1],null);
assert.equal(ai.context.coverage.deadlines.status,'unavailable');assert.equal(ai.context.coverage.gameLocks.status,'unavailable');
assert.equal(ai.slots.WRRB_FLEX,1);assert.equal(ai.slots.FLEX,undefined);
const route=async(uid='alice',query='')=>{const req=new Request('https://example.test/sleeper/warroom?leagueId='+A+query,{headers:uid?{'X-Bozo-Session':uid}:{}});return ctx.handleSleeperWarroom(req,new URL(req.url),env,{});};
const website=await (await route()).json();assert.deepEqual(website.identity,ai.identity);assert.equal(website.fetchedAt,ai.fetchedAt);for(const p of ai.pool)assert.deepEqual(p,website.pool.find(x=>x.id===p.id));
assert.equal((await route('expired')).status,401,'expired auth cannot downgrade to public');
const available=decode(await read({provider:'sleeper',league_id:A,scope:'available',limit:1,position:'RB'}));
assert.deepEqual(available.pool.map(p=>p.id),['f']);assert.equal(available.scope.total,1);
const next=decode(await read({provider:'sleeper',league_id:B}));assert.equal(next.you,null);assert.deepEqual(next.pool.map(p=>p.id),['b']);
assert.equal((await read({provider:'sleeper',league_id:A,season:'2025'})).isError,true);
assert.equal((await read({provider:'sleeper',league_id:A,week:2})).isError,true);
assert.equal((await read({provider:'sleeper',league_id:A,team_id:'99'})).isError,true);
for(const invalid of [{scope:'oops'},{limit:10000},{offset:-1},{week:'1'},{refresh:'true'},{unknown:true}])assert.equal((await read({provider:'sleeper',league_id:A,...invalid})).isError,true);
rosterVersion=1;const refreshed=decode(await read({provider:'sleeper',league_id:A,refresh:true}));assert.equal(refreshed.pool.some(p=>p.id==='f'),true);
failRosters=true;assert.equal((await read({provider:'sleeper',league_id:A,refresh:true})).isError,true,'failed refresh does not return a cached league');failRosters=false;
week=2;const advanced=decode(await read({provider:'sleeper',league_id:A,week:2,refresh:true}));assert.equal(advanced.identity.week,2);assert.match(advanced.cache.key,/,2\]/);
failWeekly=true;const missing=decode(await read({provider:'sleeper',league_id:A,refresh:true}));assert.equal(missing.weekly.ready,false);assert.equal(missing.context.coverage.weeklyProjections.status,'unavailable');failWeekly=false;
swapIdentity=true;assert.equal((await read({provider:'sleeper',league_id:A,refresh:true})).isError,true);swapIdentity=false;
// Actual sealed ESPN connections: selection spans legacy/scoped records but
// another UID cannot discover or select them, and secret material never leaves.
const secret={leagueId:'123456',season:2026,s2:'test-only-secret',swid:'test-only-cookie'};
await env.RL.put(ctx.espnKvKey('alice'),await ctx.espnSeal(env,'alice',secret));
await env.RL.put(ctx.espnLeagueKey('alice','654321',2026),await ctx.espnSeal(env,'alice',{...secret,leagueId:'654321'}));
kv.set('dd$:sleeper:'+A,JSON.stringify({as_of:'2026-09-09',data:{players:[{player:dictionary.q.full_name,pos:'QB',target:123}]}}));
const custom=decode(await read({provider:'sleeper',league_id:A}));assert.equal(custom.pool.find(p=>p.id==='q').dd.v,123);
const anonymous=await (await route('')).json();assert.notEqual(anonymous.pool.find(p=>p.id==='q').dd?.v,123,'public cache cannot expose custom values');
kv.delete('dd$:sleeper:'+A);
const espn=decode(await ctx.listTool.run({provider:'espn'},env,user('alice')));assert.equal(espn.leagues.length,2);assert.equal(JSON.stringify(espn).includes('test-only'),false);
assert.equal(decode(await ctx.listTool.run({provider:'espn'},env,user('bob'))).leagues.length,0);
assert.equal(decode(await read({provider:'espn'})).selectionRequired,true);
// Browser hydration preserves the canonical rows; only Sets/Maps and references
// change. The browser and Worker use the same weekly engine, with IR/taxi excluded.
const browser=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../warroom-sleeper.js',import.meta.url),'utf8'),browser);browser.feed=website;
const hydrated=vm.runInContext('DDSleeper.hydrate(feed)',browser);assert.equal(hydrated.weekly.byId.get('q'),0);assert.equal(hydrated.teams[0].starters.has('q'),true);
const adapterStart=html.indexOf('async function fetchLeague(id){'),adapterEnd=html.indexOf('/* ESPN, assembled',adapterStart);
Object.assign(browser,{window:{DDAuth:{token:()=> 'alice'}},DD_WORKER:'https://example.test',fetch:async()=>Response.json(website),readShelf:()=>[],encodeURIComponent});vm.runInContext(html.slice(adapterStart,adapterEnd),browser);
const state=await browser.fetchLeague(A);assert.equal(state.ref.id,A);assert.equal(state.teams[0].players.find(p=>p.id==='q').weeklyPoints,0);
browser.fetch=async()=>Response.json({...website,identity:{...website.identity,leagueId:B}});await assert.rejects(()=>browser.fetchLeague(A),/different league/);
console.log('Shared Sleeper context: account/league/season/week isolation, website–AI agreement, selection, zero/missing projections, refresh failures, availability, coverage, and sealed ESPN discovery pass.');
