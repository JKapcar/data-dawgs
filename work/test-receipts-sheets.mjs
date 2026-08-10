/* CEP-5A 1b — Receipts absorbs the DawgHouse evidence. Run from the REPO ROOT.
   Grades the boundary this stage exists to enforce: the MODEL scoreboard (#models,
   "what the models believe") is a different sheet from the FORECAST GRADING scoreboard
   (#scoreboard, "how our calls graded"), and the method sheet keeps living at the END
   under its new #receipts hash with #method forwarded.
   Needs playwright: npm install playwright --no-save (Chromium is already on disk). */
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path"; import vm from "vm";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const { chromium } = loadPlaywright();
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

/* ---------- static: the copies cannot drift silently ---------- */
const rc = read("receipts.html");
const dh = read("dawghouse.html");

// mdlBeliefs (receipts) must agree with beliefSummary (work/pound-core.js, the source)
{
  const m = rc.match(/function mdlBeliefs\(values\)\{[\s\S]*?\n\}/);
  ok("receipts.html carries mdlBeliefs", !!m);
  if (m) {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(m[0] + "; this.mdlBeliefs = mdlBeliefs;", ctx);
    const P = require("./pound-core.js");
    const samples = [[0.4, 0.6, 0.8], [0.53, 0.59, 0.66], [0.5], [0.01, 0.99], [0.497, 0.503]];
    let agree = true;
    for (const s of samples) {
      const a = ctx.mdlBeliefs(s), b = P.beliefSummary(s);
      for (const k of Object.keys(b)) if (Math.abs((a[k] === true ? 1 : a[k] === false ? 0 : a[k]) - (b[k] === true ? 1 : b[k] === false ? 0 : b[k])) > 1e-12) agree = false;
    }
    ok("mdlBeliefs agrees with pound-core beliefSummary on sample inputs", agree);
    let throws = 0;
    for (const bad of [[], [1.2], ["x"]]) { try { ctx.mdlBeliefs(bad); } catch (e) { throws++; } }
    ok("mdlBeliefs fails closed like the source", throws === 3, String(throws));
  }
}
/* Stage NB, 2026-08-10. The two tabs used to be called "Scoreboard" and "Models", and the
   nav called the same two things "Scoreboard" and "What models believe". Four names for two
   sheets, and the word "scoreboard" pointed at the GRADING sheet while the model scoreboard
   was the other one. The labels now say which is which; the IDS did not move, so every
   `receipts.html#models` and `receipts.html#scoreboard` deep link on the site still lands
   where it did. ⚠️ If a future edit renames the ids to match the labels, ~20 cross-page
   links break silently — they are anchors, so nothing 404s and nothing fails. */
ok("the models sheet is not the grading sheet", rc.includes('{id:"models",label:"Model scoreboard",panel:"#sheetModels"}')
  && rc.includes('{id:"scoreboard",label:"Grading",panel:"#sheetScore"}'));
ok("the sheet IDS did not move with the labels",
  rc.includes('{id:"scoreboard",') && rc.includes('{id:"models",')
  && !rc.includes('{id:"grading",') && !rc.includes('{id:"model-scoreboard",'));
ok("the method sheet is renamed receipts, hint kept, and stays LAST",
  /\{id:"receipts",label:"Receipts & Method",panel:"#sheetMethod",hint:"pre-registered"\}\]/.test(rc));
