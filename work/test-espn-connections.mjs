// Regression fixtures for Matt's URL/ID failures, private setup, and league isolation.
// Upstream responses are synthetic; credentials below are test-only sentinels.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const root=new URL('../',import.meta.url);
const src=fs.readFileSync(new URL('dawg-bot-worker.js',root),'utf8');
const html=fs.readFileSync(new URL('fantasy-warroom.html',root),'utf8');
const providers=fs.readFileSync(new URL('draft-providers.js',root),'utf8');
const data=new Map(),calls=[];
const env={BOZO_PEPPER:'fixture-pepper-only',RL:{
  get:async key=>data.get(key)||null,put:async(key,value)=>{data.set(key,value)},delete:async key=>{data.delete(key)},
  list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})
}};
let upstreamMismatch=false,expired=false;
const fixture=(id,season)=>({id:Number(id),seasonId:Number(season),settings:{name:'League '+id,size:2,rosterSettings:{lineupSlotCounts:{0:1,2:1}},scoringSettings:{scoringItems:[{statId:53,points:.5}]}},teams:[]});
const upstream=async(url,init={})=>{
  const u=new URL(url),id=u.pathname.split('/').at(-1),season=u.pathname.match(/seasons\/(\d+)/)[1];
  if(id==='1396311343' && (expired || !String(init.headers?.Cookie).includes('fixture-s2')))
    return Response.json({messages:['You are not authorized to view this League.']},{status:401});
  return Response.json(fixture(upstreamMismatch?'999':id,season));
};
const context=vm.createContext({URL,Response,Request,TextEncoder,TextDecoder,crypto:webcrypto,fetch:upstream,
  SITE:'https://datadawgs216.com',DD_SHARE_INCLUDE:false,
  sessionAuth:async req=>req.headers.get('X-Bozo-Session')?{uid:req.headers.get('X-Bozo-Session')}:{err:'Sign in',code:401},
  json:(body,status)=>Response.json(body,{status}),ddLoadBoard:async()=>null,ddDecorateBody:()=>{}});
