// Two synthetic members in one tab, against the real handler with in-memory storage. A slow
// response for the first account must never paint over the second. Run with NODE_PATH pointing
// at a local Playwright. Invented records only; no network leaves the test.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const origin='https://job-members.test',api='https://toto.jkapcar4.workers.dev/api/jobs/v1',files=['jobs.html','jobs.css','jobs-core.js','jobs.js'];
const tokenOf=u=>u+'.'+'x'.repeat(43),A='u_member_a',B='u_member_b',markA='SYNTHETIC_MEMBER_A_MARKER',markB='SYNTHETIC_MEMBER_B_MARKER';
function worker(){
 const db=new Map(),etags=new Map(),env={RESEARCH_OWNER_UID:'u_owner',JOB_HARNESS_ENABLED:'true',JOB_HARNESS_MEMBER_UIDS:A+','+B};
 const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,Date,ORIGINS:[origin],
  readSession:async(e,t)=>[A,B].map(tokenOf).includes(t)?{u:t.split('.')[0]}:null,sessionAuth:async r=>({uid:r.headers.get('X-Dawg-Session').split('.')[0]}),
  fbGet:async(e,p)=>({data:db.get(p)||null,etag:String(etags.get(p)||0)}),fbPut:async(e,p,v,etag)=>{if(etag!==String(etags.get(p)||0))return false;db.set(p,v);etags.set(p,(etags.get(p)||0)+1);return true;}};
 vm.createContext(context);vm.runInContext(['jobs-core.js','work/dawg-pound.js','work/jobs.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n')+'\nthis.handle=handleJobs;',context);
 const create=async(user,mark)=>{const r=await context.handle(new Request(api,{method:'POST',headers:{Authorization:'Bearer '+tokenOf(user),'Content-Type':'application/json',Origin:origin},body:JSON.stringify({op:'record.create',expected_revision:0,request_id:'synthetic_seed_'+user,data:{employer_key:'synthetic-co',employer:mark,role:'Analyst',requisition:'SAME-1',url:'https://example.com/jobs/1',url_verified_at:'2026-01-02T12:00:00.000Z',resume_version:'',next_action:mark,blocker:''}})}),env);assert.equal(r.status,200);};
 return {context,env,create};
}
(async()=>{
 const w=worker();await w.create(A,markA);await w.create(B,markB);
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),logs=[],seen=[];let hold=null;
  context.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push(e.message));
  await context.route('**/*',async route=>{const req=route.request(),url=req.url();
   if(url===api){const h=await req.allHeaders(),init={method:req.method(),headers:{}};for(const k of ['authorization','content-type','origin'])if(h[k])init.headers[k]=h[k];if(req.method()==='POST')init.body=req.postData();
    const res=await w.context.handle(new Request(api,init),w.env),body=await res.text();
    if(hold&&h.authorization==='Bearer '+tokenOf(A)){const gate=hold;hold=null;gate.started();await gate.released;}
    seen.push(h.authorization);return route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body});}
   if(url.startsWith(origin+'/')){const name=new URL(url).pathname.slice(1);if(files.includes(name))return route.fulfill({body:fs.readFileSync(name),contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'});}
   return route.abort();});
  const as=async user=>page.evaluate(t=>localStorage.setItem('dd-bozo-sess',t),tokenOf(user));
  const text=()=>page.locator('body').textContent();
  await page.goto(origin+'/jobs.html');
  await as(A);await page.locator('#refresh').click();await page.getByText(markA,{exact:true}).first().waitFor();
  assert.match(await page.locator('#disclaimer').textContent(),/yours alone in this app/);assert.ok(!(await text()).includes(markB));
  // A's next response is slow; the account switches to B before it lands.
  let started,released;const began=new Promise(r=>started=r);hold={started,released:new Promise(r=>released=r)};
  await page.locator('#refresh').click();await began;
  await as(B);await page.waitForFunction(()=>!document.querySelector('.job'));          // same-tab change clears A
  await page.locator('#refresh').click();await page.getByText(markB,{exact:true}).first().waitFor();
  released();await page.waitForTimeout(300);
  const after=await text();assert.ok(after.includes(markB));assert.ok(!after.includes(markA),'stale response for A never repaints');
  assert.equal(await page.locator('.job').count(),1,'B sees only B; same requisition, no cross-member dedup');
  assert.ok(!(await page.evaluate(()=>window.DD_BOTCTX.ctx())).includes(markB));
  const persistence=await page.evaluate(async()=>({storage:Object.keys(localStorage),caches:await caches.keys()}));assert.deepEqual(persistence,{storage:['dd-bozo-sess'],caches:[]});
  assert.ok(logs.every(s=>!s.includes(markA)&&!s.includes(markB)),JSON.stringify(logs));
  await page.locator('#lock').click();await page.waitForFunction(()=>!document.querySelector('.job'));assert.ok(!(await text()).includes(markB));
  assert.match(await page.locator('#disclaimer').textContent(),/Friends cannot access this workspace/,'lock restores the signed-out copy');
  console.log('PASS: two members in one tab — each sees only their own workspace, member disclosure shown, a slow response for the previous account never repaints, no cross-member dedup, nothing in assistant context, storage or cache; lock clears.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
