/* Render-test markets.html and ai.html against STUBBED upstream responses.
   The container has no egress, so the point is not to test the network — it is to
   exercise every render path with payloads shaped exactly like the real ones
   (field names taken from live responses), and to fail on any console error.

   Repointed into the repo (Stage 2): ROOT, the Chromium binary and the screenshot dir now
   resolve from the checkout via playwright-loader.mjs instead of the build container's paths.
   The four page URLs it drives are unchanged (localhost:8099). */
import { chromiumExecutable, loadPlaywright } from './playwright-loader.mjs';
import { fileURLToPath } from 'url';
const { chromium } = loadPlaywright();
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = process.env.DD_SHOT_DIR || path.join(ROOT, 'work', '.shots');
fs.mkdirSync(SHOT, { recursive: true });
const MIME = {'.html':'text/html','.js':'text/javascript','.json':'application/json',
  '.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.txt':'text/plain','.xml':'application/xml'};

const server = http.createServer((req,res)=>{
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  fs.readFile(f,(e,d)=>{
    if(e){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
    res.end(d);
  });
});
await new Promise(r=>server.listen(8099,r));

/* ---- fixtures: field names copied from the real payloads ---- */
const orModels = { data: [] };
const VEND=['openai','anthropic','google','x-ai','meta-llama','deepseek','qwen','mistralai'];
for(let i=0;i<64;i++){
  const iq = 12 + (i*1.31)%48;
  const po = Math.pow(10, -1.2 + (i%17)/6);
  orModels.data.push({
    id:`${VEND[i%8]}/model-${i}`, name:`${VEND[i%8]}: Model ${i}`, created:1780000000+i*8600,
    context_length: [8192,32768,131072,262144,1048576][i%5],
    architecture:{modality:'text->text', input_modalities: i%4?['text']:['text','image'],
      output_modalities:['text'], tokenizer:'Other'},
    pricing:{prompt:String(po/3/1e6), completion:String(po/1e6)},
    top_provider:{context_length:131072,max_completion_tokens:null,is_moderated:false},
    benchmarks: i%5===4 ? {} : {artificial_analysis:{intelligence_index:+iq.toFixed(1)}},
    reasoning: i%3===0 ? {mandatory:i%6===0, default_enabled:true} : null
  });
}
const openMk = [];
for(let i=0;i<120;i++) openMk.push({
  id:String(1000+i), question:`Will thing number ${i} happen before the deadline?`,
  slug:`thing-${i}`, conditionId:'0x'+i,
  outcomes: JSON.stringify(['Yes','No']),
  outcomePrices: JSON.stringify([String((0.03+(i*0.0081)%0.94).toFixed(3)), '0']),
  volumeNum: 5e6/(i+1), volume:String(5e6/(i+1)),
  endDate:new Date(Date.now()+ (i+3)*86400000).toISOString(),
  startDate:new Date(Date.now()-40*86400000).toISOString(), closed:false,
  clobTokenIds: JSON.stringify(['tok'+i,'tokN'+i])
});
const closedMk = [];
for(let i=0;i<300;i++){
  const p = 0.02 + (i*0.0173)%0.96;
  const hit = ((i*7919)%1000)/1000 < p;      // roughly calibrated truth
  closedMk.push({
    id:String(9000+i), question:`Resolved market ${i}`, slug:`res-${i}`,
    outcomes: JSON.stringify(['Yes','No']),
    outcomePrices: JSON.stringify(hit?['1','0']:['0','1']),
    volumeNum: 9e6/(i+1), endDate:new Date(Date.now()-(i+2)*86400000).toISOString(),
    clobTokenIds: JSON.stringify(['ctok'+i,'ctokN'+i]), closed:true,
    tags: [[{label:'Politics'},{label:'2026 Election'}],
           [{label:'Sports'},{label:'NFL'}],
           [{label:'Crypto'},{label:'Bitcoin'}],
           [{label:'Pop Culture'}],
           []][i%5],
    __p:p
  });
}
const priceFor = {};
closedMk.forEach(m=>{ priceFor[JSON.parse(m.clobTokenIds)[0]] = {p:m.__p, end:Math.floor(new Date(m.endDate).getTime()/1000)}; });

const browser = await chromium.launch({executablePath:chromiumExecutable(chromium), args:['--no-sandbox']})
  .catch(()=>chromium.launch());
const ctx = await browser.newContext({viewport:{width:1280,height:1800}});

await ctx.route('**openrouter.ai/api/v1/models*', r=>r.fulfill({status:200,
  contentType:'application/json', body:JSON.stringify(orModels)}));
await ctx.route('**gamma-api.polymarket.com/markets*', r=>{
  const closed = r.request().url().includes('closed=true');
  return r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify(closed?closedMk:openMk)});
});
await ctx.route('**clob.polymarket.com/prices-history*', r=>{
  const u = new URL(r.request().url());
  const t = priceFor[u.searchParams.get('market')];
  if(!t) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({history:[]})});
  const hist=[]; for(let d=60;d>=0;d--) hist.push({t:t.end-d*86400, p:String(t.p)});
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({history:hist})});
});

let fails = 0;
async function check(page, url, steps){
  const errs = [];
  const p = await ctx.newPage();
  p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
  p.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  await p.goto(url, {waitUntil:'networkidle'});
  await p.waitForTimeout(700);
  for(const s of steps) await s(p);
  const sheetTabs = await p.locator('.sheetbar .sheet-tab').count();
  console.log(`\n=== ${page} ===`);
  console.log('sheet tabs rendered:', sheetTabs);
  for(const [label,sel] of Object.entries({nav:'.sitenav .links a', h1:'h1', tiles:'.ddstat .s', rows:'.ddtw tbody tr', svg:'.ddfig svg'}))
    console.log(`  ${label}: ${await p.locator(sel).count()}`);
  if(errs.length){ fails++; console.log('  CONSOLE ERRORS:'); errs.slice(0,6).forEach(e=>console.log('   -',e.slice(0,180))); }
  else console.log('  console: clean');
  await p.screenshot({path:path.join(SHOT, `shot-${page}.png`), fullPage:false});
  await p.close();
}

await check('ai', 'http://localhost:8099/ai.html', [
  async p=>{ await p.click('text=Frontier'); await p.waitForTimeout(500); },
]);
await check('ai-board', 'http://localhost:8099/ai.html#models', []);
await check('markets', 'http://localhost:8099/markets.html#calibration', [
  async p=>{ await p.click('#calRun'); await p.waitForTimeout(3500); },
]);
await check('markets-live', 'http://localhost:8099/markets.html#live', []);
await check('markets-domains', 'http://localhost:8099/markets.html#calibration', [
  async p=>{ await p.selectOption('#calN','240'); await p.click('#calRun'); await p.waitForTimeout(9000); },
  async p=>{ await p.click('text=By subject'); await p.waitForTimeout(600); },
]);
// dark mode is the site default; the skill requires it be looked at, not assumed
await check('ai-dark', 'http://localhost:8099/ai.html#frontier', [
  async p=>{ await p.evaluate(()=>{ try{localStorage.setItem('dd-theme2-ai','dark');}catch(e){} }); },
  async p=>{ await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(900); },
]);

await browser.close(); server.close();
console.log('\n' + (fails? 'PAGES WITH CONSOLE ERRORS: '+fails : 'ALL PAGES CLEAN'));
process.exit(fails ? 1 : 0);
