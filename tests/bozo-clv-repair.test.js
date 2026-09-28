const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const worker=fs.readFileSync('dawg-bot-worker.js','utf8');
const cut=(a,b)=>worker.slice(worker.indexOf(a),worker.indexOf(b,worker.indexOf(a)));
const key='u_test-with-hyphens', rowKey=`2026-w3-${key}`;
function rig(row={}){
 const writes=[];const ctx={Request,Response,Date,crypto:require('node:crypto').webcrypto,
  readBody:r=>r.json(),leagueOf:()=> 'main',SEASON:2026,LG:id=>'/bozo/leagues/'+id,
  ledgerKey:(s,w,k)=>`${s}-w${w}-${k}`,json:(b,status)=>({body:b,status}),
  requireManager:async()=>({name:'Manager',league:{season:2026,week:3,picks:{[key]:{}}}}),
  fbGet:async()=>({data:{week:3,...row}}),fbPatch:async(env,...args)=>writes.push(args)};
 vm.createContext(ctx);vm.runInContext(cut('async function bozoCloseFill(','/* GET /bozo/close-gaps'),ctx);
 return {writes,ctx,save:b=>ctx.bozoCloseFill(new Request('https://test/bozo/close',{method:'POST',body:JSON.stringify({league:'main',row:rowKey,...b})}),{}, {})};
}
test('zero and signed CLV save atomically to full hyphenated identity, receipt and audit',async()=>{
 for(const n of [0,-1.25,2.5]){
  const r=rig({close:-200,closeOpp:170,closeObservedAt:'captured'}),out=await r.save({clvPts:n});
  assert.equal(out.status,200);assert.equal(r.writes.length,1);
  const [path,p]=r.writes[0];assert.equal(path,'/bozo/leagues/main');
  assert.equal(p[`results/${key}/clvPts`],n);assert.equal(p[`ledger/${rowKey}/clvPts`],n);
  assert.equal(p[`results/${key}/close`],undefined);assert.ok(Object.keys(p).some(k=>k.startsWith('audit/')));
 }
});
test('clear override preserves captured prices; price save updates both records with manual provenance',async()=>{
 const r=rig({close:-200,closeOpp:170,closeObservedAt:'captured'});assert.equal((await r.save({clvPts:null})).status,200);
 assert.equal(r.writes[0][1][`results/${key}/clvPts`],null);
 assert.equal((await r.save({close:-210,closeOpp:180})).status,409);
 const m=rig();assert.equal((await m.save({close:-210,closeOpp:180})).status,200);
 assert.equal(m.writes[0][1][`results/${key}/closeOppSource`],'manual');
 assert.equal(m.writes[0][1][`ledger/${rowKey}/close`],-210);
});
test('failed atomic save reports failure, invalid points and incomplete pairs write nothing',async()=>{
 const r=rig();for(const b of [{clvPts:101},{clvPts:'bad'},{close:-200}])assert.equal((await r.save(b)).status,400);
 assert.equal(r.writes.length,0);r.ctx.fbPatch=async()=>{throw Error('unavailable')};
 assert.equal((await r.save({clvPts:0})).status,502);
});
test('recovery retries missing and half closes, keeps complete pairs, and throttles paid history',async()=>{
 const now=Date.parse('2026-09-28T12:00:00Z'),start=new Date(now-24*3600000).toISOString(),kv=new Map();
 const picks={a:{eventId:'1',startsAt:start,sport:'nfl',mkt:'ml'},b:{eventId:'2',startsAt:start,sport:'nfl',mkt:'ml'}};
 const league={week:3,season:2026,status:'graded',picks,results:{a:{close:-150},b:{close:-150,closeOpp:130}}};
 const ctx={Date,SEASON:2026,BOZO_CLOSE_LEAD_MS:420000,BOZO_CLOSE_STALE_MS:1200000,BOZO_CLOSE_RECOVERY_MS:172800000,BOZO_CLOSE_RETRY_MS:3600000,
 loadLeagues:async()=>({main:league}),loadUsers:async()=>({}),playerName:k=>k,memberNameAt:()=>null,accountName:()=>'',UID_RE:/^u_/,bozoOddsApiMarkets:()=>['h2h']};
 vm.createContext(ctx);vm.runInContext(cut('async function bozoCloseTargets(','// `periods`'),ctx);
 const env={ODDS_API_KEY:'fixture',RL:{get:async k=>kv.get(k),put:async(k,v)=>kv.set(k,v)}};
 assert.equal((await ctx.bozoCloseTargets(env,now)).length,1);
 assert.equal((await ctx.bozoCloseTargets(env,now+300000)).length,0);
 assert.equal((await ctx.bozoCloseTargets(env,now+3600000)).length,1);
 assert.equal((await ctx.bozoCloseTargets(env,now+49*3600000)).length,0);
});
test('phone form saves signed and zero overrides without closing prices; blank does not erase',async()=>{
 const page=fs.readFileSync('bozo.html','utf8'),posts=[];
 const input={value:''},status={textContent:''},buttons={};
 const box={dataset:{god:key},querySelector:s=>s==='.gdclv'?input:status};
 for(const cls of ['.gdclvsave','.gdclvclear'])buttons[cls]={closest:()=>box};
 const host={innerHTML:'',querySelectorAll:s=>buttons[s]?[buttons[s]]:[]};
 const ctx={S:{season:2026,week:3,picks:{[key]:{price:-150,label:'Fixture',priceSource:'captured'}},results:{}},
  document:{getElementById:id=>id==='godResults'?host:null},esc:x=>String(x??''),memberLabel:()=> 'Fixture',kDec:k=>k,
  priceSourceBadge:()=>'',isManualLeg:()=>false,clvDeltaOf:()=>null,clvMissingReason:()=> 'closing odds missing',
  wPost:async(p,b)=>posts.push({p,b}),refresh:async()=>{},paintGod:()=>{},godErr:()=>{},clvLoad:()=>{}};
 vm.createContext(ctx);vm.runInContext(page.slice(page.indexOf('function paintGodResults(){'),page.indexOf('async function paintGodAudit(){')),ctx);
 ctx.paintGodResults();assert.ok(host.innerHTML.includes('Save CLV override'));
 await buttons['.gdclvsave'].onclick();assert.equal(posts.length,0);
 for(const raw of ['0','-1.25','+2.50']){input.value=raw;await buttons['.gdclvsave'].onclick();assert.equal(posts.at(-1).b.clvPts,Number(raw));assert.equal(posts.at(-1).b.close,undefined);assert.equal(posts.at(-1).b.row,rowKey);}
 await buttons['.gdclvclear'].onclick();assert.equal(posts.at(-1).b.clvPts,null);
});
