/* Goal Lens UI. Re-scores the calculator's own outcome lots under another goal.
 * The verdict card above stays the win-probability call; this panel never replaces it. */
(()=>{'use strict';
 const G=window.DDFourthGoals,$=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const colors={go:'#e96512',fg:'#2d87b7',punt:'#a17ac1'},names={go:'Go for it',fg:'Field goal',punt:'Punt'};
 const clockText=s=>{s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
 const pts=v=>v.toFixed(1)+' pts';
 const ORDER=['win','avg','above','band','loss'];
 window.DDFourthLens={create({onChange}){
  let base=null,scenario=null,clock=null,env=null,loadError='',result=null,stripTimer=0;
  const state={goal:'win',params:{},horizon:undefined};   // horizon: undefined = the goal's default, null = rest of game, number = seconds
  const goal=()=>G.GOALS[state.goal];
  // Shared links: ?goal=above&gp=50&gh=300 (gh=rest for the whole game)
  const q=new URLSearchParams(location.search);
  if(q.has('goal')&&G.GOALS[q.get('goal')]){
   state.goal=q.get('goal');const p=goal().params[0],gp=Number(q.get('gp'));
   if(p&&q.get('gp')!==null&&q.get('gp')!==''&&Number.isFinite(gp))state.params[p.id]=gp;
   const gh=q.get('gh'),n=Number(gh);
   if(gh==='rest')state.horizon=null;else if(gh!==null&&gh!==''&&Number.isFinite(n)&&n>=0)state.horizon=n;
  }
  $('fd-goal-picks').innerHTML=ORDER.map(id=>`<button type="button" data-goal="${id}" aria-pressed="false">${esc(G.GOALS[id].label)}</button>`).join('');
  const rest=()=>base?Math.max(0,base.secondsLeft-6):0;
  // Horizon slider positions: 0 = the moment after the play, last = rest of game.
  const step=()=>{const t=rest();return t>1800?120:t>600?60:t>120?15:5;};
  const stops=()=>{const t=rest(),s=step(),out=[0];for(let v=s;v<t-s/2;v+=s)out.push(v);out.push(null);return out;};
  const horizonNow=()=>state.horizon===undefined?goal().horizon??null:state.horizon;
  function horizonIndex(){const h=horizonNow(),list=stops();if(h===null||h>=rest())return list.length-1;let best=0;list.forEach((v,i)=>{if(v!==null&&Math.abs(v-h)<Math.abs(list[best]-h))best=i;});return best;}
  const horizonLabel=h=>h===null||h>=rest()?`Rest of the game · ${clockText(rest())}`:h===0?'The moment after this play':`Next ${clockText(h)}`;
  function value(c,r){
   if(c.value===null)return '—';
   if(r.unit==='felt')return (c.value*100).toFixed(1).replace('-','−')+' pts';
   return (c.value*100).toFixed(1)+'%';
  }
  function paintStrip(id,cells,active,onPick){
   const el=$(id);
   el.innerHTML=cells.map((c,i)=>`<button type="button" tabindex="-1" data-i="${i}" class="${i===active?'on':''}${c.r.best&&(c.r.tooClose||c.r.tie)?' faint':''}" style="--key:${c.r.best?colors[c.r.best]:'var(--grid)'}" title="${esc(c.label)}: ${c.r.best?esc(names[c.r.best])+(c.r.tie?' (level)':c.r.tooClose?' (too close to call)':''):'not scored'}"></button>`).join('');
   el.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>onPick(cells[Number(b.dataset.i)])));
  }
  function strips(){
   if(!result?.available||!goal().path&&!goal().params.length)return;
   const p=goal().params[0],P=G.params(state.goal,state.params);
   if(p){
    const n=Math.round((p.max-p.min)/p.step),every=Math.max(1,Math.ceil(n/30)),cells=[];
    for(let i=0;i<=n;i+=every){const v=+(p.min+i*p.step).toFixed(4);cells.push({v,label:v+p.suffix.trim()});}
    const swept=G.sweep(base,scenario,{...state,horizon:horizonNow()},clock,cells.map(c=>({params:{[p.id]:c.v}})));
    cells.forEach((c,i)=>c.r=swept[i]);
    let on=0;cells.forEach((c,i)=>{if(Math.abs(c.v-P[p.id])<Math.abs(cells[on].v-P[p.id]))on=i;});
    paintStrip('fd-goal-param-strip',cells,on,c=>{state.params[p.id]=c.v;draw();});
   }
   if(goal().path){
    const list=stops(),every=Math.max(1,Math.ceil(list.length/30)),cells=[];
    list.forEach((h,i)=>{if(i%every===0||i===list.length-1)cells.push({h,i,label:horizonLabel(h)});});
    const swept=G.sweep(base,scenario,state,clock,cells.map(c=>({horizon:c.h})));
    cells.forEach((c,i)=>c.r=swept[i]);
    const at=horizonIndex();let on=0;cells.forEach((c,i)=>{if(Math.abs(c.i-at)<Math.abs(cells[on].i-at))on=i;});
    paintStrip('fd-goal-horizon-strip',cells,on,c=>{state.horizon=c.h;draw();});
   }
  }
  function method(){
   if(!env)return loadError||'Loading the measured path model…';
   const d=env.data,t=d.test,gap=Math.max(...d.martingale_check.map(r=>Math.abs(r.mean_wp_now-r.mean_realized_average_wp)));
   return `Time-based goals need more than the win probability after the play: they need how it travels from there to the final gun. That path is modelled as a diffusion on a measured information clock, fitted on ${d.fit.seasons[0]}–${d.fit.seasons[1]} play-by-play (${d.fit.games.toLocaleString()} games) and tested on ${t.seasons[0]}–${t.seasons[1]} (${t.games.toLocaleString()} games it never saw). On those held-out games its clock shares miss by ${pts(100*t.rmse_outside_abstain_window)} (RMSE) outside the final ${d.abstain_below_seconds} seconds, and by ${pts(100*t.by_clock[0].rmse)} inside them, so it does not answer there. A plain random walk misses by ${pts(100*d.alternatives_on_test.plain_brownian_rmse)}. The path can never move expected win probability: across ${d.martingale_check.reduce((a,r)=>a+r.n,0).toLocaleString()} play-sides, realised average win probability stayed within ${pts(100*gap)} of the starting value in every tenth. Built ${env.as_of}.`;
  }
  function draw(live=false){
   if(!base)return;
   const g=goal(),P=G.params(state.goal,state.params);state.params=P;
   $('fd-goal').hidden=false;
   $('fd-goal-picks').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.goal===state.goal));
   $('fd-goal-blurb').textContent=g.blurb;
   const p=g.params[0];
   $('fd-goal-param-control').hidden=!p;$('fd-goal-horizon-control').hidden=!g.path;
   if(p){
    const input=$('fd-goal-param');input.min=p.min;input.max=p.max;input.step=p.step;input.value=P[p.id];
    $('fd-goal-param-label').textContent=p.label;$('fd-goal-param-value').textContent=P[p.id]+p.suffix;input.setAttribute('aria-valuetext',P[p.id]+p.suffix);
    $('fd-goal-presets').innerHTML=(g.presets||[]).map(([label,v])=>`<button type="button" data-v="${v[p.id]}" aria-pressed="${v[p.id]===P[p.id]}">${esc(label)} · ${v[p.id]}${esc(p.suffix)}</button>`).join('');
    $('fd-goal-presets').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state.params[p.id]=Number(b.dataset.v);draw();}));
   }
   if(g.path){
    const list=stops(),input=$('fd-goal-horizon'),i=horizonIndex();input.max=list.length-1;input.value=i;
    $('fd-goal-horizon-value').textContent=horizonLabel(list[i]);input.setAttribute('aria-valuetext',horizonLabel(list[i]));
   }
   try{result=G.evaluate(base,scenario,{...state,horizon:horizonNow()},clock);}
   catch(e){result={available:false,reason:e.message,goal:state.goal,label:g.label};}
   const r=result,v=$('fd-goal-verdict');
   $('fd-goal-method').textContent=method();
   if(!r.available){
    v.className='fd-goal-verdict off';v.innerHTML=`<b>Not scored here.</b><span>${esc(clock||!g.path?r.reason:loadError||'Loading the measured path model…')}</span>`;
    $('fd-goal-bars').innerHTML='';$('fd-goal-note').textContent='';$('fd-goal-param-strip').innerHTML='';$('fd-goal-horizon-strip').innerHTML='';onChange();return;
   }
   const best=r.choices.find(c=>c.id===r.best),runner=r.choices.find(c=>c.id===r.runnerUp),unit=r.unit==='wp'?'pp':'pts';
   let head,sub,tone='same';
   if(state.goal==='win'){head=`${best.label}.`;sub='This is the bot’s own goal, so this is the call above. Pick another goal to see whether it survives.';}
   else if(r.identity){head='Same numbers. Always.';sub='Win probability is already a fair forecast of the final result, so its expected value at every later moment equals its value now. Averaging it over the rest of the game returns the number you started with. This goal cannot change any call; the measured check is in the method note below.';}
   else if(r.tie){head='No difference under this goal.';sub=`${best.label} and ${runner.label.toLowerCase()} score the same here. The bot’s call stands.`;tone='close';}
   else if(r.tooClose){head='Too close to call under this goal.';sub=`${best.label} leads ${runner.label.toLowerCase()} by ${r.edge.toFixed(1)} ${unit}, inside the path model’s ${pts(100*clock.error)} held-out error. Not a finding either way.`;tone='close';}
   else if(r.agrees){head=`Same call: ${best.label}.`;sub=`Playing for ${r.describe}, ${best.label.toLowerCase()} still leads ${runner.label.toLowerCase()} by ${r.edge.toFixed(1)} ${unit}.`;}
   else{head=`Different call: ${best.label}.`;sub=`Playing for ${r.describe}, ${best.label.toLowerCase()} beats ${runner.label.toLowerCase()} by ${r.edge.toFixed(1)} ${unit}. Following it instead of the bot’s ${names[r.standardBest].toLowerCase()} gives up ${r.wpCost.toFixed(1)} pp of win probability.`;tone='flip';}
   v.className='fd-goal-verdict '+tone;v.innerHTML=`<b>${esc(head)}</b><span>${esc(sub)}</span>`;
   const shown=r.choices.filter(c=>c.value!==null).map(c=>c.value),lo=Math.min(...shown),hi=Math.max(...shown);
   const width=c=>c.value===null?0:r.unit==='felt'?(hi===lo?100:40+60*(c.value-lo)/(hi-lo)):Math.max(0,Math.min(100,c.value*100));
   $('fd-goal-bars').innerHTML=r.choices.filter(c=>c.value!==null).map(c=>`<div class="fd-bar-row ${c.id===r.best&&!r.tie&&!r.tooClose?'best':''}"><header><span>${esc(c.label)}${c.id===r.best&&!r.tie&&!r.tooClose?'<small>BEST FOR THIS GOAL</small>':''}</span><strong>${value(c,r)}</strong></header><div class="fd-bar-track"><div class="fd-bar-fill" style="width:${width(c)}%"></div></div>${r.unit==='wp'?'':`<span class="fd-note">${r.unit==='share'&&!r.instant?`${clockText(c.seconds)} of the next ${clockText(r.horizonSeconds)} · `:''}win probability ${(c.wp*100).toFixed(1)}%</span>`}</div>`).join('');
   $('fd-goal-legend').hidden=!g.path;
   $('fd-goal-note').textContent=!r.path?'Win probabilities are the nfl4th model estimates'+(scenario&&scenario!==base&&(scenario.conversion!==base.conversion||scenario.fgMake!==base.fgMake)?' under your slider scenario':'')+'.'
    :r.instant?(r.unit==='share'?`With the horizon at the moment after the play, each bar is the chance the play itself leaves win probability ${r.range}. No path model is involved.`:`Felt points: change in win probability right after the play, with any drop below ${(r.reference*100).toFixed(1)}% (where the best call leaves you) counted ${r.params.k}×. Zero would mean no expected pain. No path model is involved.`)
    :(r.unit==='share'?`Share of the next ${clockText(r.horizonSeconds)} of game clock, averaged over every modelled outcome. `:`Felt points: win probability with time spent below ${(r.reference*100).toFixed(1)}% counted ${r.params.k}×, averaged over the next ${clockText(r.horizonSeconds)}. `)+'Modelled path, regulation only, not a forecast of this game.';
   clearTimeout(stripTimer);
   if(live)stripTimer=setTimeout(strips,140);else strips();
   onChange();
  }
  $('fd-goal-picks').addEventListener('click',e=>{const b=e.target.closest('[data-goal]');if(!b)return;state.goal=b.dataset.goal;state.params={};state.horizon=undefined;draw();});
  $('fd-goal-param').addEventListener('input',()=>{const p=goal().params[0];state.params[p.id]=Number($('fd-goal-param').value);draw(true);});
  $('fd-goal-horizon').addEventListener('input',()=>{state.horizon=stops()[Number($('fd-goal-horizon').value)];draw(true);});
  fetch('data/fourth-down-paths.json',{cache:'no-store'}).then(v=>{if(!v.ok)throw Error();return v.json();}).then(v=>{clock=G.createClock(v);env=v;draw();}).catch(()=>{loadError='The measured path model is unavailable, so time-based goals cannot be scored. Win the game and Average win probability still work.';draw();});
  return {
   setResult(b,s){base=b;scenario=s||b;draw();},
   hide(){base=null;result=null;$('fd-goal').hidden=true;},
   active:()=>state.goal!=='win',
   shareParams(sp){if(state.goal==='win')return;sp.set('goal',state.goal);const p=goal().params[0];if(p)sp.set('gp',state.params[p.id]);if(goal().path){const h=horizonNow();sp.set('gh',h===null||h>=rest()?'rest':h);}},
   copyLine(){
    const r=result;if(!r||state.goal==='win')return '';
    if(!r.available)return `\nGoal lens (${r.label}): not scored here.`;
    if(r.identity)return '\nGoal lens (Average win probability): identical to win probability by construction.';
    return `\nGoal lens, not the bot’s call · ${r.label}${goal().params[0]?' '+r.params[goal().params[0].id]+goal().params[0].suffix:''}${r.path?' · '+horizonLabel(horizonNow()):''}: ${r.choices.filter(c=>c.value!==null).map(c=>`${c.label} ${value(c,r)}`).join(', ')}. ${r.tie?'Level.':r.tooClose?'Too close to call.':`${names[r.best]}${r.agrees?' (same call)':` (differs; costs ${r.wpCost.toFixed(1)} pp of win probability)`}.`} Modelled path.`;
   },
   getState(){
    const r=result;if(!r)return null;
    const out={goal:r.goal,label:r.label,isBotGoal:state.goal==='win',available:!!r.available};
    if(!r.available)return {...out,reason:r.reason};
    return {...out,measures:r.describe,unit:r.unit==='wp'?'win probability':r.unit==='share'?'share of game clock in the horizon':'felt points (loss-weighted win probability change)',params:r.params,
     horizon:r.path?(r.instant?'the moment after this play':horizonLabel(horizonNow())):null,
     values:Object.fromEntries(r.choices.map(c=>[c.id,c.value===null?null:+(100*c.value).toFixed(2)])),
     lensBest:r.tie||r.tooClose?null:r.best,botBest:r.standardBest,sameCallAsBot:r.tie||r.tooClose?null:r.agrees,edge:+r.edge.toFixed(2),level:r.tie,tooCloseToCall:!!r.tooClose,identicalToWinProbabilityByConstruction:r.identity,
     winProbabilityGivenUpPP:r.tie||r.tooClose?null:+r.wpCost.toFixed(2),
     pathModel:r.path&&!r.instant?{status:'modelled, not observed',builtAsOf:clock.asOf,fittedSeasons:clock.fit,testedSeasons:clock.test,heldOutErrorPts:+(100*clock.error).toFixed(2),abstainsBelowSeconds:clock.abstainBelow}:null};
   }};
 }};
})();
