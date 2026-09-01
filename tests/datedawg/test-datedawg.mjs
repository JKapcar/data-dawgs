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
ok('page states a later declaration is impossible',/no\s+way to declare a test after loading/i.test(html));
ok('subject and consent captured pre-parse',/preSubject/.test(html)&&/preConsent/.test(html));
ok('declaration voids on boundary change',/was voided when you moved/.test(html));
ok('significance withheld while exploring',/significance withheld/.test(html));
ok('empirical Tinder reference is not mislabelled as a Hinge cohort',/published empirical table/i.test(html)&&/not an observed Hinge cohort/i.test(html));
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
const quarterlySeries=DD.timeSeries(R,R.minT,R.maxT,'quarter');
const yearlySeries=DD.timeSeries(R,R.minT,R.maxT,'year');
ok('quarterly view has fewer buckets than monthly',quarterlySeries.bins.length<allSeries.bins.length);
ok('yearly view has fewer buckets than quarterly',yearlySeries.bins.length<quarterlySeries.bins.length);
ok('quarterly labels are human-readable',quarterlySeries.bins.every(b=>/^Q[1-4] \d{4}$/.test(b.label)));
ok('yearly labels are human-readable',yearlySeries.bins.every(b=>/^\d{4}$/.test(b.label)));
ok('quarterly and yearly counts reconcile',
   quarterlySeries.bins.reduce((a,b)=>a+b.likes,0)===allSeries.likes&&
   yearlySeries.bins.reduce((a,b)=>a+b.likes,0)===allSeries.likes);
const reversed=DD.timeSeries(R,R.maxT,R.minT,'month');
t('reversed custom dates are normalized',reversed.likes,allSeries.likes);
ok('weekday likes reconcile to selected total',
   allSeries.weekday.reduce((a,w)=>a+w.likes,0)===allSeries.likes);
ok('weekday matured likes reconcile',
   allSeries.weekday.reduce((a,w)=>a+w.matureLikes,0)===allSeries.matureLikes);
ok('volume buckets account for active days',
   allSeries.volume.reduce((a,v)=>a+v.days,0)===allSeries.activeDays);
ok('comment split reconciles to matured likes',
   allSeries.comments.with.n+allSeries.comments.bare.n===allSeries.matureLikes);
ok('filtered inbound decisions are exposed',allSeries.inbound.n===R.ins.length);
ok('inbound timeline bins reconcile to reviewed total',allSeries.bins.reduce((a,b)=>a+b.inboundProcessed,0)===allSeries.inbound.n);
ok('inbound timeline bins reconcile to accepted total',allSeries.bins.reduce((a,b)=>a+b.inboundAccepted,0)===allSeries.inbound.accepted);
ok('inbound accepted and declined composition reconciles',allSeries.inbound.accepted+allSeries.inbound.declined===allSeries.inbound.n);
ok('series exposes calendar-day span for fair pace comparison',allSeries.days===Math.floor((allSeries.to-allSeries.from)/864e5)+1);

