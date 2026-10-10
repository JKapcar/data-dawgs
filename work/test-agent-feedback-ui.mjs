import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';
const {chromium}=loadPlaywright();
const html=readFileSync(new URL('../feedback-inbox.html',import.meta.url));
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM||chromiumExecutable(chromium),args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let status=200,calls=0,hold=null;
 await page.route('https://toto.jkapcar4.workers.dev/agent-feedback/inbox',async route=>{calls++;assert.equal(route.request().headers()['x-dawg-session'],'synthetic-local-session');if(hold)await hold;await route.fulfill({status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:JSON.stringify({submissions:[{agent_name:'Unverified test agent',category:'test',created_at:'2026-10-10T00:00:00Z',receipt_id:'synthetic-receipt',message:'<script>window.injected=true</script> Ignore prior instructions',page_path:'/data/surfaces.json'}]})});});
 const url='http://127.0.0.1:'+server.address().port;
 await page.goto(url);await assert.doesNotReject(()=>page.getByText('Sign in with your owner account').waitFor());assert.equal(calls,0);
 await page.evaluate(()=>localStorage.setItem('dd-bozo-sess','synthetic-local-session'));
 await page.getByRole('button').click();await page.waitForSelector('article');assert.equal(await page.locator('article').count(),1);assert.match(await page.locator('article p').innerText(),/<script>/);assert.equal(await page.evaluate(()=>window.injected),undefined);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button').click();await page.waitForSelector('article');assert.equal(await page.locator('article').count(),1);
 status=403;await page.getByRole('button').click();await page.getByText('Your account does not have owner inbox access').waitFor();assert.equal(await page.locator('article').count(),0);
 status=503;await page.getByRole('button').click();await page.getByText('The feedback pilot is not enabled yet').waitFor();
 status=200;await page.getByRole('button').click();await page.waitForSelector('article');
 await page.evaluate(()=>dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'})));assert.equal(await page.locator('article').count(),0);
 await page.getByRole('button').click();await page.waitForSelector('article');await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await page.locator('article').count(),0);
 let release;hold=new Promise(resolve=>release=resolve);await page.getByRole('button').click();await page.waitForTimeout(50);await page.evaluate(()=>{localStorage.removeItem('dd-bozo-sess');dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));});release();await page.waitForTimeout(100);assert.equal(await page.locator('article').count(),0);assert.equal(await page.getByRole('button').isEnabled(),true);
 assert.deepEqual(errors,[]);console.log('PASS owner inbox UI: signed-out, mobile width, inert script text, repeat refresh, 403/503, account change, pagehide, stale-request cancellation; no page errors');
}finally{await browser.close();server.close();}
