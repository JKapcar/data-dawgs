// Closes a Claude routine reads off DraftKings before kickoff, the alert for a kickoff with
// no close, and the free read that retries before the paid fallback. Fixtures only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const src=fs.readFileSync('dawg-bot-worker.js','utf8');
const cut=(a,b)=>{const i=src.indexOf(a);assert.ok(i>=0,a);return src.slice(i,src.indexOf(b,i));};
const ledgerKey=(s,w,k)=>`${s}-w${w}-${k}`;
const kickoff=Date.parse('2026-11-01T18:00:00Z'),iso=ms=>new Date(ms).toISOString();

function agentRig(edit=()=>{}){
 const leg={player:'Kap',week:8,eventId:'401873024',mkt:'spread',side:'DAL',line:10.5,label:'DAL -10.5',startsAt:iso(kickoff),price:-110,priceOpp:-110,close:null,closeOpp:null,closeSource:null};
 const live={season:2026,week:8,manager:'Kap',managerUid:'u_kap',picks:{u_kap:{eventId:'401873024'}},results:{u_kap:{}},ledger:{[ledgerKey(2026,8,'u_kap')]:leg}};
 edit(live);const writes=[];
 const c={SEASON:2026,Date,URL,JSON,crypto:{randomUUID:()=>crypto.randomUUID()},ledgerKey,LG:x=>'/bozo/leagues/'+x,
  validLeagueId:x=>/^[a-z0-9_-]+$/.test(x),fbGet:async()=>({data:structuredClone(live)}),
  bozoCorrectionManager:(s,a)=>a.uid===s.managerUid,
  loadLeagues:async()=>({main:structuredClone(live)}),bozoGuardedPatch:async(_e,_l,_s,ch)=>{writes.push(ch);return true;}};
 vm.createContext(c);vm.runInContext(cut('// BEGIN BOZO AGENT CLOSE','// END BOZO AGENT CLOSE'),c);
 return {writes,live,c,run:(args,now=kickoff+3600000,auth={uid:'u_kap',name:'Kap'})=>c.bozoAgentCloseCore({},auth,args,now)};
}
// The routine's file entry, as it writes it, plus where it sits on the board.
const entry=(x={})=>({league:'main',season:2026,week:8,player:'Kap',game:'ARI @ DAL',eventId:'401873024',label:'DAL -10.5',mkt:'spread',side:'DAL',line:10.5,
 startsAt:iso(kickoff),close:-112,closeOpp:-108,book:'draftkings',source:'https://sportsbook.draftkings.com/event/ari-cardinals-%40-dal-cowboys/33333?category=odds',
 observedAt:iso(kickoff-4*60000),minutesBeforeKickoff:4,verification:'verified',note:'Read in the routine',requestId:'routine-2026w8-kap-0001',...x});

