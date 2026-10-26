const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto,createHash} = require('node:crypto');
const root = path.join(__dirname,'..');
const worker = fs.readFileSync(path.join(root,'dawg-bot-worker.js'),'utf8');
const block = fs.readFileSync(path.join(root,'work/mcp-block.js'),'utf8');
const cut = (a,b) => worker.slice(worker.indexOf(a),worker.indexOf(b,worker.indexOf(a)));
const clone = x => JSON.parse(JSON.stringify(x));
const NOW = Date.parse('2026-10-24T22:00:00Z');
const owner = {uid:'u_manager',name:'Manager'};
function rig() {
  let now=NOW,revision=1,writes=0,race=null,lost=false,readFail=false;
  let state={season:2026,week:7,status:'placed',managerUid:'u_manager',members:{u_manager:{name:'Manager'},u_player:{name:'Player'}},
    picks:{u_player:{sport:'cfb',eventId:'401858496',espnEventId:'401858496',startsAt:'2026-10-24T16:00:00Z',game:'IU @ MICH',side:'IU',mkt:'spread',period:'game',line:3.5,price:-110,label:'IU -3.5',ts:123}},
    results:{u_player:{close:-105,closeOpp:-115}},ledger:{old:{preserve:true}},royale:{chops:{6:{who:'someone'}}},order:[1,3,0,2],stake:50,audit:{old:{keep:true}}};
  let game={espnEventId:'401858496',startsAt:'2026-10-24T16:00:00Z',completed:false,home:{abbr:'MICH',name:'Michigan'},away:{abbr:'IU',name:'Indiana'},homeScore:null,awayScore:null};
  const kv=new Map();
  const env={RL:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)}};
  class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  const ctx={Date:Clock,crypto:webcrypto,URL,console,SEASON:2026,
    validLeagueId:s=>/^[a-z0-9-]+$/.test(s),LG:id=>'/bozo/leagues/'+id,
    sha256hex:async s=>createHash('sha256').update(s).digest('hex'),bozoPeriodOf:p=>p.period||'game',
    bozoBuildTeamRegistry:()=>({aliases:{}}),bozoTeamNorm:s=>({IU:'indiana',MICH:'michigan'}[s]||String(s).toLowerCase()),
    bozoScheduleDoc:async()=>({source:'fixture',games:[game]}),bozoScheduleFindGame:()=>game,
    fbGet:async()=>{if(readFail && writes)throw new Error('read failed');return {data:clone(state),etag:String(revision)};},
    fbPut:async(e,p,s,etag)=>{assert.equal(p,'/bozo/leagues/royale');assert.ok(etag);if(race){const fn=race;race=null;fn();}if(etag!==String(revision))return false;state=clone(s);revision++;writes++;if(lost)throw new Error('response lost');return true;},
  };
  vm.createContext(ctx);
  vm.runInContext(cut('function bozoCorrectionManager(', 'function bozoCorrectionGate(')+'\n'+
    cut('function bozoScheduledTeamSide(', 'async function bozoGradeFromScheduleKv(').split('/* GET /ops/health')[0]+'\n'+
    fs.readFileSync(path.join(root,'work/bozo-result-fallback.js'),'utf8')+'\nthis.api={bozoRecordResultCore,bozoResultRevision,bozoResultGate,BOZO_RESULT_SCHEMA};',ctx);
  const at=block.indexOf('    name: "dd_record_bozo_result"');
  const tool=block.slice(block.lastIndexOf('  {',at),block.indexOf('\n  },',at)+5).trim().replace(/,$/,'');
  ctx.toolText=x=>({content:[{type:'text',text:JSON.stringify(x)}]});ctx.toolErr=error=>({isError:true,error});
  vm.runInContext('this.tool=('+tool+');',ctx);
  const evidence={sourceUrl:'https://www.espn.com/college-football/game/_/gameId/401858496/indiana-michigan',eventId:'401858496',completed:true,status:'Final/OT',observedAt:new Date(NOW-60000).toISOString(),homeTeam:'Michigan',awayTeam:'Indiana',homeScore:6,awayScore:13};
  const args=async()=>({league:'royale',forUid:'u_player',revision:await ctx.api.bozoResultRevision(state,'u_player'),reason:'Verified final missed by automatic grader',evidence:clone(evidence)});
  const call=(b,a=owner)=>ctx.api.bozoRecordResultCore(env,a,b);
  return {ctx,env,args,call,propose:async(over={},a=owner)=>call({...await args(),...over},a),confirm:(c,a=owner)=>call({league:'royale',forUid:'u_player',confirm:c},a),
    state:()=>clone(state),writes:()=>writes,change:f=>{f(state);revision++;},game:f=>f(game),tick:n=>now+=n,expire:()=>kv.clear(),lost:()=>lost=true,readFail:()=>readFail=true,
    race:fn=>race=()=>{fn(state);revision++;},mcp:args=>ctx.tool.run(args,env,{...owner,kind:'user'})};
}
test('preview/confirm records IU arithmetic, audit and exact readback; preserves all other state',async()=>{
  const r=rig(),before=r.state(),p=await r.propose();assert.equal(p.status,200,JSON.stringify(p));assert.equal(r.writes(),0);
  assert.equal(p.body.arithmetic.actual,7);assert.equal(p.body.arithmetic.edge,3.5);assert.equal(p.body.arithmetic.result,'won');
  assert.equal(p.body.evidence.verification,'manager_attested');
  const out=await r.confirm(p.body.confirm_code);assert.equal(out.status,200,JSON.stringify(out));assert.equal(out.body.matchesRecorded,true);assert.equal(r.writes(),1);
  const after=r.state();for(const k of ['picks','ledger','royale','status','stake','order','members'])assert.deepEqual(after[k],before[k]);
  assert.equal(after.results.u_player.close,-105);assert.equal(after.results.u_player.actual,7);assert.equal(after.results.u_player.won,true);assert.equal(after.results.u_player.resultSource,'manual');
  const receipt=after.audit[p.body.confirm_code];assert.deepEqual(receipt.before,before.results.u_player);assert.deepEqual(receipt.after,after.results.u_player);assert.equal(receipt.actor,owner.uid);
  r.expire();const replay=await r.confirm(p.body.confirm_code);assert.equal(replay.body.matchesRecorded,true);assert.equal(r.writes(),1);
});
for(const [name,mutate] of [
  ['manual',s=>s.results.u_player.resultSource='manual'],['existing win',s=>s.results.u_player.result='won'],['existing actual',s=>s.results.u_player.actual=0],
  ['future',s=>s.picks.u_player.startsAt='2026-10-25T00:00:00Z'],['period',s=>s.picks.u_player.period='1h'],['prop',s=>s.picks.u_player.mkt='prop'],
  ['graded',s=>s.status='graded'],['chopped',s=>s.royale.chops[7]={}],['settling',s=>s.gradeStartedWeek=7]
]) test('refuses '+name,async()=>{const r=rig();r.change(mutate);assert.ok((await r.propose()).status>=400);assert.equal(r.writes(),0);});
for(const auth of [{}, {name:'Manager'}, {uid:'stranger',name:'Manager'}, {kind:'shared'}])
  test('requires existing verified manager identity '+JSON.stringify(auth),async()=>{const r=rig();assert.ok((await r.propose({},auth)).status>=400);assert.equal(r.writes(),0);});
