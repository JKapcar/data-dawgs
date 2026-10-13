'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),N=require('../dfs-nhl.js'),model=require('../dfs-nhl-model.js'),{build}=require('../tools/nhl-snapshot.cjs');
test('published snapshot is dated, attributed, derived-only and identity checked',()=>{
 assert.equal(model.season,2027);assert.equal(model.gameType,'02');assert.equal(model.players.length,725);assert.equal(model.receipt.identityAccepted,3392);assert.equal(model.receipt.identityRejected,0);assert.equal(model.attribution.license,'CC BY 4.0');assert.equal(model.receipt.trainingMaxDate,'2026-10-12');
 const ids=new Set();for(const p of model.players){assert(!ids.has(p.nhlId));ids.add(p.nhlId);assert(p.lastGame<model.asOf.slice(0,10));assert(p.minutes>0&&p.minutes<=100);assert(Object.values(p.rates).every(Number.isFinite));assert(!p.gameId);assert(p.name.trim().split(/\s+/).length>=2);}
});
test('representative official DK schema gets exact-name projections; DK IDs never become NHL IDs',()=>{
 const rows=model.players.filter(p=>p.pos!=='G').slice(0,3),text='Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame\n'+rows.map((p,i)=>['C',p.name+' ('+(100+i)+')',p.name,100+i,'C/UTIL',5000,p.team+'@ZZZ 10/13/2026 07:00PM ET',p.team,10].join(',')).join('\n');
 const pool=N.parsePool(text,'dk');assert.equal(pool.parsed,3);assert.equal(pool.rejected.length,0);
 for(const p of pool.players){assert.equal(p.nhlId,null);const projected=N.project(p,model);assert.equal(projected.match,'Exact name + team');assert(Number.isFinite(projected.subtotal));assert.equal(projected.points,null);assert(projected.flags.includes('Playing probability unknown'));assert.equal(p.own,null);}
 const p=pool.players[0];assert.equal(N.project({...p,nhlId:'999999999'},model).subtotal,null);assert.equal(N.project({...p,name:'Unknown Rookie'},model).subtotal,null);assert.equal(N.project({...p,team:'ZZZ'},model).subtotal,null);
 assert.equal(N.project({...p,date:'2026-10-12'},model).subtotal,null);
});
test('builder rejects mixed seasons, checks identities and excludes same-day games',()=>{
 const heads='game_id,player_id,player_name,team_abbrev,position,toi,game_date,goals,assists,shots_on_goal,blocked_shots,season\n';
 const box=heads+'2026020001,1,A. Test,AAA,C,20:30,2026-10-11,1,0,3,2,20262027\n2026020002,1,A. Test,AAA,C,21:00,2026-10-13,9,9,9,9,20262027';
 const roster='game_id,player_id,first_name,last_name,full_name,team_abbr,position_code,game_date,season\n2026020001,1,Alpha,Test,Alpha Test,AAA,C,2026-10-11,20262027';
 const m=build(box,roster,model.asOf);assert.equal(m.players[0].name,'Alpha Test');assert.equal(m.players[0].games,1);assert.equal(m.players[0].minutes,20.5);assert.equal(m.receipt.rejected.future,1);
 assert.throws(()=>build(box.replace('20262027','20252026'),roster,model.asOf),/season/);
 assert.throws(()=>build(box,roster.replace('Alpha Test,AAA','Alpha Test,BBB'),model.asOf),/No identity/);
});