test('an agent-read DraftKings close fills the gap as a verified, labelled close',async()=>{
 const r=agentRig(),out=await r.run(entry());
 assert.equal(out.status,200);assert.equal(out.body.minutesBeforeKickoff,4);
 const ch=r.writes[0],row='ledger/2026-w8-u_kap';
 assert.equal(ch[row+'/close'],-112);assert.equal(ch[row+'/closeOpp'],-108);
 assert.equal(ch[row+'/closeSource'],'agent_search');assert.equal(ch[row+'/closeBook'],'draftkings');
 assert.equal(ch['results/u_kap/close'],-112,'the live board shows the same close');
 // Not stamped as a feed observation, so a manager can still correct a misread by hand.
 assert.equal(ch[row+'/closeObservedAt'],null);
 const ev=ch[row+'/closeEvidence'];
 assert.equal(ev.url,'https://sportsbook.draftkings.com/event/ari-cardinals-%40-dal-cowboys/33333','no query string is kept');
 assert.equal(ev.readAt,iso(kickoff-4*60000));assert.equal(ev.minutesBeforeKickoff,4);assert.equal(ev.observer,'agent_web_search');
 assert.ok(Object.keys(ch).some(k=>k.startsWith('audit/')&&ch[k].type==='agent_close'));
});
test('the feed goes first: a pregame read is only held, and a close already there stands',async()=>{
 let r=agentRig();const held=await r.run(entry(),kickoff-60000);
 assert.equal(held.status,200);assert.equal(held.body.staged,true);
 const w=r.writes[0];assert.equal(w['ledger/2026-w8-u_kap/agentCloseCandidate'].close,-112);
 assert.ok(!Object.keys(w).some(k=>/\/close(Opp)?$/.test(k)),'nothing is written as the close before kickoff');
 r=agentRig(l=>Object.assign(l.ledger['2026-w8-u_kap'],{close:-115,closeOpp:-105,closeSource:'espn',closeObservedAt:iso(kickoff-3*60000)}));
 assert.match((await r.run(entry())).body.error,/already has a close \(espn\)/);
 r=agentRig(l=>Object.assign(l.results.u_kap,{close:-115,closeOpp:-105,closeSource:'espn'}));
 assert.equal((await r.run(entry())).status,409);assert.equal(r.writes.length,0);
});
test("the routine's own id shape is accepted, and junk is not",async()=>{
 assert.equal((await agentRig().run(entry({requestId:'2026-w8-401873024-2026-11-01T17:56:00.000Z'}))).status,200);
 assert.match((await agentRig().run(entry({requestId:'2026 w8 / ../x'}))).body.error,/requestId/);
});
test('a replay with the same requestId is a no-op, not a second write',async()=>{
 const r=agentRig(l=>Object.assign(l.ledger['2026-w8-u_kap'],{close:-112,closeOpp:-108,closeSource:'agent_search',closeEvidence:{requestId:'routine-2026w8-kap-0001'}}));
 const out=await r.run(entry());assert.equal(out.status,200);assert.equal(out.body.unchanged,true);assert.equal(r.writes.length,0);
});
test('only the leg itself, at its own line and side, from DraftKings, before kickoff',async()=>{
 const refuse=async(x,re,edit)=>{const r=agentRig(edit);const out=await r.run(entry(x));assert.notEqual(out.status,200,JSON.stringify(x));if(re)assert.match(out.body.error,re);assert.equal(r.writes.length,0);};
 await refuse({book:'fanduel'},/only a DraftKings close counts/);
 await refuse({line:11},/different selection/);
 await refuse({side:'ARI'},/another side/);
 await refuse({observedAt:iso(kickoff)},/at or after kickoff/);
 await refuse({observedAt:iso(kickoff-4*3600000),minutesBeforeKickoff:240},/more than 3 hours/);
 await refuse({minutesBeforeKickoff:64},/time zone/);
 await refuse({startsAt:iso(kickoff+3600000)},/check the game/);
 await refuse({player:'Jeff'},/No leg matches/);
 await refuse({closeOpp:null},/Both whole American prices/);
 await refuse({mkt:'prop'},/two-sided close/);
 await refuse({source:'http://example.com/x'},/https/);
 await refuse({extra:1},/Send only/);
 await refuse({},/Simulated league/,l=>{l.synthetic=true;});
 const r=agentRig();assert.equal((await r.run(entry(),undefined,{uid:'u_jeff',name:'Jeff'})).status,403);
});

function missedRig(){const c={SEASON:2026,Date,ledgerKey,bozoEspnOddsSupports:p=>p.mkt!=='prop'};vm.createContext(c);
 vm.runInContext(cut('const BOZO_MISSED_CLOSE_GRACE_MS','// One cron interval'),c);return c;}
