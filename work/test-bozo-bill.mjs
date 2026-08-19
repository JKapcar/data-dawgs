/* work/test-bozo-bill.mjs — assertions for the Playbill/Slip build of bozo.html.
   Counts are printed so a dropped check is visible even on green. */
import {chromium} from 'playwright';
import {roster,leagues,state} from './test-bozo-fixtures.mjs';
import {chromiumExecutable} from './playwright-loader.mjs';
const CHROME=chromiumExecutable(chromium);   // repo convention: resolves the container path, or system Chrome/Edge
const tok=Buffer.from(JSON.stringify({n:'Kap',e:Date.now()+864e5})).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')+'.sig';
let pass=0, fail=0;
const ok=(c,m)=>{ c?pass++:(fail++,console.log('  ✗ '+m)); };

const b=await chromium.launch({executablePath:CHROME});
async function page({url='',lid='main',fix='main',w=1440,h=1000,theme='light',signedIn=true,rm=false}={}){
  const p=await b.newPage({viewport:{width:w,height:h},reducedMotion:rm?'reduce':'no-preference'});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.addInitScript(({tok,signedIn,theme})=>{
    if(signedIn) localStorage.setItem('dd-bozo-sess',tok);
    localStorage.setItem('dd-theme3',theme); localStorage.setItem('dd-theme3-bozo',theme);
    window.EventSource=class{constructor(){}addEventListener(){}close(){}};
  },{tok,signedIn,theme});
  await p.route('**/*',async r=>{const u=r.request().url();
    if(u.startsWith('file:')) return r.continue();
    if(u.includes('/league/list')) return r.fulfill({json:leagues});
    if(u.includes('/auth/roster')) return r.fulfill({json:roster});
    if(u.includes('firebaseio.com')){const m=u.match(/leagues\/([^.]+)\.json/);
      return r.fulfill({json:state[(m&&m[1]===lid)?fix:fix]||{}});}
    return r.fulfill({status:204,body:''});});
  await p.goto('file://'+process.cwd().replace(/\/work$/,'')+'/bozo.html'+url,{waitUntil:'load'});
  await p.waitForTimeout(1200);
  return {p,errs};
}

// ---- 1. the hub is the bill -------------------------------------------------
{
  const {p,errs}=await page();
  ok(errs.length===0,'hub: page errors '+errs.slice(0,2));
  ok(await p.locator('#hubCard.pb-bill').isVisible(),'hub: bill visible');
  ok(!(await p.locator('#bzHead').isVisible()),'hub: #bzHead stands down (no double wordmark)');
  ok((await p.locator('.pb-word').innerText()).trim().toUpperCase()==='BOZO','hub: wordmark');
  ok(await p.locator('#houseSlip .sl-tot').isVisible(),'hub: house ticket totals');
  ok((await p.locator('#hubList .hcard').count())===3,'hub: three stubs');
  // the data contract the delegated handlers read
  for(const a of ['data-open','data-title','data-rnerr'])
    ok((await p.locator(`#hubList [${a}]`).count())>=3,'hub: '+a+' preserved on every stub');
  ok((await p.locator('#hubList [data-rename]').count())===3,'hub: rename button per stub (admin)');
  ok((await p.locator('#hubList [data-del]').count())===2,'hub: delete on non-main only');
  // live figures come from state, not from copy
  const tot=await p.locator('#houseSlip .sl-tot').innerText();
  ok(/1\s*\/\s*8/.test(tot),'hub: legs-in reads 1/8 from state');
  ok(tot.includes('-245'),'hub: parlay price from the single live leg');
  ok((await p.locator('#pbStubBar').innerText()).includes('1 of 8 in'),'hub: pinned stub count');
  // honesty: every caveat present
  const fine=await p.locator('.pb-fine').innerText();
  for(const s of ['self-reported','simulation','not measured yet','invented','server'])
    ok(fine.toLowerCase().includes(s),'hub: small print carries "'+s+'"');
  ok((await p.locator('#houseSlip .sl-note').innerText()).includes('self-reported'),
     'hub: the slip itself repeats the self-reported caveat');
  // the stamp must never sit on the note
  const st=await p.locator('#houseSlip .stamp').boundingBox();
  const nt=await p.locator('#houseSlip .sl-note').boundingBox();
  ok(st.bottom===undefined ? (st.y+st.height <= nt.y+1) : true,'hub: stamp clears the note');
  await p.close();
}

