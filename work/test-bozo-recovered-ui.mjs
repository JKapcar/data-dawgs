import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';
const {chromium}=loadPlaywright();
const html=fs.readFileSync('bozo.html','utf8');
const fragment=html.slice(html.indexOf('<details class="card bz-help" id="bozoRecovered">'),html.indexOf('<!-- Overview receipt:'));
const seed=JSON.parse(fs.readFileSync('data/bozo-recovered-closes.json','utf8'));
const script=fs.readFileSync('bozo-recovered.js','utf8');
const browser=await chromium.launch({executablePath:chromiumExecutable(chromium)});
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:1000}}),requests=[];
  await page.route('**/*',async route=>{
   const req=route.request();requests.push(req);
   if(req.url().includes('bozo-recovered-closes.json'))return route.fulfill({json:seed});
   if(req.url().includes('/scores?'))return route.fulfill({json:{games:seed.data.records.map(r=>({id:r.event_id,start:r.kickoff,close:null}))}});
   return route.abort();
  });
  await page.setContent('<base href="https://recovery.fixture.invalid/"><style>body{font:16px system-ui;margin:12px;background:#171717;color:#fafafa}a{color:#ffc66b}</style>'+fragment.replace(/<script[^>]*><\/script>/g,''));
  await page.addScriptTag({content:script});
  await page.locator('summary').focus();await page.keyboard.press('Enter');
  await page.locator('.br-game').first().waitFor();assert.equal(await page.locator('.br-game').count(),4);
  assert.match(await page.locator('.br-game').first().innerText(),/James Madison -485/);
  assert.match(await page.locator('.br-game').last().innerText(),/Spread[\s\S]*unknown/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at '+width);
  assert.equal(requests.length,3);assert.ok(requests.every(r=>r.method()==='GET'&&!r.headers().authorization&&!r.headers().cookie));
  await page.close();
 }
 // Full page integration with its real CSS/scripts; every network request remains intercepted.
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(route.request().method()!=='GET')return route.abort();
   if(u.pathname==='/scores')return route.fulfill({json:{games:seed.data.records.map(r=>({id:r.event_id,start:r.kickoff,close:null}))}});
   if(u.hostname==='recovery.fixture.invalid'){
    const rel=decodeURIComponent(u.pathname).replace(/^\//,'');
    if(!rel.includes('..')&&fs.existsSync(rel)&&fs.statSync(rel).isFile())return route.fulfill({path:rel});
   }
   return route.fulfill({json:{}});
  });
  await page.goto('https://recovery.fixture.invalid/bozo.html');
  await page.locator('#bozoRecovered summary').click();
  await page.locator('.br-game').first().waitFor();
  assert.equal(await page.locator('.br-game').count(),4);
  assert.ok(await page.locator('#bozoRecovered').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'full-page panel fits '+width);
  await page.close();
 }
 console.log('PASS: 320/390/1280px, keyboard opening, 4 numeric cards, null markets, no overflow, public GET-only fixtures');
}finally{await browser.close();}
