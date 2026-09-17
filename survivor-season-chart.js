/* 2026 Circa calendar and maximum-product assignment. Uses the site's nfelo
 * probability policy and exact Hungarian solver; the display filter is not a constraint.
 * Official calendar: CircaSportsSurvivorContest.2026-FinalRules-19-JUNE-2026.pdf, rules 7–9.
 */
(function(root){
'use strict';
const HOLIDAYS=[
  {id:'TG',label:'TG',name:'Thanksgiving',dates:['2026-11-25','2026-11-26','2026-11-27']},
  {id:'XMAS',label:'XMAS',name:'Christmas',dates:['2026-12-24','2026-12-25']}
];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=p=>(p*100).toFixed(1)+'%';
function buildLegs(D,probability){
  if(D.meta.season!==2026) throw new Error('Circa calendar needs verification for this season.');
  const holidayDates=new Set(HOLIDAYS.flatMap(h=>h.dates));
  const legs=[];
  for(let w=1;w<=18;w++){
    for(const holiday of HOLIDAYS){
      const games=D.games.filter(g=>holiday.dates.includes(g.d));
      // Preserve empty holiday columns rather than silently skipping a required leg.
      const holidayWeek=holiday.id==='TG'?12:16;
      if(w===holidayWeek) legs.push({...holiday,week:w,holiday:true,games});
    }
    legs.push({id:'W'+w,label:'W'+w,name:'Week '+w,week:w,holiday:false,
      games:D.games.filter(g=>g.wk===w&&!holidayDates.has(g.d))});
  }
  return legs.map(leg=>({...leg,options:leg.games.flatMap(g=>{
    const {p,src}=probability(g);
    return [{team:g.h,opp:g.a,home:true,p,src,date:g.d,gameId:g.id},
      {team:g.a,opp:g.h,home:false,p:1-p,src,date:g.d,gameId:g.id}];
  })}));
}
function optimize(legs,used,hungarian){
  const spent=new Set(used);
  const teams=[...new Set(legs.flatMap(l=>l.options.map(o=>o.team)))].filter(t=>!spent.has(t)).sort();
  const tables=legs.map(l=>Object.fromEntries(l.options.map(o=>[o.team,o])));
  const n=Math.max(teams.length,legs.length), unavailable=1000;
  const cost=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>{
    if(j>=legs.length) return 0;
    const option=tables[j]?.[teams[i]];
    return option&&option.p>0?-Math.log(option.p):unavailable;
  }));
  const picks=Array(legs.length).fill(null);
  if(n) Array.from(hungarian(cost)).forEach((j,i)=>{
    if(i<teams.length&&j<legs.length&&cost[i][j]<unavailable) picks[j]=tables[j][teams[i]];
  });
  const complete=picks.every(Boolean);
  return {picks,complete,covered:picks.filter(Boolean).length,
    survival:complete?picks.reduce((p,o)=>p*o.p,1):null};
}
// Horizontal nudging only. A helmet's vertical position always encodes its exact p.
function layout(legs,solved,used,{only=false,line=true}={}){
  const spent=new Set(used), chosen=solved.picks.filter(Boolean);
  const min=Math.max(0,Math.min(.65,...chosen.map(p=>Math.floor((p.p-.012)*20)/20)));
  const max=Math.min(1,Math.max(.95,...legs.flatMap(l=>l.options.map(o=>Math.ceil((o.p+.012)*20)/20))));
  const width=Math.max(1460,legs.length*76+110),height=650,left=76,right=30,top=55,bottom=68;
  const step=(width-left-right)/Math.max(legs.length,1);
  const y=p=>top+(max-p)/(max-min)*(height-top-bottom);
  const points=[];
  legs.forEach((leg,j)=>{
    const placed=[];
    const options=leg.options.filter(o=>!spent.has(o.team)&&(o.p>=.65||o.team===solved.picks[j]?.team))
      .sort((a,b)=>Number(b.team===solved.picks[j]?.team)-Number(a.team===solved.picks[j]?.team)||b.p-a.p||a.team.localeCompare(b.team));
    options.forEach(o=>{
      const selected=o.team===solved.picks[j]?.team;
      if(only&&!selected)return;
      const base=left+step*(j+.5),py=y(o.p),offsets=[0,-24,24,-12,12,-30,30];
      const score=dx=>placed.reduce((s,q)=>s+Math.max(0,37-Math.hypot(base+dx-q.x,py-q.y)),0);
      const dx=selected?0:offsets.reduce((best,dx)=>score(dx)<score(best)?dx:best,0);
      const point={...o,leg:leg.id,legName:leg.name,index:j,selected,x:base+dx,y:py};
      placed.push(point);points.push(point);
    });
  });
  return {points,min,max,width,height,left,right,top,bottom,step,y,line};
}
let config={},allLegs=null,initialized=false;
function update(cfg){
  config=cfg;
  if(!root.document)return;
  const $=id=>document.getElementById(id);
  if(!initialized){
    allLegs=buildLegs(root.SV,g=>root.DDSurvivor.gameProb(g,config,root.SV));
    $('svSeasonStart').innerHTML=allLegs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const first=allLegs.find(l=>l.games.some(g=>g.d>=today));
    $('svSeasonStart').value=(first||allLegs[allLegs.length-1]).id;
    ['svSeasonStart','svSeasonLine','svSeasonOnly'].forEach(id=>$(id).addEventListener('change',()=>update(config)));
    const details=e=>{
      const el=e.target.closest('[data-detail]');
      if(el)$('svSeasonDetail').textContent=el.dataset.detail;
    };
    $('svSeasonChart').addEventListener('click',details);
    $('svSeasonChart').addEventListener('pointerover',details);
    $('svSeasonChart').addEventListener('focusin',details);
    $('svSeasonChart').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();details(e);}});
    initialized=true;
  }
  const start=allLegs.findIndex(l=>l.id===$('svSeasonStart').value),legs=allLegs.slice(start);
  const used=config.used||[],solved=optimize(legs,used,root.DDSurvivor.hungarian);
  const m=layout(legs,solved,used,{only:$('svSeasonOnly').checked,line:$('svSeasonLine').checked});
  const {width:W,height:H,left:L,top:T,bottom:B,step}=m;
  const ink='var(--chart-ink)',muted='var(--chart-muted)',orange='var(--chart-orange)',bg='var(--chart-bg)';
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="group" aria-labelledby="svSeasonSvgTitle svSeasonSvgDesc"><title id="svSeasonSvgTitle">Circa Survivor weekly win probability options</title><desc id="svSeasonSvgDesc">Helmets show team win probabilities by contest leg. Orange rings and a connecting line show the maximum-product no-repeat season path. Thanksgiving and Christmas are separate shaded columns.</desc>`;
  legs.forEach((l,j)=>{
    const x=L+step*j;
    if(l.holiday)svg+=`<rect x="${x+2}" y="18" width="${step-4}" height="${H-B-18}" fill="#efbf38" fill-opacity=".15"/><text x="${x+step/2}" y="36" text-anchor="middle" fill="${muted}" font-size="12" font-weight="800">HOLIDAY</text>`;
    else if(j===0)svg+=`<rect x="${x+2}" y="18" width="${step-4}" height="${H-B-18}" fill="#6cacf0" fill-opacity=".08"/>`;
    svg+=`<line x1="${x+step/2}" y1="${T}" x2="${x+step/2}" y2="${H-B}" stroke="var(--chart-grid)" opacity=".4"/><text x="${x+step/2}" y="${H-B+32}" text-anchor="middle" fill="${ink}" font-size="14" font-weight="700">${l.label}</text>`;
    if(!solved.picks[j])svg+=`<text x="${x+step/2}" y="${T+30}" text-anchor="middle" fill="${muted}" font-size="12">No pick</text>`;
  });
  for(let v=Math.ceil(m.min*20);v<=Math.floor(m.max*20);v++){
    const y=m.y(v/20);
    svg+=`<line x1="${L}" y1="${y}" x2="${W-30}" y2="${y}" stroke="var(--chart-grid)"/><text x="${L-14}" y="${y+5}" text-anchor="end" fill="${muted}" font-size="14">${v*5}%</text>`;
  }
  svg+=`<text transform="translate(20 ${H/2}) rotate(-90)" text-anchor="middle" fill="${ink}" font-size="15" font-weight="700">Win probability</text><text x="${W/2}" y="${H-8}" text-anchor="middle" fill="${ink}" font-size="15" font-weight="700">Circa Survivor contest leg</text>`;
  // Break at an unfilled leg: never suggest an incomplete path is continuous.
  if(m.line){
    let segment=[];
    const flush=()=>{if(segment.length>1){const p=segment.map(o=>`${o.x},${o.y}`).join(' ');svg+=`<polyline points="${p}" fill="none" stroke="${bg}" stroke-width="9" stroke-linejoin="round"/><polyline class="sv-season-route" points="${p}" fill="none" stroke="${orange}" stroke-width="4" stroke-linejoin="round"/>`;}segment=[];};
    legs.forEach((l,j)=>{const p=m.points.find(o=>o.selected&&o.index===j);if(p)segment.push(p);else flush();});flush();
  }
  m.points.sort((a,b)=>Number(a.selected)-Number(b.selected)).forEach(p=>{
    const highlight=p.selected&&m.line,size=highlight?44:35;
    const detail=`${p.legName} · ${p.team} ${p.home?'vs':'at'} ${p.opp} · ${pct(p.p)} · ${p.date} · ${p.src==='nfelo'?'Published nfelo forecast':'nfelo-based season projection'}${p.selected?' · Optimized pick':''}`;
    svg+=`<g class="sv-season-point" tabindex="0" role="button" aria-label="${esc(detail)}" data-detail="${esc(detail)}" data-leg="${p.leg}" data-team="${p.team}" data-probability="${p.p}" data-selected="${p.selected}"><title>${esc(detail)}</title><circle class="sv-season-hit" cx="${p.x}" cy="${p.y}" r="${highlight?25:20}" fill="${highlight?bg:'transparent'}" stroke="${highlight?orange:'transparent'}" stroke-width="3"/><image href="assets/helmets/${p.team}_right.webp" x="${p.x-size/2}" y="${p.y-size/2}" width="${size}" height="${size}" opacity="${m.line && !p.selected ? 0.78 : 1}"/>`;
    if(highlight)svg+=`<rect x="${p.x-25}" y="${p.y+26}" width="50" height="20" rx="5" fill="${orange}"/><text x="${p.x}" y="${p.y+40}" text-anchor="middle" fill="${bg}" font-size="12" font-weight="800">${pct(p.p)}</text>`;
    svg+='</g>';
  });
  $('svSeasonChart').innerHTML=svg+'</svg>';
  $('svSeasonSubtitle').textContent=`Teams at 65% or higher · Separate holiday legs · nfelo data ${root.SV.meta.captured}`;
  $('svSeasonOdds').textContent=solved.complete?(solved.survival*100).toFixed(2)+'%':'Incomplete';
  $('svSeasonDetail').textContent=`${solved.covered} of ${legs.length} legs filled. Tap or focus a helmet for its matchup and exact probability.`;
  const below=solved.picks.filter(p=>p&&p.p<.65).length;
  $('svSeasonNote').innerHTML=`Maximum-product path from ${esc(legs[0].name)}; each team used once. ${used.length} spent team${used.length===1?'':'s'} excluded from Settings${used.length?'':'; record your earlier picks there to personalize the path'}. ${below?`${below} optimized pick${below===1?'':'s'} below 65% remain visible. `:''}Future games use nfelo-based season projections. These are win probabilities, not odds of winning the pool. <a href="https://www.circasports.com/wp-content/uploads/2026/06/CircaSportsSurvivorContest.2026-FinalRules-19-JUNE-2026.pdf" target="_blank" rel="noopener">2026 rules</a>: TG Nov 25–27; Christmas Dec 24–25. This Circa chart uses one pick per leg; the weekly pool settings and backup cards below are separate.`;
  $('svSeasonTable').innerHTML='<tr><th>Leg</th><th>Team</th><th>Opponent</th><th>Win probability</th></tr>'+legs.map((l,j)=>{const p=solved.picks[j];return `<tr><td>${l.name}</td><td>${p?p.team:'No available team'}</td><td>${p?`${p.home?'vs':'at'} ${p.opp}`:'—'}</td><td>${p?pct(p.p):'—'}</td></tr>`;}).join('');
}
root.DDSurvivorSeasonChart={buildLegs,optimize,layout,update};
})(typeof module!=='undefined'&&module.exports?module.exports:window);
