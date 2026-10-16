import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
import {fixture} from './gateway-fixture.mjs';import {createResearchGateway} from './gateway.mjs';import {transition} from './worker-core.mjs';
const f=await fixture(),handler=createResearchGateway({...f.dependencies,transition}),site='https://datadawgs216.com',worker='https://toto.jkapcar4.workers.dev';
const h=await(await f.command('hypothesis',{title:'Signed-in shared study',method:'Synthetic audit'})).json();await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000});
const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(token=>localStorage.setItem('dd-bozo-sess',token),f.session);
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===worker){const r=await handler(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}),f.env);return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()});}
  assert.equal(url.origin,site,'test must not contact external services');
  let file=url.pathname.split('/').at(-1)||'index.html';if(file==='data-dawgs-site-logo-560.png')file='brand.png';
  if(file==='client-config.mjs')return route.fulfill({contentType:'text/javascript',body:`export default {mode:'hosted',workerOrigin:'${worker}',tenant:'demo'};`});
  assert(['index.html','app.mjs','client.mjs','tracking.mjs','style.css','instrument.css','brand.png'].includes(file),file);
  return route.fulfill({contentType:file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html',body:readFileSync(new URL(file==='brand.png'?'../assets/data-dawgs-site-logo-560.png':file,import.meta.url))});
 });
 await page.goto(site+'/research-lab/');await page.getByText('Shared runner ready.',{exact:false}).waitFor();assert.equal(await page.locator('#hypothesis-grid article').count(),1);
 await page.getByRole('tab',{name:'Queue'}).click();await page.getByRole('button',{name:'Claim & run shared audit'}).click();await page.getByText('Receipt recorded: success.',{exact:false}).waitFor();assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.receipts.length,1);
 await page.reload();await page.getByText('Shared runner ready.',{exact:false}).waitFor();assert.equal(await page.locator('#receipt-count').innerText(),'1 receipt');
 const envelope=structuredClone(f.rows.get('/researchLab/v1/tenants/demo'));envelope.access.users.u_owner.enabled=false;f.put('/researchLab/v1/tenants/demo',envelope);
 await page.getByRole('tab',{name:'Research',exact:true}).click();await page.locator('#new-hypothesis').click();await page.getByLabel('Title',{exact:true}).fill('Denied');await page.getByLabel('Method and falsification criteria').fill('Test');await page.getByRole('button',{name:'Save hypothesis'}).click();await page.getByText('research_grant_required',{exact:false}).first().waitFor();assert.equal(await page.locator('#hypothesis-grid article').count(),0);assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.hypotheses.length,1);
 assert.deepEqual(errors,[]);console.log('PASS signed-in browser → WebCrypto gateway → conditional shared state → receipt → reload → revocation clears state; all network intercepted.');
}finally{await browser.close();}
