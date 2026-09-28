/* Both sliders use the exact same conditional outcomes as the decision cards. */
(()=>{'use strict';
 const A=window.DDFourthAnalysis,$=id=>document.getElementById(id),pct=x=>x==null?'—':(x*100).toFixed(1)+'%',esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const colors={go:'#e96512',fg:'#2d87b7',punt:'#a17ac1',model:'#9b793c',team:'#23956d',median:'#8a7c68',selected:'#e96512'};
 function svgStart(title,h){return `<svg viewBox="0 0 600 ${h}" role="img" aria-label="${esc(title)}" xmlns="http://www.w3.org/2000/svg"><title>${esc(title)}</title>`;}
 const line=(x,y,x2,y2,color,dash='',width=2)=>`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
 const txt=(x,y,t,anchor='start',color='currentColor')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-size="16">${esc(t)}</text>`;
 function decisionChart(base,r,kind,hist){
  const success=kind==='go'?base.successWP:base.makeWP,fail=kind==='go'?base.failWP:base.missWP,p=kind==='go'?r.conversion:r.fgMake;
  const comparisons=A.comparisons(r,kind),pts=[fail,success,...comparisons.map(c=>c.wp)],min=Math.max(0,Math.floor((Math.min(...pts)*100-3)/5)*5),max=Math.min(100,Math.ceil((Math.max(...pts)*100+3)/5)*5);
  const x=p=>52+520*p,y=wp=>242-(wp*100-min)/(max-min)*198;
  let out=svgStart(`${kind==='go'?'Go':'Field goal'} win probability as success probability changes; axis ${min}% to ${max}%`,310);
  for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;out+=line(52,y(v/100),572,y(v/100),'var(--grid)')+txt(44,y(v/100)+5,Math.round(v)+'%','end');}
  for(const v of [0,.25,.5,.75,1])out+=txt(x(v),270,Math.round(v*100)+'%','middle');
  out+=txt(52,22,'Chance to win the game')+txt(312,301,kind==='go'?'Fourth-down conversion probability':'Field-goal make probability','middle');
  for(const c of comparisons){out+=line(52,y(c.wp),572,y(c.wp),colors[c.id],'7 5');if(c.p>=0&&c.p<=1&&c.p!==null)out+=line(x(c.p),44,x(c.p),242,colors[c.id],'3 5',1.5);}
  if(hist?.median!=null)out+=line(x(hist.median),44,x(hist.median),242,colors.median,'2 6',1.5);
  if(hist?.selected)out+=line(x(hist.selected.estimate),44,x(hist.selected.estimate),242,colors.team,'5 4',2);
  out+=line(52,y(fail),572,y(success),colors[kind],'',4)+line(x(p),44,x(p),242,'var(--ink-1)','',1.5);
  out+=`<circle cx="${x(p)}" cy="${y(p*success+(1-p)*fail)}" r="7" fill="${colors[kind]}" stroke="var(--surface-1)" stroke-width="3"/>`;
  return out+'</svg>';
 }
 function distribution(hist,base,r,kind){
  if(!hist)return '';
  const x=p=>52+p*520,model=kind==='go'?base.conversion:base.fgMake,p=kind==='go'?r.conversion:r.fgMake;
  const stacks=Array(50).fill(0),counts=Array(50).fill(0);for(const row of hist.rows)counts[Math.min(49,Math.floor(row.estimate*50))]++;const floor=Math.max(135,50+12*Math.max(...counts));let out=svgStart('Distribution of smoothed historical team rates; each dot is one team',floor+65);
  out+=txt(52,21,'Each dot = one team with comparable attempts');
  for(const row of hist.rows){const b=Math.min(49,Math.floor(row.estimate*50)),y=floor-12*stacks[b]++;out+=`<circle cx="${x(row.estimate)}" cy="${y}" r="${row.team===hist.team?6:4}" fill="${row.team===hist.team?colors.team:'var(--ink-2)'}"><title>${esc(row.team)}: ${pct(row.estimate)} smoothed; ${row.s}/${row.n} observed</title></circle>`;}
  out+=line(x(hist.median),38,x(hist.median),floor+11,colors.median,'2 4');
  out+=line(x(model),38,x(model),floor+11,colors.model,'6 4');
  for(const c of A.comparisons(r,kind))if(c.p!==null&&c.p>=0&&c.p<=1)out+=line(x(c.p),38,x(c.p),floor+11,colors[c.id],'3 5',1.5);
  if(hist.selected)out+=line(x(hist.selected.estimate),38,x(hist.selected.estimate),floor+11,colors.team,'',2);
  out+=line(x(p),38,x(p),floor+11,'var(--ink-1)','',1.5)+line(52,floor+11,572,floor+11,'var(--axis)', '',1);
  for(const v of [0,.25,.5,.75,1])out+=txt(x(v),floor+35,Math.round(v*100)+'%','middle');
  out+=txt(312,floor+61,'Smoothed historical success rate','middle');return out+'</svg>';
 }
 function percentileChart(values,refs){
  const sorted=[...values].sort((a,b)=>a-b),n=sorted.length,x=p=>65+505*p,y=p=>235-p*1.85;
  let out=svgStart('Empirical conversion-rate percentile: share of comparison rates at or below each success rate',310);
  const cut=refs.find(r=>r.primary&&r.p!=null&&r.p>=0&&r.p<=1);
  if(cut)out+=`<rect x="65" y="50" width="${505*cut.p}" height="185" fill="${cut.color}" opacity=".08"/>`;
  for(const v of [0,25,50,75,100])out+=line(65,y(v),570,y(v),'var(--grid)', '',1)+txt(56,y(v)+5,v+'%','end');
  for(const v of [0,.25,.5,.75,1])out+=txt(x(v),265,Math.round(v*100)+'%','middle');
  out+=txt(65,22,'Share of sample at or below this rate')+txt(315,299,'Success rate → empirical percentile','middle');
  if(n){let d=`M65 ${y(0)}`;sorted.forEach((p,i)=>{d+=` H${x(p)} V${y(100*(i+1)/n)}`;});d+=' H570';out+=`<path d="${d}" fill="none" stroke="var(--ink-2)" stroke-width="3"/>`;}
  for(const ref of refs){if(ref.p==null||ref.p<0||ref.p>1)continue;const rank=A.percentile(values,ref.p);if(!rank)continue;
   out+=line(x(ref.p),50,x(ref.p),235,ref.color,ref.primary?'5 4':'2 5',ref.primary?2.5:1.5);
   if(ref.primary)out+=line(65,y(rank.percentile),x(ref.p),y(rank.percentile),ref.color,'5 4',2);
   out+=`<circle cx="${x(ref.p)}" cy="${y(rank.percentile)}" r="${ref.primary?6:4}" fill="${ref.color}"><title>${esc(ref.label)}: ${pct(ref.p)}; ${rank.atOrBelow}/${rank.n} at or below</title></circle>`;
  }
  return out+'</svg>';
 }
 window.DDFourthExplorer={create({onChange}){
  let base,input,env,hist,r,kind='go',mode='model',rankMode='teams',loadError='';
  const history=()=>A.historical(env,input,kind);
  function draw(){
   if(!base)return;
   hist=history();
   $('fd-chart-go').setAttribute('aria-pressed',kind==='go');$('fd-chart-fg').setAttribute('aria-pressed',kind==='fg');
   const fg=A.available(base,'fg');$('fd-fg-control').hidden=!fg;$('fd-chart-fg').disabled=!fg;
   $('fd-conversion-value').textContent=pct(r.conversion);$('fd-fg-value').textContent=pct(r.fgMake);
   $('fd-conversion').setAttribute('aria-valuetext',pct(r.conversion));$('fd-fg-probability').setAttribute('aria-valuetext',pct(r.fgMake));
   $('fd-conversion-model').textContent=`Model: ${pct(base.conversion)}`;$('fd-fg-model').textContent=`Model: ${pct(base.fgMake)} · ${Number(input.yardline)+18} yards`;
   const current=kind==='go'?r.conversion:r.fgMake,model=kind==='go'?base.conversion:base.fgMake;
   $('fd-provenance').textContent=kind==='go'?`The ${pct(model)} estimate comes from nfl4th’s trained yardage distribution: add the probabilities of gaining at least ${input.toGo} yard${input.toGo===1?'':'s'}. Inputs are yards to go, field position, roof, and pregame spread/total. Team names do not add personnel or team conversion history.`:`The ${pct(model)} make estimate comes from nfl4th’s distance-and-roof kicking model. It does not use the kicker’s identity, wind, or this team’s recent results.`;
   $('fd-decision-chart').innerHTML=decisionChart(base,r,kind,hist);
   const comps=A.comparisons(r,kind);
   $('fd-thresholds').innerHTML=comps.map(c=>{
    const condition=c.p===null?(c.always==='above'?'Always better':c.always==='below'?'Never better':'Equal at every rate'):
      c.p<0?(c.direction>0?'Better at every rate':'Never better'):c.p>1?(c.direction>0?'Never better':'Better at every rate'):`Better ${c.direction>0?'above':'below'} ${pct(c.p)}`;
    return `<span style="--key:${colors[c.id]}"><i></i>vs ${esc(c.label)}: <b>${condition}</b></span>`;
   }).join('');
   const bestOther=Math.max(...r.choices.filter(c=>c.id!==kind&&c.wp!==null).map(c=>c.wp)),wp=kind==='go'?r.goWP:r.fgWP,delta=100*(wp-bestOther);
   $('fd-scenario').textContent=`${mode==='model'?'Model baseline':'Your scenario'} · ${pct(current)} ${kind==='go'?'convert':'make'} → ${pct(wp)} win. ${Math.abs(delta).toFixed(1)} pp ${delta>=0?'above':'below'} the best alternative.`;
   $('fd-chart-legend').innerHTML=[{name:kind==='go'?'Go for it':'Field goal',color:colors[kind]},...comps.map(c=>({name:c.label,color:colors[c.id]})),{name:'Selected rate',color:'var(--ink-1)'},...(hist?[{name:'Median team',color:colors.median},{name:'Team history',color:colors.team}]:[])].map(v=>`<span style="--key:${v.color}"><i></i>${v.name}</span>`).join('');
   $('fd-history-summary').textContent=hist?`${hist.cohort} · ${hist.seasons[0]}–${hist.seasons.at(-1)} regular seasons · through ${hist.through} · ${hist.n.toLocaleString()} attempts across ${hist.rows.length} teams.`:loadError||(!env?'Loading comparable team history…':'No comparable attempts in this snapshot.');
   $('fd-history-body').hidden=!hist;$('fd-use-team').disabled=!hist?.selected;$('fd-use-median').disabled=!hist;
   if(hist){
    const t=hist.selected;
    $('fd-benchmarks').innerHTML=[['nfl4th model',pct(model),'Situation estimate'],['Median team',pct(hist.median),`${hist.rows.length} smoothed team rates`],[`${hist.team} history`,t?pct(t.estimate):'Unavailable',t?`${t.s}/${t.n} observed · ${pct(t.raw)} raw`:'No comparable attempts']].map(([label,val,note])=>`<div><span>${esc(label)}</span><b>${val}</b><small>${esc(note)}</small></div>`).join('');
    $('fd-distribution-chart').innerHTML=distribution(hist,base,r,kind);
    $('fd-rank-title').textContent=kind==='go'?'How weak would the offense have to be?':'Where does the kicking rate rank?';
    const raw=rankMode==='seasons',minN=Number($('fd-season-min').value);
    const rankRows=raw?hist.seasonRows.filter(t=>t.n>=minN):hist.rows,values=rankRows.map(t=>raw?t.raw:t.estimate);
    const median=A.median(values),other=r.choices.filter(c=>c.id!==kind&&c.wp!==null).sort((a,b)=>b.wp-a.wp)[0];
    const cut=comps.find(c=>c.id===other.id),rank=cut?.p!=null?A.percentile(values,cut.p):null;
    $('fd-rank-teams').setAttribute('aria-pressed',!raw);$('fd-rank-seasons').setAttribute('aria-pressed',raw);$('fd-season-min-control').hidden=!raw;
    $('fd-rank-summary').textContent=!values.length?'No team-seasons meet this sample minimum.':!rank?'No single break-even rate for this scenario.':`${pct(cut.p)} break-even vs ${cut.label.toLowerCase()} · ${rank.atOrBelow} of ${rank.n} ${raw?'team-seasons':'teams'} at or below it (${rank.percentile.toFixed(1)}% of this sample).`;
    $('fd-rank-position').textContent=!rank?'':rank.belowSample?`Below the lowest ${raw?'observed rate':'smoothed estimate'}: ${pct(rank.min)}. The data cannot resolve a percentile farther into this tail.`:rank.aboveSample?`Above the highest ${raw?'observed rate':'smoothed estimate'}: ${pct(rank.max)}. The data cannot resolve a percentile farther into this tail.`:`The threshold sits at the ${rank.percentile.toFixed(1)}th empirical percentile of these ${raw?'team-season rates':'team estimates'}.`;
    $('fd-percentile-chart').innerHTML=percentileChart(values,[...comps.map(c=>({p:c.p,color:colors[c.id],primary:c.id===other.id,label:'Break-even vs '+c.label})),{p:median,color:colors.median,label:'Sample median'},{p:model,color:colors.model,label:'nfl4th model'},{p:t?.estimate,color:colors.team,label:hist.team+' smoothed estimate'}]);
    $('fd-rank-note').textContent=`${raw?`Observed team-season rates, with at least ${minN} comparable attempts each; ${hist.seasonRows.length-rankRows.length} smaller samples excluded. Current season is partial.`:'One smoothed estimate per team, pooling the displayed seasons. Smoothing pulls sparse samples toward the league and narrows this distribution.'} Same distance and field context as above. Percentile = share at or below the rate, including ties; this ranks comparable conversion performance, not overall offense quality. It does not estimate a latent talent percentile or the chance the model is wrong. ${cut?.direction<0?'Here a higher success rate reduces modeled win probability; inspect the outcome assumptions.':''}`;
    $('fd-rank-samples').innerHTML=rankRows.slice().sort((a,b)=>(raw?a.raw:a.estimate)-(raw?b.raw:b.estimate)).map(t=>`<tr><th scope="row">${esc(t.team)}${raw?' '+t.season:''}</th><td>${pct(raw?t.raw:t.estimate)}</td><td>${t.s}/${t.n}</td></tr>`).join('');
    $('fd-history-detail').textContent=t?`${hist.team}: ${t.currentS}/${t.currentN} this season. Observed-rate 95% Wilson interval: ${pct(t.low)}–${pct(t.high)}. That interval describes the historical sample, not this play’s true probability.`:`${hist.team} has no comparable attempts; no team estimate is shown.`;
    $('fd-history-method').textContent=`Team estimates combine each team’s successes with ${hist.prior} assumed attempts at the other teams’ pooled rate. This chosen smoothing strength reduces small-sample extremes; it has not been tuned or calibrated. Median is across teams with attempts, with equal team weights. Pooled league rate: ${pct(hist.pooled)} (${hist.s}/${hist.n}). Dots show differences between team samples, not uncertainty around nfl4th. This is today’s historical sample, including plays after older decisions; it is not a pre-play backtest. These are descriptive comparisons, not opponent- or play-call-adjusted forecasts.`;
    $('fd-team-table').innerHTML=hist.rows.slice().reverse().map(t=>`<tr${t.team===hist.team?' class="fd-team-selected"':''}><th scope="row">${esc(t.team)}</th><td>${pct(t.estimate)}</td><td>${t.s}/${t.n}</td><td>${pct(t.raw)}</td></tr>`).join('');
   }
  }
  function update(exact=false,changed=null){
   if(!base)return;
   r=A.scenario(base,exact?base.conversion:(changed==='fg'&&r?r.conversion:Number($('fd-conversion').value)/100),exact?base.fgMake:(changed==='go'&&r?r.fgMake:Number($('fd-fg-probability').value)/100));
   mode=exact?'model':'scenario';draw();onChange(r,mode);
  }
  for(const [id,k] of [['fd-conversion','go'],['fd-fg-probability','fg']])$(id).addEventListener('input',()=>{kind=k;update(false,k);});
  for(const [id,k] of [['fd-chart-go','go'],['fd-chart-fg','fg']])$(id).addEventListener('click',()=>{kind=k;draw();if(window.DDFourthState)onChange(r,mode);});
  for(const [id,value] of [['fd-rank-teams','teams'],['fd-rank-seasons','seasons']])$(id).addEventListener('click',()=>{rankMode=value;draw();});
  $('fd-season-min').addEventListener('change',draw);
  $('fd-restore').addEventListener('click',()=>{if(base){$('fd-conversion').value=base.conversion*100;$('fd-fg-probability').value=base.fgMake*100;update(true);}});
  for(const [id,which] of [['fd-use-team','team'],['fd-use-median','median']])$(id).addEventListener('click',()=>{
   if(!hist)return;const p=which==='team'?hist.selected?.estimate:hist.median;if(p==null)return;
   $(kind==='go'?'fd-conversion':'fd-fg-probability').value=p*100;update(false,kind);
  });
  fetch('data/fourth-down-rates.json',{cache:'no-store'}).then(v=>{if(!v.ok)throw Error('History unavailable');return v.json();}).then(v=>{if(!v.source||!v.as_of||!v.data?.seasons)throw Error('Incomplete history');env=v;draw();if(window.DDFourthState)onChange(r,mode);}).catch(()=>{loadError='Comparable history is unavailable. The model and sensitivity calculations still work.';draw();});
  return {setResult(value,state,overrides){base=value;input=state;if(!A.available(base,'fg'))kind='go';$('fd-conversion').value=base.conversion*100;$('fd-fg-probability').value=base.fgMake*100;if(overrides){if(overrides.cp!=null)$('fd-conversion').value=overrides.cp;if(overrides.fp!=null)$('fd-fg-probability').value=overrides.fp;}update(!overrides);},getState:()=>({mode,conversion:r?.conversion,fgMake:r?.fgMake,comparison:hist,percentileView:rankMode})};
 }};
})();
