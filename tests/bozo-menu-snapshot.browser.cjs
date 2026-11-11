// node tests/bozo-menu-snapshot.browser.cjs (Playwright Chromium required)
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const {snapshotFiles}=await import('../tools/bozo-menu-snapshots.mjs');
 const root=path.resolve(__dirname,'..');
 const old={status:'published',week:'2026-11-02',revision:2,published_at:'2026-11-06T16:00:00Z',retrieved_at:'2026-11-11T15:00:00Z',title:'Old menu',scope:'Saved research',candidates:[{id:'old',selection:'Old hold',status:'hold',sources:[]}],published_weeks:[{week:'2026-11-02',revision:2,published_at:'2026-11-06T16:00:00Z'}]};
 const latest={...old,week:'2026-11-09',revision:1,title:'New menu <script>bad()</script>',candidates:[{id:'new',selection:'New hold',status:'hold',sources:[]},{id:'scratch',selection:'Scratch retained',status:'scratch',sources:[]}],published_weeks:[{week:'2026-11-09',revision:1,published_at:old.published_at},...old.published_weeks]};
 const html=snapshotFiles([old],old.retrieved_at).get('bozo-menu.html');
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  async function setup(reply,pathname='/bozo-menu.html'){
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.route('https://example.test/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith('.html'))return route.fulfill({contentType:'text/html',body:html});
    if(['/bozo-menu-snapshot.js','/bozo-menu.mjs'].includes(p))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,p),'utf8')});
    return route.fulfill({status:404,body:''});
   });
   await page.route('https://toto.jkapcar4.workers.dev/**',reply);
   await page.goto('https://example.test'+pathname);
   return page;
  }
  let current=latest;
  let p=await setup(r=>r.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(current)}));
  await p.waitForFunction(()=>document.querySelector('#snapshotNotice').dataset.live==='true');
  assert.match(await p.locator('h1').innerText(),/New menu/);
  assert.equal(await p.locator('article').count(),2);
  assert.equal(await p.locator('main script').count(),0);
  assert.match(await p.locator('body').innerText(),/revision 1/);
  assert.ok(await p.locator('nav a').filter({hasText:'Current publisher JSON'}).getAttribute('href'));
  current=old;
  await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForFunction(()=>document.querySelector('#snapshotNotice').textContent.startsWith('Publisher recheck failed'));
  assert.equal(await p.locator('article').count(),2,'regressed feed retains last verified display');
  await p.close();
  p=await setup(r=>r.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:'Unavailable'}));
  await p.waitForFunction(()=>document.querySelector('#snapshotNotice').textContent.startsWith('Publisher check failed'));
  assert.equal(await p.locator('h1').innerText(),'Old menu');assert.equal(await p.locator('article').count(),1);
  await p.close();
  p=await setup(r=>{assert.match(r.request().url(),/week=2026-11-02/);return r.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(old)});},'/bozo-menu/2026-11-02.html');
  await p.waitForFunction(()=>document.querySelector('#snapshotNotice').dataset.live==='true');
  assert.equal(await p.locator('h1').innerText(),'Old menu');await p.close();
  p=await setup(r=>r.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({...latest,revision:0})}));
  await p.waitForFunction(()=>document.querySelector('#snapshotNotice').textContent.startsWith('Publisher check failed'));
  assert.equal(await p.locator('h1').innerText(),'Old menu');await p.close();
  console.log('PASS: rollover, full hold/scratch data, escaped content, regression, offline fallback, archive pinning, malformed source');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
