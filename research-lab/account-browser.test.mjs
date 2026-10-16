import assert from 'node:assert/strict';import {readFileSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
const root=path.resolve(import.meta.dirname,'..'),output=process.env.LAB_SCREENSHOTS||path.join(os.tmpdir(),'dd-account-preview');mkdirSync(output,{recursive:true});
const session=Buffer.from(JSON.stringify({n:'Synthetic Owner',u:'u_synthetic',e:Date.now()+3600000})).toString('base64url')+'.'+'x'.repeat(43);
const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
try{
 for(const [url,kind] of [['/dawg-pound.html','pound'],['/research-lab/private.html','research'],['/research-lab/upload.html','upload']]){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let status=200,release,started,hold=null;
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.hostname==='datadawgs216.com'){const f=path.join(root,u.pathname);return route.fulfill({contentType:/\.(mjs|js)$/.test(f)?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:readFileSync(f)});}
   assert.equal(u.hostname,'toto.jkapcar4.workers.dev');assert(['GET','OPTIONS'].includes(req.method()),'No fixture writes');
   const headers={'Access-Control-Allow-Origin':'https://datadawgs216.com','Access-Control-Allow-Headers':'Authorization','Access-Control-Allow-Methods':'GET,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});assert.equal(req.headers().authorization,'Bearer '+session);
   if(hold){started();await hold;}
   const body=status!==200?{error:'denied'}:kind==='pound'?{workspace:{revision:0,updated_at:null,agents:[],tasks:[],messages:[],contexts:[],activity:[],agent_access_enabled:false}}:kind==='upload'?{configured:true,upload:null,maxBytes:10000,partBytes:1000}:{hypotheses:[],tasks:[],receipts:[],evidence:[],audit:[],discussions:[]};
   return route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('https://datadawgs216.com'+url);await page.getByText('Not signed in',{exact:true}).waitFor();assert.notEqual(await page.locator('#accountLink').getAttribute('data-verified'),'true');
  await page.addInitScript(t=>localStorage.setItem('dd-bozo-sess',t),session);
  hold=new Promise(r=>release=r);const waiting=new Promise(r=>started=r);await page.reload();await waiting;assert.notEqual(await page.locator('#accountLink').getAttribute('data-verified'),'true');assert(!(await page.locator('#accountLabel').textContent()).includes('Synthetic Owner'));if(kind==='pound')assert(await page.locator('#workspace').isHidden());
  release();hold=null;await page.getByText('Signed in as Synthetic Owner',{exact:true}).waitFor();assert.equal(await page.locator('#accountLink').getAttribute('data-verified'),'true');
  if(kind==='pound'){assert(await page.locator('#workspace').isVisible());assert.equal(await page.locator('#agentCount').textContent(),'0 / 24');assert.equal(await page.locator('.agent').count(),0);}
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert((await page.locator('.dd-shell').boundingBox()).height<=140);await page.screenshot({path:path.join(output,`${kind}-verified-${width}.png`),fullPage:true});}
  for(status of [401,403]){await page.reload();await page.waitForFunction(()=>document.querySelector('#accountLink').dataset.verified==='false'&&!document.querySelector('#accountLabel').textContent.includes('Checking'));assert.equal(await page.locator('#accountLabel').textContent(),status===401?'Sign in again':'Access not authorized');assert.equal(await page.locator('#accountLink').textContent(),'Sign in');if(kind==='pound')assert(await page.locator('#workspace').isHidden());}
  status=200;await page.reload();await page.getByText('Signed in as Synthetic Owner',{exact:true}).waitFor();await page.evaluate(()=>{localStorage.clear();dispatchEvent(new StorageEvent('storage',{key:null}));});await page.getByText('Not signed in',{exact:true}).waitFor();assert.notEqual(await page.locator('#accountLink').getAttribute('data-verified'),'true');if(kind==='pound')assert(await page.locator('#workspace').isHidden());assert.deepEqual(errors,[]);await page.close();
 }
 console.log(JSON.stringify({passed:true,syntheticOnly:true,pages:3,widths:[1440,768,390,320],verifiedOnlyAfterResponse:true,emptyRosterPreserved:true,screenshots:output}));
}finally{await browser.close();}
