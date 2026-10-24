/* DFS SHOWDOWN in a real browser: signed out on the invented demo slate, then signed in
   against the REAL Worker code (in memory, Firebase replaced by a map) with synthetic
   workspaces, so the page is tested against the actual list/get response shapes.
   ⚠️ Synthetic data only. No paid or private slate may ever be a fixture in this repo. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const SD = require('../dfs-showdown.js');
const root = path.join(__dirname, '..'), out = process.env.DFS_SHOWDOWN_PREVIEW || path.join(root, 'work/artifacts/dfs-showdown');

const source = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8').replace(/^import .*;$/m, 'const BOZO_ESPN_TEAM_SEED={};').replace('export class DiscordMentionGateway','class DiscordMentionGateway').replace('export default', 'const worker=');
const context = vm.createContext({ console, Date, URL, Response, Request, Headers, TextEncoder, TextDecoder, crypto: globalThis.crypto, AbortController, setTimeout, clearTimeout });
vm.runInContext(source + `\nglobalThis.api={run:dfsRun};fbGet=async(e,p)=>({data:e.rows[p]||(p.split('/').length===4?Object.fromEntries(Object.entries(e.rows).filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>[k.slice(p.length+1),v])):null),etag:String(e.versions[p]||0)});fbPut=async(e,p,v,t)=>{if(String(e.versions[p]||0)!==t)return false;e.rows[p]=JSON.parse(JSON.stringify(v));e.versions[p]=(e.versions[p]||0)+1;return true;};`, context);
const env = { rows: {}, versions: {} }, caller = { kind: 'user', uid: 'synthetic-showdown-user' };
const rowPath = id => '/users/' + caller.uid + '/dfsWorkspaces/' + id;

// Synthetic pool: the invented demo slate, every name tagged so a leak is greppable.
const demo = SD.demoSlate();
const players = demo.players.map((p, i) => ({ ...p, id: 'syn-' + i, name: 'SYNTH ' + p.name, dkId: String(5000 + i), cptId: String(6000 + i) }));
const at = n => demo.players.findIndex(p => p.name === n);
const legal = [at('Quinn Delacroix'), at('Rowan Vance'), at('Nico Albrecht'), at('Hollis Wren'), at('Jalen Pryor'), at('Tobin Reyes')];
const overCap = [at('Malik Ostrander'), at('Rowan Vance'), at('Ellis Marlow'), at('Tobin Reyes'), at('Reggie Calloway'), at('Sterling Abara')];
const lineups = demo.entries.map(e => ({ ids: e.ids.slice(), cpt: e.cpt })).concat([{ ids: legal, cpt: legal[0] }, { ids: overCap, cpt: overCap[0] }]);

const server = http.createServer((q, r) => {
  const f = path.resolve(root, '.' + decodeURIComponent(new URL(q.url, 'http://localhost').pathname));
  if (!f.startsWith(root + path.sep)) return r.writeHead(403).end();
  try { r.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html'); r.end(fs.readFileSync(f)); } catch { r.writeHead(404).end(); }
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
  try {
    // two synthetic Showdown workspaces and one Classic one the page must ignore
    for (const [id, site] of [['synthetic-sd-lineups', 'dk_showdown'], ['synthetic-sd-portfolio', 'dk_showdown'], ['synthetic-classic', 'dk_classic']]) {
      await context.api.run('create', { workspace_id: id, site, source: 'Synthetic ' + id, as_of: '2026-10-12T18:00:00Z' }, env, caller);
    }
    Object.assign(env.rows[rowPath('synthetic-sd-lineups')], { players, lineups, updated_at: '2026-10-12T19:00:00Z' });
    const portfolio = {
      version: 1, site: 'dk_showdown', synthetic: true, capturedAt: '2026-10-12T20:00:00Z', source: { name: 'Synthetic portfolio', asOf: null, version: 't1' },
      players: players.map(p => ({ id: p.id, name: p.name, pos: p.pos, team: p.team, opp: p.opp, sal: p.sal, proj: p.proj, own: p.own, cptOwn: p.cptOwn })),
      entries: [
        { ids: demo.entries[0].ids, cpt: demo.entries[0].cpt, slots: ['CPT', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'FLEX'], fee: 20, lifecycle: 'entered', contestId: 'c-se', history: [] },
        { ids: demo.entries[2].ids, cpt: demo.entries[2].cpt, slots: ['CPT', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'FLEX'], fee: 3, lifecycle: 'entered', contestId: 'c-mme', history: [] },
        { ids: demo.entries[3].ids, cpt: demo.entries[3].cpt, slots: ['CPT', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'FLEX'], fee: 5, lifecycle: 'proposed', contestId: 'c-se', history: [] }],
      contests: [{ id: 'c-se', name: 'Synthetic single entry', source: 'Invented lobby', asOf: null, fieldSize: 2378, entryLimit: 1, fee: 20, payouts: [] },
        { id: 'c-mme', name: 'Synthetic max entry', source: 'Invented lobby', asOf: null, fieldSize: 1500, entryLimit: 150, fee: 3, payouts: [] }],
      notes: [], availabilityEvidence: null, scenarios: [], recommendations: []
    };
    Object.assign(env.rows[rowPath('synthetic-sd-portfolio')], { players, lineups: lineups.slice(0, 3), portfolio_json: JSON.stringify(portfolio), updated_at: '2026-10-12T18:30:00Z' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    fs.mkdirSync(out, { recursive: true });
    const origin = 'http://127.0.0.1:' + server.address().port, errors = [], calls = [], bodies = [];
    const token = Buffer.from(JSON.stringify({ n: 'Synthetic Tester', e: Date.now() + 3600e3 })).toString('base64url') + '.synthetic';

    async function setup(width, height, signedIn) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'reduce' });
      page.on('pageerror', e => errors.push(e.message));
      if (signedIn) await page.addInitScript(t => { try { localStorage.setItem('dd-bozo-sess', t); } catch (e) {} }, token);
      await page.route('**/*', async route => {
        const req = route.request(), url = req.url();
        if (url.startsWith(origin + '/')) {
          const local = path.resolve(root, '.' + decodeURIComponent(new URL(url).pathname));
          if (!local.startsWith(root + path.sep) || !fs.existsSync(local)) return route.fulfill({status:404,body:''});
          return route.fulfill({path:local});
        }
        if (url.startsWith('https://toto.jkapcar4.workers.dev/api/dfs/')) {
          const op = url.split('/').pop(), args = req.postDataJSON() || {};
          calls.push(op); bodies.push(req.postData() || '');
          try { return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await context.api.run(op, args, env, caller)) }); }
          catch (e) { return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: e.message }) }); }
        }
        return route.abort();
      });
      return page;
    }
    const ready = page => page.waitForFunction(() => { const s = window.DDShowdownPage && window.DDShowdownPage.state; return s && s.model && !s.running; }, null, { timeout: 60000 });
    const noSideways = page => page.evaluate(() => {
      const w = document.documentElement.clientWidth, bad = [];
      // content inside its own horizontal scroller (the entry chips, the entries table) is fine
      const scroller = el => { for (let p = el.parentElement; p && p.id !== 'sd'; p = p.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(p).overflowX)) return true; return false; };
      for (const el of document.querySelectorAll('#sd *')) {
        if (el.closest('details:not([open])') || scroller(el)) continue;
        const b = el.getBoundingClientRect(); if (b.width && b.right > w + 1) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(b.right));
      }
      return bad;
    });

    // 1. Signed out, phone: the invented demo, no account calls at all.
    {
      const page = await setup(390, 844, false);
      await page.goto(origin + '/dfs-showdown.html'); await ready(page);
      await page.locator('#sdPro').click();
      await page.locator('#sdSessionJump').click();
      assert.match(await page.locator('#sdSourceBody').innerText(), /DEMO SLATE/);
      assert.equal(calls.length, 0, 'signed out never calls the account');
      assert.equal(await page.locator('#sdLeft .sd-lrow').count(), 6);
      assert.match(await page.locator('#sdTop').innerText(), /of simulated games had at least one entry in the modeled top 1%/);
      assert.ok(await page.locator('#sdChart .pt').count() === 6, 'one point per entry');
      assert.deepEqual(await noSideways(page), []);
      await page.screenshot({ path: path.join(out, 'demo-phone.png'), fullPage: true });
      await page.locator('[data-view="lineup"]').click();
      await page.locator('.sd-verdict h2').waitFor();
      assert.match(await page.locator('.sd-verdict h2').innerText(), /Relative model comparison/);
      await page.locator('#sdMore summary').click();
      assert.match(await page.locator('#sdRight').innerText(), /Pending dupe haircut/);
      // the contest type switch regrades the same build without moving it
      const at = () => page.evaluate(() => { const c = document.getElementById('sdChart').getBoundingClientRect(), b = document.querySelector('#sdChart .pt.me').getBoundingClientRect(); return [b.left - c.left, b.top - c.top]; });
      const before = await at();
      await page.locator('#sdTypes button').nth(3).click(); await page.waitForTimeout(200);
      const after = await at();
      assert.ok(Math.abs(before[0] - after[0]) < 1 && Math.abs(before[1] - after[1]) < 1, 'points stay put across contest types ' + before + ' vs ' + after);
      assert.deepEqual(await noSideways(page), []);
      await page.screenshot({ path: path.join(out, 'demo-phone-lineup-pro.png'), fullPage: true });
      const prefs = await page.evaluate(() => localStorage.getItem('dd-showdown:prefs'));
      assert.match(prefs, /"pro":true/);
      await page.close();
    }

    // 2. Signed in, desktop: newest Showdown workspace loads through list + get; Classic is ignored.
    {
      const page = await setup(1280, 900, true);
      await page.goto(origin + '/dfs-showdown.html'); await ready(page);
      await page.locator('#sdPro').click();
      await page.locator('#sdSessionJump').click();
      const opts = await page.locator('#sdWs option').allInnerTexts();
      assert.equal(opts.length, 2, 'only Showdown workspaces are offered');
      assert.ok(opts.every(o => !/classic/i.test(o)));
      assert.equal(await page.locator('#sdWs').inputValue(), 'synthetic-sd-lineups', 'most recently updated first');
      assert.equal(await page.locator('#sdLeft .sd-lrow').count(), lineups.length - 1, 'no portfolio: every legal workspace lineup is an entry');
      assert.match(await page.locator('#sdFoot').innerText(), /over the \$50,000 cap/, 'the illegal lineup is reported, not graded');
      assert.match(await page.locator('#sdCtx').innerText(), /HBR|MSA/);
      // untick one entry in the editor and re-grade
      await page.locator('#sdEntries > summary').click();
      await page.locator('#sdETable tbody tr').first().locator('input[data-f="on"]').uncheck();
      await page.locator('#sdRegrade').click(); await ready(page);
      await page.waitForFunction(n => document.querySelectorAll('#sdLeft .sd-lrow').length === n, lineups.length - 2);
      // a DraftKings entries CSV matched by official IDs replaces the ticks and fills contests
      const e0 = demo.entries[4], e1 = demo.entries[5];
      const cell = (i, cpt) => players[i].name + ' (' + (cpt ? 6000 + i : 5000 + i) + ')';
      const csv = ['Entry ID,Contest Name,Contest ID,Entry Fee,CPT,FLEX,FLEX,FLEX,FLEX,FLEX',
        ['1', 'Synthetic Showdown $8 [20 Entry Max]', '11', '$8', cell(e0.cpt, true), ...e0.ids.slice(1).map(i => cell(i))].join(','),
        ['2', 'Synthetic Showdown $2 Single Entry', '12', '$2', cell(e1.cpt, true), ...e1.ids.slice(1).map(i => cell(i))].join(',')].join('\n');
      await page.locator('#sdCsv').setInputFiles({ name: 'DKEntries.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await page.locator('#sdCsvMsg').filter({ hasText: 'Imported 2 entries' }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('#sdLeft .sd-lrow').length === 2, null, { timeout: 60000 }); await ready(page);
      assert.match(await page.locator('#sdTop').innerText(), /\$10/);
      assert.match(await page.locator('#sdLeft').innerText(), /5\/20-max|20 Entry Max/);
      // the device remembers the assignment; nothing was written to the account
      assert.match(await page.evaluate(() => localStorage.getItem('dd-showdown:v1:synthetic-sd-lineups')), /Entry Max/);
      await page.screenshot({ path: path.join(out, 'workspace-desktop.png'), fullPage: true });
      // switching workspace: a saved portfolio's ENTERED entries become the entries, typed by contest
      await page.locator('#sdWs').selectOption('synthetic-sd-portfolio'); await page.waitForFunction(() => location.search.includes('synthetic-sd-portfolio')); await ready(page);
      await page.waitForFunction(() => document.querySelectorAll('#sdLeft .sd-lrow').length === 2, null, { timeout: 60000 });
      const left = await page.locator('#sdLeft').innerText();
      assert.match(left, /Synthetic single entry/); assert.match(left, /Synthetic max entry/);
      assert.match(await page.locator('#sdTop').innerText(), /\$23/);
      await page.close();
    }

    assert.equal(calls.length, 3, "one list, one get per workspace opened: " + calls);
    // Same roster in different contests must retain separate accounting.
    portfolio.entries = [
      {...portfolio.entries[0], id:'cash-copy', contestId:'cash'},
      {...portfolio.entries[0], id:'gpp-copy', contestId:'gpp'}
    ];
    portfolio.contests = [
      {id:'cash',name:'Synthetic Double Up',contestType:'cash',fieldSize:200,paidPlaces:87,entryLimit:1},
      {id:'gpp',name:'Synthetic tournament',contestType:'gpp',fieldSize:200,payouts:Array(44).fill(10),entryLimit:1}
    ];
    env.rows[rowPath('synthetic-sd-portfolio')].portfolio_json=JSON.stringify(portfolio);
    {
      const page=await setup(390,844,true);
      await page.goto(origin+'/dfs-showdown.html?w=synthetic-sd-portfolio'); await ready(page);
      const entries=await page.evaluate(()=>window.DDShowdownPage.state.model.entries);
      for(const [width,height] of [[360,568],[390,664],[430,740]]){
        await page.setViewportSize({width,height});
        for(const pick of ['0','1']){
          await page.locator('#sdPointSelect').selectOption(pick);
          assert.match(await page.locator('#sdPointDetail').innerText(),pick==='0'?/43.5%.*supplied paidPlaces/:/22.0%.*supplied payouts/);
          const before=await page.evaluate(()=>JSON.stringify(window.DDShowdownPage.state.model));
          await page.locator('.dd-presentation').evaluate(el=>{el.open=true;el.closest('.navgrp')?.classList.add('open');});
          await page.getByRole('button',{name:'AI / technical details',exact:true}).click();
          assert.equal(await page.locator('#sdUncertainty summary').isVisible(),true);
          assert.equal(await page.locator('#sdPointDetail').isVisible(),true);
          assert.equal(await page.evaluate(()=>JSON.stringify(window.DDShowdownPage.state.model)),before);
          await page.locator('.dd-presentation').evaluate(el=>{el.open=true;el.closest('.navgrp')?.classList.add('open');});
          await page.getByRole('button',{name:'TL;DR',exact:true}).click();
        }
        await page.evaluate(()=>scrollTo(0,0));
        assert.ok(await page.locator('#sdChart').evaluate((el,h)=>el.getBoundingClientRect().bottom<h,height));
        await page.screenshot({path:path.join(out,`saved-lineup-${width}x${height}.png`)});
      }
      await page.locator('#sdSessionJump').click();
      assert.equal(entries.length,2);
      assert.notEqual(entries[0].key,entries[1].key);
      assert.deepEqual(entries.map(e=>e.cashLine),[.435,.22]);
      assert.equal(entries[0].type,'cash');
      assert.equal(entries[0].score.cash.score,null);
      assert.match(await page.locator('#sdCashAccounting').innerText(),/43.5%/);
      await page.locator('#sdEntries > summary').click();
      assert.equal(await page.locator('#sdETable tbody tr').first().locator('[data-f="type"]').isDisabled(),true);
      assert.equal(await page.locator('#sdETable tbody tr').first().locator('[data-f="entrants"]').isDisabled(),true);
      await page.locator('#sdPro').click();
      assert.match(await page.locator('#sdCashAccounting').innerText(),/Wilson 95%/);
      assert.deepEqual(await noSideways(page),[]);
      await page.screenshot({path:path.join(out,'cash-mixed-phone.png'),fullPage:true});
      for(const width of [360,390,430]) {
        await page.setViewportSize({width,height:844});
        await page.addStyleTag({content:'#sd { font-size: 125%; } #sd .sd-small {font-size:18px;}'});
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        assert.deepEqual(await noSideways(page),[], 'cash accounting enlarged text at '+width);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      }
      await page.close();
    }
    assert.deepEqual([...new Set(calls)].sort(), ['get', 'list'], 'read-only: list and get only');
    assert.equal(bodies.some(b => /SYNTH /.test(b)), false, 'no player data is ever sent to the account');
    assert.deepEqual(errors, []);
    console.log('PASS dfs-showdown browser: signed-out demo (no account calls), phone layout, lineup + Pro views, contest switch keeps points, signed-in list/get against the real Worker, Classic ignored, editor re-grade, DK CSV import by ID, device-only assignments, saved-portfolio entries typed by contest, identical rosters retain separate cash lines, metadata controls locked, Wilson intervals, 360/390/430 enlarged accounting text.');
  } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