for(const changes of [{completed:false},{status:'3rd quarter'},{eventId:'123'},{homeScore:null},{homeScore:NaN},{awayScore:-1},{awayScore:1.5},{homeTeam:'Indiana',awayTeam:'Michigan'},
  {sourceUrl:'https://evil.example/401858496'}, {sourceUrl:'https://www.espn.com/college-football/game/_/gameId/4018584960/wrong'}, {observedAt:'2026-10-24T23:00:00Z'},{observedAt:'2026-10-23T00:00:00Z'}])
  test('invalid evidence '+JSON.stringify(changes),async()=>{const r=rig(),a=await r.args();Object.assign(a.evidence,changes);assert.ok((await r.call(a)).status>=400);assert.equal(r.writes(),0);});
test('cached official final conflict fails closed',async()=>{const r=rig();r.game(g=>Object.assign(g,{completed:true,homeScore:7,awayScore:13}));assert.ok((await r.propose()).status>=400);});
test('unknown target and added arbitrary path rejected',async()=>{const r=rig();assert.ok((await r.propose({forUid:'unknown'})).status>=400);assert.ok((await r.propose({path:'stake',value:0})).status>=400);});
test('stale read, stale preview, expiry, permission revocation, and argument tampering fail closed',async()=>{
  for(const kind of ['read','preview','expired','revoked','tampered']){
    const r=rig(),a=await r.args();if(kind==='read'){r.change(s=>s.picks.u_player.line=4.5);assert.equal((await r.call(a)).status,409);continue;}
    const p=await r.propose();
    if(kind==='preview')r.change(s=>s.results.u_player.close=-180);
    if(kind==='expired')r.tick(301000);
    if(kind==='revoked')r.change(s=>s.managerUid='other');
    const out=kind==='tampered'?await r.call({league:'royale',forUid:'u_player',confirm:p.body.confirm_code,evidence:{}}):await r.confirm(p.body.confirm_code);
    assert.ok(out.status>=400,kind);assert.equal(r.writes(),0);
  }
});
test('concurrent unrelated write is preserved; same code can safely retry',async()=>{const r=rig(),p=await r.propose();r.race(s=>s.stake=60);assert.equal((await r.confirm(p.body.confirm_code)).status,409);assert.equal(r.writes(),0);assert.equal((await r.confirm(p.body.confirm_code)).body.matchesRecorded,true);assert.equal(r.state().stake,60);});
test('commit response loss recovers through durable receipt, without duplicate write',async()=>{const r=rig(),p=await r.propose();r.lost();assert.equal((await r.confirm(p.body.confirm_code)).body.uncertain,true);r.expire();assert.equal((await r.confirm(p.body.confirm_code)).body.matchesRecorded,true);assert.equal(r.writes(),1);});
test('readback failure is explicit and superseded result never silently restored',async()=>{
  const r=rig(),p=await r.propose();r.readFail();assert.equal((await r.confirm(p.body.confirm_code)).body.readbackVerified,false);
  const q=rig(),v=await q.propose();await q.confirm(v.body.confirm_code);q.change(s=>s.results.u_player.result='lost');assert.equal((await q.confirm(v.body.confirm_code)).body.matchesRecorded,false);assert.equal(q.writes(),1);
});
for(const [market,side,line,expected,edge] of [['ml','IU',0,'won',7],['spread','IU',7,'push',0],['spread','IU',10,'lost',-3],['total','under',20,'won',1],['total','over',20,'lost',-1]])
  test('arithmetic '+[market,side,line].join('/'),async()=>{const r=rig();r.change(s=>Object.assign(s.picks.u_player,{mkt:market,side,line}));const p=await r.propose();assert.equal(p.body.arithmetic.result,expected);assert.equal(p.body.arithmetic.edge,edge);});
test('MCP wrapper preserves structured errors, rejects shared caller, and exposes schema',async()=>{
  const r=rig();assert.equal(r.ctx.tool.readOnlyHint,false);assert.equal(r.ctx.tool.inputSchema.additionalProperties,false);
  assert.equal((await r.ctx.tool.run({},r.env,{kind:'shared'})).isError,true);
  const p=await r.mcp(await r.args());assert.equal(JSON.parse(p.content[0].text).status,'confirm_required');
  const bad=await r.mcp({league:'royale',forUid:'u_player',confirm:'bad'});assert.equal(bad.isError,true);assert.ok(JSON.parse(bad.content[0].text).error);
});
