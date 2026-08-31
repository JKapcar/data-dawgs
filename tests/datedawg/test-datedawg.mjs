import fs from 'fs';
const html=fs.readFileSync('../../datedawg.html','utf8');
const DD=eval(html.split('/*<<<PARSER_START>>>*/')[1].split('/*<<<PARSER_END>>>*/')[0]+'; DD');
let pass=0,fail=0;
const t=(label,got,want)=>{const ok=String(got)===String(want);
  console.log(`${ok?'  ok  ':'  FAIL'} ${label.padEnd(46)} got=${got} want=${want}`);ok?pass++:fail++;};
const ok=(label,cond)=>t(label,!!cond,true);

const F={'matches.json':JSON.parse(fs.readFileSync('fixture-matches.json','utf8')),
         'user.json':JSON.parse(fs.readFileSync('fixture-user.json','utf8')),
         'media.json':JSON.parse(fs.readFileSync('fixture-media.json','utf8')),
         'selfie_verification.json':'__REFUSED__'};
const R=DD.parse(F);
await DD.fingerprint(R);

console.log('=== parse (synthetic fixture, no real data) ===');
t('records',R.records,630);
t('malformed records survive',!R.error,true);
t('selfie refused',R.refused.join(','),'selfie_verification.json');
t('identity+devices dropped',R.userDropped.sort().join(','),'devices,identity,installs,location');
t('photo links counted not kept',R.photoLinks,3);
t('filters read',`${R.filters.ageMin}-${R.filters.ageMax}/${R.filters.distance}`,'18-85/66');
t('outbound rows',R.outs.length,540);
t('inbound rows (25 acc + 60 blk + 1 gap + 1 weMet)',R.ins.length,87);
t('we_met deduped to connections',R.weMetConnections,1);
t('we_met Yes counted once not twice',R.weMet.didMeet['Yes'],1);
t('was_my_type captured',R.weMet.wasMyType['Yes'],1);
t('coverage gap year flagged',R.blockGapYears.join(','),'2024');

console.log('\n=== conversion is piped, not surfaced ===');
ok('conversion computed',R.conversionPipes.messagesSent>0);
ok('conversion carries a not-surfaced note',/not surfaced/i.test(R.conversionPipes.note));
ok('no "opened" label in shipped HTML',!/threads you opened|You messaged first/i.test(html));
ok('no date/we_met panel on surface',!/<h2>Dates<\/h2>/.test(html));
ok('headline is reciprocal acceptance, not cold exposure',
   /liked you back/.test(html) && !/If she sees your profile/.test(html));
ok('cold-discover disclaimed in lead',/no\s+denominator in the export/.test(html));
ok('no flip-to-reveal mode toggle',!/id="mDecl"/.test(html)&&!/id="mExp"/.test(html));
ok('declaration is captured BEFORE parse',/preDate/.test(html)&&/preReason/.test(html));
ok('no in-dashboard declare control',!/id="dGo"/.test(html)&&!/id="dReason"/.test(html));
ok('declaration requires both date and reason',/when&&why/.test(html));
ok('page states a later declaration is impossible',/no way to declare one later/i.test(html));
ok('subject and consent captured pre-parse',/preSubject/.test(html)&&/preConsent/.test(html));
ok('declaration voids on boundary change',/was voided when you moved/.test(html));
ok('significance withheld while exploring',/significance withheld/.test(html));
ok('derived not observed percentile stated',/derived reference/.test(html)&&/not observed Hinge cohort/.test(html));
ok('stratification language softened',/partially<\/i> holds|<i>partially<\/i>/.test(html)||/does\s*'\+\s*'not isolate the profile|not isolate the profile/.test(html));

console.log('\n=== windowed metrics ===');
const CUT=new Date('2025-06-01T00:00:00Z').getTime();
const M=DD.metrics(R,CUT);
ok('after-window rate > before-window rate',M.after.p>M.before.p);
ok('era shift is significant',M.z.z>2);
ok('heavy-day strata populated both sides',M.heavyAfter.n>0&&M.heavyBefore.n>0);
ok('like-for-like lift still positive',M.zHeavy.lift>0);
ok('adjusted n <= raw n (censoring)',M.afterAdj.n<=M.after.n);
ok('selectivity computed',M.selAfter.perDay>0&&M.selBefore.perDay>0);
ok('standardized rate computed',M.std.wsum>0&&M.std.afterRate>0);
ok('standardized uses all 4 strata',M.std.strata.filter(x=>x.w).length===4);
ok('standardized lift is finite',isFinite(M.std.lift));
ok('standardization is censoring-adjusted',M.std.matured===true);
const stdN=M.std.strata.reduce((a,x)=>a+x.a.n+x.b.n,0);
const matureN=M.afterAdj.n+M.beforeAdj.n;
ok('standardized n equals matured n, not raw n',stdN===matureN);
ok('standardized n < raw n when recent likes exist',stdN<=M.after.n+M.before.n);
ok('z-test runs on matured likes',M.z.p1===M.afterAdj.p&&M.z.p2===M.beforeAdj.p);
ok('raw z kept separately',!!M.zRaw&&M.zRaw!==M.z);
ok('common-support guard present',typeof M.std.valid==='boolean');
ok('strata accounting complete',M.std.strataUsed+M.std.dropped.length===M.std.strataTotal);
const noOverlap=DD.metrics(R,new Date('2019-01-01T00:00:00Z').getTime());
ok('no-overlap window suppresses standardization',noOverlap.std.valid===false||noOverlap.std.strataUsed>=2);
ok('rankStd null when standardization invalid',
   noOverlap.std.valid?true:noOverlap.rankStd===null);
