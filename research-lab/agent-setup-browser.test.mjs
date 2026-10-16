import assert from 'node:assert/strict';import {readFileSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
const output=process.env.LAB_SCREENSHOTS||path.join(os.tmpdir(),'dd-agent-setup-preview');mkdirSync(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let enabled=false,writes=0,denied=0,reads=0,holdRead=null,readStarted=null;
 const state={delegatedEnabled:false,scopes:{pound:['pound:task:read','pound:message:append'],research:['research:read']},grants:[],resources:{roster:[{id:'roster',name:'Claude synthetic'}],tasks:[{id:'task',title:'Synthetic pilot',agent_id:'roster'}],contexts:[{id:'context',title:'Synthetic approved brief',versions:[1]}]}};
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==='datadawgs216.com'){const name=url.pathname.split('/').at(-1);assert(['agent-setup.html','agent-setup.css','agent-setup-ui.mjs','navigation.css','navigation.js'].includes(name));return route.fulfill({contentType:/\.(mjs|js)$/.test(name)?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(new URL(name,import.meta.url))});}
  assert.equal(url.hostname,'toto.jkapcar4.workers.dev');assert.equal(url.pathname,'/agent-setup/v1');assert.equal(url.search,'');
  const headers={'Access-Control-Allow-Origin':'https://datadawgs216.com','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(req.headers().authorization,'Bearer synthetic-owner');
  const send=(body,status=200)=>route.fulfill({status,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(denied)return send({error:denied===401?'owner_session_required':'owner_required'},denied);
  if(!enabled)return send({error:'setup_unconfigured'},503);
  if(req.method()==='GET'){reads++;if(holdRead){readStarted?.();await holdRead;}return send(state);}
  writes++;const b=req.postDataJSON();if(b.action==='issue')return send({id:'synthetic',endpoint:'https://example.invalid/mcp',secret:'synthetic-not-a-real-credential',expiresAt:Date.now()+604800000});
  assert.equal(b.action,'revoke');return send({revoked:true});
 });
 await page.goto('https://datadawgs216.com/research-lab/agent-setup.html');await page.getByText('Not signed in in this browser',{exact:true}).waitFor();assert(await page.locator('#signinHelp').isVisible());assert(await page.locator('#load').isDisabled());assert.equal(await page.locator('#accountLink').getAttribute('href'),'../signon.html?next=research-lab/agent-setup.html');assert.equal(writes,0);
 await page.addInitScript(()=>localStorage.setItem('dd-bozo-sess','synthetic-owner'));
 await page.goto('https://datadawgs216.com/research-lab/agent-setup.html');await page.getByText('setup_unconfigured',{exact:false}).waitFor();assert(await page.locator('#setup').isHidden());assert.equal(writes,0);
 enabled=true;await page.reload();await page.locator('#setup').waitFor();assert.equal(reads,1);assert.equal(await page.locator('#sessionStatus').textContent(),'Signed in - owner verified');assert.equal(await page.locator('#accountLink').textContent(),'Account');assert(await page.locator('#signinHelp').isHidden());assert.equal(writes,0);
 denied=401;await page.reload();await page.getByText('Your sign-in has expired or is no longer valid. Sign in again.',{exact:true}).waitFor();assert(await page.locator('#setup').isHidden());assert(await page.locator('#signinHelp').isVisible());
 denied=403;await page.reload();await page.getByText('Owner access required',{exact:true}).waitFor();assert(await page.locator('#setup').isHidden());assert.equal(writes,0);
 denied=0;await page.reload();await page.locator('#setup').waitFor();assert(await page.locator('#issue').isDisabled());
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`agent-setup-${width}.png`),fullPage:true});}
 await page.locator('#consent').check();await page.locator('#issue').click();await page.locator('#secretPanel').waitFor();assert.equal(await page.locator('#secret').inputValue(),'Bearer synthetic-not-a-real-credential');assert.equal(writes,1);
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic-not-a-real-credential')),false);
 await page.evaluate(()=>dispatchEvent(new Event('pagehide')));assert.equal(await page.locator('#secret').inputValue(),'');assert(await page.locator('#setup').isHidden());
 await page.locator('#load').click();await page.locator('#setup').waitFor();await page.evaluate(()=>{localStorage.removeItem('dd-bozo-sess');dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));});assert(await page.locator('#setup').isHidden());assert.equal(await page.locator('#sessionStatus').textContent(),'Not signed in in this browser');assert(await page.locator('#load').isDisabled());
 await page.evaluate(()=>{localStorage.setItem('dd-bozo-sess','synthetic-owner');dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));});await page.locator('#setup').waitFor();
 await page.evaluate(()=>{localStorage.clear();dispatchEvent(new StorageEvent('storage',{key:null}));});assert(await page.locator('#setup').isHidden());assert(await page.locator('#signinHelp').isVisible());assert.deepEqual(errors,[]);
 let releaseRead,startedRead;holdRead=new Promise(r=>releaseRead=r);const started=new Promise(r=>startedRead=r);readStarted=startedRead;
 await page.evaluate(()=>{localStorage.setItem('dd-bozo-sess','synthetic-owner');dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));});await started;
 await page.evaluate(()=>{localStorage.clear();dispatchEvent(new StorageEvent('storage',{key:null}));});const completed=page.waitForResponse(r=>r.url().endsWith('/agent-setup/v1')&&r.request().method()==='GET');releaseRead();holdRead=null;await (await completed).finished();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await page.locator('#status').textContent(),'Sign in to DataDawgs to open Connections.');assert.equal(await page.locator('#accountLink').textContent(),'Sign in');assert(await page.locator('#signinHelp').isVisible());assert(await page.locator('#setup').isHidden());assert.equal(writes,1);
 console.log(JSON.stringify({passed:true,syntheticOnly:true,widths:[1440,390,320],screenshots:output,secretCleared:true,noExternalConnections:true}));
}finally{await browser.close();}
