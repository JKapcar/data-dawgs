import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import http from 'node:http';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';
const {chromium}=loadPlaywright();
const server=http.createServer((req,res)=>{const path=['/presentation-mode.js','/presentation-mode.css','/install-help.js','/install-help.css'].includes(req.url)?req.url.slice(1):'agent-board.html';res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(new URL('../'+path,import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 const thread={id:'synthetic-thread-1',kind:'thread',title:'Synthetic example: compare public model results',agent_name:'Example analyst',agent_name_verified:false,message:'Synthetic fixture only. Which public evaluation would make this comparison useful?',created_at:'2026-10-17T12:00:00Z',score:3,upvotes:4,downvotes:1,reply_count:21};
 const second={...thread,id:'synthetic-thread-2',title:'Synthetic example: testing a new idea',reply_count:0};
 const reply={...thread,id:'synthetic-reply',kind:'reply',thread_id:thread.id,message:'Synthetic reply: show the dated inputs and uncertainty.',score:0,upvotes:0,downvotes:0};
 let failVote=false;
 await page.route('https://toto.jkapcar4.workers.dev/agent-board**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Idempotency-Key','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Content-Type':'application/json'};
  if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  assert(!req.headers()['x-dawg-session']);assert(!req.headers()['x-bozo-session']);calls.push(req.url());
  let data,status=200;
  if(url.pathname.endsWith('/vote')){const body=req.postDataJSON();if(failVote){status=429;data={error:'vote_rate_limit'};}else data={post:{...thread,id:body.post_id,score:4,upvotes:5,downvotes:1},value:body.value};}
  else if(url.searchParams.get('view')==='thread'){const offset=Number(url.searchParams.get('offset'));data={thread,posts:[reply],pagination:{next_offset:offset===0?20:null}};}
  else {const offset=Number(url.searchParams.get('offset'));data={submissions_enabled:true,posts:[offset?second:thread],pagination:{total:21,next_offset:offset===0?20:null},notice:'Synthetic screenshot fixture. Names are unverified.'};}
  await route.fulfill({status,headers,body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByText('1 public threads.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Reply',exact:true}).click();await page.locator('#message').fill('Draft stays attached to the selected thread.');await page.locator('#consent').check();
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText(second.title,{exact:true}).first().waitFor();assert.equal(await page.locator('#thread').inputValue(),thread.id);assert.equal(await page.locator('#message').inputValue(),'Draft stays attached to the selected thread.');
 await page.locator('#sort').selectOption('top');await page.getByText(thread.title,{exact:true}).first().waitFor();assert(calls.some(u=>u.includes('sort=top')));
 await page.getByRole('button',{name:'Show discussion (21)',exact:true}).click();await page.getByText(reply.message,{exact:true}).waitFor();
 await page.getByRole('button',{name:'More replies',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.discussion button:last-child')?.disabled);assert(calls.some(u=>u.includes('view=thread')&&u.includes('offset=20')));
 await page.locator('#posts > article > .votes').getByRole('button',{name:'Upvote',exact:true}).click();await page.getByText('Network vote saved. Refresh Top to update ordering.',{exact:true}).waitFor();assert.equal(await page.locator('#posts > article > .votes output').textContent(),'4');
 failVote=true;await page.locator('#posts > article > .votes').getByRole('button',{name:'Downvote',exact:true}).click();await page.getByText('Too many requests. Please wait before trying again.',{exact:true}).waitFor();assert.equal(await page.locator('#posts > article > .votes output').textContent(),'4');
 assert.equal(await page.locator('#posts a, #posts script').count(),0);
 mkdirSync(new URL('../artifacts/board/',import.meta.url),{recursive:true});
 for(const width of [320,390]){await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:new URL('../artifacts/board/forum-'+width+'.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});}
 await page.locator('#sort').focus();assert.equal(await page.locator('#sort').evaluate(el=>el===document.activeElement),true);assert.deepEqual(errors,[]);
 console.log('PASS forum browser: pagination, draft reply target, Top, reply pages, verified vote feedback, failed vote unchanged, no owner headers, 320/390px screenshots, focus and no errors');
}finally{await browser?.close();server.close();}
