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
  ok(`[${theme}] nine sheets in order, inventory first and receipts last`,
    JSON.stringify(models.tabs) === JSON.stringify(["inventory", "scoreboard", "models", "classic", "cfbrec", "calls", "provenance", "audit", "receipts"]),
    JSON.stringify(models.tabs));
  ok(`[${theme}] #models opens the models sheet, not grading`, models.selected === "models" && models.gradingHidden);

  /* ---- Stage RI, 2026-08-10: the inventory sheet ------------------------------
     Two things must hold, and neither is about layout.
     1. NO COUNT IS TYPED. Every number arrives from a fetch, so the page cannot
        drift from the payloads. A hardcoded 272 would be right today and a lie the
        first time a forecast is added -- which is the exact failure this page
        exists to argue against.
     2. THE PANEL CARRIES NO SCORE. The whole ruling is that there is no honest
        Brier across domains, so a score column here would contradict the sheet's
        own opening paragraph. */
  await p.goto("http://127.0.0.1:8921/receipts.html#inventory", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  const inv = await p.evaluate(() => {
    const panel = document.getElementById("sheetInv");
    const cell = (r, i) => r.children[i]?.textContent.trim();
    return {
      selected: document.querySelector('.sheet-tab[aria-selected="true"]')?.dataset.id,
      open: !panel.hidden,
      loadHidden: document.getElementById("invLoad").hidden,
      tableVisible: !document.getElementById("invTable").hidden,
      rows: [...document.querySelectorAll("#invTable tbody tr.inv-main")].map(r => ({
        name: cell(r, 0), reg: cell(r, 1), settled: cell(r, 2), pending: cell(r, 3) })),
      /* ⚠️ The bug this catches was found in a PNG, not by a bounds check. Under
         table-layout:auto the Ledger cell's description sentence took all the width and
         pushed Settled / Pending / Machine read outside .inv-wrap -- three of five columns
         invisible at 1280, while document scrollWidth stayed 0 because the wrap scrolls
         internally. Measure the header cells against the WRAP's client box, not the page. */
      clipped: (() => {
        const wrap = document.querySelector("#sheetInv .inv-wrap");
        const wb = wrap.getBoundingClientRect();
        return [...document.querySelectorAll("#invTable thead th")]
          .filter(th => th.getBoundingClientRect().right > wb.right + 1)
          .map(th => th.textContent.trim());
      })(),
      /* ⚠️ Measure the SCROLL BOX, not the cells. Two earlier cuts were vacuous: cell
         bounding boxes under table-layout:fixed sit on the column boundaries and never
         overlap however the text behaves, and a cell's own scrollWidth stays clean when
         the TABLE grows to fit it and .inv-wrap absorbs the difference. The property that
         actually matters, and the only one a mutation can break, is that at 1280 this
         table needs no horizontal scrolling at all. (At 420 it legitimately does, which is
         why this is asserted only at the wide viewport.) */
      wrapOverflow: (() => {
        const w = document.querySelector("#sheetInv .inv-wrap");
        return w.scrollWidth - w.clientWidth;
      })(),
      /* ⚠️ PROVES THE WRAP HAPPENS, which the scroll-box check above cannot: a row that
         never wraps only overflows once some sentence is long enough, and before Stage MS
         none were.
         ⚠️⚠️ COUNT DISTINCT `top` VALUES, NOT `getClientRects().length`. The first cut of
         this assertion counted rects and was VACUOUS — a Range over the cell yields one
         rect per text run, and this cell holds a text node plus an <em>, so it returned 2
         under nowrap and the assertion passed while the row sat on a single line. The
         nowrap mutation is what exposed it. A rect per line is only true when the content
         is one text run; a rect per distinct top is true always. */
      descLines: Math.max(...[...document.querySelectorAll("#invTable tr.inv-desc td")]
        .map(td => { const r = document.createRange(); r.selectNodeContents(td);
                     return new Set([...r.getClientRects()].map(b => Math.round(b.top))).size; })),
      heads: [...document.querySelectorAll("#invTable thead th")].map(t => t.textContent.trim()),
      forecasts: document.getElementById("invForecasts").textContent.trim(),
      games: document.getElementById("invGames").textContent.trim(),
      settled: document.getElementById("invResolved").textContent.trim(),
      overlap: document.getElementById("invOverlap").textContent.trim(),
      audit: document.getElementById("invAudit").textContent.trim(),
      text: panel.innerText,
    };
  });
  ok(`[${theme}] #inventory opens the inventory sheet`, inv.selected === "inventory" && inv.open);
  /* ⚠️ DERIVED FROM THE PAYLOAD, NOT A TYPED 4, and not a hand-listed set of files.
     This assertion and the two Registered checks below carried a hardcoded four-file list.
     Stage MS appended a fifth ledger (the DDPR ensemble) and three assertions went red while
     describing the stage perfectly correctly. The properties actually worth grading are
     "the page drops no ledger the payload publishes" and "each Registered count equals the
     row count of THAT ledger's own file" — neither needs to know how many ledgers exist.
     Not circular: the loop below ties every count to a real file on disk, and
     tools/validate-data.js separately grades the payload against those same files. */
  const invLedgers = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/receipts-inventory.json"), "utf8")).data.ledgers;
  const mr = JSON.parse(fs.readFileSync(path.join(ROOT, "data/model-receipts.json"), "utf8"));
  /* Same structural rule as tools/validate-data.js: ask the payload its shape rather than
     naming files. An envelope that is neither an array nor {forecasts:[]} yields undefined
     and fails the length comparison loudly. */
  const fileCounts = invLedgers.map(l => {
    const env = JSON.parse(fs.readFileSync(
      path.join(ROOT, "data", String(l.machine).replace("/data/", "")), "utf8"));
    const rows = Array.isArray(env.data) ? env.data : (env.data && env.data.forecasts);
    return Array.isArray(rows) ? rows.length : NaN;
  });

  ok(`[${theme}] the inventory publishes more than one ledger (guards the next assertion)`,
    invLedgers.length > 1, String(invLedgers.length));
  ok(`[${theme}] the inventory table renders every ledger`,
    inv.tableVisible && inv.loadHidden && inv.rows.length === invLedgers.length,
    JSON.stringify(inv.rows.map(r => r.name)));
  ok(`[${theme}] every inventory column fits inside the scroll box at 1280`,
    inv.clipped.length === 0, `clipped: ${inv.clipped.join(", ")}`);
  /* ⚠️ THIS ONE FOUND A REAL BUG THE MOMENT IT COULD. Stage RI's description row never
     wrapped — the global `td{white-space:nowrap}` applies to it — and all four original
     sentences happened to fit on one line, so this assertion had never had the chance to
     fail. Stage MS's 290-char DDPR description scrolled .inv-wrap +791px on the first run.
     Keep the description sentences long enough that this stays a live check. */
  ok(`[${theme}] the inventory table needs no sideways scrolling at 1280`,
    inv.wrapOverflow <= 1, `+${inv.wrapOverflow}px inside .inv-wrap`);
  ok(`[${theme}] the longest ledger description actually wraps`,
    inv.descLines >= 2, `tallest description row is ${inv.descLines} line(s)`);

  ok(`[${theme}] every Registered count comes from its file`,
    JSON.stringify(inv.rows.map(r => Number(r.reg.replace(/,/g, "")))) === JSON.stringify(fileCounts),
    `page ${JSON.stringify(inv.rows.map(r => r.reg))} vs files ${JSON.stringify(fileCounts)}`);
  ok(`[${theme}] the aggregate counts distinct forecasts, never the column sum`,
    Number(inv.forecasts.replace(/,/g, "")) === mr.data.length &&
    Number(inv.games.replace(/,/g, "")) === new Set(mr.data.map(r => r.game_id)).size,
    `${inv.forecasts} forecasts / ${inv.games} games`);

  /* ⚠️ NO COUNT IS TYPED. Scoped to the panel's SOURCE markup, not its rendered
     text -- the rendered text is full of numbers precisely because the fetch put
     them there. If a real count appears in the markup, it was hardcoded. */
  const invSrc = fs.readFileSync(path.join(ROOT, "receipts.html"), "utf8")
    .split('<div id="sheetInv">')[1].split('<div id="sheetScore">')[0];
  const typed = [...new Set(fileCounts.concat([new Set(mr.data.map(r => r.game_id)).size]))]
    .filter(n => n > 1).filter(n => new RegExp(`\\b${n}\\b`).test(invSrc));
  ok(`[${theme}] no count is typed into the inventory markup`, typed.length === 0,
    `hardcoded: ${typed.join(",")}`);

  // THE PANEL CARRIES NO SCORE
  const banned = ["brier", "accuracy", "correct", "% right", "win rate"];
  const found = banned.filter(w => inv.heads.join(" ").toLowerCase().includes(w));
  ok(`[${theme}] the inventory table has no score column`, found.length === 0, found.join(","));
  ok(`[${theme}] the inventory says out loud why there is no single score`,
    /no single score/i.test(inv.text) && /blended/i.test(inv.text));
  ok(`[${theme}] the inventory warns against summing the Registered column`,
    /do not add the registered column up/i.test(inv.overlap) &&
    inv.overlap.includes(fileCounts.reduce((a, n) => a + n, 0).toLocaleString("en-US")),
    inv.overlap.slice(0, 90));
  /* ⚠️ THE CORRECTION MUST NAME EVERY VIEW, not the two that existed when it was written.
     The original sentence enumerated "the pre-registered calls and the 538 Classic beliefs"
     and silently stopped being complete when a third view was appended. A stale correction
     is the worst kind of stale prose on this page: the reader has just been told the column
     sum lies, so they have no reason to doubt the explanation of why. */
  const nonSuperset = invLedgers.filter(l => !l.superset && l.registered > 0);
  ok(`[${theme}] more than one ledger is a view (guards the next assertion)`,
    nonSuperset.length > 1, String(nonSuperset.length));
  ok(`[${theme}] the overlap correction names every view of the superset`,
    nonSuperset.every(l => inv.overlap.includes(l.name)),
    `missing ${nonSuperset.filter(l => !inv.overlap.includes(l.name)).map(l => l.name)}`);

  /* The audit is a judgment and must be counted OUTSIDE the forecast table, or this
     sheet becomes the cross-domain blend the ruling forbids. */
  const ta = JSON.parse(fs.readFileSync(path.join(ROOT, "data/tier-audit.json"), "utf8"));
  ok(`[${theme}] the tier audit is counted outside the forecast table`,
    inv.audit.includes(String(ta.data.length)) &&
    !inv.rows.some(r => /audit/i.test(r.name)) &&
    /judgment, not a measurement/i.test(inv.audit), inv.audit.slice(0, 80));
  ok(`[${theme}] nothing is settled yet, and every ledger says so`,
    inv.rows.every(r => r.settled === "0") && inv.settled === "0");
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
