const test=require('node:test');
const assert=require('node:assert/strict');
const {score,optimize,load}=require('../warroom-weekly.js');
const player=(id,pos)=>({id:String(id),name:'Player '+id,pos});

test('uses league scoring, preserving zero and negative totals without a half-PPR fallback',()=>{
  assert.equal(score({stats:{rec:5,rec_yd:50,pts_half_ppr:99}},{rec:1,rec_yd:.1}),10);
  assert.equal(score({stats:{pass_td:1,pass_int:2,pts_half_ppr:99}},{pass_td:4,pass_int:-2}),0);
  assert.equal(score({stats:{pass_int:2}},{pass_int:-2}),-4);
  assert.equal(score({stats:{pts_half_ppr:99}},{rec:1}),null);
  assert.equal(score({stats:{rec:null}},{rec:1}),null);
});
test('maximizes flex assignment regardless of slot order and uses each player only once',()=>{
  const p=[player('q','QB'),player('r','RB'),player('w','WR'),player('t','TE')];
  const vals=new Map([['q',20],['r',10],['w',15],['t',14]]);
  const result=optimize(p,['FLEX','REC_FLEX','RB'],vals);
  assert.equal(result.ready,true);
  assert.equal(result.points,39);
  assert.equal(new Set(result.starters.map(p=>p.id)).size,3);
  const sf=optimize(p,['SUPER_FLEX','QB','RB'],vals);
  assert.equal(sf.points,45);
  assert.equal(sf.assignments.find(a=>a.slot==='QB').player.id,'q');
});
test('weekly points choose a different flex from season projections and dollar values',()=>{
  const a={...player('a','WR'),p:5,dollars:1},b={...player('b','TE'),p:25,dollars:100};
  const r=optimize([a,b],['FLEX'],new Map([['a',8],['b',4]]));
  assert.equal(r.starters[0].id,'a');assert.equal(r.bench[0].id,'b');
});
test('missing projections cannot fill a slot or masquerade as zero',()=>{
  const r=optimize([player('q','QB'),player('r','RB')],['QB','RB'],new Map([['r',0]]));
  assert.equal(r.ready,false);assert.equal(r.points,null);assert.equal(r.missing,1);
  const ready=optimize([player('q','QB')],['QB'],new Map([['q',-1]]));
  assert.equal(ready.ready,true);assert.equal(ready.points,-1);
});
test('matches a brute-force optimum across overlapping flex fixtures',()=>{
  let seed=13;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let run=0;run<40;run++){
    const ps=['QB','RB','WR','TE','RB','WR'].map((p,i)=>player(i,p));
    const vals=new Map(ps.map(p=>[p.id,Math.floor(random()*30)-2]));
    const slots=['FLEX','QB','REC_FLEX'];let expected=-Infinity;
    for(const a of ps)for(const b of ps)for(const c of ps){
      if(new Set([a.id,b.id,c.id]).size<3||!['RB','WR','TE'].includes(a.pos)||b.pos!=='QB'||!['WR','TE'].includes(c.pos))continue;
      expected=Math.max(expected,vals.get(a.id)+vals.get(b.id)+vals.get(c.id));
    }
    assert.equal(optimize(ps,slots,vals).points,expected);
  }
});
test('loads the NFL current week, refreshes rollover, and does not use season projections',async()=>{
  let week=1;const urls=[];
  const fetcher=async(url,options)=>{
    urls.push(url);assert.equal(options.cache,'no-store');
    return {ok:true,json:async()=>url.endsWith('/state/nfl')?{season:'2026',season_type:'regular',week}
      :[{player_id:'a',player:{first_name:'Fixture',last_name:'Receiver',position:'WR'},stats:{rec:5}}]};
  };
  const league={season:'2026',scoring_settings:{rec:1}};
  const a=await load(league,fetcher);assert.equal(a.week,1);assert.equal(a.byId.get('a'),5);
  week=2;const b=await load(league,fetcher);assert.equal(b.week,2);
  assert.match(urls[1],/2026\/1\?/);assert.match(urls[3],/2026\/2\?/);
  assert.equal((await load({...league,scoring_settings:{rec:.5}},fetcher)).byId.get('a'),2.5);
});
test('failed, empty, and wrong-season feeds return an unavailable state',async()=>{
  assert.equal((await load({},async()=>{throw Error('offline')})).ready,false);
  const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/state/nfl')?{season:'2026',season_type:'regular',week:1}:[]});
  assert.equal((await load({season:'2026'},fetcher)).ready,false);
  assert.equal((await load({season:'2025'},fetcher)).ready,false);
});
