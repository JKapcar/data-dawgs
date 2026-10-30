// Mirror only the existing PUBLIC menu. Never reads owner APIs or credentials.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderPublicMenu} from '../bozo-menu.mjs';

export const SOURCE = 'https://toto.jkapcar4.workers.dev/bozo/menu.json';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const date = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const weekOK = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && new Date(s + 'T00:00:00Z').getUTCDay() === 1;
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateMenu(m) {
  if (!m || m.status !== 'published' || !weekOK(m.week) || !Number.isInteger(m.revision) || m.revision < 1 || !date(m.published_at) || !date(m.retrieved_at) || !Array.isArray(m.candidates) || m.candidates.length > 200 || !Array.isArray(m.published_weeks) || !m.published_weeks.length || m.published_weeks.length > 104) throw Error('Invalid public menu; keeping existing snapshots');
  if (new Set(m.candidates.map(c => c.id)).size !== m.candidates.length || m.candidates.some(c => !c.id || !c.selection || !['keep','downgrade','hold','scratch'].includes(c.status))) throw Error('Invalid public candidates');
  if (m.published_weeks.some(w => !weekOK(w.week) || !Number.isInteger(w.revision) || !date(w.published_at)) || new Set(m.published_weeks.map(w => w.week)).size !== m.published_weeks.length) throw Error('Invalid public archive');
  return m;
}
const index = m => JSON.stringify(m.published_weeks.map(w => [w.week,w.revision,w.published_at]).sort());
const notice = at => `Static copy checked ${at}. Refresh is attempted hourly; delays or failures can leave this copy behind the publisher. Compare the week, revision and source publication time. These are saved research observations, not live odds or available bets. Holds and scratches are not active recommendations.`;
export function snapshotFiles(menus, checkedAt) {
  if (!date(checkedAt)) throw Error('Invalid snapshot time');
  const files = new Map();
  function add(m, base) {
    const n = notice(checkedAt), source = SOURCE + '?week=' + m.week;
    const payload = {...m, snapshot:{checked_at:checkedAt, source, notice:n}};
    const nav = `<nav aria-label="Menu formats"><a href="${base}.html">Readable HTML</a><a href="${base}.txt">Plain text for AI</a><a href="${base}.json">JSON</a><a href="/bozo-menu.html">Latest copied menu</a></nav><nav aria-label="Published weeks">${m.published_weeks.map(w => `<a href="/bozo-menu/${w.week}.html">${w.week}</a>`).join('')}</nav>`;
    let html = renderPublicMenu(m).replace(/<nav>[\s\S]*?<\/nav>/g, '');
    html = html.replace('</head>', `<link rel="canonical" href="https://datadawgs216.com${base}.html"><meta name="description" content="Full public Bozo Menu snapshot, including holds and scratches. No sign-in or JavaScript required."><link rel="stylesheet" href="/install-help.css"></head>`);
    html = html.replace('<main>', `<aside role="note"><p id="snapshotNotice" data-checked-at="${checkedAt}">${escape(n)}</p><p>Publisher feed: <a href="${source}">check source revision</a></p></aside>${nav}<main>`);
    html = html.replace('</body>', '<script src="/bozo-menu-snapshot.js" defer></script><script src="/presentation-mode.js" defer></script><script src="/install-help.js" defer></script></body>');
    files.set(base.slice(1)+'.html', html+'\n');
    files.set(base.slice(1)+'.txt', renderPublicMenu(m,'md')+'\n\n'+n+'\nPublisher: '+source+'\nHTML: https://datadawgs216.com'+base+'.html\nJSON: https://datadawgs216.com'+base+'.json\n');
    files.set(base.slice(1)+'.json', JSON.stringify(payload,null,2)+'\n');
  }
  for (const m of menus) add(m,'/bozo-menu/'+m.week);
  add(menus[0],'/bozo-menu');
  return files;
}
export async function collectSnapshots({fetchImpl=fetch, now=()=>new Date().toISOString()}={}) {
  async function read(url) {
    const r = await fetchImpl(url,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw Error('Public source unavailable; keeping existing snapshots');
    const text=await r.text(); if(text.length>3000000)throw Error('Public source too large');
    return validateMenu(JSON.parse(text));
  }
  const latest = await read(SOURCE), menus=[latest];
  for (const w of latest.published_weeks) {
    const m = w.week === latest.week ? latest : await read(SOURCE+'?week='+w.week);
    if(m.week!==w.week || m.revision!==w.revision || m.published_at!==w.published_at || index(m)!==index(latest))throw Error('Archive changed during copy; retry later');
    if(m!==latest)menus.push(m);
  }
  const after=await read(SOURCE);
  if(after.week!==latest.week || after.revision!==latest.revision || index(after)!==index(latest))throw Error('Publication changed during copy; retry later');
  return {menus, files:snapshotFiles(menus,now())};
}
export async function refreshSnapshots(root=ROOT, options={}) {
  const {menus,files}=await collectSnapshots(options);
  // Fetch and validate the entire archive before changing any output.
  for(const [name,text] of files){const target=resolve(root,name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);}
  const sitemap=resolve(root,'sitemap.xml');
  let xml=readFileSync(sitemap,'utf8').replace(/\s*<url><loc>https:\/\/datadawgs216\.com\/bozo-menu(?:\.html|\/\d{4}-\d{2}-\d{2}\.html)<\/loc>[\s\S]*?<\/url>/g,'');
  const urls=['bozo-menu.html',...menus.map(m=>'bozo-menu/'+m.week+'.html')];
  xml=xml.replace('</urlset>',urls.map(p=>`  <url><loc>https://datadawgs216.com/${p}</loc></url>`).join('\n')+'\n</urlset>');
  writeFileSync(sitemap,xml);
  return {week:menus[0].week,revision:menus[0].revision,candidates:menus[0].candidates.length,weeks:menus.length};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await refreshSnapshots()));
