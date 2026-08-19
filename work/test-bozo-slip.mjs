/* work/test-bozo-slip.mjs — the shared DraftKings betslip link.

   Three surfaces, because the feature has three trust boundaries and each one can
   fail on its own:
     1. the Worker's validator, run against its REAL source (not a copy)
     2. the rollover contract in bozoNext, asserted at source level
     3. the page, in a browser, including what it does with a TAMPERED value

   Counts are printed so a dropped check is visible even on green. */
import fs from 'fs';
import {chromium} from 'playwright';
import {roster,leagues,state} from './test-bozo-fixtures.mjs';
import {chromiumExecutable} from './playwright-loader.mjs';

const ROOT = process.cwd().replace(/[\\/]work$/,'');
const CHROME = chromiumExecutable(chromium);
let pass=0, fail=0;
const ok=(c,m)=>{ c?pass++:(fail++,console.log('  ✗ '+m)); };

/* ========================================================================
   1 · the Worker's validator, lifted out of the real file
   ======================================================================== */
const wk = fs.readFileSync(ROOT+'/dawg-bot-worker.js','utf8');
{
  const a = wk.indexOf('const DK_SHARE_HOSTS');
  const b = wk.indexOf('\n}', wk.indexOf('function dkSlipUrl(')) + 2;
  ok(a>0 && b>a, 'worker: dkSlipUrl block found in source');
  const dkSlipUrl = new Function(wk.slice(a,b) + '\nreturn dkSlipUrl;')();

  const good = u => { const r=dkSlipUrl(u); ok(!r.err, 'worker: accepts '+u+(r.err?' — got "'+r.err+'"':'')); return r; };
  const bad  = (u,why) => { const r=dkSlipUrl(u); ok(!!r.err, 'worker: rejects '+why); return r; };

  const r1 = good('https://sportsbook.draftkings.com/event/12345?slip=abc');
  ok(r1.host==='sportsbook.draftkings.com','worker: reports the host it accepted');
  good('https://draftkings.com/promo');
  good('https://DraftKings.com/PROMO');            // host case is normalised
  good('https://dksb.sng.link/A/b?_dl=deep');      // the pinned app share host

  bad('https://evil.com/x','a non-DK host');
  ok(/evil\.com/.test(dkSlipUrl('https://evil.com/x').err),
     'worker: the rejection NAMES the host, so a wrong guess is self-correcting');
  bad('https://notdraftkings.com/x','a lookalike registrable domain');
  bad('https://draftkings.com.evil.com/x','a suffix-shaped impostor');
  bad('https://sng.link/x','the bare shortener (subdomain scoping holds)');
  bad('http://sportsbook.draftkings.com/x','plain http');
  bad('https://u:p@sportsbook.draftkings.com/x','a URL carrying credentials');
  bad('javascript:alert(1)','a javascript: URL');
  bad('data:text/html,<b>hi','a data: URL');
  bad('','an empty string');
  bad('not a link','unparseable text');
  bad(42,'a non-string');
  bad('https://sportsbook.draftkings.com/'+'x'.repeat(700),'an over-long link');
}