ok('rankStd exists',!!M.rankStd);
ok('comment split by era',M.comBefore.n>0&&M.comAfter.n>=0);
ok('inbound per-day computed',M.inbound.perDay>0);

console.log('\n=== time-series dashboard ===');
const allSeries=DD.timeSeries(R,R.minT,R.maxT,'month');
t('all-range likes equal parsed outbound',allSeries.likes,R.outs.length);
t('all-range matches preserve outcomes',allSeries.matches,R.outs.reduce((a,o)=>a+o.matched,0));
ok('maturity removes recent likes',allSeries.matureLikes<=allSeries.likes);
ok('monthly series fills the full range',allSeries.bins.length>12);
ok('bin counts reconcile to selected total',allSeries.bins.reduce((a,b)=>a+b.likes,0)===allSeries.likes);
ok('rate denominator reconciles to matured likes',
   allSeries.bins.reduce((a,b)=>a+b.matureLikes,0)===allSeries.matureLikes);
const recentSeries=DD.timeSeries(R,R.maxT-89*864e5,R.maxT,'month');
ok('date range filters activity',recentSeries.likes<allSeries.likes);
const weeklySeries=DD.timeSeries(R,R.minT,R.maxT,'week');
ok('weekly view has more buckets than monthly',weeklySeries.bins.length>allSeries.bins.length);
const reversed=DD.timeSeries(R,R.maxT,R.minT,'month');
t('reversed custom dates are normalized',reversed.likes,allSeries.likes);