ok("#method deep links forward", rc.includes('if(location.hash==="#method")history.replaceState(null,"","#receipts")'));
ok("dawghouse.html no longer holds the scoreboard section", !dh.includes('id="scoreboard"'));
ok("dawghouse.html no longer holds the provenance section", !dh.includes('id="provGrid"'));
ok("dawghouse.html forwards its old deep links",
  dh.includes('if(h==="#scoreboard")location.replace("receipts.html#models")')
  && dh.includes('else if(h==="#provenance")location.replace("receipts.html#provenance")'));
{
  const pages = fs.readdirSync(ROOT).filter(x => x.endsWith(".html"));
  let covered = 0, badNav = [];
  for (const page of pages) {
    const html = read(page);
    if (!html.includes("const NAV = [")) continue;
    covered++;
    if (!html.includes('["receipts.html#provenance","Provenance","pound-provenance"],')) badNav.push(page);
    if (html.includes('"Tools & Scoreboard"')) badNav.push(page + " (stale label)");
  }
  ok("nav on every shared-nav page follows the provenance move", covered >= 19 && badNav.length === 0, badNav.join(","));
}
{
  const surfaces = JSON.parse(read("data/surfaces.json"));
  const pound = surfaces.data.find(s => s.id === "pound");
  const receipts = surfaces.data.find(s => s.id === "receipts");
  ok("surfaces: model-receipts.json moved to the receipts row",
    receipts.machine.some(m => m.url === "/data/model-receipts.json")
    && !pound.machine.some(m => m.url === "/data/model-receipts.json"));
  ok("surfaces: upstream-models.json moved to the receipts row",
    receipts.machine.some(m => m.url === "/data/upstream-models.json")
    && !pound.machine.some(m => m.url === "/data/upstream-models.json"));
  ok("surfaces: dd_model_scoreboard rides with the models sheet",
    receipts.machine.some(m => m.tool === "dd_model_scoreboard")
    && !pound.machine.some(m => m.tool === "dd_model_scoreboard"));
  /* CEP-5A Stage 2: the calculators moved from the pound surface to their own
     /calculators.html surface. The invariant that matters here is unchanged — the
     machine tier value stays "pound" — and the tools must live somewhere, exactly once. */
  const calcs = surfaces.data.find(s => s.id === "calculators");
  ok("surfaces: the pound row keeps its tier; the calculators moved to their own surface",
    pound.tier === "pound" && !!calcs
    && calcs.machine.some(m => m.tool === "dd_convert_odds")
    && !pound.machine.some(m => m.tool === "dd_convert_odds"));
}

/* ---------- live: the sheets actually work, in both themes ---------- */
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0].split("#")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8921, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });

