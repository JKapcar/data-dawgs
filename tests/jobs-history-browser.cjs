// End to end: the real page (jobs.html + jobs-core.js + jobs.js) against the real handler
// (work/jobs.js) with in-memory storage and a synthetic signed session. Run with NODE_PATH
// pointing at a local Playwright. Invented records only; no network leaves the test.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const origin='https://job-history.test',api='https://toto.jkapcar4.workers.dev/api/jobs/v1',token='u_owner.'+'x'.repeat(43),page_files=['jobs.html','jobs.css','jobs-core.js','jobs.js'];
function worker(){
 const db=new Map();let version=0;const env={RESEARCH_OWNER_UID:'u_owner',JOB_HARNESS_ENABLED:'true'};
 const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,ORIGINS:[origin],
  readSession:async(e,t)=>t===token?{u:'u_owner'}:null,sessionAuth:async r=>({uid:r.headers.get('X-Dawg-Session').split('.')[0]}),
  fbGet:async(e,p)=>({data:db.get(p)||null,etag:String(version)}),fbPut:async(e,p,v,etag)=>{if(etag!==String(version))return false;db.set(p,v);version++;return true;}};
 vm.createContext(context);vm.runInContext(['jobs-core.js','work/dawg-pound.js','work/jobs.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n')+'\nthis.handle=handleJobs;',context);
 const state=()=>JSON.parse(db.get('/privateJobs/v1/u_owner').payload);
 let n=0;// another tab, same account: goes through the handler like the page does
 const direct=async(op,data)=>{const s=db.get('/privateJobs/v1/u_owner')?state():{revision:0};const r=await context.handle(new Request(api,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({op,data,expected_revision:s.revision,request_id:'synthetic_other_tab_'+String(++n).padStart(4,'0')})}),env);const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b.receipt.id;};
 return {context,env,db,state,direct,row:id=>state().records.find(r=>r.id===id)};
}
const listing=(employer,key,req,role='Analyst')=>({employer_key:key,employer,role,requisition:req,url:'https://example.com/jobs/'+key,url_verified_at:'2026-01-02T12:00:00.000Z',resume_version:'synthetic-v1',next_action:'Review',blocker:''});
(async()=>{
 const w=worker(),posts=[];let drop=false,fail503=false,hold=null;
 const pine=await w.direct('record.create',listing('Pine Example Co','pine-example','PX-1'));
 await w.direct('event.append',{id:pine,stage:'approved',outcome:'none',occurred_at:'2026-01-03T12:00:00.000Z',verified_at:'2026-01-03T12:00:00.000Z',evidence_url:null,reason_kind:'unknown',reason:'',next_action:'Apply',blocker:'',resume_version:'synthetic-v1'});
 const spruce=await w.direct('record.create',listing('Spruce Example Co','spruce-example','SX-9','Engineer'));
 await w.direct('record.archive',{id:spruce,note:'Synthetic: paused'});
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog:'+d.message());d.dismiss();});
  await context.route('**/*',async route=>{const req=route.request(),url=req.url();
   if(url===api){const h=await req.allHeaders(),init={method:req.method(),headers:{}};for(const k of ['authorization','content-type','origin'])if(h[k])init.headers[k]=h[k];if(req.method()==='POST'){init.body=req.postData();posts.push(JSON.parse(init.body));}
    if(hold&&req.method()==='POST'){const gate=hold;hold=null;gate.started();await gate.released;}
    const res=await w.context.handle(new Request(api,init),w.env);if(drop&&req.method()==='POST'){drop=false;return route.abort('failed');} // committed, response lost
    if(fail503&&req.method()==='POST'){fail503=false;return route.fulfill({status:503,headers:Object.fromEntries(res.headers),body:JSON.stringify({error:'jobs_unavailable'})});} // committed, then storage call failed
    return route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:await res.text()});}
   if(url.startsWith(origin+'/')){const name=new URL(url).pathname.slice(1);if(page_files.includes(name))return route.fulfill({body:fs.readFileSync(name),contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'});}
   return route.abort();});
  const $=s=>page.locator(s),field=n=>page.locator(`#fields [name="${n}"]`),status=()=>$('#status').textContent(),error=()=>$('#error').textContent();
  const save=async expect=>{await $('#save').click();await page.waitForFunction(()=>!document.getElementById('save').disabled);if(expect==='ok')await page.waitForFunction(()=>!document.getElementById('editor').open);};
  const options=async n=>field(n).locator('option').evaluateAll(o=>o.map(x=>x.value));
  await page.goto(origin+'/jobs.html');await page.evaluate(t=>localStorage.setItem('dd-bozo-sess',t),token);await $('#refresh').click();await $('.job').first().waitFor();
  assert.equal(await $('.job').count(),1,'archived record hidden from the board');assert.equal(await $('#archivedCount').textContent(),'Archived (1)');

  // 1. a verified update: stage menu starts at the current stage, evidence becomes required
  await $('.job').click();await page.getByRole('button',{name:'Record verified update'}).click();
  assert.deepEqual(await options('stage'),['approved','prepared','submitted','interview','offer','closed'],'append cannot pick an earlier stage');
  await field('stage').selectOption('closed');assert.deepEqual(await options('outcome'),['','rejected','position_closed','withdrawn','accepted']);assert.equal(await field('outcome').inputValue(),'','closed never defaults to an outcome');
  await field('stage').selectOption('submitted');assert.deepEqual(await options('outcome'),['none','no_later_decision']);assert.equal(await field('outcome').inputValue(),'none');
  assert.match(await page.locator('label:has([name="evidence_url"])').textContent(),/required/);
  await field('evidence_url').fill('https://example.com/receipt/px-1');
  await field('occurred_at').fill('2026-01-04T12:00:28.123');await field('verified_at').fill('2026-01-04T12:01:29.456');await save('ok');
  assert.equal(w.row(pine).events[1].occurred_at,new Date('2026-01-04T12:00:28.123').toISOString(),'new receipts preserve entered seconds and milliseconds');
  assert.match(await status(),/Saved to your tracker · revision \d+\. Saving records evidence; it never submits anything to an employer\./);
  assert.match(await $('#detail').textContent(),/#2Submitted · No decision recorded/);assert.equal(w.row(pine).events.length,2);

  // 2. response lost after commit: Save again replays the same request; nothing doubles
  await page.getByRole('button',{name:'Record verified update'}).click();await field('stage').selectOption('submitted');await field('outcome').selectOption('no_later_decision');await field('evidence_url').fill('https://example.com/receipt/px-1');
  drop=true;await save();assert.match(await error(),/Could not confirm whether that saved/);assert.equal(w.row(pine).events.length,3,'first attempt committed');
  await save('ok');assert.match(await status(),/^Already saved · revision/);assert.equal(w.row(pine).events.length,3,'replay added nothing');
  const [lost,retry]=posts.slice(-2);assert.equal(lost.request_id,retry.request_id);assert.equal(lost.expected_revision,retry.expected_revision);

  // 3. another tab writes first: 409, fresh history loads under the open dialog, same key retried
  await page.getByRole('button',{name:'Record verified update'}).click();assert.equal(await field('outcome').inputValue(),'none','a new update does not inherit the previous outcome');await field('stage').selectOption('interview');await field('evidence_url').fill('https://example.com/receipt/px-1-interview');
  await w.direct('record.correct',{id:pine,changes:{role:'Senior Analyst'},note:'Synthetic: title changed'});
  await save();assert.match(await error(),/changed in another tab or device/);assert.equal(await $('#editor').evaluate(d=>d.open),true,'draft kept');
  assert.equal(await field('evidence_url').inputValue(),'https://example.com/receipt/px-1-interview');assert.match(await $('#detail h2').textContent(),/Senior Analyst/);
  await save('ok');const [stale,fresh]=posts.slice(-2);assert.equal(stale.request_id,fresh.request_id);assert.equal(fresh.expected_revision,stale.expected_revision+1);
  assert.deepEqual(w.row(pine).events.map(e=>e.kind||e.stage),['approved','submitted','submitted','record_correction','interview']);

  // 4. backdated update: refused with directions to the correction path
  await page.getByRole('button',{name:'Record verified update'}).click();await field('evidence_url').fill('https://example.com/receipt/old');await field('occurred_at').fill('2025-12-01T10:00');await save();
  assert.match(await error(),/dated before the latest one\. If an earlier update is wrong, use Correct/);await page.keyboard.press('Escape');

  // 5. correct #2: original kept, correction attributed, timeline uses the fix
  const original=structuredClone(w.row(pine).events[1]);
  await page.locator('#detail details').evaluate(e=>e.open=true);await page.getByRole('button',{name:'Correct #2'}).click();assert.equal(await page.locator('input[name="action"][value="replace"]').isChecked(),true);
  await field('evidence_url').fill('https://example.com/receipt/px-1-corrected');await field('note').fill('Receipt link pointed at the wrong email');await save('ok');
  const fix=w.row(pine).events.at(-1);assert.deepEqual(w.row(pine).events[1],original);assert.equal(fix.kind,'correction');assert.equal(fix.target,1);assert.equal(fix.replacement.occurred_at,original.occurred_at,'untouched time keeps exact milliseconds');
  const text=await $('#detail').textContent();assert.match(text,/#2Submitted · No decision recordedCorrected by #6/);assert.match(text,/#6Corrected #2Now: Submitted · No decision recorded/);assert.match(text,/Why: Receipt link pointed at the wrong email/);

  // 6. a non-submission entry cannot be corrected into a submission; void is offered
  await page.locator('#detail details').evaluate(e=>e.open=true);await page.getByRole('button',{name:'Correct #1'}).click();assert.deepEqual(await options('stage'),['opportunity','screened','approved','prepared','closed']);
  await page.locator('input[name="action"][value="void"]').check();assert.equal(await page.locator('fieldset.details').evaluate(f=>f.disabled),true);await page.keyboard.press('Escape');

  // 7. listing fix sends only the changed field
  await page.getByRole('button',{name:'Fix listing details'}).click();await field('requisition').fill('PX-1A');await field('note').fill('Requisition had a typo');await save('ok');
  assert.deepEqual(posts.at(-1).data.changes,{requisition:'PX-1A'});assert.match(await $('#detail').textContent(),/Requisition: PX-1 → PX-1A/);

  // 8. re-adding an archived requisition: refused, with a way to the archived record; restore it
  await $('#add').click();await field('employer').fill('Spruce Example Co');assert.equal(await field('employer_key').inputValue(),'spruce-example','existing key reused');
  for(const [n,v] of [['role','Engineer'],['requisition',' sx-9 '],['url','https://example.com/jobs/other']])await field(n).fill(v);await save();
  assert.match(await error(),/already tracked/);await $('#errorAction').click();
  assert.equal(await $('#filter').inputValue(),'archived');assert.match(await $('#detail h2').textContent(),/Spruce Example Co · EngineerArchived/);
  await page.getByRole('button',{name:'Restore record'}).click();await save('ok');assert.equal(w.state().records.find(r=>r.id===spruce).events.at(-1).kind,'restore');
  await $('#filter').selectOption('all');assert.equal(await $('.job').count(),2);

  // 9. archive keeps the history readable and offers restore
  await $('.job',).filter({hasText:'Pine Example Co'}).click();await page.getByRole('button',{name:'Archive'}).click();await save('ok');
  assert.ok(await page.getByRole('button',{name:'Restore record'}).isVisible());assert.equal(await $('#archivedCount').textContent(),'Archived (1)');assert.match(await $('#detail').textContent(),/#8Archived/);

  // 10. keyboard: open a card and an editor, Escape returns focus to the opener
  await $('.job').first().focus();await page.keyboard.press('Enter');const opener=page.getByRole('button',{name:'Record verified update'});await opener.focus();await page.keyboard.press('Enter');
  assert.equal(await $('#editor').evaluate(d=>d.open),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.textContent==='Record verified update');

  // 11. unsafe stored text renders inert, non-https links never become anchors
  const s=w.state(),hostile='<img src=x onerror="window.__jobsXss=1"><script>window.__jobsXss=2</script>';
  s.records.push({id:'synthetic-hostile',identity:'hostile|h-1',employer_key:'hostile',employer:hostile,role:hostile,requisition:'H-1',url:'javascript:window.__jobsXss=3',url_verified_at:'2026-01-02T12:00:00.000Z',resume_version:'',next_action:hostile,blocker:'',created_at:'2026-01-02T12:00:00.000Z',
   events:[{id:'synthetic-hostile',stage:'submitted',outcome:'none',occurred_at:'2026-01-03T12:00:00.000Z',verified_at:'2026-01-03T12:00:00.000Z',evidence_url:'data:text/html,<script>window.__jobsXss=4</script>',reason_kind:'explicit',reason:hostile,next_action:hostile,blocker:'',resume_version:'',recorded_at:'2026-01-03T12:00:00.000Z',actor_uid:'u_owner'},
    {kind:'correction',target:0,action:'replace',replacement:{stage:'submitted',outcome:'none',occurred_at:'2026-01-03T12:00:00.000Z',verified_at:'2026-01-03T12:00:00.000Z',evidence_url:'http://example.com/plain',reason_kind:'unknown',reason:'',next_action:hostile,blocker:'',resume_version:''},note:hostile,recorded_at:'2026-01-04T12:00:00.000Z',actor_uid:'u_owner'}]});
  s.revision++;w.db.set('/privateJobs/v1/u_owner',{owner_uid:'u_owner',payload:JSON.stringify(s)});
  await $('#refresh').click();await $('.job').filter({hasText:'<img'}).click();
  assert.equal(await page.evaluate(()=>window.__jobsXss),undefined);assert.equal(await page.locator('#board img, #detail img, #detail script').count(),0);
  assert.equal(await page.locator('#detail a[href^="javascript"], #detail a[href^="data"], #detail a[href^="http:"]').count(),0);assert.ok((await $('#detail').textContent()).includes('<img src=x'));

  // 12. mobile: the full history fits 390 and 320 without sideways scrolling
  await $('#filter').selectOption('archived');await $('.job').filter({hasText:'Pine'}).click();
  const out=path.resolve('..','evidence');fs.mkdirSync(out,{recursive:true});
  for(const width of [390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow at '+width);await page.screenshot({path:path.join(out,'jobs-history-'+width+'.png'),fullPage:true});}
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(out,'jobs-history-desktop.png'),fullPage:true});
  // 13–16 (review findings) on the restored Spruce record
  await page.setViewportSize({width:1280,height:900});await $('#filter').selectOption('all');await $('.job').filter({hasText:'Spruce Example Co'}).click();
  await page.getByRole('button',{name:'Record verified update'}).click();await field('stage').selectOption('submitted');await field('evidence_url').fill('https://example.com/receipt/sx-9');await save('ok');
  const sx=()=>w.state().records.find(r=>r.id===spruce),sxEvents=()=>sx().events.length;assert.equal(sxEvents(),3);
  // 13. a save in flight cannot be dismissed; a 503 after the write is reported as unconfirmed, and Save again replays
  await page.getByRole('button',{name:'Record verified update'}).click();await field('stage').selectOption('submitted');await field('outcome').selectOption('no_later_decision');await field('evidence_url').fill('https://example.com/receipt/sx-9');
  let started,released;const began=new Promise(r=>started=r);hold={started,released:new Promise(r=>released=r)};fail503=true;
  await $('#save').click();await began;await page.keyboard.press('Escape');
  assert.equal(await $('#editor').evaluate(d=>d.open),true,'Escape cannot close a save in flight');assert.equal(await $('#cancel').isDisabled(),true);
  released();await page.waitForFunction(()=>!document.getElementById('save').disabled);
  assert.match(await error(),/Could not confirm whether that saved/);assert.doesNotMatch(await error(),/setup pending|No data loaded/);assert.equal(sxEvents(),4,'the write had landed');
  await save('ok');assert.match(await status(),/^Already saved/);assert.equal(sxEvents(),4);
  // 14. downgrade by correction; the stage menu then refuses submission stages, and restore is offered
  await page.locator('#detail details').evaluate(e=>e.open=true);await page.getByRole('button',{name:'Correct #3'}).click();await field('stage').selectOption('approved');await field('outcome').selectOption('blocked_not_submitted');await field('blocker').fill('Portal timed out');await field('note').fill('The upload failed');await save('ok');
  await page.locator('#detail details').evaluate(e=>e.open=true);await page.getByRole('button',{name:'Correct #3'}).click();
  assert.deepEqual(await options('stage'),['opportunity','screened','approved','prepared','closed'],'no re-upgrade through a correction');
  const restore=page.locator('input[name="action"][value="restore"]');assert.equal(await restore.count(),1);await restore.check();
  assert.equal(await page.locator('fieldset.details').evaluate(f=>f.disabled),true);await field('note').fill('The upload had gone through after all');await save('ok');
  const back=sx().events.at(-1);assert.equal(back.kind,'correction');assert.deepEqual(back.replacement,Object.fromEntries(Object.entries(sx().events[2]).filter(([k])=>['stage','outcome','occurred_at','verified_at','evidence_url','reason_kind','reason','next_action','blocker','resume_version'].includes(k))),'restore sends the original entry exactly');
  // 15. a listing fix after a 409 sends only what this tab changed; the other tab's edit survives
  await page.getByRole('button',{name:'Fix listing details'}).click();await field('requisition').fill('SX-9B');await field('note').fill('Requisition suffix was missing');
  await w.direct('record.correct',{id:spruce,changes:{role:'Lead Engineer'},note:'Synthetic: other tab'});
  await save();assert.match(await error(),/changed in another tab/);
  assert.equal(await field('role').inputValue(),'Lead Engineer','untouched field shows the refreshed value');assert.equal(await field('requisition').inputValue(),'SX-9B');
  await save('ok');const [conflicted,applied]=posts.slice(-2);assert.equal(conflicted.request_id,applied.request_id);assert.deepEqual(applied.data.changes,{requisition:'SX-9B'});
  assert.equal(sx().role,'Lead Engineer');assert.equal(sx().requisition,'SX-9B');
  assert.deepEqual(errors,[]);
  // Owner-scoped claims and preparation are real stored operations, not online-agent badges.
  await page.getByRole('button',{name:'Claim work',exact:true}).click();await field('actor_label').fill('Synthetic helper');await save('ok');
  assert.match(await $('#detail').textContent(),/self-reported label/);
  await page.getByRole('button',{name:'Work details',exact:true}).click();await field('resume_version').fill('synthetic-v2');await field('resume_sha256').fill('b'.repeat(64));await field('answers_provenance').fill('Synthetic owner reference');await field('deadline').fill('2026-01-01T12:00:00.000Z');await save('ok');
  assert.equal(sx().events.at(-1).details.resume_sha256,'b'.repeat(64));
  await page.getByRole('button',{name:'Release claim',exact:true}).click();await field('note').fill('Synthetic work complete');await save('ok');assert.equal(sx().events.at(-1).kind,'release');
  assert.match(await $('#summary').textContent(),/evidence-backed submissions/);
  console.log('PASS: real handler end to end — staged update menus, required evidence, lost-response replay (no duplicate), 409 refresh keeps draft and key, backdated refusal, correction keeps original, no correction into submission, listing fix diff, archived duplicate → open → restore, archive, keyboard focus return, inert hostile text and links, 390/320 history layout; in-flight dialog lock, 503-after-commit reported as unconfirmed then replayed, no re-upgrade by correction, exact restore, post-409 listing fix sends only its own change.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
