import fs from 'fs';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let pass=0,fail=0;
const ok=(l,c)=>{console.log(`${c?'  ok  ':'  FAIL'} ${l}`);c?pass++:fail++;};
const savedDb=new Map();
function installFakeIDB(win){
  const db={objectStoreNames:{contains:()=>true},createObjectStore(){},close(){},transaction(){
    const tx={oncomplete:null,onerror:null,objectStore(){return {
      get(key){return request(()=>savedDb.get(key),tx);},
      put(value,key){return request(()=>{savedDb.set(key,JSON.parse(JSON.stringify(value)));return key;},tx);},
      delete(key){return request(()=>{savedDb.delete(key);return undefined;},tx);}
    };}};return tx;}};
  function request(work,tx){const q={result:undefined,error:null,onsuccess:null,onerror:null};setTimeout(()=>{try{q.result=work();q.onsuccess&&q.onsuccess();setTimeout(()=>tx.oncomplete&&tx.oncomplete(),0);}catch(e){q.error=e;q.onerror&&q.onerror();}},0);return q;}
  win.indexedDB={open(){const q={result:db,error:null,onupgradeneeded:null,onsuccess:null,onerror:null};setTimeout(()=>{q.onsuccess&&q.onsuccess();},0);return q;}};
  Object.defineProperty(win.navigator,'storage',{value:{persist:async()=>true,persisted:async()=>true},configurable:true});
}

const html=fs.readFileSync('../../datedawg.html','utf8');
const dom=new JSDOM(html,{runScripts:"dangerously",url:"http://localhost/",
  beforeParse(win){
    // jsdom omits crypto.subtle; browsers provide it in secure contexts. Polyfill for
    // the test runtime only — the page itself degrades to a null fingerprint without it.
    const { webcrypto } = require('node:crypto');
    const { TextEncoder, TextDecoder } = require('node:util');
    if(!win.crypto || !win.crypto.subtle)
      Object.defineProperty(win,'crypto',{value:webcrypto,configurable:true});
    if(!win.TextEncoder) win.TextEncoder=TextEncoder;
    if(!win.TextDecoder) win.TextDecoder=TextDecoder;
    installFakeIDB(win);
  }});
const w=dom.window;
// jsdom has no FileReader-from-disk; drive the render path directly
const F={'matches.json':JSON.parse(fs.readFileSync('fixture-matches.json','utf8')),
         'user.json':JSON.parse(fs.readFileSync('fixture-user.json','utf8')),
         'media.json':JSON.parse(fs.readFileSync('fixture-media.json','utf8')),
         'selfie_verification.json':'__REFUSED__'};
w.eval(`window.__F=${JSON.stringify(F)};`);
w.eval(`
  (function(){
    var f=new File([JSON.stringify(window.__F['matches.json'])],'matches.json');
    void f;
  })();
`);
// simulate: parse + paint by invoking the same code path the file reader ends in
w.eval(`
  window.__R = DD.parse(window.__F);
  window.__M = DD.metrics(window.__R, new Date('2025-06-01T00:00:00Z').getTime());
`);
const R=w.__R, M=w.__M;
ok('parser reachable in page',!!R && !R.error);
ok('standardization valid on fixture',M.std.valid===true);
ok('rankStd produced',!!M.rankStd);

// now drive the real UI: dispatch a drop with real File objects
const { File } = w;
const files=Object.keys(F).filter(k=>k!=='selfie_verification.json')
  .map(n=>new File([JSON.stringify(F[n])],n,{type:'application/json'}));
files.push(new File(['{"nope":1}'],'selfie_verification.json',{type:'application/json'}));
// the real flow: declare before the file is parsed
w.document.getElementById('preDate').value='2025-06-01';
w.document.getElementById('preReason').value='lost 90 lbs';
w.document.getElementById('preSubject').value='subject-a';
w.document.getElementById('preConsent').value='supplied for this project';
const dt={files};
const ev=new w.Event('drop',{bubbles:true});
Object.defineProperty(ev,'dataTransfer',{value:dt});
w.document.getElementById('drop').dispatchEvent(ev);

await new Promise(r=>setTimeout(r,400));
const out=w.document.getElementById('out');
const text=out.textContent||'';
const inner=out.innerHTML||'';

