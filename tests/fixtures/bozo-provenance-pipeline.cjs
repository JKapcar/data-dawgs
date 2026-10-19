const assert=require('node:assert/strict'),vm=require('node:vm');
const {build,page,worker}=require('./bozo-beat-harness.cjs');
const lift=(s,n)=>s.match(new RegExp(`(?:async )?function ${n}\\([\\s\\S]*?\\n\\}`))[0];
function buildPick(captured){
 const {server}=build(page,worker);
 Object.assign(server,{bozoLabelWithPeriod:x=>x,selectionKeyOf:()=> 'selection',marketKeyOf:()=> 'market'});
 vm.runInContext(lift(worker,'buildBozoLeg'),server);
 return server.buildBozoLeg('Pat',captured);
}
async function assertHistorical(pick,source){
 const {server,ui}=build(page,worker);
 for(const n of ['ledgerEntries','bozoClv'])vm.runInContext(lift(worker,n),server);
 Object.assign(server,{ledgerKey:(s,w,n)=>`${s}-${w}-${n}`,validLeagueId:()=>true,loadLeague:async()=>({season:2026,week:6}),
  LG:()=>'/test',settingsOf:()=>({format:'standard'}),memberNames:()=>[],ticketPricing:()=>[],BOZO_CLOSE_BOOK:'draftkings',json:x=>x});
 const row=server.ledgerEntries('main',2026,6,{Pat:pick},[1])['2026-6-Pat'];
 assert.equal(row.entryOppSource,source);assert.equal(row.period,pick.period);
 // Only settlement is supplied by the fixture; prices, period and provenance come from production paths.
 server.fbGet=async()=>({data:{row:{...row,result:'lost',actual:-3,worstBeatRule:'entry-normal-v2'}}});
 const clv=await server.bozoClv({},new URL('https://example.test?league=main'),{},{});
 assert.equal(clv.legs[0].entryOppSource,source);assert.equal(clv.legs[0].period,pick.period);
 vm.runInContext(lift(page,'royalePool')+'\n globalThis.clvDevig=devigP;',ui);
 Object.assign(ui,{S:{season:2026,week:6,worstBeatPolicy:{version:'entry-normal-v2',season:2026,week:6}},CLV:{data:clv}});
 const expected=server.royaleBeatDeficit(pick,{result:'lost',actual:-3},'entry-normal-v2').v;
 assert.ok(Number.isFinite(expected));
 assert.equal(ui.beatOf(pick,{result:'lost',actual:-3}),expected);
 assert.equal(ui.royalePool('Pat')[0].beat,expected);
}
module.exports={buildPick,assertHistorical};
