const P8=["Butts","JWhite","Kap","Manzeo","Squatch","The Kid","Tony","Tucholski"];
export const roster={players:P8.map(n=>({name:n,claimed:true}))};
const stdSet={stake:50,allowEdit:true,lockRule:'all',lockCount:0,levers:[0,1,2,3],format:'standard',buyback:0,formatLocked:false,synthetic:false};
export const leagues={defaultLeague:'main',leagues:[
 {id:'main',name:'Bozo Boyz',manager:'Kap',size:8,members:P8,week:1,status:'open',settings:{...stdSet}},
 {id:'demo',name:'Bozo Boyz (DEMO)',manager:'Kap',size:8,members:P8,week:22,status:'graded',settings:{...stdSet,synthetic:true}},
 {id:'royale',name:'Bozo Royale (DEMO)',manager:'Kap',size:8,members:P8,week:14,status:'graded',settings:{...stdSet,synthetic:true,format:'royale',buyback:25}}
]};
const T=1786661665821;
export const state={
 main:{season:2026,week:1,status:'open',config:{bandCeil:-100,bandFloor:-500},
  picks:{Kap:{sport:'nfl',game:'TEN @ SF',eventId:'401874392',mkt:'ml',side:'TEN',line:null,price:-245,priceOpp:200,label:'TEN ML',ts:T}},
  results:{},order:null,bozo:null,history:[]},
 // a fuller open board, 5 of 8 in — for layout stress
 main5:{season:2026,week:1,status:'open',config:{bandCeil:-100,bandFloor:-500},
  picks:{
   Kap:{sport:'nfl',game:'TEN @ SF',eventId:'401874392',mkt:'ml',side:'TEN',line:null,price:-245,priceOpp:200,label:'TEN ML',ts:T},
   Tony:{sport:'nfl',game:'DAL @ PHI',eventId:'4018',mkt:'spread',side:'PHI',line:-6.5,price:-115,priceOpp:-105,label:'PHI -6.5',ts:T+6e5},
   Squatch:{sport:'cfb',game:'OSU @ MICH',eventId:'4019',mkt:'ml',side:'OSU',line:null,price:-400,priceOpp:310,label:'OSU ML',ts:T+12e5},
   JWhite:{sport:'nfl',game:'KC @ BUF',eventId:'4020',mkt:'total',side:'over',line:47.5,price:-110,priceOpp:-110,label:'KC/BUF o47.5',ts:T+18e5},
   Butts:{sport:'nba',game:'BOS @ NYK',eventId:'4021',mkt:'prop',side:'over',line:27.5,price:-135,priceOpp:105,label:'Tatum o27.5 pts',prop:'Tatum points',ts:T+24e5}},
  results:{},order:null,bozo:null,history:[]},
 demo:{season:2026,week:22,status:'graded',config:{bandCeil:-100,bandFloor:-500},
  picks:Object.fromEntries(P8.map((n,i)=>[encodeURIComponent(n),
   {sport:'nfl',game:['DEN @ LV','MIA @ NYJ','GB @ CHI','SEA @ ARI','LAR @ SF','CIN @ CLE','HOU @ IND','NO @ ATL'][i],
    eventId:'50'+i,mkt:i%2?'spread':'ml',side:['DEN','MIA','GB','SEA','LAR','CIN','HOU','NO'][i],
    line:i%2?-3.5:null,price:[-365,-150,-220,-110,-190,-135,-260,-175][i],priceOpp:[290,125,180,-110,155,110,215,145][i],
    label:['DEN ML','MIA -3.5','GB ML','SEA -3.5','LAR ML','CIN -3.5','HOU ML','NO -3.5'][i],ts:T+i*36e5}])),
  results:Object.fromEntries(P8.map((n,i)=>[encodeURIComponent(n),{won:i!==2&&i!==5&&i!==7,actual:i===2?-4:i===5?-6:i===7?-1:null}])),
  order:[0,3,1,2],bozo:'Kap',bozoWhy:'Shortest odds among the losing legs (DEN ML -365).',
  history:[{week:20,bozo:'Tony'},{week:21,bozo:'Squatch'},{week:19,bozo:'Kap'}]}
};
state.royale=JSON.parse(JSON.stringify(state.demo));
state.royale.week=14;