for (const theme of ["dark", "light"]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addInitScript(t => { localStorage.setItem("dd-theme2", t); localStorage.setItem("dd-theme", t); }, theme);
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));

  // #models deep link opens the models sheet and renders real rows
  await p.goto("http://127.0.0.1:8921/receipts.html#models", { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  const models = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll(".sheet-tab")].map(t => t.dataset.id),
    selected: document.querySelector('.sheet-tab[aria-selected="true"]')?.dataset.id,
    rows: document.querySelectorAll("#scoreTable tbody tr").length,
    tableVisible: !document.getElementById("scoreTable").hidden,
    gradingHidden: document.getElementById("sheetScore").hidden,
  }));
  ok(`[${theme}] eight sheets in order, receipts last`,
    JSON.stringify(models.tabs) === JSON.stringify(["scoreboard", "models", "classic", "cfbrec", "calls", "provenance", "audit", "receipts"]),
    JSON.stringify(models.tabs));
  ok(`[${theme}] #models opens the models sheet, not grading`, models.selected === "models" && models.gradingHidden);
  ok(`[${theme}] the model scoreboard renders 16 games`, models.rows === 16 && models.tableVisible, String(models.rows));

  // #provenance renders the grid
  await p.goto("http://127.0.0.1:8921/receipts.html#provenance", { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  const prov = await p.evaluate(() => ({
    selected: document.querySelector('.sheet-tab[aria-selected="true"]')?.dataset.id,
    cards: document.querySelectorAll("#provGrid article.prov").length,
  }));
  ok(`[${theme}] #provenance opens its sheet`, prov.selected === "provenance");
  ok(`[${theme}] provenance renders upstream cards`, prov.cards >= 5, String(prov.cards));

  // #method forwards to #receipts and the method panel opens.
  // ⚠️ Fresh page on purpose: hopping #provenance -> #method on the same page object is a
  // same-document navigation, the page script never re-runs, and the forward (which lives
  // in page load) cannot fire. The real stale-link case is a fresh load of the old URL.
  const p2 = await ctx.newPage();
  p2.on("pageerror", e => errs.push(e.message));
  await p2.goto("http://127.0.0.1:8921/receipts.html#method", { waitUntil: "load" });
  await p2.waitForTimeout(500);
  const fwd = await p2.evaluate(() => ({
    hash: location.hash,
    selected: document.querySelector('.sheet-tab[aria-selected="true"]')?.dataset.id,
    methodShown: !document.getElementById("sheetMethod").hidden,
  }));
  ok(`[${theme}] #method forwards to #receipts`, fwd.hash === "#receipts" && fwd.selected === "receipts" && fwd.methodShown,
    JSON.stringify(fwd));
  await p2.close();

  // dawghouse old deep link chain follows the content
  await p.goto("http://127.0.0.1:8921/dawghouse.html#scoreboard", { waitUntil: "load" });
  await p.waitForTimeout(900);
  ok(`[${theme}] dawghouse.html#scoreboard lands on receipts.html#models`,
    await p.evaluate(() => location.pathname.endsWith("/receipts.html") && location.hash === "#models"));

  /* ================= CEP-5A Stage 8 — the per-tool sheets =================
     THE LINE: `models` is what models BELIEVE, `scoreboard` is how our pre-registered
     calls GRADE. `classic`/`cfbrec` are beliefs; `audit` is neither and says so. */

  const openSheet = async (page, id) => {
    await page.click(`.sheet-tab[data-id="${id}"]`);
    await page.waitForFunction(
      i => document.querySelector(`.sheet-tab[data-id="${i}"]`)?.getAttribute("aria-selected") === "true",
      id, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(450);
  };
  const statMap = (page, sel) => page.evaluate(q => Object.fromEntries(
    [...document.querySelectorAll(`${q} .s8-stat`)].map(d =>
      [d.querySelector("span").textContent.trim().toLowerCase(), d.querySelector("b").textContent.trim()])), sel);

  // --- A. every new sheet's numbers come from ITS OWN FILE (compared to the file) ---
  const CLASSIC = JSON.parse(read("data/538-classic.json"));
  const CFBREC  = JSON.parse(read("data/cfb-model-receipts.json"));
  const AUDIT   = JSON.parse(read("data/tier-audit.json"));

  await p.goto("http://127.0.0.1:8921/receipts.html", { waitUntil: "networkidle" });
  await openSheet(p, "classic");
  {
    const st = await statMap(p, "#sheetClassic");
    const fc = CLASSIC.data.forecasts, weeks = new Set(fc.map(f => f.week)).size;
    ok(`[${theme}] classic: forecast count comes from the file`, st["forecasts"] === String(fc.length),
      `page ${st["forecasts"]} vs file ${fc.length}`);
    ok(`[${theme}] classic: team count comes from the file`, st["teams rated"] === String(CLASSIC.data.teams.length),
      `page ${st["teams rated"]} vs file ${CLASSIC.data.teams.length}`);
    ok(`[${theme}] classic: week count comes from the file`, st["weeks covered"] === String(weeks),
      `page ${st["weeks covered"]} vs file ${weeks}`);
    const wk1 = fc.filter(f => f.week === 1);
    const shown = await p.evaluate(() => [...document.querySelectorAll("#clTable tbody tr")].map(
      tr => tr.lastElementChild.textContent.trim()));
    ok(`[${theme}] classic: renders every Week 1 row`, shown.length === wk1.length, `${shown.length} vs ${wk1.length}`);
    const want = wk1.slice().sort((a, b) => a.game_id < b.game_id ? -1 : 1)
      .map(f => (f.home_win_probability * 100).toFixed(1) + "%");
    ok(`[${theme}] classic: every probability equals the file's, to the digit`,
      JSON.stringify(shown) === JSON.stringify(want),
      shown.find((v, i) => v !== want[i]) ? `first drift ${shown.find((v, i) => v !== want[i])}` : "");
  }

  await openSheet(p, "audit");
  {
    const st = await statMap(p, "#sheetAudit");
    const c = AUDIT.counts;
    ok(`[${theme}] audit: audited count comes from the file`, st["audited"] === String(c.audited));
    ok(`[${theme}] audit: promotions count comes from the file`, st["promotions"] === String(c.promotions_recommended));
    ok(`[${theme}] audit: demotions count comes from the file`, st["demotions"] === String(c.demotions_recommended));
    ok(`[${theme}] audit: pound count comes from the file`, st["in the pound"] === String(c.pound));
    const verdicts = await p.evaluate(() => [...document.querySelectorAll("#auTable tbody tr")].map(
      tr => tr.lastElementChild.textContent.trim()));
    ok(`[${theme}] audit: one row per audited tool, verdicts from the file`,
      JSON.stringify(verdicts) === JSON.stringify(AUDIT.data.map(r => r.verdict)), verdicts.join(","));
  }

  // --- B. a ZERO-ROW file renders a STATED zero, not an empty table ---
  await openSheet(p, "cfbrec");
  {
    const z = await p.evaluate(() => ({
      count: document.getElementById("cfrCount").textContent.trim(),
      note: document.getElementById("cfrNote").textContent.trim(),
      tables: document.querySelectorAll("#sheetCfbRec table").length,
      rows: document.querySelectorAll("#sheetCfbRec tbody tr").length,
      terms: document.querySelectorAll("#cfrTerms li").length,
    }));
    ok(`[${theme}] cfbrec: the row count is stated and equals the file`, z.count === String(CFBREC.data.length) && z.count === "0",
      z.count);
    ok(`[${theme}] cfbrec: a zero-row file renders NO table at all`, z.tables === 0 && z.rows === 0,
      `${z.tables} tables / ${z.rows} rows`);
    ok(`[${theme}] cfbrec: the file's own "empty by design" note is on the page`,
      z.note === CFBREC.note.trim() && /empty by design/i.test(z.note));
    ok(`[${theme}] cfbrec: the append-only contract terms render`, z.terms >= 4, String(z.terms));
  }

  // --- C. the models/scoreboard line still holds ---
  {
    /* ⚠️ #scoreTable lives in #sheetModels and holds BELIEFS — an earlier version of this
       check counted its rows and "failed" on a page that was behaving correctly. The
       grading sheet is #sheetScore. The invariant that matters: opening a belief sheet
       must leave the GRADING panel byte-identical, i.e. no new loader writes into it. */
    /* ⚠️ ON A FRESH PAGE. The first version snapshotted #sheetScore on THIS page, where
       the audit sheet had already been opened further up the loop — so its loader had
       already run and any bleed was baked into the "before" value. The assertion could
       not fail. Proven by mutation M5. */
    const p3 = await ctx.newPage();
    p3.on("pageerror", e => errs.push(e.message));
    await p3.goto("http://127.0.0.1:8921/receipts.html", { waitUntil: "networkidle" });
    const gradeBefore = await p3.evaluate(() => document.getElementById("sheetScore").innerHTML.length);
    for (const id of ["classic", "cfbrec", "audit"]) await openSheet(p3, id);
    const bleed = await p3.evaluate(() => ({
      scoreHidden: document.getElementById("sheetScore").hidden,
      modelsHidden: document.getElementById("sheetModels").hidden,
      gradeLen: document.getElementById("sheetScore").innerHTML.length,
    }));
    await p3.close();
    ok(`[${theme}] opening all three belief sheets leaves the GRADING panel untouched`,
      bleed.scoreHidden && bleed.modelsHidden && bleed.gradeLen === gradeBefore,
      JSON.stringify({ ...bleed, gradeBefore }));
    await openSheet(p, "classic"); await openSheet(p, "cfbrec"); await openSheet(p, "audit");
    const said = await p.evaluate(() => ({
      classic: document.getElementById("sheetClassic").textContent,
      cfbrec: document.getElementById("sheetCfbRec").textContent,
      audit: document.getElementById("sheetAudit").textContent,
    }));
    ok(`[${theme}] classic declares itself a belief and states it is not graded`,
      /belief/i.test(said.classic) && /not a grade/i.test(said.classic) && CLASSIC.graded === false);
    ok(`[${theme}] cfbrec declares itself a belief ledger`,
      /belief/i.test(said.cfbrec) && CFBREC.graded === false);
    ok(`[${theme}] audit says out loud that it is on NEITHER side`,
      /neither side of the line/i.test(said.audit) && /one reviewer/i.test(said.audit));
    ok(`[${theme}] no belief sheet claims a result`,
      !/(hit rate|win rate|accuracy so far|record so far|went \d+-\d+|beat the market|profit)/i
        .test(said.classic + said.cfbrec));
  }

  ok(`[${theme}] no script errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}
/* --- D. LAZY: nothing loads until its sheet is opened -----------------------
   ⚠️ The reason this is checked at the NETWORK and not by a viewport helper: a hidden
   panel's rect is 0x0 at the document origin, so "is it near the viewport" reads TRUE
   for every closed sheet and fires on load. cfb.html shipped exactly that bug. */
{
  const S8 = { classic: "/data/538-classic.json", cfbrec: "/data/cfb-model-receipts.json", audit: "/data/tier-audit.json" };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addInitScript(() => { localStorage.setItem("dd-theme2", "dark"); });
  const p = await ctx.newPage();
  const hits = [];
  p.on("request", r => { const u = new URL(r.url()).pathname; if (Object.values(S8).includes(u)) hits.push(u); });

  await p.goto("http://127.0.0.1:8921/receipts.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  ok("at page load NONE of the three files is fetched", hits.length === 0, hits.join(","));

  for (const [id, url] of Object.entries(S8)) {
    const before = hits.length;
    await p.click(`.sheet-tab[data-id="${id}"]`);
    await p.waitForResponse(r => new URL(r.url()).pathname === url, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(350);
    ok(`opening #${id} fetches ${url} and nothing else`,
      hits.length === before + 1 && hits[hits.length - 1] === url, hits.slice(before).join(","));
  }
  // re-opening must not re-fetch: the loaders latch
  const settled = hits.length;
  for (const id of Object.keys(S8)) { await p.click(`.sheet-tab[data-id="${id}"]`); await p.waitForTimeout(250); }
  ok("re-opening a sheet does not re-fetch its file", hits.length === settled, `${hits.length} vs ${settled}`);
  await ctx.close();
}

/* --- E. overflow measured ON EACH SHEET, both themes ------------------------
   A CLOSED sheet cannot overflow the document, so a single check passes vacuously
   for seven of the eight panels. Loop them. */
{
  const SHEETS = ["scoreboard", "models", "classic", "cfbrec", "calls", "provenance", "audit", "receipts"];
  for (const theme of ["dark", "light"]) {
    for (const W of [320, 390, 1280]) {
      const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
      await ctx.addInitScript(t => { localStorage.setItem("dd-theme2", t); localStorage.setItem("dd-theme", t); }, theme);
      const p = await ctx.newPage();
      await p.goto("http://127.0.0.1:8921/receipts.html", { waitUntil: "networkidle" });
      for (const sheet of SHEETS) {
        await p.click(`.sheet-tab[data-id="${sheet}"]`);
        await p.waitForTimeout(sheet === "classic" || sheet === "audit" || sheet === "cfbrec" ? 700 : 220);
        const m = await p.evaluate(s => {
          const de = document.documentElement;
          const panel = document.querySelector(`.sheet-tab[data-id="${s}"]`)?.getAttribute("aria-controls");
          const el = panel && document.getElementById(panel);
          return { over: de.scrollWidth - de.clientWidth, open: !!el && !el.hidden };
        }, sheet);
        ok(`[${theme}] no document overflow at ${W} on the ${sheet} sheet`, m.over <= 1, `+${m.over}px`);
        // the vacuity guard: prove the sheet was actually OPEN when we measured it
        ok(`[${theme}] the ${sheet} sheet was open when measured at ${W}`, m.open);
      }
      await ctx.close();
    }
  }
}

await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
