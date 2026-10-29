// Synthetic isolated panel harness. Actual HTML, CSS and controller from bozo.html;
// no production session, external request, league write or quote provider is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=fs.readFileSync(path.join(__dirname,'../bozo.html'),'utf8');
const panel=source.match(/<section class="card" id="ownerRepairCard"[\s\S]*?<\/section>/)[0];
const css=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[0]).join('\n');
const controller=source.slice(source.indexOf('function ownerRepairPending(){'),source.indexOf('/* ---------------- the ticket, as a parlay slip'));
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<main class="bz" style="padding:16px;max-width:900px;margin:auto">${panel}<div id="adminActions"></div></main><script>
let ME={session:'synthetic-session'},LID='main',ownerRepairSession=null,ownerRepairAllowed=false,ownerRepairBusy=false;
let S={status:'placed',week:8,members:{u_member:{name:'Synthetic Member'}},picks:{u_member:{mkt:'spread',label:'AAA -4',price:-175,line:4,submissionId:'old'}},admin:{actions:{}}};
const memberLabel=k=>S.members[k].name;
const esc=s=>String(s??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const when=ts=>new Date(ts).toISOString();
async function wGet(p){const r=await fetch(p);if(!r.ok)throw new Error('Denied');return r.json();}
async function wPost(p,b){const r=await fetch(p,{method:'POST',body:JSON.stringify({league:LID,...b})});const j=await r.json();if(!r.ok)throw new Error(j.error);return j;}
async function refresh(){const j=await wGet('/synthetic-state');S.admin=j;paintAdminActions();paintOwnerRepair();}
${controller}
paintOwnerRepair();refresh();</script>`;
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    const errors=[],sent=[];let allowed=true,actions={},lost=false,writes=0;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!=='http://owner-repair.test')throw new Error('Unexpected external request '+url);
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
      if(url.pathname==='/synthetic-state')return route.fulfill({json:{actions}});
      if(url.pathname==='/bozo/owner-repair'){
        if(!allowed)return route.fulfill({status:403,json:{error:'Owner required'}});
        if(req.method()==='GET')return route.fulfill({json:{ownerRepair:true}});
        const body=req.postDataJSON();sent.push(body);
        if(!body.confirm)return route.fulfill({json:{confirm_code:'synthetic-confirmation',expiresAt:Date.now()+300000,
          echo:'OWNER RULING: AAA -4 at -175 → AAA +3.5 at -202. New confirmation time; Last In may change. Unverified; original ledger retained.'}});
        if(!actions.ruling){writes++;actions.ruling={type:'owner_pick_ruling',week:8,ts:Date.now(),byName:'Synthetic Owner',forName:'Synthetic Member',reason:'Correct synthetic line',timestampMode:'confirm_time',before:{label:'AAA -4',price:-175},after:{label:'AAA +3.5',price:-202,ownerRuling:{observedAt:null,evidenceReference:'Owner decision <script>bad()</script>'}}};}
        if(lost)return route.fulfill({status:502,json:{error:'Outcome uncertain; retry same code.'}});
        return route.fulfill({json:{status:'owner_repaired',correctionId:'ruling'}});
      }
      return route.abort();
    });
    await page.goto('http://owner-repair.test/');await page.locator('#ownerRepairCard').waitFor({state:'visible'});
    assert.equal(await page.locator('#ownerRepairLine').inputValue(),'-4','stored required margin renders as posted handicap');
    await page.locator('#ownerRepairLine').fill('3.5');await page.locator('#ownerRepairPrice').fill('-202');
    await page.locator('#ownerRepairTime').selectOption('confirm_time');await page.locator('#ownerRepairReason').fill('Correct synthetic line');
    await page.locator('#ownerRepairEvidence').fill('Synthetic owner ruling');await page.locator('#ownerRepairPreview').click();
    await page.locator('#ownerRepairConfirm').waitFor({state:'visible'});
    assert.equal(writes,0);assert.equal(await page.locator('#ownerRepairLine').isDisabled(),true);
    assert.equal(sent[0].line,3.5);assert.equal(sent[0].price,-202);assert.equal(sent[0].observedAt,null);
    await page.reload();await page.locator('#ownerRepairConfirm').waitFor({state:'visible'});
    assert.equal(await page.locator('#ownerRepairLine').inputValue(),'3.5');assert.equal(await page.locator('#ownerRepairTime').inputValue(),'confirm_time');
    const overflow=await page.locator('#ownerRepairCard').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));assert(overflow.scroll<=overflow.width,'panel overflow '+JSON.stringify(overflow));
    if(process.env.OWNER_REPAIR_PREVIEW){fs.mkdirSync(process.env.OWNER_REPAIR_PREVIEW,{recursive:true});await page.locator('#ownerRepairCard').screenshot({path:path.join(process.env.OWNER_REPAIR_PREVIEW,'owner-repair-mobile.png')});}
    // Lost response and reload: retry the exact same confirmation, never a new edit.
    lost=true;await page.locator('#ownerRepairConfirm').click();await page.getByText('Outcome uncertain; retry same code.').waitFor();assert.equal(writes,1);
    await page.reload();await page.locator('#ownerRepairConfirm').waitFor({state:'visible'});lost=false;
    await page.locator('#ownerRepairConfirm').click();await page.getByText(/Owner ruling saved/).waitFor();assert.equal(writes,1);
    assert.deepEqual(sent.at(-1),{league:'main',forUid:'u_member',confirm:'synthetic-confirmation'});
    assert.equal(await page.locator('#ownerRepairConfirm').isVisible(),false);
    await page.reload();await page.getByText(/Original ledger retained; automatic no-vig CLV unavailable/).waitFor();
    assert.match(await page.locator('#adminActions').innerText(),/Owner decision <script>bad\(\)<\/script>/);assert.equal(await page.locator('#adminActions script').count(),0);
    await page.setViewportSize({width:1280,height:900});
    if(process.env.OWNER_REPAIR_PREVIEW)await page.screenshot({path:path.join(process.env.OWNER_REPAIR_PREVIEW,'owner-repair-desktop.png'),fullPage:true});
    allowed=false;await page.reload();await page.waitForLoadState('networkidle');assert.equal(await page.locator('#ownerRepairCard').isVisible(),false);
    assert.deepEqual(errors,[]);console.log('PASS: panel preview, mobile fit, reload recovery, lost-response replay, durable escaped audit, unauthorized hidden; no external requests.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
