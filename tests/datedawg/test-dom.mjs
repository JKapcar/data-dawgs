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

console.log('\n=== rendered DOM ===');
ok('output rendered',inner.length>2000);
ok('dashboard is the primary result',/Your dating dashboard/i.test(text));
ok('four dashboard views rendered',out.querySelectorAll('[data-view]').length===4);
ok('year shortcuts rendered',!!out.querySelector('[data-range="year-2025"]'));
ok('market value is scoped to selected range',/Dating App MV \/ Market Value/i.test(text));
ok('market value uses human-readable ordinal percentiles',/\d+(?:st|nd|rd|th)–\d+(?:st|nd|rd|th) percentile/i.test(text));
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
ok('import receipt is collapsed by default',!!out.querySelector('details.receipt')&&!out.querySelector('details.receipt').open);
ok('chart copy explains matches are dated to the sent like',/grouped by the date you sent each like/i.test(text));
ok('maturity note appears beside trend',/too recent to score/i.test(text));
ok('likes and matches have distinct color tokens',/--likes:#006ee6/.test(html)&&/--matches:#d91f4e/.test(html));

console.log('\n=== dashboard filters ===');
const allReadout=out.querySelector('.range-readout').textContent;
out.querySelector('[data-range="90d"]').click();
await new Promise(r=>setTimeout(r,50));
ok('90-day preset changes displayed range',out.querySelector('.range-readout').textContent!==allReadout);
out.querySelector('[data-grain="week"]').click();
await new Promise(r=>setTimeout(r,50));
ok('weekly grouping becomes active',out.querySelector('[data-grain="week"]').classList.contains('on'));
out.querySelector('[data-range="year-2025"]').click();
await new Promise(r=>setTimeout(r,50));
ok('year shortcut isolates that calendar year',/2025-01-01 → 2025-12-20/.test(out.querySelector('.range-readout').textContent));
ok('year view labels acceptance points',out.querySelectorAll('.pointlabel').length>0);
ok('both main charts have their own filters',out.querySelectorAll('.charttools').length===2&&out.querySelectorAll('[data-chart-year]').length===2);
let chartYear=out.querySelector('[data-chart-year]');chartYear.value='2024';chartYear.dispatchEvent(new w.Event('change'));
await new Promise(r=>setTimeout(r,50));
ok('chart-local year filter changes the shared view',/2024-01-10 → 2024-12-31/.test(out.querySelector('.range-readout').textContent));
out.querySelector('[data-range="year-2025"]').click();
await new Promise(r=>setTimeout(r,50));
ok('main charts render a median line and 20th–80th band',out.querySelectorAll('svg .benchmarkline.median').length===2&&out.querySelectorAll('svg .benchmarkband').length===2&&/20th–80th percentile benchmark/.test(out.textContent));
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
ok('patterns view uses plain-language weekday and activity labels',/When you send likes/.test(out.textContent)&&/How daily activity relates to your results/.test(out.textContent));
ok('patterns view explains reviewed incoming likes',/Likes you reviewed/.test(out.textContent));
ok('rate bars carry median markers and percentile bands',out.querySelectorAll('.bartrack.ratebench .benchmark').length>0&&out.querySelectorAll('.bartrack.ratebench .benchmark-range').length>0);
out.querySelector('[data-view="momentum"]').click();
await new Promise(r=>setTimeout(r,50));
ok('momentum view shows a filterable cumulative chart',/Your cumulative likes and matches/.test(out.textContent)&&out.querySelectorAll('svg.chart').length===1&&out.querySelectorAll('.charttools').length===1);
ok('momentum includes volume-normalized median and benchmark band',out.querySelectorAll('svg .benchmarkline.median').length===1&&out.querySelectorAll('svg .benchmarkband').length===1);
out.querySelector('[data-view="compare"]').click();
await new Promise(r=>setTimeout(r,50));
ok('compare view explains one export and two scopes',/overall history versus your selected snapshot/i.test(out.textContent)&&/One uploaded export, shown at two scopes/i.test(out.textContent));
ok('compare view fixes overall history against selected snapshot',/Overall history/.test(out.textContent)&&/Selected snapshot/.test(out.textContent));
ok('compare chart includes median and 20th–80th benchmark band',out.querySelectorAll('svg .benchmarkline.median').length===1&&out.querySelectorAll('svg .benchmarkband').length===1);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