console.log('\n=== verdict arrival state ===');
const V=w.document.getElementById('verdict');
const rankTo=Math.max(R.minT,R.maxT-w.DD.RESOLVE_DAYS*864e5);
const rankFrom=Math.max(R.minT,rankTo-364*864e5);
const rankM=w.DD.metrics(R,rankFrom);
ok('verdict renders first',!!V&&out.firstElementChild===V);
ok('arrival screen is removed once results exist',w.document.body.classList.contains('results-ready')&&w.getComputedStyle(w.document.getElementById('arrival')).display==='none');
ok('verdict leads with a percentile',/^\s*\d{1,3}/.test(V.querySelector('.vnum').textContent));
ok('verdict percentile matches its selected ranking window',Math.round((rankM.rankStd.band||rankM.rankStd.all).p)===parseInt(V.querySelector('.vnum').textContent,10));
ok('verdict names the age cohort',/AMONG MEN \d+–\d+/.test(V.textContent));
ok('verdict states reciprocal acceptance',/RECIPROCAL ACCEPTANCE/.test(V.textContent));
const ridgeD=V.querySelector('.vridge path').getAttribute('d');
ok('ridge is derived from many density points',ridgeD.length>800&&ridgeD.split('L').length>100);
const pinLeft=parseFloat(V.querySelector('.vpin').style.left);
const rp=w.DD.ridgePath(rankM.rankStd.anchorsBand,1000,200);
const pinWant=(Math.log(rankM.rankStd.rate)-rp.lo)/rp.span*100;
ok('verdict pin uses the actual rate',Math.abs(pinLeft-pinWant)<0.2);
ok('verdict axes name published anchors',/MEDIAN ·/.test(V.textContent)&&/p90 ·/.test(V.textContent));
ok('verdict carries all-men comparison',/ALL MEN/.test(V.textContent));
ok('verdict carries heavy-day check',/HEAVY-DAY CHECK/.test(V.textContent));
ok('verdict carries sample provenance',/6,233/.test(V.textContent)&&/SWIPESTATS/.test(V.textContent));
ok('verdict repeats the local-only promise',/NOTHING LEFT THIS PAGE/.test(V.textContent));
ok('verdict has a workings cue',!!w.document.getElementById('vcue'));
ok('reduced motion disables verdict animation',/prefers-reduced-motion/.test(html)&&/\.verdict\.play \.vpin/.test(html));

console.log('\n=== rendered DOM ===');
ok('output rendered',inner.length>2000);
ok('dashboard is the primary result',/Your dating dashboard/i.test(text));
ok('four dashboard views rendered',out.querySelectorAll('[data-view]').length===4);
ok('year shortcuts rendered',!!out.querySelector('[data-range="year-2025"]'));
ok('market value is scoped to selected range',/Dating App MV \/ Market Value/i.test(text));
ok('market value uses a human-readable ordinal percentile',/\d+(?:st|nd|rd|th) percentile/i.test(text));
ok('market value leads with the matching age cohort when age is present',/Among men 40–44 in the published SwipeStats Tinder reference/i.test(text));
ok('all-men reference is shown separately rather than blended',/Against all men, every age:/i.test(text));
ok('benchmark sex is detected and remains visibly changeable',/Detected from export/.test(out.querySelector('.benchmark-sex').textContent)&&out.querySelector('[data-benchmark-sex="men"]').classList.contains('on'));
const maleRankBefore=parseInt(out.querySelector('.rank .big').textContent,10);
out.querySelector('[data-benchmark-sex="women"]').click();
await new Promise(r=>setTimeout(r,30));
ok('women toggle switches every ranking surface to the female ecosystem',out.querySelector('[data-benchmark-sex="women"]').classList.contains('on')&&/AMONG WOMEN 40–44/.test(out.querySelector('.verdict').textContent)&&/All women/.test(out.querySelector('.scen').textContent));
ok('female benchmark uses its own sample and produces a different percentile',/842/.test(out.querySelector('.verdict').textContent)&&parseInt(out.querySelector('.rank .big').textContent,10)!==maleRankBefore);
ok('female chart reference uses the published female median',/Women 40–44 median/.test(out.textContent)&&!/Women 40–44 median · 1\.50%/.test(out.textContent));
out.querySelector('[data-benchmark-sex="men"]').click();
await new Promise(r=>setTimeout(r,30));
ok('ranking panel has dashboard plus four independent time windows',out.querySelectorAll('[data-rank-range]').length===5&&!!out.querySelector('[data-rank-range="selected"]'));
ok('ranking panel defaults to one year',out.querySelector('[data-rank-range="1y"]').classList.contains('on'));
const shownRank=()=>parseInt(out.querySelector('.rank .big').textContent,10);
const verdictRank=()=>parseInt(out.querySelector('.verdict .vnum').textContent,10);
ok('verdict and detailed rank agree on the default window',verdictRank()===shownRank());
const dashboardRangeBeforeRank=out.querySelector('.range-readout').textContent;
const oneYearRankDates=out.querySelector('.rankwindow .dates').textContent;
out.querySelector('[data-rank-range="6m"]').click();
await new Promise(r=>setTimeout(r,50));
ok('six-month ranking recomputes its own dates',out.querySelector('[data-rank-range="6m"]').classList.contains('on')&&out.querySelector('.rankwindow .dates').textContent!==oneYearRankDates);
ok('verdict and detailed rank agree after a period change',verdictRank()===shownRank()&&/PERIOD\s+6 MONTHS/i.test(out.querySelector('.verdict').textContent));
ok('ranking window does not change dashboard range',out.querySelector('.range-readout').textContent===dashboardRangeBeforeRank);
out.querySelector('[data-rank-range="all"]').click();
await new Promise(r=>setTimeout(r,50));
ok('overall verdict and detailed rank use one answer',verdictRank()===shownRank()&&/PERIOD\s+OVERALL/i.test(out.querySelector('.verdict').textContent));
out.querySelector('[data-rank-range="1m"]').click();
await new Promise(r=>setTimeout(r,50));
ok('one-month ranking ends on latest scoreable date',out.querySelector('[data-rank-range="1m"]').classList.contains('on')&&/through the latest scoreable date/i.test(out.querySelector('.rankwindow .dates').textContent));
const oneMonthPanel=out.querySelector('.slip').textContent;
const oneMonthVerdict=out.querySelector('.verdict').textContent;
ok('one-month verdict and detail agree even when the sample is thin',
  (/Not enough resolved likes/i.test(oneMonthPanel)&&/NOT ENOUGH RESOLVED LIKES/i.test(oneMonthVerdict))||verdictRank()===shownRank());
