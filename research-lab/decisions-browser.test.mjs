import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
const root=process.cwd(),out=process.env.LAB_SCREENSHOTS?path.join(process.env.LAB_SCREENSHOTS,'decisions'):path.join(root,'artifacts/decisions');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const data=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,{chromium}=loadPlaywright();
const browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
const controls=[{kind:'choice'},{kind:'scale',min:2,max:10,step:2,unit:'synthetic trials'},{kind:'rank'},{kind:'budget',total:10,unit:'synthetic hours'},{kind:'buckets',buckets:[{id:'now',label:'Now'},{id:'later',label:'Later'}]}];
function fixture(){return {revision:5,decisions:controls.map((control,i)=>({id:'r_00000000-0000-4000-8000-'+String(i).padStart(12,'0'),revision:1,proposal_version:String(i+1).repeat(64),status:'proposed',deck_status:'ready_for_decision',title:'SYNTHETIC · '+['Choose the next study','Set the trial count','Rank research steps','Allocate study time','Sort proposed work'][i],context:'Invented screenshot fixture. No real project decision.',options:[{id:'a',text:'Small reproducible baseline',consequences:'Faster to inspect; less coverage.'},{id:'b',text:'Broader synthetic comparison',consequences:'More coverage; more review time.'}],deck:{version:1,stage:'ready_for_decision',why_now:'A synthetic example of an explicit owner decision.',deadline:'No deadline',consequence:'No real work or spending changes.',lesson:'Compare the evidence needed to learn something useful with the effort needed to check it. This lesson is illustrative, not a research finding.',recommendation:'Review the smaller baseline first.',counterargument:'A wider comparison may reveal missed assumptions.',uncertainty:'This is entirely synthetic.',dependent_work:['Synthetic report'],researched_at:'2026-01-01T00:00:00Z',valid_until:'2099-01-01T00:00:00Z',sources:[{title:'Synthetic source',url:'https://example.com/research',checked_at:'2026-01-01T00:00:00Z',claim:'Illustrates source attribution only.'}],authorization:{intent_only:i===0,approval_url:i===0?'https://example.com/approval':''},control}}))};}
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('dd-bozo-sess','synthetic.session'));
 let state=fixture(),writes=[],lose=false,conflict=false,disabled=false;
 await context.route('https://toto.jkapcar4.workers.dev/**',async route=>{
  const req=route.request(),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(disabled)return route.fulfill({status:503,headers,json:{error:'projects_disabled'}});
  if(req.method()==='GET')return route.fulfill({headers,json:{project:state,exists:true}});
  const body=req.postDataJSON();writes.push(body);
  if(conflict)return route.fulfill({status:409,headers,json:{error:'revision_conflict'}});
  const row=state.decisions.find(d=>d.id===body.data.id);
  if(!row.responses?.some(r=>r.request_id===body.request_id)){row.revision++;state.revision++;row.responses=[...(row.responses||[]),{...body.data,request_id:body.request_id,at:'2026-10-17T12:00:00Z',by:{uid:'u_synthetic',actor_kind:'owner'},execution:'not_executed'}];row.deck_status=body.data.disposition==='answer'?'answered':body.data.disposition==='defer'?'deferred':'needs_research';}
  if(lose){lose=false;return route.abort();}
  return route.fulfill({headers,json:{receipt:{item_id:row.id,record_revision:row.revision,revision:state.revision}}});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/research-lab/decisions.html');await page.getByText(/5 authored deck items/).waitFor();
 assert.equal(await page.locator('input[type=radio]:checked').count(),0);assert.equal(await page.locator('input[type=number]').first().inputValue(),'');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(out,'deck-390.png')});
 const first=page.locator('.card').first();await first.locator('summary').click();await first.screenshot({path:path.join(out,'detail-390.png')});
 await first.locator('input[type=radio]').first().check();await first.locator('textarea').fill('Synthetic rationale.');await first.getByText('Preview answer',{exact:true}).click();
 assert.equal(writes.length,0);assert.equal(await page.locator('#back').evaluate(e=>e===document.activeElement),true);await page.locator('#back').click();assert.equal(writes.length,0);
 await first.getByText('Preview answer',{exact:true}).click();lose=true;await page.locator('#confirm').click();await page.getByText('Retry & verify',{exact:true}).waitFor();await page.locator('#confirm').click();await page.getByText(/Saved and read back/).waitFor();
 assert.equal(writes.length,2);assert.equal(writes[0].request_id,writes[1].request_id);assert.equal(state.decisions[0].responses.length,1);
 for(const i of [1,2,3,4]){const card=page.locator('.card').nth(i);
  if(i===1)await card.locator('input[type=number]').fill('6');
  if(i===2){await card.locator('select').nth(0).selectOption('2');await card.locator('select').nth(1).selectOption('1');}
  if(i===3){await card.locator('input[type=number]').nth(0).fill('3');await card.locator('input[type=number]').nth(1).fill('7');}
  if(i===4){await card.locator('select').nth(0).selectOption('now');await card.locator('select').nth(1).selectOption('later');}
  await card.locator('textarea').fill('Synthetic rationale.');await card.getByText('Preview answer',{exact:true}).click();await page.locator('#confirm').click();await page.getByText(/Saved and read back/).waitFor();
 }
 assert.deepEqual(state.decisions[1].responses[0].answer,{number:6});assert.deepEqual(state.decisions[2].responses[0].answer,{order:['b','a']});
 await page.setViewportSize({width:320,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'deck-320.png')});
 const card=page.locator('.card').first();await card.locator('textarea').fill('Need a better source.');await card.getByText('Need more information',{exact:true}).click();await page.locator('#confirm').click();await page.getByText(/Saved and read back/).waitFor();assert.equal(state.decisions[0].deck_status,'needs_research');
 await page.locator('.card').first().locator('textarea').fill('Defer synthetic case.');await page.locator('.card').first().getByText('Defer',{exact:true}).click();conflict=true;await page.locator('#confirm').click();await page.getByText(/project or proposal changed/).waitFor();assert.equal(await page.locator('.card').count(),0);
 conflict=false;disabled=true;await page.getByText('Open project',{exact:true}).click();await page.getByText(/Decision storage is not enabled/).waitFor();assert.equal(await page.locator('.card').count(),0);
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS: five controls, preview/back, exact-key uncertain retry, readback, conflict, disabled state, 320/390px and reduced-motion screenshots; synthetic only.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
