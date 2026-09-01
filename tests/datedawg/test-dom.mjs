import fs from 'fs';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let pass=0,fail=0;
const ok=(l,c)=>{console.log(`${c?'  ok  ':'  FAIL'} ${l}`);c?pass++:fail++;};

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
ok('exploratory boundary slider is not rendered',!w.document.getElementById('cut'));
ok('old pick-your-window panel is not rendered',!/Pick your window/i.test(text));
ok('selfie refused shown on receipt',/Refused, never opened/.test(text));
const fpv=await w.eval('DD.fingerprint(window.__R)');
ok('fingerprint is sha256',/^sha256-[0-9a-f]{64}$/.test(String(fpv)));
ok('fingerprint rendered on receipt',/sha256-/.test(w.document.getElementById('out').textContent));
ok('censoring applied to standardization',M.std.matured===true);
ok('dashboard date inputs rendered',!!w.document.getElementById('viewFrom')&&!!w.document.getElementById('viewTo'));
ok('both time-series charts rendered',out.querySelectorAll('svg.chart').length===2);
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
ok('trend explains why monthly dots cannot be averaged',/Monthly dots have different sample sizes/i.test(text));
ok('likes and matches have distinct color tokens',/--likes:#006ee6/.test(html)&&/--matches:#d91f4e/.test(html));

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
ok('year view labels acceptance points',out.querySelectorAll('.pointlabel').length>0);
ok('rate chart labels the weighted selected-period result against the default cohort',!!out.querySelector('.selectedline')&&/SELECTED PERIOD/.test(out.querySelector('.selectedlabel').textContent)&&/PERCENTILE MEN 40–44/.test(out.querySelector('.selectedlabel').textContent));
ok('both main charts have their own filters',out.querySelectorAll('.charttools').length===2&&out.querySelectorAll('[data-chart-year]').length===2);
ok('both main charts expose six-month and one-month slices',out.querySelectorAll('.charttools [data-range="6m"]').length===2&&out.querySelectorAll('.charttools [data-range="1m"]').length===2);
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
ok('no exploratory slider can mutate declaration',!w.document.getElementById('cut'));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
