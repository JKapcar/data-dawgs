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
ok('STANDARDIZED result is displayed',/standardized · since/i.test(inner));
ok('strata table rendered with all four rows',
   (inner.match(/<tr[^>]*><td>\d+-(\d+|\+)<\/td>/g)||[]).length>=4);
ok('volume-standardized lift shown',/volume-standardized lift/i.test(text));
ok('rank headline uses standardized label',/volume-standardized match rate/i.test(text));
ok('three bands described',/main selectivity-adjusted result/.test(text)
   && /conservative diagnostic/.test(text) && /unadjusted, for reference/.test(text));
ok('pre-parse declaration honoured',/DECLARED PRE-PARSE/.test(text));
ok('z shown for a pre-parse declaration',/z = /.test(text));
ok('declaration reason rendered',/lost 90 lbs/.test(text));
ok('stated as recorded before parse',/recorded before the export was parsed/.test(text));
ok('no in-dashboard declare button',!w.document.getElementById('dGo'));
ok('provenance: publisher rendered',/SwipeStats\.io/.test(text));
ok('provenance: sample size rendered',/7,079/.test(text));
ok('provenance: url rendered',/swipestats\.io\/blog\/tinder-statistics/.test(inner));
ok('provenance: out-of-sample check disclosed',/out-of-sample shape check/i.test(text));
ok('provenance: hinge median disclosed as never measured',/never been measured|NO measured/i.test(text));
ok('inbound relabelled as decisions processed',/Decisions processed/.test(text));
ok('processing-not-arrival stated',/processing times, not arrival times/i.test(text));
ok('selfie refused shown on receipt',/Refused, never opened/.test(text));
const fpv=await w.eval('DD.fingerprint(window.__R)');
ok('fingerprint is sha256',/^sha256-[0-9a-f]{64}$/.test(String(fpv)));
ok('fingerprint rendered on receipt',/sha256-/.test(w.document.getElementById('out').textContent));
ok('censoring applied to standardization',M.std.matured===true);
ok('dashboard date inputs rendered',!!w.document.getElementById('viewFrom')&&!!w.document.getElementById('viewTo'));
ok('both time-series charts rendered',out.querySelectorAll('svg.chart').length===2);
ok('import receipt is collapsed by default',!!out.querySelector('details.receipt')&&!out.querySelector('details.receipt').open);
ok('chart copy explains sent-like dating',/grouped by sent-like date/i.test(text));
ok('maturity note appears beside trend',/too recent to score/i.test(text));

console.log('\n=== dashboard filters ===');
const allReadout=out.querySelector('.range-readout').textContent;
out.querySelector('[data-range="90d"]').click();
await new Promise(r=>setTimeout(r,50));
ok('90-day preset changes displayed range',out.querySelector('.range-readout').textContent!==allReadout);
out.querySelector('[data-grain="week"]').click();
await new Promise(r=>setTimeout(r,50));
ok('weekly grouping becomes active',out.querySelector('[data-grain="week"]').classList.contains('on'));
const vf=w.document.getElementById('viewFrom'),vt=w.document.getElementById('viewTo');
vf.value='2025-01-01';vt.value='2025-03-31';w.document.getElementById('applyRange').click();
await new Promise(r=>setTimeout(r,50));
ok('custom date range is applied',/2025-01-01 → 2025-03-31/.test(out.querySelector('.range-readout').textContent));

console.log('\n=== declaration mechanics ===');
const sl=w.document.getElementById('cut');
sl.value=String(+sl.value+86400000*30);
sl.dispatchEvent(new w.Event('change',{bubbles:true}));
await new Promise(r=>setTimeout(r,200));
let t3=w.document.getElementById('out').textContent;
ok('moving the boundary voids the declaration',/significance withheld/i.test(t3));
ok('void is explained',/was voided when you moved/i.test(t3));
ok('post-move exploration is counted',/exploratory · \d+ move/.test(t3));
ok('cannot be reinstated in-session',/cannot be reinstated/i.test(t3));
ok('no way to declare after seeing results',!w.document.getElementById('dGo'));
const fp2=await w.eval('DD.fingerprint(window.__R)');
ok('page fingerprint stable across calls',/^sha256-[0-9a-f]{64}$/.test(String(fp2)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
