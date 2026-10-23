import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';
const {chromium}=loadPlaywright(),html=fs.readFileSync('bozo.html','utf8'),script=fs.readFileSync('bozo-estimate-manager.js','utf8');
const browser=await chromium.launch({executablePath:chromiumExecutable(chromium)});
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:1100}});await page.route('**/*',r=>r.abort());
  await page.route('https://estimate.fixture.invalid/',r=>r.fulfill({contentType:'text/html',body:'<html><head>'+[...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('')+'</head><body><main style="padding:12px;max-width:100%"><div id="host" class="card"></div></main></body></html>'}));await page.goto('https://estimate.fixture.invalid/');
  await page.addScriptTag({content:script});
  await page.evaluate(()=>{
   window.fixture={league:'synthetic',manager:true,writes:[],reads:[],mode:'normal',row:{week:1,player:'Fixture',label:'Synthetic historical total',price:-150,priceOpp:null,entryBook:'draftkings',selectionKey:'synthetic-selection',close:-180,closeOpp:150,result:'lost',clvPts:0}};
   const f=window.fixture;window.api={isManager:()=>f.manager,league:()=>f.league,identity:()=> 'synthetic-owner',who:x=>x,refresh:async()=>{},read:async path=>{f.reads.push(path);return {value:path==='ledger'?{'2026-w1-fixture':structuredClone(f.row)}:structuredClone(f.row)};},write:async(path,body)=>{f.writes.push({path,body});if(f.mode==='deferred')await new Promise(resolve=>f.release=resolve);if(f.mode==='conflict')throw Error('Concurrent change; refresh and retry');const estimate={requestId:body.requestId,revision:body.expectedEstimateRevision+1,point:0,input:JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(body.estimate).reverse()),(_k,v)=>v===null?undefined:v))};if(f.mode!=='missing-readback')f.row.clvEstimate=estimate;if(f.mode==='changed-row')f.row.price=-160;return {ok:true,estimate};}};
   DDClvEstimateManager.mount(document.getElementById('host'),window.api);
  });
  assert.equal(await page.locator('form').isVisible(),false);await page.getByRole('button',{name:'Load league ledger'}).click();assert.equal(await page.locator('form').isVisible(),true);
  await page.locator('[name=sourceUrl]').fill('https://example.com/closing');assert.equal(await page.locator('[name=retrievedAt]').inputValue(),'');await page.locator('[name=retrievedAt]').fill('2026-10-23T02:59:00Z');await page.locator('[name=rationale]').fill('Synthetic reported close; quote time unknown; hold calibrated from close pair.');
  await page.locator('[name=evidence]').selectOption('untimed_quote_proxy');
  await page.getByRole('button',{name:'Preview estimate'}).click();assert.match(await page.locator('[data-preview]').innerText(),/Estimated/,await page.locator('[data-status]').innerText()+JSON.stringify(await page.locator('form').evaluate(f=>Array.from(f.elements).filter(e=>e.validity&&!e.validity.valid).map(e=>({name:e.name,value:e.value,message:e.validationMessage})))));assert.match(await page.locator('[data-preview]').innerText(),/not.*confidence/i);
  assert.match(await page.locator('[data-preview]').innerText(),/Untimed quote used as closing proxy/);
  await page.getByRole('button',{name:'Save estimated CLV'}).click();assert.match(await page.locator('[data-status]').innerText(),/Saved and verified revision 1/);
  const state=await page.evaluate(()=>fixture);assert.equal(state.writes[0].body.estimate.closeQuote.evidence,'untimed_quote_proxy');assert.equal(state.writes.length,1);assert.equal(state.writes[0].path,'/bozo/close');assert.equal(state.writes[0].body.expectedEstimateRevision,0);assert.equal(state.row.clvPts,0);assert.equal(state.row.result,'lost');assert.equal(state.writes[0].body.estimate.closeQuote.quotedAt,null);
  assert.ok(await page.locator('#host').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'manager form fits '+width);
  await page.locator('[name=rationale]').fill('Readback failure fixture');await page.getByRole('button',{name:'Preview estimate'}).click();await page.evaluate(()=>fixture.mode='missing-readback');await page.getByRole('button',{name:'Save estimated CLV'}).click();assert.match(await page.locator('[data-status]').innerText(),/Save not verified/);
  await page.evaluate(()=>fixture.mode='deferred');await page.getByRole('button',{name:'Save estimated CLV'}).click();assert.equal(await page.locator('[name=row]').isDisabled(),true);assert.equal(await page.locator('[name=price]').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Load league ledger'}).isDisabled(),true);await page.evaluate(()=>fixture.release());await page.getByText(/Saved and verified revision 2/).waitFor();
  await page.getByRole('button',{name:'Load league ledger'}).click();assert.equal(await page.locator('[name=retrievedAt]').inputValue(),'2026-10-23T02:59:00Z');
  await page.locator('[name=rationale]').fill('Concurrent row fixture');await page.getByRole('button',{name:'Preview estimate'}).click();await page.evaluate(()=>fixture.mode='changed-row');await page.getByRole('button',{name:'Save estimated CLV'}).click();assert.match(await page.locator('[data-status]').innerText(),/Ledger or selection changed/);await page.evaluate(()=>fixture.mode='normal');await page.getByRole('button',{name:'Load league ledger'}).click();
  // A conflict cannot produce a success message or silently increase the expected revision.
  await page.locator('[name=rationale]').fill('Changed synthetic rationale');await page.getByRole('button',{name:'Preview estimate'}).click();await page.evaluate(()=>fixture.mode='conflict');await page.getByRole('button',{name:'Save estimated CLV'}).click();assert.match(await page.locator('[data-status]').innerText(),/Concurrent change/);
  const first=await page.evaluate(()=>fixture.writes.at(-1).body.requestId);await page.getByRole('button',{name:'Save estimated CLV'}).click();assert.equal(await page.evaluate(()=>fixture.writes.at(-1).body.requestId),first);
  await page.evaluate(()=>fixture.league='another-league');const count=await page.evaluate(()=>fixture.writes.length);await page.getByRole('button',{name:'Save estimated CLV'}).click();assert.match(await page.locator('[data-status]').innerText(),/Account or league changed/);assert.equal(await page.evaluate(()=>fixture.writes.length),count);
  fs.mkdirSync('artifacts/estimate-manager',{recursive:true});await page.screenshot({path:`artifacts/estimate-manager/form-${width}.png`,fullPage:true});
  await page.evaluate(()=>{fixture.manager=false;DDClvEstimateManager.mount(document.getElementById('host'),api);});assert.equal(await page.locator('form').count(),0);
  await page.close();
 }
 console.log('PASS: manager load/preview/save/readback, null timing, override/result preservation, conflict/idempotent retry, league guard, nonmanager hiding;320/390/1280px');
}finally{await browser.close();}
