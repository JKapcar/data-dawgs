import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
const root=process.cwd(),out=path.join(process.env.LAB_SCREENSHOTS||'artifacts','discord-pack');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,{chromium}=loadPlaywright();
const browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
try{for(const width of [320,390,1280]){
 const context=await browser.newContext({viewport:{width,height:844}});
 await context.addInitScript(()=>localStorage.setItem('dd-bozo-sess','synthetic.session'));
 const calls=[],state={flags:{pack:true,delivery:false,bot_secret_bound:true},command:null,links:[],jobs:[],seats:[{seat:'claude',display:'Claude',configured_key:'pack-claude',binding:{number:1,live:true,session_ref:'<img src=x onerror=alert(1)> synthetic',last_seen_at:'2026-10-23T18:00:00Z'}}]};
 await context.route('https://toto.jkapcar4.workers.dev/**',async route=>{
  const req=route.request(),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(req.method()==='POST'){
   const body=req.postDataJSON();calls.push(body);
   if(body.action==='inspect_command')return route.fulfill({headers,json:{observed:'absent'}});
   if(body.action==='register'){state.command={status:'registered'};return route.fulfill({headers,json:{registration:'registered'}});}
   if(body.action==='stop')state.seats[0].stopped_at='2026-10-23T18:01:00Z';
  }
  return route.fulfill({headers,json:state});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/research-lab/discord-pack.html');await page.locator('#load').click();await page.locator('#panel').waitFor({state:'visible'});
 assert(await page.locator('#register').isDisabled());assert.match(await page.locator('main').innerText(),/cannot wake a chat/);
 assert.equal(await page.locator('#seats img').count(),0);
 await page.locator('#inspect').click();await page.waitForFunction(()=>document.querySelector('#command').textContent.includes('absent'));
 assert.deepEqual(calls.map(c=>c.action),['inspect_command']);assert(!await page.locator('#consent').isChecked());
 await page.locator('#consent').check();await page.locator('#register').click();await page.waitForFunction(()=>document.querySelector('#command').textContent.includes('registered'));
 assert(!await page.locator('#consent').isChecked());
 await page.locator('#consent').check();await page.locator('[data-act="stop"]').click();await page.locator('[data-act="allow"]').waitFor();
 assert.deepEqual(calls.map(c=>c.action),['inspect_command','register','stop']);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,id:e.id,cls:e.className,width:e.getBoundingClientRect().width,text:e.textContent.slice(0,60)})))));
 await page.locator('.eyebrow').evaluate(e=>e.textContent='SYNTHETIC UI TEST');await page.screenshot({path:path.join(out,'synthetic-'+width+'.png'),fullPage:true});
 await page.evaluate(()=>window.dispatchEvent(new Event('dd-auth')));assert(await page.locator('#panel').isHidden());assert(await page.locator('#register').isDisabled());
 assert.deepEqual(errors,[]);await context.close();
}console.log('Pack owner UI 320/390/1280: load, safe rendering, inspection, consent, registration, stop and account invalidation passed (mock APIs only).');}
finally{await browser.close();await new Promise(r=>server.close(r));}