/* ========================================================================
   2 · the rollover contract — the trap this feature is most likely to hit
   ======================================================================== */
{
  const nx = wk.slice(wk.indexOf('async function bozoNext'), wk.indexOf('async function bozoNext')+2600);
  ok(/history\.push\(\{[^}]*slip: state\.slip \|\| null/.test(nx),
     'rollover: the link is archived into the history row (kept on a graded week)');
  ok(/picks: null[\s\S]{0,600}?\bslip: null,/.test(nx),
     'rollover: slip is nulled BY NAME, so it cannot leak into the new week');
  ok(wk.includes('async function requireMember'),'worker: requireMember exists');
  ok(/if \(url\.pathname === "\/league\/slip"\)/.test(wk),'worker: /league/slip is routed');
  // the route must not be manager-gated — that was the whole design decision
  const rt = wk.slice(wk.indexOf('async function leagueSlip'), wk.indexOf('async function leagueSlip')+1800);
  ok(rt.includes('requireMember(request, env, lid)'),'route: gated on membership, not management');
  ok(!rt.includes('requireManager'),'route: never falls back to requireManager');
  ok(/=== "graded"/.test(rt),'route: refuses to rewrite a graded week');
  ok(/by: auth\.name/.test(rt),'route: attribution comes from the session, not the body');
}

/* ========================================================================
   3 · the page
   ======================================================================== */
const DK = 'https://sportsbook.draftkings.com/event/12345?slip=abc';
const clone = o => JSON.parse(JSON.stringify(o));
const S = {};
S.none    = clone(state.main);
S.live    = Object.assign(clone(state.main),
              {slip:{url:DK, host:'sportsbook.draftkings.com', by:'Tony', ts:1786661665821}});
S.graded  = Object.assign(clone(state.demo),
              {slip:{url:DK, host:'sportsbook.draftkings.com', by:'Tony', ts:1786661665821}});
// what a tampered RTDB node looks like — the page must refuse both of these
S.evil    = Object.assign(clone(state.main),
              {slip:{url:'https://evil.com/drain', host:'sportsbook.draftkings.com', by:'Tony', ts:1}});
S.jsurl   = Object.assign(clone(state.main),
              {slip:{url:'javascript:alert(1)', host:'sportsbook.draftkings.com', by:'Tony', ts:1}});

const tokFor = n => Buffer.from(JSON.stringify({n, e:Date.now()+864e5})).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')+'.sig';

const b = await chromium.launch({executablePath:CHROME});
async function page({url='?l=main', fix='none', who='Kap', signedIn=true, w=1440, h=1100}={}){
  const p = await b.newPage({viewport:{width:w,height:h}});
  const errs=[], posts=[];
  p.on('pageerror',e=>errs.push(String(e)));
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
  await p.addInitScript(({tok,signedIn})=>{
    if(signedIn) localStorage.setItem('dd-bozo-sess',tok);
    localStorage.setItem('dd-theme3','light'); localStorage.setItem('dd-theme3-bozo','light');
    window.EventSource=class{constructor(){}addEventListener(){}close(){}};
  },{tok:tokFor(who),signedIn});
  await p.route('**/*', async r=>{
    const u=r.request().url();
    if(u.startsWith('file:')) return r.continue();
    if(u.includes('/league/slip')){ posts.push(JSON.parse(r.request().postData()||'{}'));
      return r.fulfill({json:{ok:true}}); }
    if(u.includes('/league/list')) return r.fulfill({json:leagues});
    if(u.includes('/auth/roster')) return r.fulfill({json:roster});
    if(u.includes('firebaseio.com')) return r.fulfill({json:S[fix]||{}});
    return r.fulfill({status:204,body:''});
  });
  await p.goto('file://'+ROOT+'/bozo.html'+url,{waitUntil:'load'});
  await p.waitForTimeout(1300);
  return {p,errs,posts};
}

// ---- a member, nothing posted yet -------------------------------------------
{
  const {p,errs} = await page({fix:'none'});
  ok(errs.length===0,'none: no page errors '+errs.slice(0,2));
  ok(await p.locator('#slipBar').isVisible(),'none: the bar is on the board');
  ok(await p.locator('#slipBar [data-slip="add"]').isVisible(),'none: a member is offered "Add the link"');
  // placement is the requirement: at the TOP of the ticket, above the slip
  const order = await p.evaluate(()=>{
    const bar=document.getElementById('slipBar'), bd=document.getElementById('board');
    return bar.compareDocumentPosition(bd) & Node.DOCUMENT_POSITION_FOLLOWING ? 'above' : 'below';
  });
  ok(order==='above','none: the bar sits ABOVE the slip, inside the ticket card');
  ok((await p.locator('#ticketCard #slipBar').count())===1,'none: it is inside #ticketCard');
  await p.close();
}

// ---- a link is up ------------------------------------------------------------
{
  const {p,errs} = await page({fix:'live'});
  ok(errs.length===0,'live: no page errors '+errs.slice(0,2));
  const a = p.locator('#slipBar a.sb-go');
  ok(await a.isVisible(),'live: the button is rendered');
  ok((await a.getAttribute('href'))===DK,'live: href is the posted link');
  ok((await a.getAttribute('target'))==='_blank','live: opens in a new tab');
  const rel = (await a.getAttribute('rel'))||'';
  ok(/noopener/.test(rel) && /noreferrer/.test(rel),'live: rel carries noopener AND noreferrer');
  const meta = await p.locator('#slipBar .sb-meta').innerText();
  ok(meta.includes('sportsbook.draftkings.com'),'live: the destination host is printed before the click');
  ok(meta.includes('Tony'),'live: attribution names who posted it');
  ok(await p.locator('#slipBar [data-slip="clear"]').isVisible(),'live: a member can remove it');
  ok(await p.locator('#slipBar [data-slip="add"]').isVisible(),'live: a member can replace it');
  await p.close();
}

// ---- somebody outside the league --------------------------------------------
{
  const {p} = await page({fix:'live', who:'Stranger'});
  ok(await p.locator('#slipBar a.sb-go').isVisible(),'outsider: can still open the link');
  ok((await p.locator('#slipBar [data-slip="add"]').count())===0,'outsider: is offered no controls');
  ok((await p.locator('#slipBar [data-slip="clear"]').count())===0,'outsider: cannot remove it');
  await p.close();
}
{
  const {p} = await page({fix:'none', signedIn:false});
  ok((await p.locator('#slipBar [data-slip="add"]').count())===0,'signed out: no post control');
  ok((await p.locator('#slipBar .sb-quiet').innerText()).length>0,'signed out: says why the space is empty');
  await p.close();
}

// ---- a graded week is a receipt ---------------------------------------------
{
  const {p} = await page({url:'?l=demo', fix:'graded'});
  ok(await p.locator('#slipBar a.sb-go').isVisible(),'graded: the link is still readable');
  ok((await p.locator('#slipBar [data-slip="add"]').count())===0,'graded: nobody can replace it');
  ok((await p.locator('#slipBar [data-slip="clear"]').count())===0,'graded: nobody can remove it');
  await p.close();
}

// ---- a TAMPERED node. The page checks the host itself. ----------------------
for(const [fix,what] of [['evil','a non-DK host'],['jsurl','a javascript: URL']]){
  const {p,errs} = await page({fix});
  ok((await p.locator('#slipBar a.sb-go').count())===0,
     'tampered ('+what+'): NOT rendered as a link, despite a well-formed host field');
  const html = await p.locator('#slipBar').innerHTML();
  ok(!/evil\.com|javascript:/.test(html),'tampered ('+what+'): the value never reaches the DOM');
  ok(errs.length===0,'tampered ('+what+'): no page errors');
  await p.close();
}

// ---- the client refuses the common mistake without a round trip -------------
{
  const {p,posts} = await page({fix:'none'});
  await p.locator('#slipBar [data-slip="add"]').click();
  await p.locator('#slipUrl').fill('https://bet365.com/parlay/9');
  await p.locator('#slipBar [data-slip="save"]').click();
  await p.waitForTimeout(400);
  // ⚠️ Read it defensively. If the refusal path is ever removed the bar repaints
  // and #slipErr stops existing — a strict read would THROW and kill the run,
  // turning a precise red into "the suite died". Ask for a named failure instead.
  const err = await p.locator('#slipErr').innerText().catch(()=>'');
  ok(/bet365\.com/.test(err),'client: names the host it refused');
  ok(/DraftKings/i.test(err),'client: says what it wanted instead');
  ok(posts.length===0,'client: refused it locally — no request was sent');
  await p.close();
}

// ---- and it does send a good one --------------------------------------------
{
  const {p,posts} = await page({fix:'none'});
  await p.locator('#slipBar [data-slip="add"]').click();
  await p.locator('#slipUrl').fill(DK);
  await p.locator('#slipBar [data-slip="save"]').click();
  await p.waitForTimeout(600);
  ok(posts.length===1,'client: a valid link is posted once');
  ok(posts[0] && posts[0].url===DK,'client: sends the url it was given');
  ok(posts[0] && posts[0].league==='main','client: scoped to the open league');
  await p.close();
}

// ---- the hub carries it, read-only ------------------------------------------
{
  const {p,errs} = await page({url:'', fix:'live'});
  ok(errs.length===0,'hub: no page errors '+errs.slice(0,2));
  const a = p.locator('#houseSlip .sl-slip a');
  ok(await a.isVisible(),'hub: the house ticket shows the link');
  ok((await a.getAttribute('href'))===DK,'hub: same destination');
  ok(/noopener/.test((await a.getAttribute('rel'))||''),'hub: rel carries noopener');
  ok((await p.locator('#houseSlip [data-slip]').count())===0,'hub: read-only — no controls there');
  await p.close();
}
{
  const {p} = await page({url:'', fix:'none'});
  ok((await p.locator('#houseSlip .sl-slip').count())===0,'hub: prints nothing when no link is posted');
  await p.close();
}

await b.close();
console.log(`\n${pass} assertions passed, ${fail} failed`);
process.exit(fail?1:0);
