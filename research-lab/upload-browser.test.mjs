import assert from 'node:assert/strict';import {readFileSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
const output=process.env.LAB_SCREENSHOTS||path.join(os.tmpdir(),'dd-upload-preview');mkdirSync(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let configured=false,upload=null,parts=0,retry=true,partStarted;const firstPart=new Promise(r=>partStarted=r);
 await page.route('https://datadawgs216.com/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);assert(['install-help.js','install-help.css','upload.html','upload.css','upload.mjs','navigation.css','navigation.js','account.js'].includes(name));await route.fulfill({contentType:/\.(mjs|js)$/.test(name)?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(new URL(name.startsWith('install-help.')?'../'+name:name,import.meta.url))});});
 await page.route('https://toto.jkapcar4.workers.dev/**',async route=>{
  const req=route.request(),action=new URL(req.url()).pathname.split('/').at(-1),send=(body,status=200)=>route.fulfill({status,headers:{'Access-Control-Allow-Origin':'https://datadawgs216.com','Content-Type':'application/json'},body:JSON.stringify(body)});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'https://datadawgs216.com','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,X-Upload-Part,X-Upload-ID'}});
  assert.equal(req.headers().authorization,'Bearer synthetic-test-session');if(!configured)return send({error:'private_upload_unconfigured'},503);
  if(action==='status')return send({configured:true,upload,partBytes:8*1024*1024,maxBytes:10*1024**3});
  if(action==='create'){upload={...req.postDataJSON(),id:'synthetic-test-upload',parts:{},status:'uploading'};return send(upload,201);}
  if(action==='part'){const n=Number(req.headers()['x-upload-part']);if(n===1){partStarted();await new Promise(r=>setTimeout(r,300));}if(n===2&&retry){retry=false;return send({error:'temporary_failure'},503);}parts++;upload.parts[n]={partNumber:n,etag:'synthetic-part'};return send(upload.parts[n]);}
  if(action==='complete'){upload.status='complete';upload.etag='synthetic-etag';return send(upload);}
  if(action==='abort'){upload=null;return send({deleted:true});}throw Error('Unexpected API request');
 });
 await page.addInitScript(()=>localStorage.setItem('dd-bozo-sess','synthetic-test-session'));
 const url='https://datadawgs216.com/research-lab/upload.html';await page.goto(url);await page.getByText('Private storage is not activated yet.',{exact:false}).waitFor();assert(await page.locator('#file').isDisabled());
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(width!==320)await page.screenshot({path:path.join(output,`upload-${width}.png`),fullPage:true});}
 configured=true;await page.reload();await page.getByText('Private storage ready',{exact:false}).waitFor();const bytes=Buffer.alloc(8*1024*1024+22);bytes.set([80,75,3,4]);
 const file={name:'synthetic-test.zip',mimeType:'application/zip',buffer:bytes};await page.locator('#file').setInputFiles(file);await page.locator('#start').click();await firstPart;await page.locator('#pause').click();await page.getByText('Paused. Your received parts are saved.').waitFor();assert.equal(parts,1);
 await page.reload();await page.getByText('Archive: synthetic-test.zip',{exact:false}).waitFor();const changed=Buffer.from(bytes);changed[changed.length-1]=1;await page.locator('#file').setInputFiles({...file,buffer:changed});await page.locator('#start').click();await page.getByText('This file differs',{exact:false}).waitFor();assert.equal(parts,1);
 await page.locator('#file').setInputFiles(file);await page.locator('#start').click();await page.getByText('Stored privately',{exact:false}).waitFor();assert.equal(parts,2);assert.equal(retry,false);assert(await page.locator('#start').isDisabled());
 await page.evaluate(()=>{localStorage.removeItem('dd-bozo-sess');dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));});assert.equal(await page.locator('#receipt').textContent(),'');assert(await page.locator('#remove').isDisabled());assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,syntheticOnly:true,resume:true,retry:true,mismatchRejected:true,logoutClears:true,widths:[1440,390,320],screenshots:output}));
}finally{await browser.close();}
