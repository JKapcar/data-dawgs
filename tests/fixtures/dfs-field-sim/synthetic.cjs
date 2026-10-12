// Invented scores, participants and payouts. Test mechanics only; never a model default.
const source={name:'Synthetic fixture',version:'synthetic-v1',asOf:'2026-10-12T12:00:00Z'};
const slots=['CPT','FLEX','FLEX','FLEX','FLEX','FLEX'];
function lineup(ids=[0,1,2,3,4,5],cpt=0){return {ids,slots:slots.slice(),cpt};}
function fixture(){
 const pool={site:'dk_showdown',slate:'SYNTHETIC AAA @ BBB',source:{...source},players:Array.from({length:8},(_,id)=>({uid:'synthetic-'+id,name:'Synthetic '+id,pos:id===0?'QB':'WR',team:id%2?'BBB':'AAA',opp:id%2?'AAA':'BBB',sal:5000,cptSal:7500,proj:10,own:50,cptProj:15}))};
 const opponent={...lineup(),participantId:'synthetic-participant'};
 return {version:1,pool,candidates:[{id:'candidate',participantId:'candidate-owner',...lineup()}],
  settings:{seed:0,iterations:200,evaluatedAt:'2026-10-12T13:00:00Z',maxAgeHours:6},
  scoreModel:{type:'joint_worlds',basis:'synthetic',source:{...source},projectionVersion:source.version,playerIds:pool.players.map(p=>p.uid),scoreDecimals:2,captainPolicy:'official_1_5',worlds:[{weight:1,scores:Array(8).fill(10)},{weight:1,scores:Array(8).fill(10)}]},
  contests:[{id:'synthetic-contest',kind:'illustrative',site:pool.site,slate:pool.slate,source:{...source},fieldSize:2,entryLimit:1,entryFee:10,tiePayoutRule:'pool_occupied_places_equally',payouts:[20,0],field:{mode:'complete',source:{...source},scoreRelationship:'fixed_before_outcomes',entries:[opponent]}}]};
}
function complete(r,entries){r.contests[0].field={mode:'complete',source:{...source},scoreRelationship:'fixed_before_outcomes',entries:entries.map((e,i)=>({participantId:'synthetic-'+i,...e}))};r.contests[0].fieldSize=entries.length+1;r.contests[0].payouts=Array(entries.length+1).fill(0);}
module.exports={fixture,lineup,complete,source};
