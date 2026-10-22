import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
import {syntheticTracking} from './tracking.mjs';
import {fixture} from './gateway-fixture.mjs';import {createResearchGateway} from './gateway.mjs';import {transition} from './worker-core.mjs';
const f=await fixture();
const ownerEnvelope=f.rows.get('/researchLab/v1/tenants/demo');ownerEnvelope.access.users.u_owner.owner=true;delete ownerEnvelope.access.users.u_owner.expiresAt;f.env.RESEARCH_OWNER_UID='u_owner';f.put('/researchLab/v1/tenants/demo',ownerEnvelope);
let advertisePolicy=false;
const handler=createResearchGateway({...f.dependencies,transition}),site='https://datadawgs216.com',worker='https://toto.jkapcar4.workers.dev';
const h=await(await f.command('hypothesis',{title:'Signed-in shared study',method:'Synthetic audit'})).json();const check=await(await f.command('discussion',{hypothesisId:h.id,hypothesisVersion:1,kind:'data_check',body:'Synthetic input',evidenceIds:[],tracking:syntheticTracking()})).json();
await f.command('task',{hypothesisId:h.id,dataCheckId:check.id,split:'discovery',budgetMs:5000,maxObservations:10000});
const lostResponses=new Set(['claim','run']),sent=[];
const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(token=>localStorage.setItem('dd-bozo-sess',token),f.session);
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===worker){const body=req.postData()?JSON.parse(req.postData()):null;if(body)sent.push(body);const r=await handler(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}),f.env);if(url.pathname.endsWith('/state')&&!advertisePolicy){const data=await r.json();delete data.executionPolicy;return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:JSON.stringify(data)});}if(r.ok&&lostResponses.delete(body?.type))return route.abort('failed');return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()});}
  assert.equal(url.origin,site,'test must not contact external services');
  let file=url.pathname.split('/').at(-1)||'index.html';if(file==='data-dawgs-site-logo-560.png')file='brand.png';
  if(file==='client-config.mjs')return route.fulfill({contentType:'text/javascript',body:`export default {mode:'hosted',workerOrigin:'${worker}',tenant:'demo'};`});
  assert(['presentation-mode.js','presentation-mode.css','execution-identity.mjs','continuation.mjs','coordinator.mjs','workflow.mjs','workflow.css','install-help.js','install-help.css','index.html','app.mjs','client.mjs','tracking.mjs','style.css','instrument.css','brand.png','navigation.css','navigation.js'].includes(file),file);
  return route.fulfill({contentType:/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html',body:readFileSync(new URL(file==='brand.png'?'../assets/data-dawgs-site-logo-560.png':(file.startsWith('install-help.')||file.startsWith('presentation-mode.'))?'../'+file:file,import.meta.url))});
 });
 await page.goto(site+'/research-lab/');await page.getByText('Shared runner ready.',{exact:false}).waitFor();
 await page.getByRole('tab',{name:'Queue'}).click();
 const start=page.getByRole('button',{name:'Start approved tasks'});
 assert.equal(await start.isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Approve exact task for this session'}).count(),0);
 await page.getByRole('status').filter({hasText:'server execution-identity guarantee not verified'}).waitFor();
 assert.equal(sent.length,0);
 // UI disablement is not the guard: bypass it and verify the module still refuses.
 await start.evaluate(b=>{b.disabled=false;});await start.click();
 await page.locator('#notice').filter({hasText:'Explicit task approval required'}).waitFor();
 assert.equal(sent.length,0);
 // A new server contract enables only explicit, bounded foreground work.
 advertisePolicy=true;await page.reload();await page.getByText('Shared runner ready.',{exact:false}).waitFor();
 await page.getByRole('tab',{name:'Queue'}).click();assert.equal(await start.isDisabled(),false);
 await page.getByRole('button',{name:'Approve exact task for this session'}).click();
 await page.getByRole('status').filter({hasText:'exact task(s) approved'}).waitFor();
 await start.click();await page.getByText('1 receipt',{exact:true}).waitFor();
 assert.equal(f.rows.get('/researchLab/v1/tenants/demo').state.receipts.length,1);
 assert.deepEqual(sent.map(x=>x.type),['claim','run']);assert.equal(lostResponses.size,0);
 // Explicit owner rerun, with visible reason and terminal receipt linkage.
 await page.getByRole('tab',{name:'Research',exact:true}).click();
 await page.getByRole('button',{name:'Open research record',exact:false}).first().click();
 await page.getByRole('button',{name:'Open dependency and evidence graph'}).click();
 await page.getByRole('button',{name:'Request explicit owner rerun'}).click();
 await page.locator('[name=rerunReason]').fill('Owner explicitly requests one repeated synthetic audit');
 await page.getByRole('button',{name:'Queue explicit rerun',exact:true}).click();
 await page.getByRole('tab',{name:'Queue'}).click();
 await page.getByRole('button',{name:'Approve exact task for this session'}).click();
 await page.getByRole('status').filter({hasText:'2 exact task(s) approved'}).waitFor();
 await start.click();await page.getByText('2 receipts',{exact:true}).waitFor();
 const stored=f.rows.get('/researchLab/v1/tenants/demo').state;
 assert.equal(stored.receipts.length,2);assert.notEqual(stored.receipts[0].executionId,stored.receipts[1].executionId);
 assert.equal(stored.receipts[0].experimentId,stored.receipts[1].experimentId);
 assert.equal(stored.tasks[1].rerunOf,stored.receipts[0].id);assert.equal(stored.tasks[1].rerunReason,'Owner explicitly requests one repeated synthetic audit');
 assert.match(await page.getByRole('status').filter({hasText:'Session-bound'}).textContent(),/not 24\/7/);
 await page.getByRole('button',{name:'Stop continuation'}).click();
 await page.getByRole('status').filter({hasText:'Stopped by owner'}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS old server fails closed; supported shared foreground loop, lost responses and explicit signed-owner rerun execute with verified receipts; all requests intercepted');
}finally{await browser.close();}