test('a leg that kicked off with no close is reported until it gets one',()=>{
 const c=missedRig(),pick=(x={})=>({eventId:'1',mkt:'spread',label:'DAL -10.5',startsAt:iso(kickoff),...x});
 const lg=(picks,results={},ledger={},x={})=>({main:{season:2026,week:8,picks,results,ledger,...x}});
 const at=kickoff+30*60000;
 const out=c.bozoMissedCloses(lg({a:pick(),b:pick({mkt:'prop',label:'Lamb 80+ yds'})},{a:{closeUnavailableReason:'Exact pregame line unavailable'}}),at);
 assert.deepEqual(JSON.parse(JSON.stringify(out.map(x=>[x.row,x.freeSource,x.reason]))),[['2026-w8-a',true,'Exact pregame line unavailable'],['2026-w8-b',false,null]]);
 assert.equal(c.bozoMissedCloses(lg({a:pick()},{a:{close:-110,closeOpp:-110}}),at).length,0,'a close on the board clears it');
 assert.equal(c.bozoMissedCloses(lg({a:pick()},{},{'2026-w8-a':{close:-110,closeOpp:-110}}),at).length,0,'so does one on the ledger');
 assert.equal(c.bozoMissedCloses(lg({a:pick()},{a:{clvPts:0}}),at).length,0,'a manager-set CLV is an answer too');
 assert.equal(c.bozoMissedCloses(lg({a:pick()},{a:{close:-110}}),at).length,1,'one side is still a miss');
 assert.equal(c.bozoMissedCloses(lg({a:pick()}),kickoff+5*60000).length,0,'grace for the last pregame tick');
 assert.equal(c.bozoMissedCloses(lg({a:pick()}),kickoff+37*3600000).length,0,'last weekend cannot keep health red');
 assert.equal(c.bozoMissedCloses(lg({a:pick()},{},{},{synthetic:true}),at).length,0,'simulated leagues are never reported');
 assert.equal(c.bozoMissedCloses(lg({a:pick({mkt:'other'})}),at).length,0);
});

function captureRig(espnReads,leagues={}){
 const calls={espn:0,once:0},patches=[];
 const t={lid:'main',key:'a',player:'Kap',uid:'u_kap',season:2026,week:8,startMs:kickoff,pick:{sport:'nfl',mkt:'spread',eventId:'1',startsAt:iso(kickoff)}};
 const c={SEASON:2026,Date,JSON,console:{log:()=>{}},BOZO_CLOSE_BOOK:'draftkings',ledgerKey,LG:x=>'/bozo/leagues/'+x,
  loadLeagues:async()=>structuredClone(leagues),bozoCloseTargets:async()=>[t],bozoTeamRegistry:async()=>({}),bozoEspnOddsSupports:()=>true,
  bozoEspnOddsCapture:async()=>{const ok=espnReads[calls.espn++];return ok?{ok:true,quote:{price:-112,opp:-108,provider:'espn',snapshotAt:'x'}}:{ok:false,code:'timeout'};},
  bozoCaptureOnce:async()=>{calls.once++;return {ok:false,reason:'paid provider refused'};},bozoCaptureIdentity:()=>[],
  bozoOddsApiMarkets:p=>p.mkt==='spread'?['spreads']:null,
  fbGet:async (_e,k)=>({data:String(k).endsWith('/main')?{week:8,season:2026,picks:{a:t.pick},results:{},ledger:{}}:{}}),
  bozoSame:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  bozoCloseMutation:(_t,q,reason)=>q?{'results/a/close':q.price,'results/a/closeOpp':q.opp}:{'results/a/closeUnavailableReason':reason},
  bozoGuardedPatch:async(_e,_l,_s,p)=>{patches.push(p);return true;},cfbMarketKV:()=>null,bozoPromoteAgentCloses:async()=>0};
 vm.createContext(c);vm.runInContext(cut('const BOZO_MISSED_CLOSE_GRACE_MS','/* GET /bozo/clv'),c);
 return {c,calls,patches};
}
test('a free read that misses early is retried next tick; the paid fallback waits for the last tick',async()=>{
 const r=captureRig([false,false]),paid={BOZO_PAID_ODDS:'true'};
 let out=await r.c.runBozoCloseCapture(paid,kickoff-7*60000);
 assert.equal(r.calls.once,0,'no paid call and no stored failure seven minutes out');assert.equal(r.patches.length,0);assert.equal(out.captured,0);
 out=await r.c.runBozoCloseCapture(paid,kickoff-2*60000);
 assert.equal(r.calls.espn,2);assert.equal(r.calls.once,1,'the last tick reaches the paid fallback once');
 assert.equal(JSON.stringify(out.missed),'[]');
});
test('a free read that lands on the last tick never touches the paid receipt',async()=>{
 const r=captureRig([false,true]);
 await r.c.runBozoCloseCapture({},kickoff-7*60000);
 const out=await r.c.runBozoCloseCapture({},kickoff-2*60000);
 assert.equal(r.calls.once,0);assert.equal(out.captured,1);assert.equal(r.patches[0]['results/a/close'],-112);
});

