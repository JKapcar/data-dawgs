import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
import {fixture} from './gateway-fixture.mjs';import {createResearchGateway} from './gateway.mjs';import {transition} from './worker-core.mjs';
const f=await fixture(),handler=createResearchGateway({...f.dependencies,transition}),site='https://datadawgs216.com',worker='https://toto.jkapcar4.workers.dev';
const h=await(await f.command('hypothesis',{title:'Signed-in shared study',method:'Synthetic audit'})).json();await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000});
const lostResponses=new Set(['claim','run']),sent=[];
const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(token=>localStorage.setItem('dd-bozo-sess',token),f.session);
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===worker){const body=req.postData()?JSON.parse(req.postData()):null;if(body)sent.push(body);const r=await handler(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}),f.env);if(r.ok&&lostResponses.delete(body?.type))return route.abort('failed');return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()});}
  assert.equal(url.origin,site,'test must not contact external services');
  let file=url.pathname.split('/').at(-1)||'index.html';if(file==='data-dawgs-site-logo-560.png')file='brand.png';
  if(file==='client-config.mjs')return route.fulfill({contentType:'text/javascript',body:`export default {mode:'hosted',workerOrigin:'${worker}',tenant:'demo'};`});
  assert(['presentation-mode.js','presentation-mode.css','execution-identity.mjs','continuation.mjs','coordinator.mjs','workflow.mjs','workflow.css','install-help.js','install-help.css','index.html','app.mjs','client.mjs','tracking.mjs','style.css','instrument.css','brand.png','navigation.css','navigation.js'].includes(file),file);
  return route.fulfill({contentType:/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html',body:readFileSync(new URL(file==='brand.png'?'../assets/data-dawgs-site-logo-560.png':(file.startsWith('install-help.')||file.startsWith('presentation-mode.'))?'../'+file:file,import.meta.url))});
 });
 await page.goto(site+'/research-lab/');await page.getByText('Shared runner ready.',{exact:false}).waitFor();assert.equal(await page.locator('#hypothesis-grid article').count(),1);
 await page.getByRole('tab',{name:'Queue'}).click();await page.getByRole('button',{name:'Claim & run shared audit'}).evaluate(b=>{b.dispatchEvent(new MouseEvent('click',{bubbles:true}));b.dispatchEvent(new MouseEvent('click',{bubbles:true}));});await page.getByText('Receipt recorded: success.',{exact:false}).waitFor();assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.receipts.length,1);
 assert.deepEqual(sent.map(x=>x.type),['claim','run']);assert.equal(lostResponses.size,0);
 const foreign=await(await f.command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000})).json();const lease=await(await f.command('claim',{taskId:foreign.id,leaseMs:60000},'agent')).json();
 await page.reload();await page.getByText('Shared runner ready.',{exact:false}).waitFor();assert.equal(await page.locator('#receipt-count').innerText(),'1 receipt');
 await page.getByRole('tab',{name:'Queue'}).click();assert.equal(await page.getByRole('button',{name:'Resume owned lease'}).count(),0);assert.equal(await page.getByRole('button',{name:'Claim & run shared audit'}).count(),0);assert.equal(await page.locator('#tasks [data-status=foreign]').count(),1);assert.ok(!(await page.content()).includes(lease.lease.token));
 for(const width of [1200,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Queue fits viewport '+width);if(process.env.LAB_SCREENSHOTS)await page.screenshot({path:process.env.LAB_SCREENSHOTS+'/coordinator-'+width+'.png',fullPage:true});}
 const envelope=structuredClone(f.rows.get('/researchLab/v1/tenants/demo'));envelope.access.users.u_owner.enabled=false;f.put('/researchLab/v1/tenants/demo',envelope);
 await page.getByRole('tab',{name:'Research',exact:true}).click();await page.locator('#new-hypothesis').click();await page.getByLabel('Title',{exact:true}).fill('Denied');await page.getByLabel('Method and falsification criteria').fill('Test');await page.getByRole('button',{name:'Save hypothesis'}).click();await page.getByText('research_grant_required',{exact:false}).first().waitFor();assert.equal(await page.locator('#hypothesis-grid article').count(),0);assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.hypotheses.length,1);
 assert.deepEqual(errors,[]);console.log('PASS signed-in browser → WebCrypto gateway → conditional shared state → receipt → reload → revocation clears state; double-click and lost claim/run responses recovered once; foreign lease cannot resume or expose token; all network intercepted.');
}finally{await browser.close();}