console.log('\n=== ranking math ===');
const fit=DD.fitFromQuantiles(0.0204,0.125,0.90);
t('two-quantile sigma',fit.sigma.toFixed(4),'1.4145');
const q=(L)=>100*fit.median*Math.exp(DD.Phinv(L)*fit.sigma);
t('refits p75 (published 5.39)',q(0.75).toFixed(2),'5.30');
t('refits p90 (fitted anchor)',q(0.90).toFixed(2),'12.50');
t('refits p95 (published 20.37)',q(0.95).toFixed(2),'20.90');
ok('p75 within 0.2pp of published',Math.abs(q(0.75)-5.39)<0.2);
ok('p95 within 0.6pp of published',Math.abs(q(0.95)-20.37)<0.6);
ok('no Gini borrowed from another variable',!/sigmaFromGini\s*\(/.test(html.split('PARSER_END')[0].split('BENCHMARKS')[1]||''));
t('benchmarks graded',DD.BENCHMARKS.filter(b=>b.grade==='A').length,1);
ok('every benchmark carries provenance',DD.BENCHMARKS.every(b=>b.source&&b.source.publisher&&b.source.verified));
ok('male sample size corrected',/6,233/.test(DD.BENCHMARKS.find(b=>b.grade==='A').source.sample));
ok('bias direction stated as unknown',
   /DIRECTION of the selection bias is unknown/i.test(DD.BENCHMARKS.find(b=>b.grade==='A').source.bias));
ok('hinge rows labelled ASSUMPTION',DD.BENCHMARKS.filter(b=>b.grade==='C').every(b=>/^ASSUMPTION/.test(b.name)));
ok('conversion note says v1.2',/v1\.2/.test(R.conversionPipes.note));
ok('grade-A carries a url',!!DD.BENCHMARKS.find(b=>b.grade==='A').source.url);
ok('grade-C rows admit no measured median',DD.BENCHMARKS.filter(b=>b.grade==='C')
   .every(b=>/never been published|NO measured/i.test(b.source.verified)));
ok('parser version is 1.2',DD.PARSER_VERSION==='1.2.0');
const rk=DD.rank(0.099);
t('5 reference distributions',rk.rows.length,5);
ok('band spans a real range',rk.hi-rk.lo>3);
ok('mid inside band',rk.mid>=rk.lo&&rk.mid<=rk.hi);
ok('higher rate ranks higher',DD.rank(0.15).mid>DD.rank(0.05).mid);
ok('grade-A p90 lands on its anchor',Math.abs(rk.rows[0].p90*100-12.5)<0.05);
ok('band drawn from Hinge rows only',rk.hi<=Math.max(...rk.rows.filter(r=>r.id.startsWith('hinge')).map(r=>r.pct))+0.01);
t('rank(0) is null',DD.rank(0),null);

console.log('\n=== intervals behave ===');
const wide=DD.wilson(1,2),tight=DD.wilson(599,9839);
ok('n=2 interval is wide',(wide.hi-wide.lo)>0.6);
ok('n=9839 interval is tight',(tight.hi-tight.lo)<0.02);
ok('low-n gated below MIN_N',wide.n<DD.MIN_N);

console.log('\n=== comment detection, both nestings ===');
ok('inner-nested',DD.likeHasComment({like:[{like:[{comment:'x'}]}]}));
ok('outer',DD.likeHasComment({like:[{comment:'x'}]}));
ok('none',!DD.likeHasComment({like:[{timestamp:'x'}]}));
t('classify inbound',DD.classify({match:[]}),'inbound');
t('classify outbound',DD.classify({like:[]}),'outbound');

console.log('\n=== snapshot hygiene ===');
const snap=JSON.stringify(DD.snapshot(R,M));
ok('no message bodies',!/synthetic message/.test(snap));
ok('no comment text',!/synthetic comment/.test(snap));
ok('no email',!/@/.test(snap));
ok('no urls',!/http/.test(snap));
ok('conversion pipes present for later phase',/conversion_pipes/.test(snap));
const S=DD.snapshot(R,M,{subject:'subject-a',consent:'supplied for this project',consentAt:'2026-08-30'});
ok('snapshot v3',S.datedawg_snapshot===3);
ok('lineage: subject',S.lineage.subject==='subject-a');
ok('lineage: consent + timestamp',!!S.lineage.consent&&!!S.lineage.consent_captured_at);
ok('withdrawal is a mechanism not a sentence',
   !!S.lineage.withdrawal.mechanism&&!!S.lineage.withdrawal.reachable_by);
ok('artifact id present',!!S.lineage.artifact_id);
ok('derivation graph present',Array.isArray(S.lineage.derived_from)&&
   S.lineage.derived_from[0].fingerprint===R.fingerprint);
ok('derives_to slot exists',Array.isArray(S.lineage.derives_to));
ok('lineage: fingerprint matches parse',S.lineage.export_fingerprint===R.fingerprint);
ok('lineage: captured_at is ISO',/^\d{4}-\d{2}-\d{2}T/.test(S.lineage.captured_at));
ok('fingerprint is sha256',/^sha256-[0-9a-f]{64}$/.test(R.fingerprint));
ok('fingerprint carries no PII',!/@|synthetic/.test(R.fingerprint));
// collision test: move the match onto a DIFFERENT like, keep all counts identical
const m2=JSON.parse(JSON.stringify(F['matches.json']));
const iA=m2.findIndex(r=>r&&r.like&&r.match), iB=m2.findIndex((r,i)=>r&&r.like&&!r.match&&i>iA);
const mv=m2[iA].match; delete m2[iA].match; m2[iB].match=mv;
const R2=DD.parse({'matches.json':m2}); await DD.fingerprint(R2);
const R1=DD.parse({'matches.json':F['matches.json']}); await DD.fingerprint(R1);
ok('same counts, different match assignment -> different fingerprint',R1.fingerprint!==R2.fingerprint);
ok('identical input -> identical fingerprint',
   (await (async()=>{const X=DD.parse({'matches.json':F['matches.json']});await DD.fingerprint(X);return X.fingerprint;})())===R1.fingerprint);
ok('standardized rank in snapshot',!!S.rank_standardized);

console.log('\n=== page hygiene ===');
ok('no storage APIs',!/localStorage|sessionStorage|indexedDB/.test(html));
// the only URLs permitted are provenance citations rendered as TEXT, never fetched
const urls=[...html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map(m=>m[0]);
ok('no fetchable external refs',
   !/(src|href)\s*=\s*["']https?:/i.test(html) && !/fetch\(|XMLHttpRequest|import\(/.test(html));
ok('urls present are citations only',urls.every(u=>/swipestats\.io|example\.invalid/.test(u)));
ok('CSP present',/connect-src 'none'/.test(html));
ok('fingerprint degrades instead of throwing',/typeof TextEncoder!=="undefined"/.test(html));
ok('render survives a null fingerprint',/catch\(function\(\)\{ return null; \}\)/.test(html));
ok('reduced motion respected',/prefers-reduced-motion/.test(html));
t('missing matches.json errors',!!DD.parse({}).error,true);
t('empty list parses',DD.parse({'matches.json':[]}).records,0);
ok('Windows upload paths normalize to a base filename',html.includes('f.name.split(/[\\\\/]/).pop()'));
ok('receipt values wrap on narrow screens',/\.slip \.kv b\{[^}]*overflow-wrap:anywhere/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
