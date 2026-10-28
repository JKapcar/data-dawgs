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
  bozoCorrectionManager:(s,a)=>a.uid===s.managerUid,bozoGuardedPatch:async(_e,_l,_s,ch)=>{writes.push(ch);return true;}};
 vm.createContext(c);vm.runInContext(cut('// BEGIN BOZO AGENT CLOSE','// END BOZO AGENT CLOSE'),c);
 return {writes,run:(args,now=kickoff+3600000,auth={uid:'u_kap',name:'Kap'})=>c.bozoAgentCloseCore({},auth,args,now)};
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
test('the feed goes first: nothing before kickoff, and a close already there stands',async()=>{
 let r=agentRig();assert.match((await r.run(entry(),kickoff-60000)).body.error,/Kickoff has not passed/);
 r=agentRig(l=>Object.assign(l.ledger['2026-w8-u_kap'],{close:-115,closeOpp:-105,closeSource:'espn',closeObservedAt:iso(kickoff-3*60000)}));
 assert.match((await r.run(entry())).body.error,/already has a close \(espn\)/);
 r=agentRig(l=>Object.assign(l.results.u_kap,{close:-115,closeOpp:-105,closeSource:'espn'}));
 assert.equal((await r.run(entry())).status,409);assert.equal(r.writes.length,0);
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

function captureRig(espnReads){
 const calls={espn:0,once:0},patches=[];
 const t={lid:'main',key:'a',player:'Kap',uid:'u_kap',season:2026,week:8,startMs:kickoff,pick:{sport:'nfl',mkt:'spread',eventId:'1',startsAt:iso(kickoff)}};
 const c={SEASON:2026,Date,JSON,console:{log:()=>{}},BOZO_CLOSE_BOOK:'draftkings',ledgerKey,LG:x=>'/bozo/leagues/'+x,
  loadLeagues:async()=>({}),bozoCloseTargets:async()=>[t],bozoTeamRegistry:async()=>({}),bozoEspnOddsSupports:()=>true,
  bozoEspnOddsCapture:async()=>{const ok=espnReads[calls.espn++];return ok?{ok:true,quote:{price:-112,opp:-108,provider:'espn',snapshotAt:'x'}}:{ok:false,code:'timeout'};},
  bozoCaptureOnce:async()=>{calls.once++;return {ok:false,reason:'paid provider refused'};},bozoCaptureIdentity:()=>[],
  fbGet:async (_e,k)=>({data:String(k).endsWith('/main')?{week:8,season:2026,picks:{a:t.pick},results:{},ledger:{}}:{}}),
  bozoSame:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  bozoCloseMutation:(_t,q,reason)=>q?{'results/a/close':q.price,'results/a/closeOpp':q.opp}:{'results/a/closeUnavailableReason':reason},
  bozoGuardedPatch:async(_e,_l,_s,p)=>{patches.push(p);return true;},cfbMarketKV:()=>null};
 vm.createContext(c);vm.runInContext(cut('const BOZO_MISSED_CLOSE_GRACE_MS','/* GET /bozo/clv'),c);
 return {c,calls,patches};
}
test('a free read that misses early is retried next tick; the paid fallback waits for the last tick',async()=>{
 const r=captureRig([false,false]);
 let out=await r.c.runBozoCloseCapture({},kickoff-7*60000);
 assert.equal(r.calls.once,0,'no paid call and no stored failure seven minutes out');assert.equal(r.patches.length,0);assert.equal(out.captured,0);
 out=await r.c.runBozoCloseCapture({},kickoff-2*60000);
 assert.equal(r.calls.espn,2);assert.equal(r.calls.once,1,'the last tick reaches the paid fallback once');
 assert.equal(JSON.stringify(out.missed),'[]');
});
test('a free read that lands on the last tick never touches the paid receipt',async()=>{
 const r=captureRig([false,true]);
 await r.c.runBozoCloseCapture({},kickoff-7*60000);
 const out=await r.c.runBozoCloseCapture({},kickoff-2*60000);
 assert.equal(r.calls.once,0);assert.equal(out.captured,1);assert.equal(r.patches[0]['results/a/close'],-112);
});