vm.runInContext(src.slice(src.indexOf('const ESPN_READ ='),src.indexOf('async function handleSleeperPlayersSlim(')),context);
// Keep actual routes, access checks, encryption, and ESPN fetch; substitute only feed assembly.
vm.runInContext(`espnWarroomFeed=async cred=>{const r=await espnFetch(cred.leagueId,cred.season,['mSettings'],cred.s2?cred:null);return r.ok?{ok:true,body:{league:{id:r.body.id,season:r.body.seasonId,name:r.body.settings.name,slots:[]},pool:[],teams:[],schedule:[]}}:r}`,context);
async function route(path,method='GET',body,uid='kap'){
  const req=new Request('https://toto.example'+path,{method,headers:uid?{'X-Bozo-Session':uid,'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
  return context.handleEspn(req,new URL(req.url),env,{});
}
async function body(path,method,values,uid){const r=await route(path,method,values,uid);return {status:r.status,...await r.json()}}
const scope=(id,season=2026)=>'?leagueId='+id+'&season='+season;
const original={leagueId:'110404',season:2026,s2:'fixture-s2',swid:'{fixture-swid}',at:'fixture'};
await env.RL.put(context.espnKvKey('kap'),await context.espnSeal(env,'kap',original));
assert.equal((await body('/espn/connect'+scope('110404'))).connected,true,'existing connection remains readable');
assert.equal((await body('/espn/connect'+scope('1396311343'))).connected,false,'another league must not inherit the original connection');
assert.equal((await body('/espn/warroom'+scope('1396311343'))).status,404);
assert.equal((await body('/espn/warroom'+scope('110404',2025))).status,404,'season is part of the connection identity');
assert.equal((await body('/espn/connect'+scope('1396311343'),'POST',{leagueId:'1396311343',season:'2026'},'matt')).needsCredentials,true,'Matt gets the private setup signal');
assert.equal([...data.keys()].some(k=>k.includes('matt')),false,'failed access does not save a connection');
assert.equal((await body('/espn/connect'+scope('1396311343'),'POST',{leagueId:'1396311343',season:'2026',s2:'fixture-s2',swid:'{fixture-swid}'},'matt')).connected,true);
const mattFeed=await body('/espn/warroom'+scope('1396311343'),undefined,undefined,'matt');
assert.equal(String(mattFeed.league.id),'1396311343');
assert.equal(JSON.stringify(mattFeed).includes('fixture-s2'),false,'credentials never appear in returned data');
assert.equal([...data.values()].some(v=>v.includes('fixture-s2')),false,'stored credentials are sealed');
assert.equal((await body('/espn/connect'+scope('1396311343'),'POST',{leagueId:'1396311343',season:'2026'})).connected,true,'caller can reuse their existing valid ESPN session');
assert.equal((await context.espnStored(env,'kap')).leagueId,'110404','adding a new league preserves the draft connection');
assert.equal(String((await body('/espn/warroom'+scope('110404'))).league.id),'110404');
assert.equal(String((await body('/espn/warroom'+scope('1396311343'))).league.id),'1396311343');
assert.equal((await body('/espn/connect'+scope('12'),'POST',{leagueId:'13',season:'2026'})).status,400,'body and URL must match');
upstreamMismatch=true;
assert.match((await body('/espn/connect'+scope('42'),'POST',{leagueId:'42',season:'2026'})).error,/different league/);
assert.equal((await context.espnStored(env,'kap','42',2026)),null);
upstreamMismatch=false;
const shared=await body('/espn/share'+scope('1396311343'),'POST',{});
const sharedUrl=new URL('https://toto.example/espn/share/'+new URL(shared.url).searchParams.get('share'));
assert.equal(String((await (await context.handleEspnShareRead(new Request(sharedUrl),sharedUrl,env,{})).json()).league.id),'1396311343');
await body('/espn/connect'+scope('123456'),'POST',{leagueId:'123456',season:'2026'});
assert.equal(String((await (await context.handleEspnShareRead(new Request(sharedUrl),sharedUrl,env,{})).json()).league.id),'1396311343','share stays pinned after a second connection');
assert.equal((await body('/espn/warroom'+scope('1396311343'),undefined,undefined,'stranger')).status,404,'different account has no access');
assert.equal((await body('/espn/warroom'+scope('1396311343'),undefined,undefined,'')).status,401);
expired=true;
assert.equal((await body('/espn/warroom'+scope('1396311343'))).needsCredentials,true,'expired session requests reconnection');
expired=false;
await body('/espn/connect'+scope('1396311343'),'DELETE');
assert.equal((await body('/espn/connect'+scope('110404'))).connected,true,'targeted disconnect preserves other leagues');
assert.equal((await context.handleEspnShareRead(new Request(sharedUrl),sharedUrl,env,{})).status,404,'targeted disconnect revokes its share');
await body('/espn/connect','DELETE');
assert.equal([...data.keys()].some(k=>k.startsWith('espn:league:kap:')||k==='espn:cred:kap'),false,'legacy disconnect removes all of that account’s saved credentials');
assert.equal((await context.espnStored(env,'matt','1396311343',2026)).leagueId,'1396311343','disconnect cannot touch another user');
// Execute the shipped browser adapter through the real Worker handler above.
const browser=vm.createContext({URL,localStorage:{getItem:()=> 'new-user'},fetch:async(url,init)=>{
  const u=new URL(url);calls.push({path:u.pathname+u.search,method:init.method});
  return route(u.pathname+u.search,init.method,init.body?JSON.parse(init.body):undefined,init.headers['X-Bozo-Session']);
}});
vm.runInContext(providers,browser);
await browser.DDProviders.espn.openWarroom({leagueId:'123456',season:'2026'});
assert.deepEqual(calls.map(x=>x.method),['GET','POST','GET'],'new user connects before reading');
assert.ok(calls.every(x=>x.path.includes('leagueId=123456&season=2026')),'all requests specify identity');
calls.length=0;
await browser.DDProviders.espn.openWarroom({leagueId:'123456',season:'2026'});
assert.deepEqual(calls.map(x=>x.method),['GET','GET'],'reload reuses the saved connection');
await assert.rejects(browser.DDProviders.espn.openWarroom({leagueId:'1396311343',season:'2026'}),e=>e.needsCredentials===true);
await browser.DDProviders.espn.openWarroom({leagueId:'1396311343',season:'2026',s2:'fixture-s2',swid:'{fixture-swid}'});
await assert.rejects(browser.DDProviders.espn.openWarroom({leagueId:'123456',season:'2026'},{fetch:async()=>Response.json({connected:true,leagueId:'123456',season:2026,league:{id:'999',season:2026}})}),/different league/,'browser rejects a stale/misrouted backend response');
// Test the exact War Room parser and verify executable inline scripts.
const start=html.indexOf('const ESPN_WR_SEASON='),end=html.indexOf('let leagueLoadGeneration=',start);
const pstart=html.indexOf('function providerInput('),pend=html.indexOf('\n/* ----------------------------------------------------------- rendering',pstart);
browser.window=browser;
vm.runInContext(html.slice(start,end)+html.slice(pstart,pend),browser);
const url='https://fantasy.espn.com/football/league?leagueId=1396311343';
assert.equal(browser.parseWarroomInput(url).provider,'espn');
assert.equal(browser.parseWarroomInput('1396311343','espn').provider,'espn');
assert.throws(()=>browser.parseWarroomInput('1396311343'),/Choose ESPN/);
assert.equal(browser.parseWarroomInput('1400972302392262656').provider,'sleeper','existing Sleeper ID shortcut still works');
assert.equal(browser.parseWarroomInput('1400972302392262656','sleeper').id,'1400972302392262656');
assert.throws(()=>browser.parseWarroomInput(url+'&seasonId=2025'),/2026 season/);
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/application\/ld\+json/.test(m[1]))new vm.Script(m[2]);
console.log('ESPN connection regressions passed: public/private setup, saved-session reuse, encryption, account/league/season isolation, mismatches, shares, revocation, URL/ID routing, and inline script syntax.');
