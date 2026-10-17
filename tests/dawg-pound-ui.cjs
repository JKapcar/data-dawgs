/* Real Chromium UI + screenshots, exclusively synthetic in-memory data. No live writes.
 * POUND_PLAYWRIGHT_MODULE may point to a local playwright-core install.
 * POUND_CHROME may point to an installed browser. Screenshots go outside the repository. */
const fs=require('node:fs'),http=require('node:http'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
// The page-local visual proposal preserves navigation identities and touch targets.
// Header colors and account target height intentionally change; switcher alignment
// remains stable. The baseline page is read
// from git (POUND_HEADER_BASE, default the release-plan start commit) and rendered in the same
// browser, so the comparison does not depend on fonts installed on the machine.
const BASE_REF=process.env.POUND_HEADER_BASE||'d5d48369a412fd7263c751e42b6108ba498a798a';
const baseFile=f=>execFileSync('git',['show',BASE_REF+':'+f],{encoding:'utf8'});
const shot=async l=>createHash('sha256').update(await l.screenshot()).digest('hex');
const headerShape=async page=>({boxes:await page.evaluate(()=>Object.fromEntries(['header.dd-shell','.dd-brand','.dd-account','.dd-apps > summary'].map(q=>{const r=document.querySelector(q).getBoundingClientRect();return [q,{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}];}))),brand:await shot(page.locator('.dd-brand')),account:await shot(page.locator('.dd-account')),label:(await page.locator('.dd-apps > summary').textContent()).trim(),aria:await page.locator('.dd-apps > summary').getAttribute('aria-label')});
let ownerApps={status:200,body:{owner:'u_demo',apps:[{app:'pound',status:'on',enabled:true,mode:'until_revoked',version:3},{app:'research',available:false,status:'tenant_unconfigured',error:'tenant_unconfigured'}],assistantIdentity:'unverified'}};
const {chromium}=require(process.env.POUND_PLAYWRIGHT_MODULE||'playwright-core');
const db=new Map();let revision=0,commits=0,loseResponse=false,heldRead=null;
const ctx={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,ORIGINS:[],
  readSession:async(e,t)=>['u_demo','u_other'].some(u=>t===u+'.'+'x'.repeat(43))?{u:t.split('.')[0]}:null,
  sessionAuth:async r=>({uid:r.headers.get('X-Dawg-Session').split('.')[0]}),
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
  await page.context().route('**/*',async route=>{
    const req=route.request();if(req.url().startsWith(origin)){let file=new URL(req.url()).pathname.slice(1);const base=file.startsWith('base/');if(base)file=file.slice(5);if(!['install-help.js','dawg-pound.html','dawg-pound.js','research-lab/account.js','research-lab/navigation.js'].includes(file))return route.fulfill({status:404,body:''});return route.fulfill({status:200,contentType:file.endsWith('.js')?'text/javascript':'text/html',headers:{'Cache-Control':'no-store'},body:base?baseFile(file):fs.readFileSync(file,'utf8')});}
    if(req.url()==='https://toto.jkapcar4.workers.dev/owner-apps/v1'){assert.match(req.headers().authorization,/^Bearer u_(demo|other)\.[x]{43}$/);assert.equal(req.method(),'GET');return route.fulfill({status:ownerApps.status,contentType:'application/json',body:JSON.stringify(ownerApps.body)});}
    if(req.url()==='https://toto.jkapcar4.workers.dev/api/pound'){
      assert.match(req.headers().authorization,/^Bearer u_(demo|other)\.[x]{43}$/);
      for(const h of ['x-dawg-session','x-bozo-session','x-dawg-pass'])assert.equal(req.headers()[h],undefined);
      if(req.method()==='GET'&&heldRead){const hold=heldRead;heldRead=null;hold.started();await hold.wait;}
      const response=await ctx.handle(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}),{DAWG_POUND_ENABLED:'true'});
      if(loseResponse&&req.method()==='POST'){loseResponse=false;return route.abort('failed');}
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
    }
    return route.abort();
  });
  await page.goto(origin+'/dawg-pound.html');await page.getByText('Sign in to open your private workspace.',{exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('dd-bozo-sess','u_demo.'+'x'.repeat(43)));await page.reload();await page.locator('#workspace:not([hidden])').waitFor();
  // Roster, diagnostics and limits live behind <details>; the default screen is task summary and work; questions and context use explicit view controls.
  assert.equal(await page.locator('#rosterDrawer').evaluate(d=>d.open),false);assert.equal(await page.locator('#diagnostics').evaluate(d=>d.open),false);for(const id of ['#projectSummary','#work'])assert.ok(await page.locator(id).isVisible(),id);await page.locator('#evidenceDrawer').evaluate(d=>d.open=true);assert.equal(await page.locator('#addTask').isDisabled(),false);
  await page.locator('#rosterDrawer > summary').click();
  async function createAgent(name,role,fn,caps){await page.locator('#addAgent').click();await page.locator('[name=name]').fill(name);await page.locator('[name=role]').fill(role);await page.locator('[name=function]').fill(fn);await page.locator('[name=capabilities]').fill(caps);await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});}
  await createAgent('Scout','Research & discovery','Find primary sources and bring back the useful details.','Source review · concise research notes');
  await createAgent('Analyst','Data & evidence','Turn a clear question into a reproducible analysis.','Dataset checks · analysis planning');
  assert.equal(await page.getByText('Not connected',{exact:true}).count(),2);
  await page.locator('#addTask').click();await page.locator('[name=title]').fill('Build the next research brief');await page.locator('[name=body]').fill('Start with the question. Gather primary sources, then capture what changed and what remains uncertain.');await page.locator('[name=agent_id]').selectOption({label:'Scout'});await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});
  await page.locator('#messageText').fill('Keep the first pass small: three good sources and a short recommendation.');await page.locator('#sendMessage').click();await page.locator('#messages').getByText('Keep the first pass small: three good sources and a short recommendation.',{exact:true}).waitFor();
  // Kind picker and reference field; refs link only https on the allowlist, everything else is inert text.
  const refs=[['https://github.com/JKapcar/data-dawgs',true],['https://www.kaggle.com/competitions/nfl-big-data-bowl-2027',true],['https://datadawgs216.com/receipts.html',true],['http://github.com/insecure',false],['javascript:alert(1)',false],['https://evil.example/github.com',false],['https://user:pw@github.com/x',false],['Smith et al. 2024, table 3',false]];
  for(const [i,[ref]] of refs.entries()){await page.locator('#messageKind').selectOption(i%2?'finding':'question');await page.locator('#messageRef').fill(ref);await page.locator('#messageText').fill('Ref check '+i);await page.locator('#sendMessage').click();await page.locator('#messages').getByText('Ref check '+i,{exact:true}).waitFor();}
  for(const [ref,linked] of refs){const anchors=page.locator('#messages a',{hasText:ref});if(linked){assert.equal(await anchors.count(),1,ref);assert.equal(await anchors.getAttribute('rel'),'noopener noreferrer');assert.equal(await anchors.getAttribute('target'),'_blank');}else{assert.equal(await anchors.count(),0,ref);assert.equal(await page.locator('#messages li',{hasText:ref}).count(),1,ref);}}
  const stored=JSON.parse(db.get('/privatePounds/u_demo').payload).messages;assert.deepEqual(stored.slice(1).map(m=>m.kind),refs.map((_,i)=>i%2?'finding':'question'));assert.equal(stored[0].kind,'note');
  assert.equal(await page.locator('#recentMessages li').count(),5);assert.match(await page.locator('#recentMessages li').first().textContent(),/Ref check 7/);
  // WO-03: a connector-written row shows the verified key label first, the self-reported name second.
  {const row=db.get('/privatePounds/u_demo'),s=JSON.parse(row.payload);s.messages.push({id:'p_'+webcrypto.randomUUID(),thread_id:s.tasks[0].id,text:'Synthetic connector finding',kind:'finding',actor_uid:'u_demo',actor_kind:'owner_connector',credential_label:'Muse',author_label:'Claude',author_label_trust:'unverified',created_at:new Date().toISOString()});s.revision++;row.payload=JSON.stringify(s);revision++;}
  await page.locator('#refresh').click();await page.locator('#messages').getByText('Synthetic connector finding',{exact:true}).waitFor();
  assert.match(await page.locator('#messages article').last().textContent(),/finding · your connector · key Muse \(verified\) · says "Claude" \(unverified\)/);
  await page.locator('#openLibrary').click();await page.locator('#addContext').click();await page.locator('[name=title]').fill('How we work');await page.locator('[name=text]').fill('Start with evidence.\nName the uncertainty.\nKeep the next step clear.');await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('#closeLibrary').click();
  assert.match(await page.locator('#contextShelf').textContent(),/How we work.*Version 1 of 1/);assert.doesNotMatch(await page.locator('#now-grid, .now-grid').textContent(),/Start with evidence/,'full context opens on demand, not on the first screen');
  // Task edits quote the task revision; open work sorts ahead of done work, grouped by stored status.
  await page.locator('#addTask').click();await page.locator('[name=title]').fill('Finished item');await page.locator('[name=status]').selectOption('done');await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});
  assert.match(await page.locator('#work .work-group li').first().textContent(),/Build the next research brief.*Assigned: Scout/);assert.match(await page.locator('#work .work-done').textContent(),/Done · 1.*Finished item.*Unassigned/);
  await page.locator('#taskSelect').selectOption({label:'Build the next research brief'});await page.locator('#taskDetail button',{hasText:'Edit task'}).click();await page.locator('[name=status]').selectOption('working');await page.locator('[name=refs]').fill('https://github.com/JKapcar/data-dawgs\nplain citation');await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});
  const edited=JSON.parse(db.get('/privatePounds/u_demo').payload).tasks.find(t=>t.title==='Build the next research brief');assert.equal(edited.revision,2);assert.equal(edited.status,'working');assert.deepEqual(edited.refs,['https://github.com/JKapcar/data-dawgs','plain citation']);
  // WO-02 task fields through the real editor: a blocked task must carry a reason code; the
  // planning fields, dependency and estimate are stored exactly; canceled reads "Not planned".
  await page.locator('#addTask').click();await page.locator('[name=title]').fill('Gather synthetic data');await page.locator('[name=status]').selectOption('blocked');await page.locator('#saveEdit').click();
  await page.locator('#editorError').filter({hasText:'blocked requires blocked_reason.code'}).waitFor();assert.ok(await page.locator('#editor').evaluate(d=>d.open),'editor stays open with the server error');
  await page.locator('[name=blocked_code]').selectOption('waiting_data');await page.locator('[name=blocked_note]').fill('Synthetic sample not staged');await page.locator('[name=planned_start]').fill('2026-10-20');await page.locator('[name=planned_end]').fill('2026-10-24');await page.locator('[name=estimate_hours]').fill('2.5');
  await page.locator('[name=blocks]').selectOption({label:'Build the next research brief'});await page.locator('[name=proposed_role]').fill('coordinator');await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});
  {const t=JSON.parse(db.get('/privatePounds/u_demo').payload).tasks.find(t=>t.title==='Gather synthetic data'),brief=JSON.parse(db.get('/privatePounds/u_demo').payload).tasks.find(t=>t.title==='Build the next research brief');
   assert.deepEqual([t.status,t.blocked_reason,t.planned_start,t.planned_end,t.estimate_hours,t.blocks,t.assignment],['blocked',{code:'waiting_data',note:'Synthetic sample not staged'},'2026-10-20','2026-10-24',2.5,[brief.id],{proposed_role:'coordinator'}]);
   for(const k of ['project_id','milestone_id','review'])assert.equal(Object.hasOwn(t,k),false,'blank optional '+k+' is omitted on create');}
  assert.match(await page.locator('#work .work-blocked').textContent(),/Gather synthetic data.*Blocked.*Waiting on data: Synthetic sample not staged · planned 2026-10-20 → 2026-10-24 · blocks Build the next research brief/);
  // Unblocking through the editor clears the reason and a blanked field is cleared, not kept.
  await page.locator('#taskSelect').selectOption({label:'Gather synthetic data'});await page.locator('#taskDetail button',{hasText:'Edit task'}).click();await page.locator('[name=status]').selectOption('working');await page.locator('[name=estimate_hours]').fill('');await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});
  {const t=JSON.parse(db.get('/privatePounds/u_demo').payload).tasks.find(t=>t.title==='Gather synthetic data');assert.equal(t.status,'working');assert.equal(Object.hasOwn(t,'blocked_reason'),false);assert.equal(Object.hasOwn(t,'estimate_hours'),false);assert.equal(t.planned_end,'2026-10-24');}
  await page.locator('#taskSelect').selectOption({label:'Gather synthetic data'});await page.locator('#taskDetail button',{hasText:'Edit task'}).click();await page.locator('[name=status]').selectOption('blocked');await page.locator('[name=blocked_code]').selectOption('waiting_data');await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});
  assert.match(await page.locator('#taskDetail').textContent(),/Blocked · owner reported.*Waiting on data.*actual .+ → open.*last 60 saved changes/);
  await page.locator('#taskSelect').selectOption({label:'Finished item'});await page.locator('#taskDetail button',{hasText:'Edit task'}).click();await page.locator('[name=status]').selectOption('canceled');await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});
  assert.match(await page.locator('#work .work-canceled').textContent(),/Not planned · 1.*Finished item.*canceled \d/);assert.doesNotMatch(await page.locator('#work .work-canceled').textContent(),/actual/);assert.equal(await page.locator('#work .work-done').count(),0,'canceled is never counted as done');
  assert.equal(await page.locator('.tally-done dd').textContent(),'0');assert.equal(await page.locator('.tally-canceled dd').textContent(),'1');
  // Diagnostics reads /owner-apps/v1 only when opened and shows reason codes.
  await page.locator('#diagnostics > summary').click();await page.locator('#diagOut').filter({hasText:'research: tenant_unconfigured'}).waitFor();assert.match(await page.locator('#diagOut').textContent(),/pound: on · mode until_revoked · grant v3/);await page.locator('#diagnostics > summary').click();
  ownerApps={status:403,body:{error:'configured_owner_required'}};await page.locator('#diagnostics > summary').click();await page.locator('#diagOut').filter({hasText:'not_owner'}).waitFor();await page.locator('#diagnostics > summary').click();
  // Dispatch layout: fixed order, only stored fields, unavailable capabilities labelled rather than inferred.
  assert.deepEqual(await page.locator('.segments button').allTextContents(),['Work','Needs you','Context']);
  assert.match(await page.locator('#needsYou').textContent(),/Not tracked yet.*nothing here is inferred\.Saved questions and decisions · resolution untracked/);
  assert.match(await page.locator('.capability-note').textContent(),/Unavailable here: project and milestone records.*votes/);assert.match(await page.locator('.capability-note').textContent(),/never typed/);
  assert.match(await page.locator('.capability-note').textContent(),/project owner and votes/);
  assert.match(await page.locator('#verified').textContent(),/Stored dependencies.*Gather synthetic data blocks Build the next research brief.*Last successful refresh · .+not that any agent ran\./);
  {const shown=await page.evaluate(()=>[...document.querySelectorAll('.tally dd')].reduce((n,d)=>n+Number(d.textContent),0)),stored=JSON.parse(db.get('/privatePounds/u_demo').payload).tasks.filter(t=>!t.archived).length;assert.equal(shown,stored,'tally equals stored unarchived tasks');assert.equal(await page.locator('#work .work-group li').count(),stored);}
  await page.locator('#viewContext').click();await page.locator('#contextShelf button').first().click();assert.ok(await page.locator('#library').evaluate(d=>d.open));assert.equal(await page.locator('#contextReader').isHidden(),false);await page.locator('#closeLibrary').click();
  await page.locator('#viewWork').click();
  const out=path.resolve(process.env.POUND_SCREENSHOTS||'../pound-preview');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'dawg-pound-desktop.png'),fullPage:true});
  const headerHashes={};
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px has no horizontal overflow');
    await page.locator('#messageText').scrollIntoViewIfNeeded();assert.ok(await page.locator('#messageForm').isVisible()&&await page.locator('#sendMessage').isVisible()&&await page.locator('#messageKind').isVisible()&&await page.locator('#messageRef').isVisible(),width+'px composer visible');
    const add=await page.locator('#addTask').boundingBox();assert.equal(await page.locator('#needsPane').isHidden(),true);await page.evaluate(()=>scrollTo(0,0));assert.ok((await page.locator('#addTask').boundingBox()).y<844,width+'px New task above the fold');void add;
    const box=await page.locator('#messageForm').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,width+'px composer inside the viewport');
    await page.screenshot({path:path.join(out,'dawg-pound-'+width+'.png'),fullPage:true});
    headerHashes[width]=createHash('sha256').update(await page.locator('header.dd-shell').screenshot()).digest('hex');}
  await page.setViewportSize({width:390,height:844});
  // WO-02 editor fields fit a phone: no horizontal overflow inside the dialog, every control reachable.
  await page.locator('#addTask').click();for(const k of ['status','blocked_code','planned_start','planned_end','estimate_hours','blocks','proposed_role','review_verdict','project_id','milestone_id'])assert.ok(await page.locator('[name='+k+']').count(),k);
  assert.ok(await page.locator('#editor').evaluate(d=>d.scrollWidth<=d.clientWidth+1),'390px editor has no horizontal overflow');await page.screenshot({path:path.join(out,'dawg-pound-editor-390.png')});await page.locator('#closeEditor').click();
  await page.locator('#openLibrary').click();await page.locator('#contextList').getByRole('button',{name:'How we work',exact:true}).click();await page.screenshot({path:path.join(out,'dawg-pound-context.png'),fullPage:true});await page.locator('#closeLibrary').click();
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
  await page.evaluate(()=>{localStorage.setItem('dd-bozo-sess','u_other.'+'x'.repeat(43));window.dispatchEvent(new StorageEvent('storage',{key:'dd-bozo-sess'}));});await page.getByText('Start with a name and a role. Your roster stays private.',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('body').textContent(),/How we work|Unsaved mobile draft|Build the next research brief/);
  // Same-document storage updates cannot submit another user's old draft under the new identity.
  await page.locator('#addTask').click();await page.locator('[name=title]').fill('Old account draft');const writesBefore=commits;await page.evaluate(()=>localStorage.setItem('dd-bozo-sess','u_demo.'+'x'.repeat(43)));await page.locator('#saveEdit').click();await page.locator('#editor').waitFor({state:'hidden'});assert.equal(commits,writesBefore);
  // Repeated hide/show while revalidation is in flight must not drop an in-memory draft.
  await page.locator('#addAgent').click();await page.locator('[name=name]').fill('Keep this repeated-switch draft');await visibility(true);
  let release,started;const startedPromise=new Promise(r=>started=r);heldRead={started,wait:new Promise(r=>release=r)};
  await visibility(false);await startedPromise;await visibility(true);release();await visibility(false);await page.locator('#editor[open]').waitFor();assert.equal(await page.locator('[name=name]').inputValue(),'Keep this repeated-switch draft');await page.locator('#closeEditor').click();
  const externalChange=fn=>{const row=db.get('/privatePounds/u_demo'),s=JSON.parse(row.payload);fn(s);s.revision++;row.payload=JSON.stringify(s);revision++;};
  // Restored edits retain their original revision instead of silently replacing another tab's work.
  await page.locator('#rosterDrawer').evaluate(d=>d.open=true);await page.locator('#roster button').first().click();await page.locator('[name=role]').fill('Stale owner edit');await visibility(true);externalChange(s=>s.agents[0].role='Changed in another tab');await visibility(false);await page.locator('#editor[open]').waitFor();await page.locator('#saveEdit').click();await page.locator('#editorError').filter({hasText:'Workspace changed'}).waitFor();assert.equal(JSON.parse(db.get('/privatePounds/u_demo').payload).agents[0].role,'Changed in another tab');await page.locator('#closeEditor').click();
  // An archived original thread must never rebind its unsent note to a fallback thread.
  await page.locator('#messageText').fill('This draft belongs to the original thread only');await visibility(true);
  externalChange(s=>{s.tasks[0].archived=true;s.tasks.push({id:'p_'+webcrypto.randomUUID(),title:'Other thread',body:'Other task',agent_id:'',status:'queued',archived:false});});
  await visibility(false);await page.getByText('Your draft belongs to an archived thread. Copy it before refreshing; it has not moved to another task.',{exact:true}).waitFor();assert.match(await page.locator('#taskDetail').textContent(),/Build the next research brief/);assert.equal(await page.locator('#messageText').inputValue(),'This draft belongs to the original thread only');await page.locator('#sendMessage').click();await page.locator('#status').filter({hasText:'Task is archived'}).waitFor();assert.ok(JSON.parse(db.get('/privatePounds/u_demo').payload).messages.every(m=>m.text!=='This draft belongs to the original thread only'));
  // Baseline header, same browser, same identity, same widths, rendered last so it cannot disturb the flow above.
  await page.goto(origin+'/dawg-pound.html');await page.locator('#workspace:not([hidden])').waitFor();
  const shapes={};for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(100);shapes[width]=await headerShape(page);headerHashes[width]=shapes[width].brand.slice(0,12)+'/'+shapes[width].account.slice(0,12);}
  await page.goto(origin+'/base/dawg-pound.html');await page.locator('#workspace:not([hidden])').waitFor();
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(100);const base=await headerShape(page),now=shapes[width],tag=width+'px vs '+BASE_REF.slice(0,7)+': ';
    assert.equal(now.label,'Dispatch ▾',tag+'switcher label');assert.equal(now.aria,'Switch app: Dispatch',tag+'switcher accessible name');assert.equal(base.label,'Dawg Pound ▾',tag+'baseline still renders the old label');
    for(const q of ['header.dd-shell','.dd-brand','.dd-account']){assert.ok(now.boxes[q].x>=0&&now.boxes[q].x+now.boxes[q].w<=width,tag+q+' inside viewport');}
    assert.ok(now.boxes['.dd-brand'].h>=44,tag+'brand target');assert.ok(now.boxes['.dd-account'].h>=44,tag+'account target');
    const a=now.boxes['.dd-apps > summary'],b=base.boxes['.dd-apps > summary'];assert.deepEqual([a.y,a.h,a.x+a.w],[b.y,b.h,b.x+b.w],tag+'switcher row, height and right edge');assert.ok(a.w>=44,tag+'switcher touch target');}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,headerHashes,checks:['signed-out','default screen: task summary and work; questions/context segmented; roster/diagnostics behind details','kind picker + allowlisted refs','task revision on edit','diagnostics reason codes','390/320 no overflow + composer visible','Work first at 390/320; secondary views explicit; unavailable fields labelled; tallies equal stored tasks','header remains in viewport with 44px brand/account targets; switcher alignment retained','owner workspace CRUD','truthful disconnected status','mobile no overflow','safe rendering','mobile draft suspension','uncertain commit replay','cross-account clearing','same-document identity change','repeated visibility during delayed revalidation','restored edit concurrency','archived thread draft binding'],screenshots:out,liveRequests:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
