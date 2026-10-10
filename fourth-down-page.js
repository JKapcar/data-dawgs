/* Fourth Down Lab UI. All scenario calculations stay in the reader's browser. */
(()=>{'use strict';
  const $=id=>document.getElementById(id),form=$('fd-form'),pct=x=>x===null?'—':(x*100).toFixed(1)+'%',pp=x=>(x>=0?'+':'')+x.toFixed(1)+' pp';
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const teams={ARI:'Cardinals',ATL:'Falcons',BAL:'Ravens',BUF:'Bills',CAR:'Panthers',CHI:'Bears',CIN:'Bengals',CLE:'Browns',DAL:'Cowboys',DEN:'Broncos',DET:'Lions',GB:'Packers',HOU:'Texans',IND:'Colts',JAX:'Jaguars',KC:'Chiefs',LA:'Rams',LAC:'Chargers',LV:'Raiders',MIA:'Dolphins',MIN:'Vikings',NE:'Patriots',NO:'Saints',NYG:'Giants',NYJ:'Jets',PHI:'Eagles',PIT:'Steelers',SEA:'Seahawks',SF:'49ers',TB:'Buccaneers',TEN:'Titans',WAS:'Commanders'};
  for(const id of ['fd-homeTeam','fd-awayTeam'])$(id).innerHTML=Object.entries(teams).map(([k,v])=>`<option value="${k}">${k} · ${v}</option>`).join('');
  const browns={homeTeam:'CLE',awayTeam:'CAR',home:1,diff:3,qtr:4,seconds:65,toGo:1,yardline:15,offTO:3,defTO:0,spread:-2.5,total:41.5,roof:'outdoors',homeKickoff:0,touchback:25,runoff:0};
  const presets={browns,goal:{...browns,diff:-4,seconds:420,yardline:1,offTO:3,defTO:3},midfield:{...browns,qtr:1,seconds:600,diff:0,yardline:50,offTO:3,defTO:3},longkick:{...browns,qtr:2,seconds:125,diff:0,toGo:6,yardline:40,offTO:2,defTO:2}};
  let engine,result,displayResult,activeInput,weekly,requestId=0,sourceLabel='Custom situation',sharedSituation=false;
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
  function situation(s){const off=s.home?s.homeTeam:s.awayTeam,def=s.home?s.awayTeam:s.homeTeam;const y=Number(s.yardline),g=Number(s.toGo),d=Number(s.diff);return `${off} vs ${def} · Q${s.qtr} ${Math.floor(s.seconds/60)}:${String(s.seconds%60).padStart(2,'0')} · ${g>=y?'4th & goal':'4th & '+g} at ${y===50?'midfield':y>50?off+' '+(100-y):def+' '+y} · ${d>0?off+' up '+d:d<0?off+' down '+(-d):'tied'}`;}
  // Decision robustness: each scenario reruns the same pinned nfl4th models.
  // These are stress tests, not confidence intervals or personnel-adjusted forecasts.
  function robustness(r){
    let panel=$('fd-robustness');
    if(!panel){
      panel=document.createElement('section');panel.id='fd-robustness';panel.className='fd-sensitivity';
      const anchor=$('fd-sensitivity');anchor.parentNode.insertBefore(panel,anchor);
    }
    const base=r.input, offSpread=base.home?base.spread:-base.spread;
    const cases=[
      ['Captured baseline',{}],
      ['2026 fly-ball touchback: own 35',{touchback:35}],
      ['Legacy touchback: own 25',{touchback:25}],
      ['Offense has zero timeouts',{offTO:0}],
      ['Defense has zero timeouts',{defTO:0}],
      ['Offense weaker by 7-point spread',{spread:base.spread+(base.home?-7:7)}],
      ['Offense stronger by 7-point spread',{spread:base.spread+(base.home?7:-7)}],
      ['Pregame total minus 7',{total:Math.max(15,base.total-7)}],
      ['Pregame total plus 7',{total:Math.min(90,base.total+7)}],
      ['Combined: weak offense, 35 kickoff',{spread:base.spread+(base.home?-7:7),touchback:35}]
    ];
    const tested=cases.map(([name,changes])=>{
      try{
        const x=engine.calculate({...base,...changes});
        return {name,x,edge:100*(x.goWP-Math.max(x.fgMake>0?x.fgWP:-Infinity,x.puntWP??-Infinity))};
      }catch{return null;}
    }).filter(Boolean);
    const flips=tested.filter(t=>t.x.best!==r.best);
    panel.innerHTML='<div class="fd-kicker">Decision robustness · model stress tests</div>'+
      '<h3>Does the recommendation survive different assumptions?</h3>'+
      '<p>Each row recalculates the full win-probability model, including post-play states. Changes are hypothetical one-factor tests unless marked combined, <strong>not</strong> calibrated probabilities or a measure of statistical confidence.</p>'+
      '<p><strong>'+tested.length+' scenarios checked · '+flips.length+' changed the preferred decision.</strong> '+(flips.length?'Inspect flipped rows before concluding the call is robust.':'No tested stress scenario reverses the decision. This does not establish a confidence interval.')+'</p>'+
      '<div style="overflow-x:auto"><table class="fd-table" style="width:100%"><thead><tr><th>Assumption</th><th>Best call</th><th>Go WP</th><th>FG WP</th><th>Go edge vs best alternative</th><th>Go break-even</th></tr></thead><tbody>'+
      tested.map(t=>'<tr><td>'+esc(t.name)+'</td><td>'+esc(DDFourth.labels[t.x.best])+'</td><td>'+pct(t.x.goWP)+'</td><td>'+pct(t.x.fgMake>0?t.x.fgWP:null)+'</td><td>'+pp(t.edge)+'</td><td>'+(t.x.breakEven===null?'—':(t.x.breakEven*100).toFixed(1)+'%')+'</td></tr>').join('')+
      '</tbody></table></div>'+
      '<p><small><strong>Clock caveat:</strong> The existing extra-runoff control affects successful non-touchdown conversions only. On fourth-and-goal from the 1 it cannot model time consumed by a failed run, which requires a separate play-type and clock-state model. The kickoff setting is a deterministic field-position scenario, not a return distribution. Pregame spread changes are stress tests, not live market updates. Conversion-rate uncertainty remains separate in the slider below.</small></p>';
  }
  function render(r){
    result=r;activeInput={...r.input,homeTeam:form.elements.homeTeam.value,awayTeam:form.elements.awayTeam.value};
    $('fd-sensitivity').hidden=false;robustness(r);explorer.setResult(r,activeInput,initialOverrides);initialOverrides=null;
    $('fd-warnings').innerHTML=r.warnings.map(w=>`<p>${esc(w)}</p>`).join('');
    $('fd-share').disabled=false;$('fd-copy').disabled=false;
    $('fd-share-status').textContent='';status(sourceLabel+' · calculated locally.');
  }
  function paintDecision(r,mode){
    displayResult=r;
    const fgAvailable=DDFourthAnalysis.available(r,'fg');
    const best=r.choices.find(c=>c.id===r.best),runner=r.choices.filter(c=>c.wp!==null&&c.id!==r.best).sort((a,b)=>b.wp-a.wp)[0];
    $('fd-strength').textContent=`${r.strength.toUpperCase()} RECOMMENDATION · ${mode==='model'?'MODEL ESTIMATE':'YOUR SCENARIO'}`;
    $('fd-recommendation').textContent=best.label+'.';
    $('fd-verdict-text').textContent=`${pct(best.wp)} chance to win, averaging success and failure.`;
    $('fd-edge').hidden=false;$('fd-edge').textContent=`${pp(r.edge)} vs ${runner.label.toLowerCase()}`;
    $('fd-situation').textContent=situation(activeInput);paintPlay(r);
    $('fd-bars').innerHTML=r.choices.map(c=>`<div class="fd-bar-row ${c.id===r.best?'best':''}"><header><span>${c.label}${c.id===r.best?'<small>BEST CHANCE</small>':''}</span><strong>${pct(c.wp)}</strong></header><div class="fd-bar-track"><div class="fd-bar-fill" style="width:${c.wp===null?0:Math.max(0,Math.min(100,c.wp*100))}%"></div></div>${c.wp===null?`<span class="fd-note">${c.id==='punt'?'Outside the punt model’s field range.':'Outside the field-goal model’s range.'}</span>`:''}</div>`).join('');
    $('fd-branches').innerHTML=[['Convert the fourth down',r.conversion,`Win if successful: ${pct(r.successWP)}`],['Make the field goal',fgAvailable?r.fgMake:null,fgAvailable?`${activeInput.yardline+18}-yard attempt · win if made: ${pct(r.makeWP)}`:'Attempt outside the model’s range.'],['Fail on fourth down',1-r.conversion,`Still win: ${pct(r.failWP)}`],['Miss the field goal',fgAvailable?1-r.fgMake:null,fgAvailable?`Still win: ${pct(r.missWP)}`:'Attempt outside the model’s range.']].map(([label,p,sub],i)=>`<div class="fd-branch"><span>${label}</span><b>${pct(p)}</b><small>${sub}</small>${i<2&&p!==null?`<a class="fd-explore-link" href="#fd-sensitivity">${mode==='model'?'nfl4th estimate':'Your assumption'} · explore ↓</a>`:''}</div>`).join('');
    lens.setResult(result,r);
    syncState();
  }
  // The lens redraws on its own dials; the shared state has to follow it.
  function syncState(){if(displayResult&&activeInput)window.DDFourthState={input:activeInput,play:playState(),result:displayResult,baseline:result,scenario:explorer.getState(),goalLens:lens.getState(),source:sourceLabel};}
  const lens=DDFourthLens.create({onChange:syncState});
  const explorer=DDFourthExplorer.create({onChange:paintDecision});
  let initialOverrides=null;
  function calculate(){
    if(!engine)return;
    try{if(!form.checkValidity()){openTab('edit');form.reportValidity();return;}render(engine.calculate(inputs()));}
    catch(e){status(e.message,true);$('fd-strength').textContent='INPUT NEEDS ATTENTION';$('fd-recommendation').textContent='Check the situation.';$('fd-verdict-text').textContent=e.message;$('fd-edge').hidden=true;$('fd-share').disabled=true;$('fd-copy').disabled=true;$('fd-bars').innerHTML='';$('fd-branches').innerHTML='';$('fd-sensitivity').hidden=true;lens.hide();$('fd-play-nav').hidden=true;$('fd-actual').hidden=true;openTab('edit');result=null;displayResult=null;window.DDFourthState=null;}
  }
  form.addEventListener('submit',e=>{e.preventDefault();calculate();});
  form.addEventListener('input',()=>{sourceLabel='Custom situation';picker.markEdited();$('fd-play-nav').hidden=true;$('fd-actual').hidden=true;status('Inputs changed. Calculate to update the call.');$('fd-strength').textContent='PREVIOUS CALCULATION · INPUTS CHANGED';$('fd-share').disabled=true;$('fd-copy').disabled=true;window.DDFourthState=null;displayResult=null;$('fd-sensitivity').hidden=true;lens.hide();});
  form.addEventListener('change',updateTeamLabels);
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{sourceLabel='Hypothetical scenario';picker.clear();setForm(presets[b.dataset.preset]);calculate();}));
  // Reset returns to the real play the reader last picked; with none, to the verified Browns case.
  $('fd-reset').addEventListener('click',()=>{if(picker.reselect()){openTab('edit');return;}sourceLabel='Browns vs Panthers · Sep 27, 2026';setForm(browns);calculate();});
  async function copy(text){try{await navigator.clipboard.writeText(text);$('fd-share-status').textContent='Copied.';}catch{$('fd-share-status').textContent=text;}}
  $('fd-share').addEventListener('click',()=>{if(!activeInput)return;const u=new URL(location.href);u.search='';u.hash='';for(const [k,v] of Object.entries(activeInput))if(Object.hasOwn(browns,k))u.searchParams.set(k,v);if(explorer.getState().mode==='scenario'){u.searchParams.set('cp',(displayResult.conversion*100).toFixed(1));u.searchParams.set('fp',(displayResult.fgMake*100).toFixed(1));}lens.shareParams(u.searchParams);const c=picker.current();if(c)u.searchParams.set('play',c.decision.id);copy(u.href);});
  $('fd-copy').addEventListener('click',()=>{if(!displayResult)return;const r=displayResult;const c=picker.current();copy(`Data Dawgs · Fourth Down Lab\n${c?`${c.matchup} · week ${c.weekNumber} · coach chose: ${DDFourth.labels[c.decision.actual]||'unclear'}\n`:''}${situation(activeInput)}\n${r.choices.filter(c=>c.wp!==null).map(c=>`${c.label}: ${pct(c.wp)} win probability`).join('\n')}\n${r.strength}: ${DDFourth.labels[r.best]} (${pp(r.edge)} over next option).\n${explorer.getState().mode==='model'?'Model estimates':'USER SCENARIO'} · convert ${pct(r.conversion)} / FG ${pct(r.fgMake)} · nfl4th port exported Sep 28, 2026 · kickoff: own ${activeInput.touchback}.${lens.copyLine()}`);});
  setForm(browns);
  // ---- Game and play picker: the page opens on a real fourth down ----
  const picker=DDFourthPicker.create({onPick:choose});
  function openTab(t){const edit=t==='edit';$('fd-tab-plays').setAttribute('aria-selected',!edit);$('fd-tab-edit').setAttribute('aria-selected',edit);$('fd-pane-plays').hidden=edit;form.hidden=!edit;}
  $('fd-tab-plays').addEventListener('click',()=>openTab('plays'));$('fd-tab-edit').addEventListener('click',()=>openTab('edit'));
  function choose(info,source){
    const g=info.game,d=info.decision;
    sourceLabel=`${g.away} @ ${g.home} · week ${info.weekNumber} · captured ${new Date(info.captured).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
    setForm({...d.input,homeTeam:g.home,awayTeam:g.away});openTab('plays');calculate();
    if(source==='play'&&matchMedia('(max-width:850px)').matches)$('fd-result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }
  $('fd-prev').addEventListener('click',()=>picker.step(-1));$('fd-next').addEventListener('click',()=>picker.step(1));
  function playState(){const c=picker.current();if(!c)return null;const d=c.decision;return {game:c.matchup,season:c.season,week:c.weekNumber,date:c.game.date,frozenPreviousWeek:c.frozen,clock:`Q${d.input.qtr} ${d.clock}`,offense:d.offense,coachChose:d.actual||null,description:d.description,captured:c.captured,position:c.index>=0?`${c.index+1} of ${c.count}`:null};}
  function paintPlay(r){
    const c=picker.current(),nav=$('fd-play-nav'),act=$('fd-actual');
    if(!c){nav.hidden=true;act.hidden=true;return;}
    nav.hidden=false;
    $('fd-play-pos').innerHTML=`<b>${esc(c.matchup)}</b> · Week ${c.weekNumber}${c.index>=0?` · ${c.index+1} of ${c.count}`:''}`;
    $('fd-prev').disabled=c.index<=0;$('fd-next').disabled=c.index<0||c.index>=c.count-1;
    const d=c.decision,a=r.choices.find(x=>x.id===d.actual),label=DDFourth.labels[d.actual],best=Math.max(...r.choices.filter(x=>x.wp!==null).map(x=>x.wp));
    let line;
    if(!d.actual)line='The feed does not make the coach’s choice clear.';
    else if(a?.wp==null)line=`<b>The coach chose: ${esc(label)}.</b> That option is outside this model’s range here.`;
    else if(d.actual===r.best)line=`<b>The coach chose: ${esc(label)}.</b> Same as the call.`;
    else{const gap=100*(best-a.wp);line=`<b>The coach chose: ${esc(label)}.</b> That gave up ${gap.toFixed(1)} pp of win probability versus ${esc(DDFourth.labels[r.best].toLowerCase())}${gap<1?', a close call':''}.`;}
    act.hidden=false;act.innerHTML=`<p>${line}</p><p class="fd-actual-play"><span>What happened</span>${esc(d.description)}</p><small>Judged before the snap: how the play turned out does not change the call.</small>`;
  }
  async function getFeed(url,fresh){const r=await fetch(url,{cache:fresh?'no-store':'default'});if(!r.ok)throw Error('Feed request failed.');const env=await r.json();if(!env.source||!env.as_of||!Array.isArray(env.data?.games))throw Error('Feed is incomplete.');return env;}
  async function refresh(){
    const rid=++requestId;
    try{const env=await getFeed('data/fourth-down.json',true);if(rid!==requestId)return;weekly=env;picker.setFeed('current',env);}
    catch(e){if(!picker.hasFeed())$('fd-feed-status').textContent=`This week’s games could not load (${e.message}). Edit the situation by hand instead.`;}
  }
  async function loadPrevious(){try{picker.setFeed('previous',await getFeed('data/fourth-down-previous.json',false));}catch{/* optional: the live week still works */}}
  const query=new URLSearchParams(location.search);if(query.has('qtr')){const s={...browns};for(const k of Object.keys(s))if(query.has(k))s[k]=typeof s[k]==='number'?Number(query.get(k)):query.get(k);if(!teams[s.homeTeam]||!teams[s.awayTeam]){status('Shared team selection is invalid.',true);}else{setForm(s);sourceLabel='Shared situation';sharedSituation=true;}}
  if(query.has('qtr')&&(query.has('cp')||query.has('fp'))){const v={};for(const key of ['cp','fp'])if(query.has(key)){const value=Number(query.get(key));if(query.get(key)!==''&&Number.isFinite(value)&&value>=0&&value<=100)v[key]=value;}if(Object.keys(v).length)initialOverrides=v;}
  // Choose what to show once the feeds are in (or after 8 s without them), then calculate once.
  const started=Promise.race([Promise.all([refresh(),loadPrevious()]),new Promise(r=>setTimeout(r,8000))]).then(()=>{
    if(query.has('play')&&picker.select(query.get('play'),{source:'link'}))return;
    if(sharedSituation){openTab('edit');return;}
    if(picker.selectDefault({source:'default'}))return;
    sourceLabel='Custom situation';openTab('edit');
  });
  Promise.all([DDFourth.load(),started]).then(([e])=>{engine=e;$('fd-calculate').disabled=false;$('fd-calculate').textContent='Calculate the call';calculate();}).catch(e=>{status(e.message+' Reload to retry.',true);$('fd-recommendation').textContent='Model unavailable.';$('fd-verdict-text').textContent='No probabilities have been calculated.';});
  setInterval(()=>{if(!document.hidden)refresh();},60000);
  window.DD_BOTCTX={label:'Fourth Down Lab',title:'Explain this decision',chrome:{sub:'Fourth Down Lab',ph:'Ask about this fourth down…',chips:['Why this call?','What conversion rate breaks even?','What does the goal lens change?','Explain the clock assumptions']},sys:'You are on Fourth Down Lab. Use ONLY DDFourthState for calculator values. Baseline probabilities are model estimates from the pinned nfl4th browser port; never invent numbers or claim independent calibration. The weekly feed is a delayed dated ESPN snapshot, not live odds. Regulation only; no overtime. The model does not know the play call, kicker identity, injuries or wind. Default kickoff assumption is the upstream own 25, with an optional own 35 scenario. Sliders update the current recommendation; distinguish result from baseline and label scenario inputs as assumptions. Historical team rates are separate descriptive comparisons: 2024 onward, regular season, matched distance/field zone or FG distance band/roof; smoothed toward other teams with 20 prior attempts. They are not calibrated matchup forecasts. Median is across smoothed team rates. The empirical percentile curve counts sample rates at or below a threshold, including ties; never extrapolate a precise tail percentile when outside the sample. The optional raw team-season view has an explicit attempt minimum and can be noisy. This is not a percentile of overall offense strength. The Wilson interval describes the raw historical rate, not model uncertainty. Never call the nfl4th baseline a team-specific personnel estimate. Warn about clock sensitivity in the final two minutes. Data and method at /data/fourth-down.json and /data/fourth-down-method.md. The published comparison is the verified fourth-and-1 slice of Brill/Yurko/Wyner (2025). Its strength slider is a user assumption in standardized market-implied scoring units, not an assigned team rating, EPA input, median team, or talent percentile. It previews conversion with existing nfl4th outcome values and current FG assumption; only Apply changes the main recommendation. Use scenario.publishedComparison for its values. It is not independently validated on later seasons and cannot establish a frequency of rare true probabilities. PICKER: the page opens on a real fourth down from the delayed ESPN snapshot: the latest play of a live game, otherwise the week’s biggest coach-versus-model disagreement. current.play describes the selected play: game, week, ESPN description, coachChose = what the coach actually did, frozenPreviousWeek = from the previous captured week (/data/fourth-down-previous.json), which is not always the immediately preceding week, so quote its week number. If current.play is null the reader built or edited the situation by hand: never attribute it to a real game. Judge every decision before the snap; never grade it by how the play turned out. GOAL LENS: current.goalLens re-scores the same outcome lots under another objective the reader picked. It is a way of keeping score, never the recommendation: the recommendation is always the win-probability call in current.result, and you must say so whenever you quote a lens result. Never say a coach should follow a lens, and never claim it shows what coaches or fans actually optimise; nothing here is fitted to coach behaviour. Average win probability is identical to win probability by construction (expected future win probability equals current win probability), so it cannot change a call; explain that instead of presenting it as a second opinion. Time above a line, Keep it a game and Hate falling behind (when its horizon is past the moment after the play) use a MODELLED path: a diffusion on an information clock fitted to 2016-2022 nflverse play-by-play and tested on 2023-2025, regulation only. Quote goalLens.pathModel for its dates and held-out error; it is not observed, not a forecast of this game and not prospectively graded. If tooCloseToCall or level is true, say the lens does not separate the choices; do not name a winner. If available is false, give the reason and stop; the path model does not answer inside the final 30 seconds. winProbabilityGivenUpPP is the modelled win probability lost by following the lens instead of the bot. Felt points are a loss-aversion score chosen by the reader, not a measured preference. Margin, cover and score-based goals are not available: there is no score-path model here. Path model data at /data/fourth-down-paths.json. There is no fourth-down MCP tool yet.',ctx:()=>JSON.stringify({current:window.DDFourthState||null,weeklyAsOf:weekly?.data.refreshed_at,feeds:picker.feeds()})};
})();