ok('empirical percentile table is rendered',/Published percentile/.test(text)&&/Published empirical table/.test(text));
ok('age-band reference is rendered',/Men 40–44/.test(text));
ok('pre-parse declaration honoured',/DECLARED PRE-PARSE/.test(text));
ok('z shown for a pre-parse declaration',/z = /.test(text));
ok('declaration reason rendered',/lost 90 lbs/.test(text));
ok('declared test is fixed and filter-independent',/fixed; dashboard filters do not alter it/i.test(text));
ok('no in-dashboard declare button',!w.document.getElementById('dGo'));
const market=out.querySelector('#market-story'),safeCut=w.document.getElementById('cut'),safeMin=+safeCut.min,safeMax=+safeCut.max;
ok('Market explains how the comparison split works',!!safeCut&&/Everything to the left becomes Before/.test(market.textContent)&&/Everything to the right becomes After/.test(market.textContent));
ok('Market gives the split safe statistical endpoints',safeMin>R.minT&&safeMax<R.maxT-w.DD.RESOLVE_DAYS*864e5&&w.DD.metrics(R,safeMin).beforeAdj.n>=w.DD.MIN_N&&w.DD.metrics(R,safeMax).afterAdj.n>=w.DD.MIN_N);
ok('Market exposes live before and after sample counts',!!market.querySelector('#cutBeforeN')&&!!market.querySelector('#cutAfterN')&&/Matured likes kept before/.test(market.textContent)&&/Matured likes kept after/.test(market.textContent));
ok('Market offers friendly starting points',market.querySelectorAll('[data-cut-preset]').length===3&&/Balanced history/.test(market.textContent)&&/1 year ago/.test(market.textContent));
const heldCut=safeCut.value;safeCut.value=safeCut.max;safeCut.dispatchEvent(new w.Event('input'));
ok('dragging previews the date and sample sizes before committing',market.querySelector('#cutLabel').textContent===new Date(safeMax).toISOString().slice(0,10)&&Number(market.querySelector('#cutAfterN').textContent.replace(/\D/g,''))===w.DD.metrics(R,safeMax).afterAdj.n);
safeCut.value=heldCut;safeCut.dispatchEvent(new w.Event('input'));
ok('old pick-your-window panel is not rendered',!/Pick your window/i.test(text));
ok('selfie refused shown on receipt',/Refused, never opened/.test(text));
const fpv=await w.eval('DD.fingerprint(window.__R)');
ok('fingerprint is sha256',/^sha256-[0-9a-f]{64}$/.test(String(fpv)));
ok('fingerprint rendered on receipt',/sha256-/.test(w.document.getElementById('out').textContent));
ok('censoring applied to standardization',M.std.matured===true);
ok('dashboard date inputs rendered',!!w.document.getElementById('viewFrom')&&!!w.document.getElementById('viewTo'));
ok('three overview time-series charts rendered',out.querySelectorAll('svg.chart').length===3);
ok('overview promotes incoming likes reviewed',/Incoming likes reviewed/i.test(out.querySelector('.kpis').textContent)&&!!out.querySelector('svg.inbound-chart'));
ok('overview inbound totals reconcile',out.querySelector('.inbound-kpi .value').textContent.trim()===String(R.ins.length)&&out.querySelector('svg.inbound-chart').getAttribute('aria-label').includes('Incoming likes reviewed'));
const initialSeries=w.DD.timeSeries(R,R.minT,R.maxT,'month');
ok('observed match totals agree across KPI, insight, and activity chart',
  parseInt(out.querySelector('.match-kpi .value').textContent.replace(/,/g,''),10)===initialSeries.matches&&
  parseInt(out.querySelector('.match-insight .big').textContent.replace(/,/g,''),10)===initialSeries.matches&&
  +out.querySelector('svg[data-observed-matches]').getAttribute('data-observed-matches')===initialSeries.matches);
