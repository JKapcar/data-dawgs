/* Current-week Sleeper projections and exact legal lineup selection.
   A missing projection stays missing. Season averages and dollar values never
   enter this optimizer. No lineup is submitted to the provider. */
(function(root){
  'use strict';
  const POS=['QB','RB','WR','TE','K','DEF'];
  const RESERVE=new Set(['BN','IR','TAXI']);
  const FLEX={FLEX:['RB','WR','TE'],'W/R/T':['RB','WR','TE'],
    WRRB_FLEX:['RB','WR'],REC_FLEX:['WR','TE'],
    SUPER_FLEX:['QB','RB','WR','TE'],SUPERFLEX:['QB','RB','WR','TE']};
  const norm=p=>p==='DEF'?'DST':p;
  function score(row,scoring){
    const stats=row&&row.stats;
    if(!stats||typeof stats!=='object')return null;
    let total=0,known=false;
    for(const [k,weight] of Object.entries(scoring||{})){
      const x=stats[k];
      if(x==null||x===''||!Number.isFinite(Number(x))||!Number.isFinite(Number(weight)))continue;
      known=true;total+=Number(x)*Number(weight);
    }
    return known?total:null;
  }
  function optimize(players,rawSlots,byId){
    const groups=[];
    for(const slot of rawSlots||[]){
      if(RESERVE.has(slot))continue;
      const eligible=FLEX[slot]||('QB RB WR TE K DST DEF'.split(' ').includes(slot)?[norm(slot)]:null);
      if(!eligible)return {ready:false,error:'Unsupported starting slot: '+slot,starters:[],bench:players.slice()};
      const g=groups.find(g=>g.slot===slot);
      if(g)g.count++;else groups.push({slot,eligible,count:1});
    }
    const needed=groups.reduce((n,g)=>n+g.count,0);
    if(!needed)return {ready:false,error:'No starting slots are configured.',starters:[],bench:players.slice()};
    // Capacity-state DP: each player can be used once, even when flex slots
    // overlap. For equal fill counts retain the highest projected point total.
    const zero=groups.map(()=>0);
    let states=new Map([[zero.join(','),{counts:zero,points:0,assignments:[]}]]);
    let missing=0;
    const seen=new Set();
    for(const player of players){
      const id=String(player.id);
      if(seen.has(id))continue;
      seen.add(id);
      const projected=byId.get(id);
      if(projected==null||!Number.isFinite(projected)){missing++;continue;}
      const positions=(player.positions?.length?player.positions:[player.pos]).map(norm);
      const next=new Map(states);
      for(const prior of states.values()){
        groups.forEach((g,i)=>{
          if(prior.counts[i]>=g.count||!positions.some(p=>g.eligible.includes(p)))return;
          const counts=prior.counts.slice();counts[i]++;
          const k=counts.join(','),points=prior.points+projected;
          if(!next.has(k)||points>next.get(k).points){
            next.set(k,{counts,points,assignments:prior.assignments.concat({slot:g.slot,player,points:projected})});
          }
        });
      }
      states=next;
    }
    const full=states.get(groups.map(g=>g.count).join(','));
    const best=full||[...states.values()].sort((a,b)=>
      b.assignments.length-a.assignments.length||b.points-a.points)[0];
    const used=new Set(best.assignments.map(a=>String(a.player.id)));
    const assignments=best.assignments.slice().sort((a,b)=>groups.findIndex(g=>g.slot===a.slot)-groups.findIndex(g=>g.slot===b.slot));
    return {ready:!!full,points:full?best.points:null,missing,needed,
      error:full?null:'Only '+best.assignments.length+' of '+needed+' starting slots have eligible projected players.',
      assignments,starters:assignments.map(a=>a.player),bench:players.filter(p=>!used.has(String(p.id)))};
  }
  async function load(league,fetcher){
    fetcher=fetcher||root.fetch.bind(root);
    const get=async url=>{const r=await fetcher(url,{cache:'no-store'});if(!r.ok)throw Error('Sleeper request failed ('+r.status+').');return r.json();};
    try{
      const nfl=await get('https://api.sleeper.app/v1/state/nfl');
      const season=String(league.season||'');
      if(season!==String(nfl.season)||!['regular','pre'].includes(nfl.season_type))
        throw Error('Current regular-season projections are unavailable for this league season.');
      const week=nfl.season_type==='pre'?1:Number(nfl.week);
      if(!Number.isInteger(week)||week<1||week>18)throw Error('Sleeper has not identified a current regular-season week.');
      const url='https://api.sleeper.app/projections/nfl/'+season+'/'+week+'?season_type=regular&order_by=pts_ppr'
        +POS.map(p=>'&position[]='+p).join('');
      const rows=await get(url);
      if(!Array.isArray(rows)||!rows.length)throw Error('Sleeper has no projections for week '+week+'.');
      const byId=new Map(),players=new Map();
      rows.forEach(r=>{if(r&&r.player_id!=null){
        const id=String(r.player_id),v=score(r,league.scoring_settings),p=r.player||{};
        if(v!=null)byId.set(id,v);
        players.set(id,{id,name:p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||'Sleeper player '+id,
          pos:norm(p.position||'Unknown'),positions:p.fantasy_positions||[p.position||'Unknown'],team:r.team||p.team});
      }});
      if(!byId.size)throw Error('No weekly projection stats match this league scoring.');
      return {ready:true,season,week,byId,players,capturedAt:new Date().toISOString(),source:url};
    }catch(e){return {ready:false,error:e.message||'Weekly projections could not be loaded.',capturedAt:new Date().toISOString()};}
  }
  const api={score,optimize,load};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.DDWeekly=api;
})(typeof globalThis!=='undefined'?globalThis:this);
