import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';
const {chromium}=loadPlaywright(),html=fs.readFileSync('bozo.html','utf8');
const fn=html.slice(html.indexOf('function clvEstimateEvidence(){'),html.indexOf('function clvMethod(){'));
const estimate={kind:'estimated',point:2.1,low:1.2,high:3.0,scenarios:[.02,.04,.06],assumption:'Synthetic common overround assumption',rationale:'Synthetic source; illustrative sensitivity, not confidence',entryVerified:false,revision:1,closeQuote:{sourceUrl:'https://example.com/'+ 'long-public-source-path-'.repeat(10),quotedAt:null,retrievedAt:'2026-10-23T12:00Z',evidence:'source_reported_closing'}};
const browser=await chromium.launch({executablePath:chromiumExecutable(chromium)});
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
  await page.route('**/*',r=>r.abort());
  // Real page styles, isolated renderer and synthetic historic/current records; no live requests.
  await page.setContent('<html><head>'+[...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('')+'</head><body><main style="max-width:100%;padding:12px"><section id="clvCard" class="card"><div id="clvFoot"></div></section></main></body></html>');
  await page.addScriptTag({content:'const CLV={data:{legs:'+JSON.stringify([{player:'Fixture',label:'Historical market',week:1,clvPts:0,clvEstimate:estimate},{player:'Fixture',label:'Current market',week:7,clvEstimate:estimate},{player:'Fixture',label:'Stale market',week:3,clvEstimate:{...estimate,stale:true,point:999}}])+"}};const teamOf=x=>x,esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');"+fn+'document.getElementById("clvFoot").innerHTML=clvEstimateEvidence();'});
  assert.equal(await page.locator('details').getAttribute('open'),'');
  const text=await page.locator('#clvFoot').innerText();
  assert.match(text,/Week 1/);assert.match(text,/Week 7/);assert.match(text,/Estimated \+2.10 pp/);assert.match(text,/manual override retained/);assert.match(text,/quote time unknown/);assert.doesNotMatch(text,/999/);
  assert.ok(await page.locator('#clvFoot').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'panel fits '+width);
  await page.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('details').getAttribute('open'),null);
  await page.keyboard.press('Enter');assert.equal(await page.locator('details').getAttribute('open'),'');
  fs.mkdirSync('artifacts/estimated-clv',{recursive:true});await page.screenshot({path:`artifacts/estimated-clv/layout-${width}.png`,fullPage:true});
  await page.close();
 }
 console.log('PASS: 320/390/1280px real CSS, visible current/history numbers, source/null/override labels, stale suppression, keyboard and no panel overflow');
}finally{await browser.close();}
