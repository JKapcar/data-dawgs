/* markets.html and ai.html — the two section hubs, now carrying their tools (Stage 2).

   ⚠️ WHAT THIS SUITE DEFENDS, POST-STAGE-2. The pages are no longer empty: each carries a
   DDSheets family of tool panels computed live in the visitor's browser from a third party's
   public API. Three honesty properties have to hold, two carried from Stage 1 and one new:

     - the live GRID still reports the FILE's count and still tells its three states apart —
       read-failed / zero-rows / rows. Collapsing the middle two is how an empty page starts
       reading as broken and a broken one starts reading as honest-empty. All three are
       exercised against the same page: a forced 500, a stubbed zero-row file, and the real
       file (which now carries rows);
     - the page no longer claims to be unbuilt, because it is built. The `.notbuilt` banner is
       gone and its removal is asserted, not assumed;
     - the tool panels render, the sheet bar switches them, the board fills, and the
       calibration pass draws a curve.

   ⚠️ TWO STAGE 1 ASSERTIONS ARE NOW FALSE BY DESIGN and were UPDATED, not deleted:
     - surfaces.json now HAS rows for each domain (Stage 2 added four). The precondition below
       asserts that, so the "rows render" path is meaningful and the zero-row path is the one
       that has to be routed rather than waited for.
     - the banner no longer says the page is unbuilt. A tool shipped; that claim would be a lie
       on a site whose whole argument is that claims must be checkable.

   ⚠️ EVERY PAGE OPEN IS HERMETIC. The tool scripts fetch Polymarket (gamma + clob) and
   OpenRouter at load. Those are stubbed here with payloads shaped from the live responses
   (field names copied from real payloads), so no page ever reaches the real network and the
   suite is deterministic. surfaces.json is layered on top per-test.

   Run:  cd work && node test-section-hubs.mjs
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".json") ? "application/json" : f.endsWith(".txt") || f.endsWith(".md") ? "text/plain" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8936, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const errs = [];

const SURFACES = JSON.parse(fs.readFileSync(path.join(ROOT, "data/surfaces.json"), "utf8"));
const PAGES = [
  /* `label` is the page's own name; `navGroup` is the top-level group it now lights.
     Release 1 (2026-08-17) demoted both of these out of the banner — Prediction Markets
     to an item under Arena, the A.I. Model Board to an item under Data — so the group
     that reads as active is no longer the one named after the page. */
  { file: "markets.html", domain: "markets", label: "Prediction Markets", navGroup: "Arena",
    h1: "prediction-markets work",
    tabLabels: ["Open board", "Calibration", "By subject", "Method"] },
  { file: "ai.html", domain: "ai", label: "A.I.", navGroup: "Data", h1: "A.I. work",
    tabLabels: ["Model board", "Frontier", "Forecast study", "Method"] },
];

