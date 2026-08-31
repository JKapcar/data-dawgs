import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
let pass=0,fail=0;
const ok=(label,cond)=>{console.log(`${cond?'  ok  ':'  FAIL'} ${label}`);cond?pass++:fail++;};

const date=read('datedawg.html'), dawgs=read('dawgs.html'), sw=read('sw.js');
const pages=fs.readdirSync(ROOT).filter(f=>f.endsWith('.html'));
const shells=pages.filter(f=>/const HELP = `/.test(read(f)));

console.log('=== site integration ===');
ok('all 31 shared-shell pages detected',shells.length===31);
ok('DateDawg appears once in every shared nav',shells.every(f=>(read(f).match(/\["datedawg\.html","DateDawg · Match Analysis","datedawg"\]/g)||[]).length===1));
ok('HELP names DateDawg once on every shared shell',shells.every(f=>(read(f).match(/DATEDAWG \(datedawg\.html\)/g)||[]).length===1));
ok('MAP names the DateDawg route once on every shared shell',shells.every(f=>(read(f).match(/datedawg\.html — local-only reciprocal-acceptance analysis/g)||[]).length===1));
ok('Dawg Pound exposes a fourth DateDawg project',/id="dateTab"/.test(dawgs)&&/id="dateSheet"/.test(dawgs)&&/href="datedawg\.html"/.test(dawgs));
ok('DateDawg has a route back to the Dawg Pound',/href="dawgs\.html#datedawg"/.test(date));
ok('offline core includes DateDawg',sw.includes('"/datedawg.html"'));
ok('sitemap includes DateDawg',read('sitemap.xml').includes('https://datadawgs216.com/datedawg.html'));
ok('LLM route inventory includes DateDawg',read('llms.txt').includes('[DateDawg](/datedawg.html)'));
const surfaces=JSON.parse(read('data/surfaces.json'));
const surface=surfaces.data.find(s=>s.id==='datedawg');
ok('machine inventory registers DateDawg',!!surface&&surface.page==='/datedawg.html');
ok('machine inventory keeps private memory disabled',Array.isArray(surface?.machine)&&surface.machine.length===0&&/subject-isolated storage/.test(surface.gap));
ok('page retains a zero-connect CSP',/default-src 'self'/.test(date)&&/connect-src 'none'/.test(date));
ok('page source has no network API call',!/(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/.test(date));
ok('Toto is told the metric is reciprocal acceptance, not cold discovery',/primary observable is reciprocal acceptance/.test(date)&&/cold-discover/.test(date));
ok('Toto is told the benchmark is empirical Tinder data, not a Hinge cohort',/published Tinder male percentile table/.test(date)&&/not from an observed Hinge cohort/.test(date));
ok('Toto is told the age-band shape assumption',/assumes the distribution shape is constant across age bands/.test(date));
ok('Toto is told ranking windows are independent and maturity-aligned',/ranking panel has its own Overall, 1 year, 6 months, and 1 month windows[\s\S]*latest scoreable date/.test(date));
ok('Toto is told benchmark selection bias has unknown direction',/direction of that bias is unknown/.test(date));
ok('Toto is told pending inbound queues undercount',/inbound counts undercount when a queue is pending/.test(date));
ok('Toto is told reply rate and ghosting are not computable',/Reply rate and true ghosting are not computable/.test(date));
ok('Toto is told conversion pipes are deliberately not surfaced',/conversion pipes are retained only in the sanitized snapshot/.test(date));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
