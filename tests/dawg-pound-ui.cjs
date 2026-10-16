/* Real Chromium UI + screenshots, exclusively synthetic in-memory data. No live writes.
 * POUND_PLAYWRIGHT_MODULE may point to a local playwright-core install.
 * POUND_CHROME may point to an installed browser. Screenshots go outside the repository. */
const fs=require('node:fs'),http=require('node:http'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {chromium}=require(process.env.POUND_PLAYWRIGHT_MODULE||'playwright-core');
const db=new Map();let revision=0,commits=0,loseResponse=false,heldRead=null;
const ctx={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,URL,Date,ORIGINS:[],
  readSession:async(e,t)=>['u_demo','u_other'].includes(t)?{u:t}:null,
  sessionAuth:async r=>({uid:r.headers.get('X-Dawg-Session')}),
  fbGet:async(e,p)=>({data:db.has(p)?JSON.parse(JSON.stringify(db.get(p))):null,etag:String(revision)}),
  fbPut:async(e,p,v,etag)=>{if(etag!==String(revision))return false;db.set(p,JSON.parse(JSON.stringify(v)));revision++;commits++;return true;}
};vm.createContext(ctx);vm.runInContext(fs.readFileSync('work/dawg-pound.js','utf8')+'\nthis.handle=handlePound;',ctx);
const server=http.createServer((req,res)=>{const file={'/dawg-pound.html':'dawg-pound.html','/dawg-pound.js':'dawg-pound.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(file));});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;ctx.ORIGINS.push(origin);
  browser=await chromium.launch({headless:true,...(process.env.POUND_CHROME?{executablePath:process.env.POUND_CHROME}:{channel:'chrome'})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const req=route.request();if(req.url().startsWith(origin)){const file=new URL(req.url()).pathname.slice(1);if(!['dawg-pound.html','dawg-pound.js'].includes(file))return route.fulfill({status:404,body:''});return route.fulfill({status:200,contentType:file.endsWith('.js')?'text/javascript':'text/html',headers:{'Cache-Control':'no-store'},body:fs.readFileSync(file,'utf8')});}
    if(req.url()==='https://toto.jkapcar4.workers.dev/api/pound'){
      if(req.method()==='GET'&&heldRead){const hold=heldRead;heldRead=null;hold.started();await hold.wait;}
      const response=await ctx.handle(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}),{DAWG_POUND_ENABLED:'true'});
      if(loseResponse&&req.method()==='POST'){loseResponse=false;return route.abort('failed');}
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
    }
    return route.abort();
  });
  await page.goto(origin+'/dawg-pound.html');await page.getByText('Sign in to open your private workspace.',{exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('dd-bozo-sess','u_demo'));await page.reload();await page.locator('#workspace:not([hidden])').waitFor();
  async function createAgent(name,role,fn,caps){await page.locator('#addAgent').click();await page.locator('[name=name]').fill(name);await page.locator('[name=role]').fill(role);await page.locator('[name=function]').fill(fn);await page.locator('[name=capabilities]').fill(caps);await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});}
  await createAgent('Scout','Research & discovery','Find primary sources and bring back the useful details.','Source review · concise research notes');
  await createAgent('Analyst','Data & evidence','Turn a clear question into a reproducible analysis.','Dataset checks · analysis planning');
  assert.equal(await page.getByText('Not connected',{exact:true}).count(),2);
  await page.locator('#addTask').click();await page.locator('[name=title]').fill('Build the next research brief');await page.locator('[name=body]').fill('Start with the question. Gather primary sources, then capture what changed and what remains uncertain.');await page.locator('[name=agent_id]').selectOption({label:'Scout'});await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});
  await page.locator('#messageText').fill('Keep the first pass small: three good sources and a short recommendation.');await page.locator('#sendMessage').click();await page.getByText('Keep the first pass small: three good sources and a short recommendation.',{exact:true}).waitFor();
  await page.locator('#openLibrary').click();await page.locator('#addContext').click();await page.locator('[name=title]').fill('How we work');await page.locator('[name=text]').fill('Start with evidence.\nName the uncertainty.\nKeep the next step clear.');await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('#closeLibrary').click();
  const out=path.resolve(process.env.POUND_SCREENSHOTS||'../pound-preview');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'dawg-pound-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');await page.screenshot({path:path.join(out,'dawg-pound-mobile.png'),fullPage:true});
  await page.locator('#openLibrary').click();await page.getByRole('button',{name:'How we work',exact:true}).click();await page.screenshot({path:path.join(out,'dawg-pound-context.png'),fullPage:true});await page.locator('#closeLibrary').click();
  // Inert rendering of adversarial text in all user-controlled display surfaces.
  await createAgent('<img src=x onerror=alert(1)>','<script>bad()</script>','Untrusted text','<svg onload=bad()>');assert.equal(await page.locator('#roster img,#roster script,#roster svg').count(),0);
  // Mobile app switch removes sensitive DOM, preserves only in-memory drafts, then revalidates.
  await page.locator('#addContext').evaluate(el=>{});await page.locator('#openLibrary').click();await page.locator('#addContext').click();await page.locator('[name=title]').fill('Unsaved mobile draft');await page.locator('[name=text]').fill('Do not lose this when I switch apps.');
  const visibility=hidden=>page.evaluate(hidden=>{Object.defineProperty(document,'hidden',{configurable:true,value:hidden});document.dispatchEvent(new Event('visibilitychange'));},hidden);
  await visibility(true);assert.equal(await page.locator('#editorFields').textContent(),'');assert.equal(await page.locator('#workspace').isVisible(),false);
  await visibility(false);await page.locator('#editor[open]').waitFor();assert.equal(await page.locator('[name=text]').inputValue(),'Do not lose this when I switch apps.');
  // Response is lost after the server commit. Retry across a visibility change must not duplicate it.
  const before=commits;loseResponse=true;await page.locator('#saveEdit').click();await page.getByText('Connection interrupted. Retry Save to check the same request.',{exact:true}).first().waitFor();
  await visibility(true);await visibility(false);await page.locator('#editor[open]').waitFor();await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});assert.equal(commits,before+1,'uncertain retry committed exactly once');
  // Switching identities clears messages, context, dialogs and suspended drafts.
  await page.evaluate(()=>{localStorage.setItem('dd-bozo-sess','u_other');window.dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));});await page.getByText('Start with a name and a role. Your roster stays private.',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('body').textContent(),/How we work|Unsaved mobile draft|Build the next research brief/);
  // Same-document storage updates cannot submit another user's old draft under the new identity.
  await page.locator('#addTask').click();await page.locator('[name=title]').fill('Old account draft');const writesBefore=commits;await page.evaluate(()=>localStorage.setItem('dd-bozo-sess','u_demo'));await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});assert.equal(commits,writesBefore);
  // Repeated hide/show while revalidation is in flight must not drop an in-memory draft.
  await page.locator('#addAgent').click();await page.locator('[name=name]').fill('Keep this repeated-switch draft');await visibility(true);
  let release,started;const startedPromise=new Promise(r=>started=r);heldRead={started,wait:new Promise(r=>release=r)};
  await visibility(false);await startedPromise;await visibility(true);release();await visibility(false);await page.locator('#editor[open]').waitFor();assert.equal(await page.locator('[name=name]').inputValue(),'Keep this repeated-switch draft');await page.locator('#closeEditor').click();
  const externalChange=fn=>{const row=db.get('/privatePounds/u_demo'),s=JSON.parse(row.payload);fn(s);s.revision++;row.payload=JSON.stringify(s);revision++;};
  // Restored edits retain their original revision instead of silently replacing another tab's work.
  await page.locator('#roster button').first().click();await page.locator('[name=role]').fill('Stale owner edit');await visibility(true);externalChange(s=>s.agents[0].role='Changed in another tab');await visibility(false);await page.locator('#editor[open]').waitFor();await page.locator('#saveEdit').click();await page.locator('#editorError').filter({hasText:'Workspace changed'}).waitFor();assert.equal(JSON.parse(db.get('/privatePounds/u_demo').payload).agents[0].role,'Changed in another tab');await page.locator('#closeEditor').click();
  // An archived original thread must never rebind its unsent note to a fallback thread.
  await page.locator('#messageText').fill('This draft belongs to the original thread only');await visibility(true);
  externalChange(s=>{s.tasks[0].archived=true;s.tasks.push({id:'p_'+webcrypto.randomUUID(),title:'Other thread',body:'Other task',agent_id:'',status:'queued',archived:false});});
  await visibility(false);await page.getByText('Your draft belongs to an archived thread. Copy it before refreshing; it has not moved to another task.',{exact:true}).waitFor();assert.match(await page.locator('#taskDetail').textContent(),/Build the next research brief/);assert.equal(await page.locator('#messageText').inputValue(),'This draft belongs to the original thread only');await page.locator('#sendMessage').click();await page.locator('#status').filter({hasText:'Task is archived'}).waitFor();assert.ok(JSON.parse(db.get('/privatePounds/u_demo').payload).messages.every(m=>m.text!=='This draft belongs to the original thread only'));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['signed-out','owner workspace CRUD','truthful disconnected status','mobile no overflow','safe rendering','mobile draft suspension','uncertain commit replay','cross-account clearing','same-document identity change','repeated visibility during delayed revalidation','restored edit concurrency','archived thread draft binding'],screenshots:out,liveRequests:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
