/* Fourth Down Lab UI. All scenario calculations stay in the reader's browser. */
(()=>{'use strict';
  const $=id=>document.getElementById(id),form=$('fd-form'),pct=x=>x===null?'—':(x*100).toFixed(1)+'%',pp=x=>(x>=0?'+':'')+x.toFixed(1)+' pp';
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const teams={ARI:'Cardinals',ATL:'Falcons',BAL:'Ravens',BUF:'Bills',CAR:'Panthers',CHI:'Bears',CIN:'Bengals',CLE:'Browns',DAL:'Cowboys',DEN:'Broncos',DET:'Lions',GB:'Packers',HOU:'Texans',IND:'Colts',JAX:'Jaguars',KC:'Chiefs',LA:'Rams',LAC:'Chargers',LV:'Raiders',MIA:'Dolphins',MIN:'Vikings',NE:'Patriots',NO:'Saints',NYG:'Giants',NYJ:'Jets',PHI:'Eagles',PIT:'Steelers',SEA:'Seahawks',SF:'49ers',TB:'Buccaneers',TEN:'Titans',WAS:'Commanders'};
  for(const id of ['fd-homeTeam','fd-awayTeam'])$(id).innerHTML=Object.entries(teams).map(([k,v])=>`<option value="${k}">${k} · ${v}</option>`).join('');
  const browns={homeTeam:'CLE',awayTeam:'CAR',home:1,diff:3,qtr:4,seconds:65,toGo:1,yardline:15,offTO:3,defTO:0,spread:-2.5,total:41.5,roof:'outdoors',homeKickoff:0,touchback:25,runoff:0};
  const presets={browns,goal:{...browns,diff:-4,seconds:420,yardline:1,offTO:3,defTO:3},midfield:{...browns,qtr:1,seconds:600,diff:0,yardline:50,offTO:3,defTO:3},longkick:{...browns,qtr:2,seconds:125,diff:0,toGo:6,yardline:40,offTO:2,defTO:2}};
  let engine,result,activeInput,weekly,requestId=0,sourceLabel='Browns vs Panthers · Sep 27, 2026';
  function setForm(s){
    for(const [k,v] of Object.entries(s))if(form.elements[k])form.elements[k].value=v;
    form.elements.minutes.value=Math.floor(s.seconds/60);form.elements.secondsPart.value=s.seconds%60;form.elements.line.value=-s.spread;
    updateTeamLabels();
  }
  function updateTeamLabels(){const h=form.elements.homeTeam.value,a=form.elements.awayTeam.value;form.elements.home.options[0].textContent=`${h} · home`;form.elements.home.options[1].textContent=`${a} · away`;}
  function inputs(){
    const values=Object.fromEntries(new FormData(form));
    if(values.homeTeam===values.awayTeam)throw Error('Choose two different teams.');
    for(const k of ['minutes','secondsPart','line'])if(values[k]===''||!Number.isFinite(+values[k]))throw Error('Complete the clock and pregame line fields.');
    return {...values,seconds:Number(values.minutes)*60+Number(values.secondsPart),spread:-Number(values.line)};
  }
  function status(text,error=false){$('fd-status').textContent=text;$('fd-status').classList.toggle('error',error);}
  function situation(s){const off=s.home?s.homeTeam:s.awayTeam,def=s.home?s.awayTeam:s.homeTeam;return `${off} vs ${def} · Q${s.qtr} ${Math.floor(s.seconds/60)}:${String(s.seconds%60).padStart(2,'0')} · 4th & ${s.toGo} · ${s.yardline>50?'own '+(100-s.yardline):def+' '+s.yardline} · ${s.diff>0?'leading by '+s.diff:s.diff<0?'trailing by '+(-s.diff):'tied'}`;}
  function render(r){
    result=r;activeInput={...r.input,homeTeam:form.elements.homeTeam.value,awayTeam:form.elements.awayTeam.value};
    const best=r.choices.find(c=>c.id===r.best),runner=r.choices.filter(c=>c.wp!==null&&c.id!==r.best).sort((a,b)=>b.wp-a.wp)[0];
    $('fd-strength').textContent=`${r.strength.toUpperCase()} RECOMMENDATION · MODEL ESTIMATE`;
    $('fd-recommendation').textContent=best.label+'.';
    $('fd-verdict-text').textContent=`${pct(best.wp)} chance to win, averaging success and failure.`;
    $('fd-edge').hidden=false;$('fd-edge').textContent=`${pp(r.edge)} vs ${runner.label.toLowerCase()}`;
    $('fd-situation').textContent=situation(activeInput);
    $('fd-bars').innerHTML=r.choices.map(c=>`<div class="fd-bar-row ${c.id===r.best?'best':''}"><header><span>${c.label}${c.id===r.best?'<small>BEST CHANCE</small>':''}</span><strong>${pct(c.wp)}</strong></header><div class="fd-bar-track"><div class="fd-bar-fill" style="width:${c.wp===null?0:Math.max(0,Math.min(100,c.wp*100))}%"></div></div>${c.wp===null?`<span class="fd-note">${c.id==='punt'?'Outside the punt model’s field range.':'Outside the field-goal model’s range.'}</span>`:''}</div>`).join('');
    $('fd-branches').innerHTML=[['Convert the fourth down',r.conversion,`Win if successful: ${pct(r.successWP)}`],['Make the field goal',r.fgMake>0?r.fgMake:null,r.fgMake>0?`${activeInput.yardline+18}-yard attempt · win if made: ${pct(r.makeWP)}`:'Attempt outside the model’s range.'],['Fail on fourth down',1-r.conversion,`Still win: ${pct(r.failWP)}`],['Miss the field goal',r.fgMake>0?1-r.fgMake:null,r.fgMake>0?`Still win: ${pct(r.missWP)}`:'Attempt outside the model’s range.']].map(([label,p,sub])=>`<div class="fd-branch"><span>${label}</span><b>${pct(p)}</b><small>${sub}</small></div>`).join('');
    $('fd-sensitivity').hidden=false;
    const threshold=r.breakEven;
    $('fd-break-even').textContent=threshold===null?'Success and failure have the same modeled value.':threshold<0?'Going is preferred even with a 0% conversion chance under these outcome assumptions.':threshold>1?'Even a certain conversion does not beat the best kick under these outcome assumptions.':`Going beats the best kick above a ${pct(threshold)} conversion chance. The model estimates ${pct(r.conversion)}.`;
    $('fd-conversion').value=Math.round(r.conversion*100);sensitivity(true);
    $('fd-warnings').innerHTML=r.warnings.map(w=>`<p>${esc(w)}</p>`).join('');
    $('fd-share').disabled=false;$('fd-copy').disabled=false;
    $('fd-share-status').textContent='';status(sourceLabel+' · calculated locally.');
    window.DDFourthState={input:activeInput,result:r,source:sourceLabel};
  }
  function sensitivity(modelExact=false){
    if(!result)return;const p=modelExact?result.conversion:Number($('fd-conversion').value)/100;
    const go=p*result.successWP+(1-p)*result.failWP;
    const kick=Math.max(result.fgMake>0?result.fgWP:0,result.puntWP??0);
    $('fd-scenario').textContent=`${modelExact?'Model':'Your scenario'}: ${pct(p)} convert → ${pct(go)} win by going (${pp(100*(go-kick))} vs best kick).`;
  }
  function calculate(){
    if(!engine)return;
    try{if(!form.reportValidity())return;render(engine.calculate(inputs()));}
    catch(e){status(e.message,true);$('fd-strength').textContent='INPUT NEEDS ATTENTION';$('fd-recommendation').textContent='Check the situation.';$('fd-verdict-text').textContent=e.message;$('fd-edge').hidden=true;$('fd-share').disabled=true;$('fd-copy').disabled=true;$('fd-bars').innerHTML='';$('fd-branches').innerHTML='';$('fd-sensitivity').hidden=true;result=null;window.DDFourthState=null;}
  }
  form.addEventListener('submit',e=>{e.preventDefault();calculate();});
  form.addEventListener('input',()=>{sourceLabel='Custom situation';status('Inputs changed. Calculate to update the call.');$('fd-strength').textContent='PREVIOUS CALCULATION · INPUTS CHANGED';$('fd-share').disabled=true;$('fd-copy').disabled=true;window.DDFourthState=null;});
  form.addEventListener('change',updateTeamLabels);
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{sourceLabel=b.dataset.preset==='browns'?'Browns vs Panthers · Sep 27, 2026':'Hypothetical scenario';setForm(presets[b.dataset.preset]);calculate();}));
  $('fd-reset').addEventListener('click',()=>{sourceLabel='Browns vs Panthers · Sep 27, 2026';setForm(browns);calculate();});
  $('fd-conversion').addEventListener('input',()=>sensitivity());$('fd-restore').addEventListener('click',()=>{if(result){$('fd-conversion').value=Math.round(result.conversion*100);sensitivity(true);}});
  async function copy(text){try{await navigator.clipboard.writeText(text);$('fd-share-status').textContent='Copied.';}catch{$('fd-share-status').textContent=text;}}
  $('fd-share').addEventListener('click',()=>{if(!activeInput)return;const u=new URL(location.href);u.search='';u.hash='';for(const [k,v] of Object.entries(activeInput))if(Object.hasOwn(browns,k))u.searchParams.set(k,v);copy(u.href);});
  $('fd-copy').addEventListener('click',()=>{if(!result)return;copy(`Data Dawgs · Fourth Down Lab\n${situation(activeInput)}\n${result.choices.filter(c=>c.wp!==null).map(c=>`${c.label}: ${pct(c.wp)} win probability`).join('\n')}\n${result.strength}: ${DDFourth.labels[result.best]} (${pp(result.edge)} over next option).\nModel estimates · nfl4th port exported Sep 28, 2026 · kickoff assumption: own ${activeInput.touchback}.`);});
  function renderBoard(){
    if(!weekly)return;
    const filter=$('fd-game-filter').value,sort=$('fd-sort').value;
    let rows=weekly.data.games.filter(g=>filter==='all'||g.id===filter).flatMap(g=>g.decisions.map(d=>({g,d})));
    const cost=d=>{const r=d.result,a=r?.choices.find(c=>c.id===d.actual);return a?.wp==null?null:100*(Math.max(...r.choices.filter(c=>c.wp!==null).map(c=>c.wp))-a.wp);};
    rows.sort((a,b)=>sort==='edge'?(b.d.result?.edge??-1)-(a.d.result?.edge??-1):sort==='cost'?(cost(b.d)??-1)-(cost(a.d)??-1):b.g.date.localeCompare(a.g.date)||b.d.input.qtr-a.d.input.qtr||a.d.input.seconds-b.d.input.seconds);
    $('fd-decisions').innerHTML=rows.length?rows.map(({g,d})=>{const r=d.result,c=cost(d),input=d.input;return `<tr><td><strong>${esc(d.offense)} · 4th &amp; ${input.toGo}</strong><small>${esc(g.away)} @ ${esc(g.home)} · Q${input.qtr} ${esc(d.clock)}<br>${input.yardline>50?'Own '+(100-input.yardline):'Opponent '+input.yardline} · ${input.diff>0?'+':''}${input.diff} pts</small></td><td><strong>${r?esc(DDFourth.labels[r.best]):'Unavailable'}</strong><small>${r?esc(r.strength)+' · '+pp(r.edge):esc(d.error)}</small></td><td class="fd-number">${r?r.choices.map(x=>pct(x.wp)).join(' / '):'—'}</td><td>${esc(DDFourth.labels[d.actual]||'Unclear')}<small title="${esc(d.description)}">${esc(d.description.length>72?d.description.slice(0,69)+'…':d.description)}</small></td><td class="fd-number">${c===null?'—':`<span class="${c>.05?'fd-negative':'fd-positive'}">${c<.05?'0.0':c.toFixed(1)} pp</span>`}</td><td><button type="button" data-play="${esc(d.id)}">Explore</button></td></tr>`;}).join(''):'<tr><td colspan="6">No fourth-down decisions available for this selection yet.</td></tr>';
    const errs=weekly.data.games.filter(g=>g.refresh_error);
    $('fd-board-status').textContent=`${rows.length} decisions · cost = modeled win probability given up versus the best option. Snapshot ${new Date(weekly.data.refreshed_at).toLocaleString()}.${errs.length?' Feed unavailable or delayed for '+errs.map(g=>g.away+' @ '+g.home).join(', ')+'. Check per-game capture times in the data.':''}`;
    $('fd-decisions').querySelectorAll('[data-play]').forEach(b=>b.addEventListener('click',()=>{const row=rows.find(x=>x.d.id===b.dataset.play);if(!row)return;sourceLabel=`${row.g.away} @ ${row.g.home} · ${row.g.date} · captured ${new Date(row.g.captured_at).toLocaleString()}`;setForm({...row.d.input,homeTeam:row.g.home,awayTeam:row.g.away});calculate();$('fd-result').scrollIntoView({behavior:'smooth',block:'start'});}));
  }
  async function refresh(){
    const rid=++requestId;$('fd-refresh').disabled=true;
    try{const response=await fetch('data/fourth-down.json',{cache:'no-store'});if(!response.ok)throw Error('Feed request failed.');const env=await response.json();if(!env.source||!env.as_of||!Array.isArray(env.data?.games))throw Error('Feed is incomplete.');if(rid!==requestId)return;weekly=env;
      const filter=$('fd-game-filter').value;$('fd-game-filter').innerHTML='<option value="all">All games</option>'+env.data.games.map(g=>`<option value="${esc(g.id)}">${esc(g.away)} @ ${esc(g.home)} · ${esc(g.status)}</option>`).join('');if(env.data.games.some(g=>g.id===filter))$('fd-game-filter').value=filter;
      $('fd-week-title').textContent=`Week ${env.data.week} decisions · ${env.data.season}`;
      const age=Date.now()-Date.parse(env.data.refreshed_at);const active=env.data.games.some(g=>/progress|halftime/i.test(g.status));
      $('fd-updated').textContent=`Captured ${new Date(env.data.refreshed_at).toLocaleString()} · ESPN + nflverse${active&&age>30*60000?' · DELAYED: older than 30 minutes':''}`;
      renderBoard();
    }catch(e){$('fd-board-status').textContent=`Could not refresh: ${e.message}${weekly?' Showing the previous dated snapshot.':' No game numbers are available.'}`;if(!weekly)$('fd-decisions').innerHTML='<tr><td colspan="6">The weekly feed is unavailable. The situation calculator works independently.</td></tr>';}
    finally{if(rid===requestId)$('fd-refresh').disabled=false;}
  }
  $('fd-refresh').addEventListener('click',refresh);$('fd-game-filter').addEventListener('change',renderBoard);$('fd-sort').addEventListener('change',renderBoard);
  setForm(browns);
  const query=new URLSearchParams(location.search);if(query.has('qtr')){const s={...browns};for(const k of Object.keys(s))if(query.has(k))s[k]=typeof s[k]==='number'?Number(query.get(k)):query.get(k);if(!teams[s.homeTeam]||!teams[s.awayTeam]){status('Shared team selection is invalid.',true);}else{setForm(s);sourceLabel='Shared situation';}}
  DDFourth.load().then(e=>{engine=e;$('fd-calculate').disabled=false;$('fd-calculate').textContent='Calculate the call';calculate();}).catch(e=>{status(e.message+' Reload to retry.',true);$('fd-recommendation').textContent='Model unavailable.';$('fd-verdict-text').textContent='No probabilities have been calculated.';});
  refresh();setInterval(()=>{if(!document.hidden)refresh();},60000);
  window.DD_BOTCTX={label:'Fourth Down Lab',title:'Explain this decision',chrome:{sub:'Fourth Down Lab',ph:'Ask about this fourth down…',chips:['Why this call?','What conversion rate breaks even?','Explain the clock assumptions']},sys:'You are on Fourth Down Lab. Use ONLY DDFourthState for calculator values. All probabilities are model estimates, from the pinned nfl4th browser port; never invent numbers or claim independent calibration. The weekly feed is a delayed dated ESPN snapshot, not live odds. Regulation only; no overtime. The model does not know the play call, kicker identity, injuries or wind. Default kickoff assumption is the upstream own 25, with an optional own 35 scenario. A user-entered sensitivity probability is an assumption. Warn about clock sensitivity in the final two minutes. Data and method at /data/fourth-down.json and /data/fourth-down-method.md. There is no fourth-down MCP tool yet.',ctx:()=>JSON.stringify({current:window.DDFourthState||null,weeklyAsOf:weekly?.data.refreshed_at})};
})();