ok('scoreable result is explicitly separated from observed total',
  new RegExp(initialSeries.matureMatches+' scoreable matches from '+initialSeries.matureLikes+' matured likes','i').test(out.textContent)&&
  new RegExp(initialSeries.matureMatches+' are attached to the '+initialSeries.matureLikes+' matured likes','i').test(out.textContent));
ok('import receipt is collapsed by default',!!out.querySelector('details.receipt')&&!out.querySelector('details.receipt').open);
ok('chart copy explains observed matches are dated to the sent like',/known match outcome, dated to when you sent each like/i.test(text));
ok('maturity note appears beside trend',/too recent to score/i.test(text));
ok('trend explains why period dots cannot be averaged',/Periods have different sample sizes/i.test(text));
ok('likes and matches have distinct color tokens',/--likes:#006ee6/.test(html)&&/--matches:#d91f4e/.test(html));
ok('Combine is compact and carries the five-second answer',!!out.querySelector('#verdict .vtier')&&out.querySelectorAll('#verdict .vmetric').length===3&&/outperform about/i.test(out.querySelector('#verdict').textContent));
ok('Market change story follows the Combine',out.children[1]&&out.children[1].id==='market-story'&&/Change after balancing daily activity/.test(out.children[1].textContent));
ok('Analysis Floor identifies the feature-detected chart registry',/The Analysis Floor/.test(out.textContent)&&/11 AVAILABLE · 34 CATALOGUED/.test(out.textContent));
ok('local companion exposes no active memory claim',!!out.querySelector('#companion')&&/LOCAL · NO MEMORY/.test(out.querySelector('#companion').textContent));
ok('Scout Report is aggregate-only',!!out.querySelector('#scout-report')&&/AGGREGATES ONLY · LOCAL/.test(out.querySelector('#scout-report').textContent));
ok('local memory is explicit and off by default',!!out.querySelector('#rememberConsent')&&out.querySelector('#saveLocal').disabled&&/Optional and off by default/.test(out.querySelector('.local-memory').textContent));
ok('local memory discloses retained event history and browser-profile access',/Dates, outcomes, comments, age, gender and filters/.test(out.querySelector('.local-memory').textContent)&&/not separately encrypted from your browser profile/i.test(out.querySelector('.local-memory').textContent));
out.querySelector('#rememberConsent').click();out.querySelector('#saveLocal').click();
await new Promise(r=>setTimeout(r,120));
ok('opt-in stores a sanitized chart model without the raw canonical sequence',savedDb.has('current')&&savedDb.get('current').kind==='sanitized-chart-data'&&!('_canon' in savedDb.get('current').R));
const restoredDom=new JSDOM(html,{runScripts:"dangerously",url:"http://localhost/",beforeParse(win){
  const {webcrypto}=require('node:crypto');const {TextEncoder,TextDecoder}=require('node:util');
  if(!win.crypto||!win.crypto.subtle)Object.defineProperty(win,'crypto',{value:webcrypto,configurable:true});
  if(!win.TextEncoder)win.TextEncoder=TextEncoder;if(!win.TextDecoder)win.TextDecoder=TextDecoder;installFakeIDB(win);
}});
await new Promise(r=>setTimeout(r,220));
ok('saved dashboard restores automatically on the next visit',restoredDom.window.document.body.classList.contains('results-ready')&&/540/.test(restoredDom.window.document.querySelector('.kpi').textContent));
restoredDom.window.close();
out.querySelector('#forgetLocal').click();await new Promise(r=>setTimeout(r,80));
ok('forget saved dashboard deletes local memory',!savedDb.has('current'));

console.log('\n=== dashboard filters ===');
const allReadout=out.querySelector('.range-readout').textContent;
ok('dashboard exposes last-year, last-six-month, and last-month slices',
  !!out.querySelector('.rangebar [data-range="1y"]')&&!!out.querySelector('.rangebar [data-range="6m"]')&&!!out.querySelector('.rangebar [data-range="1m"]'));
out.querySelector('[data-range="90d"]').click();
await new Promise(r=>setTimeout(r,50));
ok('90-day preset changes displayed range',out.querySelector('.range-readout').textContent!==allReadout);
out.querySelector('[data-grain="week"]').click();
await new Promise(r=>setTimeout(r,50));
ok('weekly grouping becomes active',out.querySelector('[data-grain="week"]').classList.contains('on'));
ok('quarterly and yearly grouping controls are available',!!out.querySelector('[data-grain="quarter"]')&&!!out.querySelector('[data-grain="year"]'));
out.querySelector('[data-grain="quarter"]').click();
await new Promise(r=>setTimeout(r,50));
ok('quarterly grouping becomes active and labels quarters',out.querySelector('[data-grain="quarter"]').classList.contains('on')&&/Q[1-4] \d{4}/.test(out.querySelector('.rate-stage').innerHTML));
out.querySelector('[data-grain="year"]').click();
await new Promise(r=>setTimeout(r,50));
ok('yearly grouping becomes active',out.querySelector('[data-grain="year"]').classList.contains('on'));
out.querySelector('[data-grain="week"]').click();
await new Promise(r=>setTimeout(r,50));
out.querySelector('[data-range="year-2025"]').click();
await new Promise(r=>setTimeout(r,50));
ok('year shortcut isolates that calendar year',/2025-01-01 → 2025-12-20/.test(out.querySelector('.range-readout').textContent));
const selected2025=w.DD.timeSeries(R,Date.UTC(2025,0,1),Date.UTC(2026,0,1)-1,'month');
const selected2025Rank=w.DD.rank(selected2025.rate.p,R.profile.age);
ok('changing dashboard dates ranks the visible dashboard rate itself',
  out.querySelector('[data-rank-range="selected"]').classList.contains('on')&&
  shownRank()===Math.round((selected2025Rank.band||selected2025Rank.all).p)&&
  verdictRank()===shownRank()&&
  new RegExp(Math.round((selected2025Rank.band||selected2025Rank.all).p)+'(?:st|nd|rd|th) percentile among men 40–44','i').test(out.querySelectorAll('.kpi')[2].textContent));
out.querySelector('[data-range="year-2024"]').click();
await new Promise(r=>setTimeout(r,50));
const multiYearLikes=w.DD.timeSeries(R,Date.UTC(2024,0,1),Date.UTC(2026,0,1)-1,'month').likes;
ok('year chips select a continuous multi-year range',
  /2024-01-10 → 2025-12-20/.test(out.querySelector('.range-readout').textContent)&&
  out.querySelector('[data-range="year-2024"]').classList.contains('on')&&
  out.querySelector('[data-range="year-2025"]').classList.contains('on')&&
  Number(out.querySelector('.kpi .value').textContent.replace(/\D/g,''))===multiYearLikes);
out.querySelector('[data-range="year-2024"]').click();
await new Promise(r=>setTimeout(r,50));
ok('clicking a selected endpoint shrinks the multi-year range',
  /2025-01-01 → 2025-12-20/.test(out.querySelector('.range-readout').textContent)&&
  !out.querySelector('[data-range="year-2024"]').classList.contains('on')&&
  out.querySelector('[data-range="year-2025"]').classList.contains('on'));
ok('rate chart defaults to a story-first view',out.querySelector('[data-rate-mode="story"]').classList.contains('on')&&out.querySelector('svg[data-rate-mode="story"]'));
ok('rate story summarizes the whole arc in four human beats',out.querySelectorAll('.rate-storyline .rate-beat').length===4&&/Your whole window/.test(out.querySelector('.rate-storyline').textContent)&&/Peak chapter/.test(out.querySelector('.rate-storyline').textContent)&&/Biggest jump/.test(out.querySelector('.rate-storyline').textContent));
ok('rate story gives the timeline four named performance zones',out.querySelectorAll('.ratechart rect[class^="rate-zone-"]').length===4&&/LONG SHOT/.test(out.querySelector('.ratechart').textContent)&&/RARE AIR/.test(out.querySelector('.ratechart').textContent));
ok('rate story marks significant chapters while preserving requested point values',out.querySelectorAll('.ratechart .story-label').length>0&&out.querySelectorAll('.ratechart .pointlabel').length>0);
ok('rate chart labels the weighted whole-window result',!!out.querySelector('.selectedline')&&/YOUR WHOLE WINDOW/.test(out.querySelector('.selectedlabel').textContent)&&new RegExp(out.querySelectorAll('.kpi')[2].querySelector('.value').textContent.replace('%','\\%')).test(out.querySelector('.selectedlabel').textContent));
out.querySelector('[data-rate-mode="analyst"]').click();
await new Promise(r=>setTimeout(r,50));
ok('analyst view adds uncertainty whiskers and dense values',out.querySelector('[data-rate-mode="analyst"]').classList.contains('on')&&out.querySelector('svg[data-rate-mode="analyst"]')&&out.querySelectorAll('.ratechart .uncertainty').length>0&&out.querySelectorAll('.ratechart .pointlabel').length>0);
out.querySelector('[data-rate-mode="story"]').click();
await new Promise(r=>setTimeout(r,50));
ok('all three overview charts have their own filters',out.querySelectorAll('.charttools').length===3&&out.querySelectorAll('[data-chart-year]').length===3);
ok('all three overview charts expose six-month and one-month slices',out.querySelectorAll('.charttools [data-range="6m"]').length===3&&out.querySelectorAll('.charttools [data-range="1m"]').length===3);
ok('inbound chart does not invent an external cohort benchmark',out.querySelector('.inbound-chart').closest('.chartcard').querySelectorAll('[data-benchmark-scope]').length===0);
let chartYear=out.querySelector('[data-chart-year]');chartYear.value='2024';chartYear.dispatchEvent(new w.Event('change'));
await new Promise(r=>setTimeout(r,50));
ok('chart-local year filter changes the shared view',/2024-01-10 → 2024-12-31/.test(out.querySelector('.range-readout').textContent));
out.querySelector('[data-range="year-2025"]').click();
await new Promise(r=>setTimeout(r,50));
ok('main charts default to the age-cohort median and 20th–80th band',
  out.querySelectorAll('svg .benchmarkline.median').length===2&&out.querySelectorAll('svg .benchmarkband').length===2&&
  /Men 40–44 median · 1\.50%/.test(out.textContent)&&/Men 40–44 20th–80th percentile/.test(out.textContent)&&
  Array.from(out.querySelectorAll('[data-benchmark-scope="cohort"]')).every(x=>x.classList.contains('on')));
out.querySelector('[data-benchmark-scope="all"]').click();
await new Promise(r=>setTimeout(r,50));
ok('all-men benchmark is an explicit chart toggle',
  /All men median · 2\.04%/.test(out.textContent)&&
  Array.from(out.querySelectorAll('[data-benchmark-scope="all"]')).every(x=>x.classList.contains('on'))&&
  /percentile among all men/i.test(out.querySelectorAll('.kpi')[2].textContent));
out.querySelector('[data-benchmark-scope="cohort"]').click();
await new Promise(r=>setTimeout(r,50));
ok('main charts render at a scrollable readable width',Array.from(out.querySelectorAll('svg.chart')).every(x=>parseInt(x.style.width,10)>=1040));
ok('activity chart defaults to a readable spread scale',out.querySelector('[data-activity-scale="sqrt"]').classList.contains('on')&&out.querySelector('svg[data-scale-mode="sqrt"]'));
ok('activity chart labels its largest real counts',out.querySelectorAll('svg[data-scale-mode] .barlabel').length>0&&out.querySelectorAll('svg[data-scale-mode] .matchlabel').length>0);
const readableSmallest=Math.min(...Array.from(out.querySelectorAll('svg[data-scale-mode] .likebar')).map(x=>+x.getAttribute('height')).filter(x=>x>0));
out.querySelector('[data-activity-scale="linear"]').click();
await new Promise(r=>setTimeout(r,50));
ok('full linear scale remains available',out.querySelector('[data-activity-scale="linear"]').classList.contains('on')&&out.querySelector('svg[data-scale-mode="linear"]'));
const linearSmallest=Math.min(...Array.from(out.querySelectorAll('svg[data-scale-mode] .likebar')).map(x=>+x.getAttribute('height')).filter(x=>x>0));
ok('readable scale visibly lifts small activity off the floor',readableSmallest>linearSmallest);
out.querySelector('[data-activity-scale="sqrt"]').click();
await new Promise(r=>setTimeout(r,50));
let benchmarkToggle=out.querySelector('[data-layer="benchmarks"]');benchmarkToggle.click();
await new Promise(r=>setTimeout(r,50));
ok('benchmark layer can be hidden',out.querySelectorAll('svg .benchmarkband').length===0&&!/External Tinder reference/.test(out.textContent));
out.querySelector('[data-layer="benchmarks"]').click();
await new Promise(r=>setTimeout(r,50));
out.querySelector('[data-view="patterns"]').click();
await new Promise(r=>setTimeout(r,50));
ok('patterns view tells an ecosystem and activity story',/Where you live in the dating ecosystem/.test(out.textContent)&&/Your week has a shape/.test(out.textContent)&&/The activity terrain/.test(out.textContent));
ok('patterns story defaults to the age-cohort ecosystem',out.querySelector('[data-benchmark-scope="cohort"]').classList.contains('on')&&/Men 40–44 20th–80th percentile Tinder reference/.test(out.textContent));
ok('patterns has one story-wide period switch',out.querySelectorAll('.patternfilters').length===1&&out.querySelectorAll('.patternfilters [data-range]').length===4);
const patternDatesBefore=out.querySelector('.patternfilters .slice-readout').textContent;
out.querySelector('.patternfilters [data-range="6m"]').click();
await new Promise(r=>setTimeout(r,50));
ok('six-month story slice recomputes the whole Patterns view',out.querySelector('.patternfilters [data-range="6m"]').classList.contains('on')&&out.querySelector('.patternfilters .slice-readout').textContent!==patternDatesBefore&&out.querySelector('.range-readout').textContent.trim()===out.querySelector('.patternfilters .slice-readout').textContent.replace(/^Showing\s+/i,'').trim());
ok('patterns view explains reviewed incoming likes',/Likes you reviewed/.test(out.textContent));
ok('ecosystem pictures a population of 100 reference men',out.querySelectorAll('.ecosystem .eco-person').length===100&&!!out.querySelector('.ecosystem .eco-you'));
ok('weekly orbit renders all seven days as visual nodes',out.querySelectorAll('.orbit-node').length===7);
ok('activity terrain renders all four volume habitats',out.querySelectorAll('.terrain-mound').length===4&&!!out.querySelector('.terrain-band')&&!!out.querySelector('.terrain-grid'));
ok('comment comparison is pictured as two speech pools',out.querySelectorAll('.comment-scene .speech').length===2&&/observed gap/.test(out.textContent));
out.querySelector('[data-view="momentum"]').click();
await new Promise(r=>setTimeout(r,50));
ok('momentum view shows a filterable cumulative chart',/Your cumulative likes and observed matches/.test(out.textContent)&&out.querySelectorAll('svg.chart').length===1&&out.querySelectorAll('.charttools').length===1);
ok('momentum total agrees with the shared observed-match KPI',out.querySelector('svg[data-observed-matches]').getAttribute('data-observed-matches')===out.querySelector('.match-kpi .value').textContent.replace(/,/g,''));
ok('momentum includes volume-normalized median and benchmark band',out.querySelectorAll('svg .benchmarkline.median').length===1&&out.querySelectorAll('svg .benchmarkband').length===1);
ok('momentum benchmark remains cohort-scoped',/Men 40–44 median · 1\.50%/.test(out.textContent));
out.querySelector('[data-view="compare"]').click();
await new Promise(r=>setTimeout(r,50));
ok('compare view explains one export and two scopes',/overall history versus your selected snapshot/i.test(out.textContent)&&/One uploaded export, shown at two scopes/i.test(out.textContent));
ok('compare view fixes overall history against selected snapshot',/Overall history/.test(out.textContent)&&/Selected snapshot/.test(out.textContent));
ok('compare is a multi-story playground',/Your pace changed/.test(out.textContent)&&/Incoming likes you reviewed/.test(out.textContent)&&/Where your week moved/.test(out.textContent)&&/Your activity mix shifted/.test(out.textContent)&&/Comment versus no-comment/.test(out.textContent));
ok('compare normalizes count pace to 30 days',out.querySelectorAll('.compare-bar-row').length===4&&/per 30 calendar days/i.test(out.textContent));
ok('compare exposes inbound composition without calling it arrival',!!out.querySelector('.inbound-flow')&&/decision timestamps/i.test(out.textContent)&&/Unprocessed incoming likes are absent/i.test(out.textContent));
ok('compare uses one story-wide period switch',out.querySelectorAll('.patternfilters').length===1&&out.querySelectorAll('.compare-story-grid').length===1);
ok('compare distinguishes observed totals from scoreable rates',/Observed matches/.test(out.textContent)&&/Scoreable match-back rate/.test(out.textContent));
ok('compare chart includes median and 20th–80th benchmark band',out.querySelectorAll('svg .benchmarkline.median').length===1&&out.querySelectorAll('svg .benchmarkband').length===1);
ok('compare benchmark remains cohort-scoped',/Men 40–44 median · 1\.50%/.test(out.textContent));
ok('compare warns that unequal-window counts are not comparable',/compare their rates.not their raw totals/i.test(out.textContent));
out.querySelector('[data-view="overview"]').click();
await new Promise(r=>setTimeout(r,50));
const likesToggle=out.querySelector('[data-series="likes"]');likesToggle.click();
await new Promise(r=>setTimeout(r,50));
ok('series visibility can be toggled',!out.querySelector('[data-series="likes"]').classList.contains('on'));
const vf=w.document.getElementById('viewFrom'),vt=w.document.getElementById('viewTo');
vf.value='2025-01-01';vt.value='2025-03-31';w.document.getElementById('applyRange').click();
await new Promise(r=>setTimeout(r,50));
ok('custom date range is applied',/2025-01-01 → 2025-03-31/.test(out.querySelector('.range-readout').textContent));

console.log('\n=== declaration mechanics ===');
let t3=w.document.getElementById('out').textContent;
ok('declared comparison survives dashboard filtering',/Your declared comparison/.test(t3)&&/lost 90 lbs/.test(t3));
let cut=w.document.getElementById('cut'),declaredCut=cut.value;
cut.value=String(+declaredCut+86400000);cut.dispatchEvent(new w.Event('change'));
await new Promise(r=>setTimeout(r,50));
ok('moving the comparison date permanently invalidates declaration',/EXPLORATORY · 1 MOVE/.test(out.querySelector('#market-story').textContent)&&!/Your declared comparison/.test(out.textContent));
cut=w.document.getElementById('cut');cut.value=declaredCut;cut.dispatchEvent(new w.Event('change'));
await new Promise(r=>setTimeout(r,50));
ok('returning to the declared date does not restore significance',/EXPLORATORY · 2 MOVES/.test(out.querySelector('#market-story').textContent)&&!/Your declared comparison/.test(out.textContent));
ok('no way to declare after seeing results',!w.document.getElementById('dGo'));
const fp2=await w.eval('DD.fingerprint(window.__R)');
ok('page fingerprint stable across calls',/^sha256-[0-9a-f]{64}$/.test(String(fp2)));
out.querySelector('#again').click();
await new Promise(r=>setTimeout(r,20));
ok('read-another-export restores the arrival screen',!w.document.body.classList.contains('results-ready')&&w.getComputedStyle(w.document.getElementById('arrival')).display!=='none'&&out.classList.contains('hide'));
const badDrop=new w.Event('drop',{bubbles:true});
Object.defineProperty(badDrop,'dataTransfer',{value:{files:[new File(['{}'],'user.json',{type:'application/json'})]}});
w.document.getElementById('drop').dispatchEvent(badDrop);
await new Promise(r=>setTimeout(r,50));
ok('failed import leaves the arrival screen visible',!w.document.body.classList.contains('results-ready')&&w.getComputedStyle(w.document.getElementById('arrival')).display!=='none'&&/matches\.json is required/i.test(out.textContent));
const unknownUser=JSON.parse(JSON.stringify(F['user.json']));delete unknownUser.profile.gender;
const unknownFiles=[new File([JSON.stringify(F['matches.json'])],'matches.json',{type:'application/json'}),new File([JSON.stringify(unknownUser)],'user.json',{type:'application/json'})];
const unknownDrop=new w.Event('drop',{bubbles:true});Object.defineProperty(unknownDrop,'dataTransfer',{value:{files:unknownFiles}});w.document.getElementById('drop').dispatchEvent(unknownDrop);
await new Promise(r=>setTimeout(r,250));
ok('missing export gender pauses before any percentile is shown',!!out.querySelector('.benchmark-choice')&&!out.querySelector('#verdict')&&/guessing would give you a misleading percentile/i.test(out.textContent));
ok('missing export gender offers an explicit women or men choice',out.querySelectorAll('[data-choose-sex]').length===2);
out.querySelector('[data-choose-sex="women"]').click();await new Promise(r=>setTimeout(r,40));
ok('unknown-gender choice opens the complete women benchmark dashboard',!!out.querySelector('#verdict')&&/WOMEN/.test(out.querySelector('#verdict').textContent)&&out.querySelector('[data-benchmark-sex="women"]').classList.contains('on'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