test('with no Odds API key and the paid switch off, an ESPN miss never reaches a paid provider or a once-only receipt',async()=>{
 for(const env of [{},{BOZO_PAID_ODDS:'false'},{BOZO_PAID_ODDS:true},{SGO_KEY:'k'},{SGO_KEY:'k',BOZO_PAID_ODDS:'false'}]){
  const r=captureRig([false,false]);
  await r.c.runBozoCloseCapture(env,kickoff-7*60000);
  const out=await r.c.runBozoCloseCapture(env,kickoff-2*60000);
  assert.equal(r.calls.once,0,JSON.stringify(env));assert.equal(out.captured,0);
  assert.match(r.patches[0]['results/a/closeUnavailableReason'],/No free DraftKings line on ESPN/);
 }
});

// The held read, the five-minute promotion and the paid gates, from the committed Worker.
function promoteRig(edit=()=>{}){
 const r=agentRig(edit);
 return {...r,promote:async now=>{
  const leagues={main:structuredClone(r.live)};for(const ch of r.writes)for(const [k,v] of Object.entries(ch)){
   const parts=k.split('/');let n=leagues.main;for(const p of parts.slice(0,-1))n=n[p]||={};n[parts.at(-1)]=v;}
  const before=r.writes.length;const n=await r.c.bozoPromoteAgentCloses({},leagues,now);return {n,ch:r.writes[before]};}};
}
test('a held read becomes the close at kickoff only when the feed got none',async()=>{
 let r=promoteRig();await r.run(entry(),kickoff-60000);
 let p=await r.promote(kickoff-30000);assert.equal(p.n,0,'not before kickoff');
 p=await r.promote(kickoff+60000);assert.equal(p.n,1);
 const row='ledger/2026-w8-u_kap';
 assert.equal(p.ch[row+'/close'],-112);assert.equal(p.ch[row+'/closeOpp'],-108);assert.equal(p.ch['results/u_kap/close'],-112);
 assert.equal(p.ch[row+'/closeSource'],'agent_search');assert.equal(p.ch[row+'/closeEvidence'].readAt,iso(kickoff-4*60000));
 assert.equal(p.ch[row+'/closeUnavailableReason'],null,'the free-miss reason is cleared');
 assert.ok(p.ch[row+'/agentCloseCandidate/promotedAt']);
 // A feed close that landed first stands; the held read is never applied over it.
 r=promoteRig(l=>Object.assign(l.results.u_kap,{close:-115,closeOpp:-105,closeSource:'espn'}));
 r.live.ledger['2026-w8-u_kap'].agentCloseCandidate={close:-112,closeOpp:-108,readAt:iso(kickoff-4*60000),requestId:'x'.repeat(16)};
 p=await r.promote(kickoff+60000);assert.equal(p.n,0);
 // Simulated leagues are never touched.
 r=promoteRig(l=>{l.synthetic=true;l.ledger['2026-w8-u_kap'].agentCloseCandidate={close:-112,closeOpp:-108,readAt:iso(kickoff-4*60000)};});
 p=await r.promote(kickoff+60000);assert.equal(p.n,0);
});
test('held reads: same id replays, a later read replaces an earlier one, never the reverse',async()=>{
 const r=agentRig();
 assert.equal((await r.run(entry({observedAt:iso(kickoff-30*60000),minutesBeforeKickoff:30,requestId:'early-read-000001'}),kickoff-20*60000)).body.staged,true);
 const replay=await r.run(entry({observedAt:iso(kickoff-30*60000),minutesBeforeKickoff:30,requestId:'early-read-000001'}),kickoff-20*60000);
 assert.equal(replay.status,200);
 const later=agentRig(l=>{l.ledger['2026-w8-u_kap'].agentCloseCandidate={close:-110,closeOpp:-110,readAt:iso(kickoff-30*60000),requestId:'early-read-000001'};});
 assert.equal((await later.run(entry({requestId:'later-read-000002'}),kickoff-2*60000)).body.staged,true,'a later read replaces');
 const earlier=agentRig(l=>{l.ledger['2026-w8-u_kap'].agentCloseCandidate={close:-110,closeOpp:-110,readAt:iso(kickoff-2*60000),requestId:'later-read-000002'};});
 const out=await earlier.run(entry({requestId:'early-read-000003'}),kickoff-60000);
 assert.equal(out.status,409);assert.match(out.body.error,/later read/);assert.equal(earlier.writes.length,0);
});
test('every paid odds client is gated by BOZO_PAID_ODDS, and only the exact string "true" opens it',()=>{
 for(const fn of ['async function bozoSgoRequest(','async function bozoFetchEvents(','async function cfbFetchMarketEvents('])
  assert.match(cut(fn,'\n}\n'),/env\.BOZO_PAID_ODDS !== "true"/,fn);
 // The Odds API clients go through one gate: the key alone opens only the close fallback.
 for(const fn of ['async function bozoOddsApiRequest(','async function bozoOddsApiRequestRaw(','async function bozoOddsApiCapture('])
  assert.match(cut(fn,'\n}\n'),/bozoOddsApiAllowed\(env, ?options\.caller\)/,fn);
 assert.match(cut('async function bozoCaptureEntry(','async function bozoCommittedEntry('),/!backup && env\.BOZO_PAID_ODDS !== "true"/);
 assert.doesNotMatch(fs.readFileSync('wrangler.jsonc','utf8'),/BOZO_PAID_ODDS/,'no manifest change: absent means off');
});