// ---- 2. the riffle is a demonstration, and says so --------------------------
{
  const {p}=await page();
  ok((await p.locator('#riffleStrip .riffle-card').count())===4,'riffle: four cards');
  const before=await p.locator('#riffleStrip').innerText();
  let changed=false;
  for(let i=0;i<12 && !changed;i++){
    await p.click('#riffleGo'); await p.waitForTimeout(280);
    changed = (await p.locator('#riffleStrip').innerText()) !== before;
  }
  ok(changed,'riffle: the order actually changes');
  ok((await p.locator('#riffleNote').innerText()).toLowerCase().includes('demonstration'),
     'riffle: labelled a demonstration, not a preview');
  ok((await p.locator('#riffleStrip .riffle-card').count())===4,'riffle: still four after shuffling');
  await p.close();
}

// ---- 3. the stubs still navigate and still rename ---------------------------
{
  const {p}=await page();
  await p.click('#hubList .hcard[data-open="demo"] h3');   // click-through, not the button
  await p.waitForTimeout(400);
  ok(p.url().includes('l=demo'),'stub: opening a league still navigates');
  await p.close();
}
{
  const {p}=await page();
  await p.click('#hubList [data-rename="demo"]');
  await p.waitForTimeout(200);
  ok((await p.locator('#hubList input.rn').count())===1,'stub: inline rename still opens');
  await p.close();
}

// ---- 4. graded, empty and signed-out states --------------------------------
{
  const {p,errs}=await page({lid:'demo',fix:'demo'});
  ok(errs.length===0,'graded hub: no errors');
  ok((await p.locator('#houseSlip .stamp').innerText()).toLowerCase().includes('graded'),
     'graded hub: the stamp reads graded');
  await p.close();
}
{
  const {p,errs}=await page({signedIn:false});
  ok(errs.length===0,'signed out: no errors');
  ok(await p.locator('#houseSlip').isVisible(),'signed out: the board is still public');
  ok(!(await p.locator('#mkLeague').isVisible()),'signed out: no admin form');
  await p.close();
}

// ---- 5. the board is untouched where it must be ----------------------------
{
  const {p,errs}=await page({url:'?l=main',fix:'main5'});
  ok(errs.length===0,'board: no errors');
  ok(await p.locator('#bzHead').isVisible(),'board: the header is back');
  ok(!(await p.locator('#hubCard').isVisible()),'board: the bill is hidden');
  ok(await p.locator('#machine').isVisible(),'board: Machine v2 intact');
  ok((await p.locator('#reels .win').count())===4,'board: four reels');
  ok(await p.locator('#ticketCard').isVisible(),'board: the ticket still paints');
  ok(!(await p.locator('#pbStubBar').isVisible()),'board: no pinned hub stub');
  await p.close();
}

// ---- 6. reduced motion ------------------------------------------------------
{
  const {p}=await page({rm:true});
  const t=await p.evaluate(()=>getComputedStyle(document.querySelector('.riffle-card')).transitionDuration);
  ok(t==='0s','reduced motion: the riffle does not animate');
  await p.close();
}

// ---- 7. no storage, no network assets in the new surfaces ------------------
{
  const src=(await import('node:fs')).readFileSync(process.cwd().replace(/\/work$/,'')+'/bozo.html','utf8');
  const bill=src.slice(src.indexOf('THE PLAYBILL & THE SLIP'), src.indexOf('/* ---- editable settings ---- */'));
  ok(!/https?:\/\//.test(bill),'css: no network assets in the bill stylesheet');
  ok(!/localStorage|sessionStorage/.test(src.slice(src.indexOf('function paintHouseTicket'), src.indexOf('function paintRiffle'))),
     'js: the house ticket touches no storage');
}

await b.close();
console.log(`\n${pass} assertions passed, ${fail} failed`);
process.exit(fail?1:0);