/* ---------- upstream fixtures, field names copied from the live payloads ---------- */
const orModels = { data: [] };
const VEND = ["openai", "anthropic", "google", "x-ai", "meta-llama", "deepseek", "qwen", "mistralai"];
for (let i = 0; i < 64; i++) {
  const iq = 12 + (i * 1.31) % 48;
  const po = Math.pow(10, -1.2 + (i % 17) / 6);
  orModels.data.push({
    id: `${VEND[i % 8]}/model-${i}`, name: `${VEND[i % 8]}: Model ${i}`, created: 1780000000 + i * 8600,
    context_length: [8192, 32768, 131072, 262144, 1048576][i % 5],
    architecture: { modality: "text->text", input_modalities: i % 4 ? ["text"] : ["text", "image"], output_modalities: ["text"], tokenizer: "Other" },
    pricing: { prompt: String(po / 3 / 1e6), completion: String(po / 1e6) },
    top_provider: { context_length: 131072, max_completion_tokens: null, is_moderated: false },
    benchmarks: i % 5 === 4 ? {} : { artificial_analysis: { intelligence_index: +iq.toFixed(1) } },
    reasoning: i % 3 === 0 ? { mandatory: i % 6 === 0, default_enabled: true } : null,
  });
}
const openMk = [];
for (let i = 0; i < 120; i++) openMk.push({
  id: String(1000 + i), question: `Will thing number ${i} happen before the deadline?`,
  slug: `thing-${i}`, conditionId: "0x" + i,
  outcomes: JSON.stringify(["Yes", "No"]),
  outcomePrices: JSON.stringify([String((0.03 + (i * 0.0081) % 0.94).toFixed(3)), "0"]),
  volumeNum: 5e6 / (i + 1), volume: String(5e6 / (i + 1)),
  endDate: new Date(Date.now() + (i + 3) * 86400000).toISOString(),
  startDate: new Date(Date.now() - 40 * 86400000).toISOString(), closed: false,
  clobTokenIds: JSON.stringify(["tok" + i, "tokN" + i]),
});
const closedMk = [];
for (let i = 0; i < 300; i++) {
  const p = 0.02 + (i * 0.0173) % 0.96;
  const hit = ((i * 7919) % 1000) / 1000 < p;
  closedMk.push({
    id: String(9000 + i), question: `Resolved market ${i}`, slug: `res-${i}`,
    outcomes: JSON.stringify(["Yes", "No"]),
    outcomePrices: JSON.stringify(hit ? ["1", "0"] : ["0", "1"]),
    volumeNum: 9e6 / (i + 1), endDate: new Date(Date.now() - (i + 2) * 86400000).toISOString(),
    clobTokenIds: JSON.stringify(["ctok" + i, "ctokN" + i]), closed: true,
    tags: [[{ label: "Politics" }, { label: "2026 Election" }],
           [{ label: "Sports" }, { label: "NFL" }],
           [{ label: "Crypto" }, { label: "Bitcoin" }],
           [{ label: "Pop Culture" }],
           []][i % 5],
    __p: p,
  });
}
const priceFor = {};
closedMk.forEach(m => { priceFor[JSON.parse(m.clobTokenIds)[0]] = { p: m.__p, end: Math.floor(new Date(m.endDate).getTime() / 1000) }; });

async function stubUpstreams(p) {
  await p.route("**openrouter.ai/api/v1/models*", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(orModels) }));
  await p.route("**gamma-api.polymarket.com/markets*", r => {
    const closed = r.request().url().includes("closed=true");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(closed ? closedMk : openMk) });
  });
  await p.route("**clob.polymarket.com/prices-history*", r => {
    const u = new URL(r.request().url());
    const t = priceFor[u.searchParams.get("market")];
    if (!t) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ history: [] }) });
    const hist = []; for (let d = 60; d >= 0; d--) hist.push({ t: t.end - d * 86400, p: String(t.p) });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ history: hist }) });
  });
}

/* ---------- 0. the precondition, read from the committed file ---------- */
for (const p of PAGES) {
  const rows = SURFACES.data.filter(r => r.domain === p.domain);
  ok(`${p.file}: surfaces.json now carries "${p.domain}" rows (Stage 2 precondition)`, rows.length > 0,
     `found ${rows.length} — Stage 2 added them; the rows-render path below is meaningless without them`);
}

async function open(file, { route, width = 900, theme = null } = {}) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(`${file}: ${e.message}`));
  await stubUpstreams(p);
  if (route) await route(p);
  if (theme) await p.addInitScript(t => { try { localStorage.setItem("dd-theme2-mode", t); } catch (e) {} }, theme);
  await p.goto(`http://127.0.0.1:8936/${file}`, { waitUntil: "load" });
  await p.waitForFunction(() => {
    const el = document.getElementById("secCards");
    return el && !/Reading the surfaces map/.test(el.textContent);
  }, null, { timeout: 15000 });
  return { ctx, p };
}