// The Odds API: Kap's paid backup, for a Bozo close only, after the agent read and ESPN both miss.
test('the Odds API key alone opens the close fallback, once per leg, on the last tick only',async()=>{
 const r=captureRig([false,false]),env={ODDS_API_KEY:'k'};
 await r.c.runBozoCloseCapture(env,kickoff-7*60000);
 assert.equal(r.calls.once,0,'never before the last tick');
 await r.c.runBozoCloseCapture(env,kickoff-2*60000);
 assert.equal(r.calls.once,1,'one once-only receipt for the leg');
});
test('a held agent read means the paid backup is never asked',async()=>{
 const cand={close:-112,closeOpp:-108,readAt:iso(kickoff-30*60000),requestId:'r'.repeat(16)};
 const r=captureRig([false,false],{main:{ledger:{'2026-w8-a':{agentCloseCandidate:cand}}}});
 const out=await r.c.runBozoCloseCapture({ODDS_API_KEY:'k',BOZO_PAID_ODDS:'true'},kickoff-2*60000);
 assert.equal(r.calls.once,0);assert.equal(out.captured,0);
 assert.match(r.patches[0]['results/a/closeUnavailableReason'],/agent's DraftKings read is held/);
 // A read already promoted, or one taken after kickoff, holds nothing.
 const late=captureRig([false],{main:{ledger:{'2026-w8-a':{agentCloseCandidate:{...cand,readAt:iso(kickoff+60000)}}}}});
 await late.c.runBozoCloseCapture({ODDS_API_KEY:'k'},kickoff-2*60000);assert.equal(late.calls.once,1);
});
test('a leg the Odds API cannot price never opens a paid receipt on the key alone',async()=>{
 const r=captureRig([false]);r.c.bozoOddsApiMarkets=()=>null;
 await r.c.runBozoCloseCapture({ODDS_API_KEY:'k'},kickoff-2*60000);
 assert.equal(r.calls.once,0,'SportsGameOdds stays behind BOZO_PAID_ODDS');
 assert.match(r.patches[0]['results/a/closeUnavailableReason'],/No free DraftKings line on ESPN/);
});

function oddsRig(responses){
 let fetches=0;const puts=[];const env={ODDS_API_KEY:'test-key'};
 const c={Date,URL,JSON,Request,Response,Promise,AbortController,setTimeout,clearTimeout,Number,Object,String,Array,
  console:{log:()=>{}},caches:undefined,
  fbGet:async()=>({data:null}),fbPut:async(_e,path,v)=>{puts.push([path,v]);return true;},
  bozoCaptureOnce:async()=>{throw Error('the close must not use the shared request receipt');},
  fetch:async()=>{const r=responses[Math.min(fetches,responses.length-1)];fetches++;return typeof r==='function'?r():r;}};
 vm.createContext(c);
 vm.runInContext(cut('const BOZO_ODDS_API_LEG_CAP','async function bozoOddsApiCapture(')+'this.cap=BOZO_ODDS_API_LEG_CAP;',c);
 return {c,env,puts,get fetches(){return fetches;}};
}
test('Odds API requests: entry capture stays off on the key alone, and each leg is capped',async()=>{
 const ok=()=>Response.json([]);
 let r=oddsRig([ok]);
 await assert.rejects(r.c.bozoOddsApiRequest(r.env,'sports/x/events',{},{caller:'submit'}),e=>e.code==='paid_feeds_off');
 await assert.rejects(r.c.bozoOddsApiRequest({},'sports/x/events',{},{caller:'close'}),e=>e.code==='unconfigured');
 assert.equal(r.fetches,0,'no call without the key, and none for entry capture');
 const legBudget={left:r.c.cap};
 await r.c.bozoOddsApiRequest(r.env,'sports/x/events',{},{caller:'close',legBudget});
 await r.c.bozoOddsApiRequest(r.env,'sports/x/events/1/odds',{},{caller:'close',legBudget});
 await assert.rejects(r.c.bozoOddsApiRequest(r.env,'sports/x/events',{},{caller:'close',legBudget}),e=>e.code==='leg_cap');
 assert.equal(r.fetches,2,'events list plus one odds read, never a third');
});
test('a refused key fails quietly with a clear reason and is retried for the next leg',async()=>{
 const r=oddsRig([()=>new Response('nope',{status:401}),()=>Response.json([])]);
 await assert.rejects(r.c.bozoOddsApiRequest(r.env,'sports/x/events',{},{caller:'close',legBudget:{left:2}}),
  e=>e.code==='unauthorized'&&e.message==='Odds API refused the key'&&!String(e.message).includes('test-key'));
 await r.c.bozoOddsApiRequest(r.env,'sports/x/events',{},{caller:'close',legBudget:{left:2}});
 assert.equal(r.fetches,2,'a 401 on one leg does not stick to the next');
});
test('an exhausted quota flag blocks for a day, then the restored subscription is used again',async()=>{
 const r=oddsRig([()=>Response.json([])]);
 r.c.fbGet=async()=>({data:{exhausted:true,at:new Date(Date.now()-3600000).toISOString()}});
 await assert.rejects(r.c.bozoOddsApiRequest(r.env,'sports/x/events',{},{caller:'close'}),e=>e.code==='quota_exceeded');
 r.c.fbGet=async()=>({data:{exhausted:true,at:new Date(Date.now()-25*3600000).toISOString()}});
 await r.c.bozoOddsApiRequest(r.env,'sports/x/events',{},{caller:'close'});
 assert.equal(r.fetches,1);
});
