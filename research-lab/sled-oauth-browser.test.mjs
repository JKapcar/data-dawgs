// Entirely intercepted browser rehearsal: never contacts the live site or ChatGPT.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
const output=process.env.LAB_SCREENSHOTS||path.join(os.tmpdir(),'dd-sled-oauth-preview');mkdirSync(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let writes=[],hold=null,callback=null,grants=[{id:'a'.repeat(32),label:'Synthetic mail relay',expiresAt:1900000000000}];
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.hostname==='datadawgs216.com'){
   const file=u.pathname.split('/').at(-1);assert.ok(['sled-connect.html','sled-connect.mjs','agent-setup.css'].includes(file));
   return route.fulfill({contentType:file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync(new URL(file,import.meta.url))});
  }
  if(u.hostname==='chatgpt.com'){callback=u;return route.fulfill({contentType:'text/html',body:'Synthetic callback only'});}
  assert.equal(u.hostname,'toto.jkapcar4.workers.dev');assert.equal(u.pathname,'/sled/oauth/consent');assert.equal(u.search,'');
  const headers={'Access-Control-Allow-Origin':'https://datadawgs216.com','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(req.headers().authorization,'Bearer synthetic-owner');const b=req.postDataJSON();writes.push(b.action);
  if(hold)await hold;
  const result=b.action==='inspect'?{transaction:'synthetic-transaction',csrf:'synthetic-csrf',client_name:'<img src=x onerror=alert(1)>',grants}:{redirect:'https://chatgpt.com/connector_platform_oauth_redirect?'+(b.action==='approve'?'code=synthetic-code':'error=access_denied')+'&state=synthetic-state&iss=https%3A%2F%2Ftoto.jkapcar4.workers.dev%2Fsled%2Foauth'};
  return route.fulfill({headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(result)});
 });
 const start=async()=>{await page.goto('about:blank');await page.goto('https://datadawgs216.com/research-lab/sled-connect.html#client_id=test-client&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector_platform_oauth_redirect');};
 await start();await page.locator('#signin').waitFor();assert.equal(writes.length,0);
 await page.addInitScript(()=>{if(location.origin==='https://datadawgs216.com')localStorage.setItem('dd-bozo-sess','synthetic-owner');});
 await start();await page.locator('#consent').waitFor();assert.equal(new URL(page.url()).hash,'');assert(await page.locator('#approve').isDisabled());assert.equal(await page.locator('img').count(),0);
 for(const width of [1200,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,'sled-oauth-'+width+'.png'),fullPage:true});}
 await page.locator('#confirm').check();await page.locator('#approve').evaluate(el=>{el.click();el.click();});await page.waitForURL('https://chatgpt.com/**');assert.equal(callback.searchParams.get('code'),'synthetic-code');assert.equal(writes.filter(a=>a==='approve').length,1);
 await start();await page.locator('#consent').waitFor();await page.locator('#deny').click();await page.waitForURL('https://chatgpt.com/**');assert.equal(callback.searchParams.get('error'),'access_denied');
 grants=[];await start();await page.locator('#consent').waitFor();await page.locator('#confirm').check();assert(await page.locator('#approve').isDisabled());assert(await page.locator('#missing').isVisible());
 await page.evaluate(()=>dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'})));assert(await page.locator('#consent').isHidden());
 grants=[{id:'a'.repeat(32),label:'Synthetic',expiresAt:1900000000000}];await start();await page.locator('#consent').waitFor();await page.evaluate(()=>dispatchEvent(new Event('pagehide')));assert(await page.locator('#consent').isHidden());
 let release;hold=new Promise(r=>release=r);const pending=page.waitForRequest(r=>r.url().endsWith('/consent')&&r.method()==='POST');await start();await pending;
 await page.evaluate(()=>{localStorage.removeItem('dd-bozo-sess');dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));});release();hold=null;
 await page.getByText(/Request interrupted|Sign-in changed/).waitFor();assert(await page.locator('#consent').isHidden());assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,syntheticOnly:true,liveRequests:0,checks:['signed out','consent required','approve','deny','missing grant','XSS inert','session change','navigation cancellation','late response'],screenshots:output}));
}finally{await browser.close();}