for (const P of PAGES) {
  /* ---------- 1. the page exists, is chipped, is built, and admits no tool ---------- */
  {
    const { ctx, p } = await open(P.file);
    /* ⚠️ THE BANNER IS GONE, AND THAT IS THE POINT. Stage 1 asserted a `.notbuilt` banner
       saying the page was unbuilt; a tool has shipped, so that claim would now be false. Its
       absence is asserted, not assumed. */
    ok(`${P.file}: the "nothing is built" banner is gone`, !(await p.$(".notbuilt")));
    const body = await p.$eval("main", el => el.textContent);
    ok(`${P.file}: the body no longer claims it is unbuilt`, !/Nothing here is built yet/i.test(body));

    const chip = await p.$(".tierchip");
    ok(`${P.file}: carries a tier chip`, !!chip);
    if (chip) ok(`${P.file}: the chip declares its tier as an attribute`,
                 (await chip.getAttribute("data-tier")) === "labs");

    /* The nav change travels here too. Release 1 put the bar back to SIX groups and moved
       these two pages underneath other groups, so what is asserted is that the page still
       lights exactly one group — and that it is the group that now owns it. Exactly one
       matters as much as which: a page that lights none looks orphaned, and a page that
       lights two means a key is duplicated across groups. */
    const groups = await p.$$eval(".sitenav .links .navgrp", n => n.length);
    ok(`${P.file}: the bar carries all six groups`, groups === 6, String(groups));
    const on = await p.$$eval(".sitenav .links .grpbtn.on", n => n.map(x => x.innerText.trim().replace(/\s*▾$/, "")));
    ok(`${P.file}: the group that now owns it is the active one`,
       on.length === 1 && on[0] === P.navGroup, JSON.stringify(on) + " want " + P.navGroup);

    /* ⚠️ THESE TOOLS ADVERTISE NO MCP TOOL. They compute in the browser from a third party's
       API; there is no dd_ tool behind them, and any dd_ id in the body would be a false
       capability claim. */
    ok(`${P.file}: names no MCP tool`, !/\bdd_[a-z_]+/.test(body), (body.match(/\bdd_[a-z_]+/g) || []).join(","));
    await ctx.close();
  }

  /* ---------- 2. the tools render: sheet bar, four panels, live board, and a curve ---------- */
  {
    const { ctx, p } = await open(P.file);
    const tabs = await p.$$eval(".sheetbar .sheet-tab", n => n.map(x => x.textContent.trim()));
    ok(`${P.file}: the sheet bar renders four tabs`, tabs.length === 4, JSON.stringify(tabs));
    ok(`${P.file}: the tabs are the tools, in order`, P.tabLabels.every((l, i) => (tabs[i] || "").startsWith(l)), JSON.stringify(tabs));

    /* switching a tab shows exactly one panel */
    await p.click(".sheetbar .sheet-tab:nth-child(2)");
    await p.waitForTimeout(200);
    const visible = await p.$$eval("[role=tabpanel]", ns => ns.filter(n => !n.hidden).length);
    ok(`${P.file}: exactly one sheet panel is visible at a time`, visible === 1, String(visible));

    if (P.domain === "markets") {
      /* the open board fills from the stubbed gamma response */
      await p.goto("http://127.0.0.1:8936/markets.html#live", { waitUntil: "load" });
      await p.waitForFunction(() => document.querySelectorAll("#mkBody tr").length > 0, null, { timeout: 15000 }).catch(() => {});
      const rows = await p.$$eval("#mkBody tr", n => n.length);
      ok(`markets.html: the open board renders a row per market`, rows > 0, String(rows));
      ok(`markets.html: the board shows its summary tiles`, (await p.$$("#mkTiles .s")).length === 3);

      /* the calibration pass draws a reliability curve from the stubbed clob history */
      await p.goto("http://127.0.0.1:8936/markets.html#calibration", { waitUntil: "load" });
      await p.selectOption("#calN", "60");
      await p.click("#calRun");
      await p.waitForFunction(() => document.querySelectorAll("#calFig svg").length > 0, null, { timeout: 20000 }).catch(() => {});
      ok(`markets.html: the calibration pass produces a curve`, (await p.$$("#calFig svg")).length === 1);
      ok(`markets.html: the curve carries at least one plotted bucket`, (await p.$$("#calFig svg circle.dot")).length > 0);
      ok(`markets.html: the calibration table renders its buckets`, (await p.$$("#calBody tr")).length > 0);
      /* the domain split reuses that same run rather than fetching again */
      await p.click(".sheetbar .sheet-tab:nth-child(3)");
      await p.waitForTimeout(300);
      ok(`markets.html: the subject split draws its small multiples`, (await p.$$("#domFacets .ddfacet")).length === 4);
    } else {
      /* the model board fills from the stubbed OpenRouter catalogue */
      await p.goto("http://127.0.0.1:8936/ai.html#models", { waitUntil: "load" });
      await p.waitForFunction(() => document.querySelectorAll("#aiBody tr").length > 0, null, { timeout: 15000 }).catch(() => {});
      ok(`ai.html: the model board renders a row per model`, (await p.$$("#aiBody tr")).length > 0);
      ok(`ai.html: the board shows its summary tiles`, (await p.$$("#aiTiles .s")).length === 4);
      /* the price/intelligence frontier plots */
      await p.goto("http://127.0.0.1:8936/ai.html#frontier", { waitUntil: "load" });
      await p.waitForFunction(() => document.querySelectorAll("#frFig svg").length > 0, null, { timeout: 15000 }).catch(() => {});
      ok(`ai.html: the frontier chart plots`, (await p.$$("#frFig svg")).length === 1);
      ok(`ai.html: the frontier labels at least one model`, (await p.$$("#frFig svg circle.dot")).length > 0);
    }
    await ctx.close();
  }

  /* ---------- 3. zero rows: the empty state, driven by a STUBBED zero-row file ----------
     The real file now has rows (Stage 2), so the zero-row branch can no longer occur
     naturally. It is routed instead, exactly as the read-failure branch already is, so the
     "nothing built yet" vs "could not be read" distinction stays covered. */
  {
    const stub = JSON.stringify({ ...SURFACES, data: [] });
    const route = async (p) => p.route("**/data/surfaces.json", r =>
      r.fulfill({ status: 200, contentType: "application/json", body: stub }));
    const { ctx, p } = await open(P.file, { route });
    const cards = await p.$eval("#secCards", el => el.textContent);
    const count = await p.$eval("#secCount", el => el.textContent);
    ok(`${P.file}: zero rows says nothing is built yet`, /Nothing is built yet/i.test(cards), cards.slice(0, 80));
    ok(`${P.file}: zero rows does NOT read as a failed request`, !/could not be read/i.test(cards), cards.slice(0, 80));
    ok(`${P.file}: zero rows names the file as the source of the zero`, /surfaces\.json/.test(cards) || /surfaces\.json/.test(count));
    ok(`${P.file}: the count line states 0 surfaces`, /\b0 surfaces\b/.test(count), count);
    ok(`${P.file}: the count line carries the file's date`, count.includes(SURFACES.as_of), `${count} (as_of ${SURFACES.as_of})`);
    ok(`${P.file}: no card was rendered`, (await p.$$("#secCards .tool")).length === 0);
    await ctx.close();
  }

  /* ---------- 4. read failure: loud, and distinguishable from empty ---------- */
  {
    const route = async (p) => p.route("**/data/surfaces.json", r => r.fulfill({ status: 500, body: "nope" }));
    const { ctx, p } = await open(P.file, { route });
    const cards = await p.$eval("#secCards", el => el.textContent);
    const count = await p.$eval("#secCount", el => el.textContent);
    ok(`${P.file}: a failed read says the file could not be read`, /could not be read/i.test(cards), cards.slice(0, 90));
    ok(`${P.file}: a failed read does NOT claim nothing is built`, !/Nothing is built yet/i.test(cards), cards.slice(0, 90));
    ok(`${P.file}: a failed read reports the status it got`, /500/.test(cards), cards.slice(0, 120));
    ok(`${P.file}: the count line says the directory is unavailable`, /unavailable/i.test(count), count);
    await ctx.close();
  }

  /* ---------- 5. rows: the real file now renders its own cards, no page edit ----------
     Driven by the REAL committed surfaces.json (rows exist since Stage 2). Each Stage 2 row
     declares machine: [], so the card names no live surface and states its gap. */
  {
    const { ctx, p } = await open(P.file);
    const cards = await p.$$("#secCards .tool");
    ok(`${P.file}: the real file renders one card per domain row`,
       cards.length === SURFACES.data.filter(r => r.domain === P.domain).length, String(cards.length));
    if (cards.length) {
      const t = await cards[0].innerText();
      ok(`${P.file}: a no-machine row says the page is the only way in`,
         /No live machine surface/i.test(t), t.slice(0, 90));
      ok(`${P.file}: a no-machine row still states its gap`, /Known gap/i.test(t), t.slice(0, 120));
    }
    ok(`${P.file}: a populated grid drops both empty-state strings`,
       !/Nothing is built yet|could not be read/i.test(await p.$eval("#secCards", el => el.textContent)));
    await ctx.close();
  }

  /* ---------- 6. both themes, phone width, nothing throws, no sideways scroll ---------- */
  for (const theme of ["dark", "light"]) {
    const { ctx, p } = await open(P.file, { width: 390, theme });
    const h1 = await p.$eval("h1", el => el.innerText);
    ok(`${P.file}@390 ${theme}: the hero renders`, h1.includes(P.h1), h1.slice(0, 60));
    ok(`${P.file}@390 ${theme}: the sheet bar renders`, (await p.$$(".sheetbar .sheet-tab")).length === 4);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok(`${P.file}@390 ${theme}: the page does not scroll sideways`, overflow === false);
    await ctx.close();
  }
}

ok("no script errors on either page in any state", errs.length === 0, errs.join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