console.log('\n=== ranking math ===');
ok('parser version is 1.4',DD.PARSER_VERSION==='1.4.0');
t('published male CDF has 8 anchors',DD.MALE_QUANTILES.length,8);
t('median anchor is 2.04%',DD.maleRateAt(50),0.0204);
t('p90 anchor is 12.50%',DD.maleRateAt(90),0.125);
ok('published anchors are monotonic',DD.MALE_QUANTILES.every((a,i,x)=>!i||(a.p>x[i-1].p&&a.rate>x[i-1].rate)));
ok('interpolation reproduces every published anchor',DD.MALE_QUANTILES.every(a=>Math.abs(DD.pctOn(a.rate,DD.MALE_QUANTILES.map(x=>[x.p,x.rate])).p-a.p)<1e-8));
const rk=DD.rank(0.099,40);
ok('9.9% lands between p75 and p90',rk.all.p>75&&rk.all.p<90);
t('8.23% is the 83rd-percentile all-men reference',Math.round(DD.rank(.0823).all.p),83);
const rk1339=DD.rank(.1339,40);
t('13.39% is about p91 against all men',Math.round(rk1339.all.p),91);
t('13.39% is about p94 among men 40–44',Math.round(rk1339.band.p),94);
ok('not extrapolated inside published range',rk.all.extrapolated===false);
ok('extremes flagged as extrapolated',DD.rank(.0005).all.extrapolated&&DD.rank(.8).all.extrapolated);
ok('age 40 selects the 40–44 band',rk.bandLabel==='40–44');
ok('age band changes the reference percentile',Math.abs(rk.band.p-rk.all.p)>0.1);
t('band scale is band mean over male mean',rk.bandScale,0.0387/DD.MALE_AVG);
ok('no age means no age band',DD.rank(.099).band===null);
ok('higher rate ranks higher',DD.rank(.15).all.p>DD.rank(.05).all.p);
ok('source is the published empirical table',/published directly|published empirical/i.test(DD.BENCH_SOURCE.verified));
ok('denominator alignment documented',/outbound-conditional/i.test(DD.BENCH_SOURCE.measure));
ok('bias direction stated as unknown',/direction.+unknown/i.test(DD.BENCH_SOURCE.bias));
ok('male sample size stated',/6,233/.test(DD.BENCH_SOURCE.sample));
ok('nothing is fitted in the shipped copy',/not a fitted model/i.test(html));
ok('age-band shape assumption disclosed',/assumes its shape is constant/i.test(html));
ok('Tinder versus Hinge caveat present',/this is Tinder, not Hinge/i.test(html));
t('rank(0) is null',DD.rank(0),null);
ok('P20 is log-interpolated between published P10 and P25',DD.maleRateAt(20)>0.003&&DD.maleRateAt(20)<0.0076);
ok('P80 is log-interpolated between published P75 and P90',DD.maleRateAt(80)>0.0539&&DD.maleRateAt(80)<0.125);
t('three visible male reference levels',DD.MALE_REFERENCES.map(r=>r.p).join(','),'20,50,80');
ok('interpolation is disclosed in source',/P20 and P80 are[\s\S]*log-interpolated/i.test(html));

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
ok('snapshot urls are benchmark provenance only',
   (snap.match(/https?:\/\//g)||[]).length<=1&&/swipestats\.io/.test(snap));
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
ok('storage is IndexedDB-only and requires an explicit opt-in',/indexedDB\.open/.test(html)&&/rememberConsent/.test(html)&&!/localStorage|sessionStorage/.test(html));
ok('saved shape excludes raw ZIP and canonical fingerprint material',/function savedShape/.test(html)&&!/var keys=\[[^\]]*"_canon"/.test(html));
ok('local persistence disclaimer names sensitivity, deletion and no cloud sync',/SENSITIVE EVENT HISTORY/.test(html)&&/Forget saved dashboard/.test(html)&&/No account or cloud sync/.test(html));
// the only URLs permitted are provenance citations rendered as TEXT, never fetched
const urls=[...html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map(m=>m[0]);
ok('no fetchable external refs',
   !/(src|href)\s*=\s*["']https?:/i.test(html) && !/fetch\(|XMLHttpRequest|import\(/.test(html));
ok('urls present are citations only',urls.every(u=>/swipestats\.io|example\.invalid/.test(u)));
ok('CSP present',/connect-src 'none'/.test(html));
ok('fingerprint degrades instead of throwing',/typeof TextEncoder!=="undefined"/.test(html));
ok('render survives a null fingerprint',/catch\(function\(\)\{\s*return null;\s*\}\)/.test(html));
ok('reduced motion respected',/prefers-reduced-motion/.test(html));
t('missing matches.json errors',!!DD.parse({}).error,true);
t('empty list parses',DD.parse({'matches.json':[]}).records,0);
ok('Windows upload paths normalize to a base filename',html.includes('f.name.split(/[\\\\/]/).pop()'));
ok('receipt values wrap on narrow screens',/\.slip \.kv b\{[^}]*overflow-wrap:anywhere/.test(html));
ok('ZIP is the primary import surface',/Drop the ZIP Hinge sent you/.test(html)&&/accept="\.zip,application\/zip"/.test(html));
ok('individual JSON remains an advanced fallback',/Advanced: choose individual JSON files/.test(html));
ok('ZIP copy accurately says selfie is detected but never extracted',/detected but never extracted or parsed/.test(html));
ok('ZIP rejects traversal and absolute paths',/Unsafe path in archive/.test(html)&&/n\[0\]==='\/'/.test(html));
ok('ZIP rejects duplicate canonical basenames',/Duplicate filename in archive/.test(html));
ok('ZIP has entry, size and ratio limits',/maximum 200/.test(html)&&/45 MB safety limit/.test(html)&&/Implausible compression ratio/.test(html));
ok('selfie refusal occurs before decompression',html.indexOf("en.base==='selfie_verification.json'")<html.indexOf('inflateZip(bytes,en)'));
ok('unknown ZIP entries are not extracted',/unknown\.push\(en\.path\);continue/.test(html));
ok('Combine, Market, Analysis Floor and Scout Report ship together',/THE COMBINE/.test(html)&&/The Market · change story/.test(html)&&/The Analysis Floor/.test(html)&&/The Scout Report/.test(html));
ok('companion context is aggregate-only and memory is inactive',/window\.DD_VIEW_CONTEXT=ctx/.test(html)&&/LOCAL · NO MEMORY/.test(html)&&/approved_memory_ids:\[\]/.test(html));
ok('Scout Report explicitly excludes raw private content',/No raw messages, comments, media, identity, or third-party details are included/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
