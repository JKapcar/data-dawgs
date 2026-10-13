/* Invented acceptance data. No user lineups or paid source rows. */
module.exports=()=>({version:1,site:'dk_showdown',synthetic:true,capturedAt:'2026-10-12T20:00:00Z',
 source:{name:'Synthetic private acceptance source',asOf:null,version:'test-v1'},
 players:Array.from({length:30},(_,i)=>({id:'synthetic-'+i,name:'SYNTHETIC_PRIVATE_'+i,pos:i%6===0?'QB':'WR',team:i<15?'AAA':'BBB',opp:i<15?'BBB':'AAA',sal:4000,proj:10+i/10,cptSal:6000,cptProj:(10+i/10)*1.5,own:54.3,cptOwn:i===1?null:9,flexOwn:i===2?0:45.3,injury:i===0?{status:'Not listed inactive',source:'Synthetic team report',asOf:'2026-10-12T19:00:00Z'}:null})),
 entries:[10,10,5,5,2,2,2].map((fee,i)=>({ids:[i,8,9,15,16,17],cpt:i,slots:['CPT','FLEX','FLEX','FLEX','FLEX','FLEX'],fee,lifecycle:'proposed',contestId:'test-contest',role:'synthetic build '+i,entryEvidence:null,history:[]})),
 contests:[{id:'test-contest',name:'Synthetic contest',source:'Invented lobby',asOf:null,fieldSize:100,entryLimit:20,fee:null,payouts:[50,20,10]}],
 notes:[{at:'2026-10-12T20:00:00Z',text:'SYNTHETIC_PRIVATE_NOTE with <b>literal markup</b>.'}],
 availabilityEvidence:{source:'Synthetic inactive evidence',verified:false,missing:null},
 scenarios:[],recommendations:[],extensionEvidence:{roles:['A',null,'B'],empty:[],longSource:'Synthetic source evidence beyond a workspace source field. '.repeat(8)}});
