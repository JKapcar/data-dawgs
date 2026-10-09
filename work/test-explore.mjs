/* Data Explorer (explore.html) — headless browser check against the REAL /data files.

   Serves the repo root on a random localhost port, loads explore.html in Chromium and
   asserts: DuckDB-Wasm initialises; every runnable starter query returns rows and cites
   the right /data file(s) with that file's real as_of; the unavailable starter stays
   disabled; null survives as null; exports carry the citation; a share link re-runs the
   same query; the chart canvas is painted; and with the .wasm blocked the page falls back
   to plain file links, previews and a static chart instead of breaking.

   ⚠️ NEEDS NETWORK: the page loads DuckDB-Wasm 1.32.0 from cdn.jsdelivr.net.

     node work/test-explore.mjs            # PLAYWRIGHT_CHROMIUM=/path/to/chrome if needed
     DD_EXPLORE_JSON=/tmp/x.json node ...  # also write the timings/results as JSON */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadPlaywright, chromiumExecutable } from "./playwright-loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = loadPlaywright();
let pass = 0, failN = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok   " + name); } else { failN++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); } };

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".md": "text/markdown", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const env = f => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));

const browser = await chromium.launch({ executablePath: chromiumExecutable(chromium), headless: true });
const report = { conditions: {}, starters: [], fallback: {} };
try {
  /* ---------------- normal path ---------------- */
  const ctx = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(BASE + "/explore.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.DDExplore && (window.DDExplore.state.mode !== "loading") && (window.DDExplore.timings.first_result || window.DDExplore.state.mode === "fallback"), null, { timeout: 120000 });
  const wall = Date.now() - t0;
  const t = await page.evaluate(() => ({ ...window.DDExplore.timings, mode: window.DDExplore.state.mode, bundle: window.DDExplore.state.bundle, error: window.DDExplore.state.error }));
  report.timings = { ...t, wall_ms_to_first_result: wall };
  console.log("  timings (ms from script start):", JSON.stringify(report.timings));
  ok("DuckDB-Wasm initialised (mode ready)", t.mode === "ready", JSON.stringify(t));
  ok("wasm_ready, tables_ready and first_result were all reached", t.wasm_ready > 0 && t.tables_ready >= t.wasm_ready && t.first_result >= t.tables_ready);
  ok("the page labels itself Lab/Pup with a data-tier chip", await page.locator('.tierchip[data-tier="labs"]').count() === 1);
  ok("Toto surface is set with sys + ctx", await page.evaluate(() => !!(window.DD_BOTCTX && window.DD_BOTCTX.sys && JSON.parse(window.DD_BOTCTX.ctx()).last)));
  ok("Toto MAP on this page lists explore.html", (await page.content()).includes("explore.html — the Data Explorer"));
  ok("the nav Data group lists the explorer", await page.locator('#nav a[href="explore.html"]').count() >= 1);

  const starters = await page.evaluate(() => window.DDExplore.starters.map(s => ({ id: s.id, title: s.title, sql: s.sql || null, unavailable: s.unavailable || null })));
  const runnable = starters.filter(s => !s.unavailable);
  ok("8-12 runnable starter queries", runnable.length >= 8 && runnable.length <= 12, String(runnable.length));
  const expectFiles = { "epa-top-2325": ["epa-teams.json"], "epa-improvers": ["epa-teams.json"], "epa-2026": ["epa-teams.json"], "qb-2025": ["epa-teams.json"],
    "rush-2025": ["epa-players.json"], "nfelo-now": ["nfelo.json"], "nfelo-mkt-backtest": ["nfelo.json"], "model-gap": ["receipts.json", "538-classic.json"],
    "cfb-net": ["cfb-efficiency.json"], "pool-pos": ["pool.json"], "nfl-results": ["nfl-schedule.json"] };
  for (const s of runnable) {
    // through the UI, so the citation, table and chart are what a reader sees
    await page.click(`[data-starter="${s.id}"]`);
    await page.waitForFunction(id => { const r = window.DDExplore.state.lastResult; const st = window.DDExplore.starters.find(x => x.id === id); return r && r.sql === st.sql.trim(); }, s.id, { timeout: 30000 });
    const r = await page.evaluate(() => { const r = window.DDExplore.state.lastResult; return { rows: r.rows.length, columns: r.columns, ms: r.ms, sources: r.sources.map(x => ({ file: x.file, as_of: x.as_of, kind: x.kind })), sample: r.rows.slice(0, 3) }; });
    const cite = await page.locator("#dx-cite").innerText();
    const painted = await page.evaluate(() => { const c = document.getElementById("dx-canvas"), g = c.getContext("2d"); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) n++; return n; });
    const want = expectFiles[s.id] || [];
    const filesOk = want.length === r.sources.length && want.every(f => r.sources.some(x => x.file === f && x.as_of === env(f).as_of));
    const citeOk = want.every(f => cite.includes("/data/" + f) && cite.includes("as_of " + env(f).as_of));
    const pass1 = r.rows > 0 && filesOk && citeOk && painted > 50;
    ok(`starter ${s.id}: ${r.rows} rows, cites ${r.sources.map(x => x.file + "@" + x.as_of).join(" + ")}, chart painted`, pass1, JSON.stringify({ r: r.rows, filesOk, citeOk, painted }));
    report.starters.push({ id: s.id, title: s.title, pass: pass1, rows: r.rows, ms: r.ms, sources: r.sources });
  }
  const un = starters.filter(s => s.unavailable);
  ok("the nfelo-vs-closing-market starter is listed as unavailable, not approximated", un.length === 1 && un[0].id === "nfelo-closing" && await page.locator('#dx-starters button[disabled]').count() === 1);
  for (const s of un) report.starters.push({ id: s.id, title: s.title, pass: null, unavailable: s.unavailable });

  /* null stays null */
  const nul = await page.evaluate(async () => { const r = await window.DDExplore.run("SELECT game_id, home_score FROM nfl_schedule WHERE week = 18 LIMIT 3"); return r.rows.map(x => x.home_score); });
  ok("unplayed games come back with NULL scores, not 0", nul.length === 3 && nul.every(v => v === null), JSON.stringify(nul));
  const mk = await page.evaluate(async () => (await window.DDExplore.run("SELECT COUNT(*) AS n, COUNT(mk) AS with_mk FROM receipts")).rows[0]);
  ok("receipts.mk keeps its nulls (51 of 272 carry a benchmark)", mk.n === 272 && mk.with_mk === 51, JSON.stringify(mk));
  const silva = await page.evaluate(async () => { try { await window.DDExplore.run("SELECT silva FROM pool LIMIT 1"); return "present"; } catch (e) { return "absent"; } });
  ok("pool.silva (source analyst's rank) is not loaded", silva === "absent");
  const lazy = await page.evaluate(async () => { const r = await window.DDExplore.run("SELECT COUNT(*) AS n FROM cfb_market"); return { n: r.rows[0].n, src: r.sources[0].file }; });
  ok("a lazy table (cfb_market) loads on first use and cites its file", lazy.n === env("cfb-market.json").data.games.length && lazy.src === "cfb-market.json", JSON.stringify(lazy));

  /* exports */
  await page.click('[data-starter="epa-improvers"]');
  await page.waitForFunction(() => /improvers|2024/.test(window.DDExplore.state.lastResult.sql));
  const dl = async sel => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(sel)]); const p = await d.path(); return { name: d.suggestedFilename(), body: fs.readFileSync(p) }; };
  const csv = await dl("#dx-csv"), cited = await dl("#dx-csv-cited"), json = await dl("#dx-json"), png = await dl("#dx-png");
  ok("CSV export: plain header + 10 rows, filename carries as_of", csv.body.toString().split("\n")[0] === "team,off_epa_play_2024,off_epa_play_2025,change" && csv.body.toString().trim().split("\n").length === 11 && csv.name.includes(env("epa-teams.json").as_of), csv.name);
  ok("cited CSV export carries source + as_of + query", /# source: \/data\/epa-teams\.json · as_of \d{4}-\d{2}-\d{2}/.test(cited.body.toString()) && cited.body.toString().includes("# query: "));
  const jb = JSON.parse(json.body.toString());
  ok("JSON export carries query, sources with as_of, and rows", jb.query && jb.sources[0].as_of === env("epa-teams.json").as_of && jb.rows.length === 10);
  ok("PNG export is a real PNG", png.body.slice(1, 4).toString() === "PNG" && png.body.length > 10000, png.name + " " + png.body.length);
  fs.writeFileSync("/tmp/dd-explore-sample.png", png.body);

  /* share link */
  await page.selectOption("#dx-ctype", "bar");
  await page.click("#dx-share");
  const url = await page.inputValue("#dx-share-out");
  const p2 = await ctx.newPage();
  await p2.goto(url);
  await p2.waitForFunction(() => window.DDExplore && window.DDExplore.state.lastResult, null, { timeout: 120000 });
  const shared = await p2.evaluate(() => ({ sql: window.DDExplore.state.lastResult.sql, type: document.getElementById("dx-ctype").value }));
  const orig = await page.evaluate(() => document.getElementById("dx-sql").value.trim());
  ok("share link re-runs the same query with the same chart type", shared.sql === orig && shared.type === "bar", JSON.stringify(shared.type));
  ok("no page errors on the normal path", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: "/tmp/dd-explore-page.png", fullPage: false });
  await ctx.close();

  /* ---------------- fallback: wasm blocked ---------------- */
  const fctx = await browser.newContext({ serviceWorkers: "block" });
  await fctx.route(/\.wasm(\?.*)?$/, r => r.abort());
  const fp = await fctx.newPage();
  const ft0 = Date.now();
  await fp.goto(BASE + "/explore.html", { waitUntil: "domcontentloaded" });
  await fp.waitForFunction(() => window.DDExplore && window.DDExplore.state.mode === "fallback" && window.DDExplore.timings.fallback_ready, null, { timeout: 90000 });
  const fb = await fp.evaluate(() => ({ err: window.DDExplore.state.error, t: window.DDExplore.timings.fallback_ready,
    visible: !document.getElementById("dx-fallback").hidden, appHidden: document.getElementById("dx-app").hidden,
    links: document.querySelectorAll("#dx-fb-files a[href^='/data/']").length, cap: document.getElementById("dx-fb-chart-cap").textContent,
    status: document.getElementById("dx-status").textContent }));
  report.fallback = { ...fb, wall_ms: Date.now() - ft0 };
  ok("wasm blocked → fallback mode with a clear message", fb.visible && fb.appHidden && /could not load/i.test(fb.status), JSON.stringify(fb));
  ok("fallback lists every table's raw /data link", fb.links >= 15, String(fb.links));
  ok("fallback static example chart cites its file and as_of", fb.cap.includes("/data/epa-teams.json") && fb.cap.includes(env("epa-teams.json").as_of), fb.cap);
  await fp.click('[data-peek="nfelo_ratings"]');
  const pv = await fp.locator("#dx-table tbody tr").count();
  ok("fallback preview shows rows without SQL", pv === 32, String(pv));
  await fp.screenshot({ path: "/tmp/dd-explore-fallback.png" });
  await fctx.close();

  /* the whole CDN unreachable (module import itself fails) → same fallback */
  const cctx = await browser.newContext({ serviceWorkers: "block" });
  await cctx.route(/cdn\.jsdelivr\.net/, r => r.abort());
  const cp = await cctx.newPage();
  await cp.goto(BASE + "/explore.html", { waitUntil: "domcontentloaded" });
  await cp.waitForFunction(() => window.DDExplore && window.DDExplore.state.mode === "fallback" && window.DDExplore.timings.fallback_ready, null, { timeout: 90000 });
  const cdn = await cp.evaluate(() => ({ t: window.DDExplore.timings.fallback_ready, links: document.querySelectorAll("#dx-fb-files a[href^='/data/']").length }));
  report.fallback_cdn_blocked = cdn;
  ok("CDN blocked entirely → same fallback, file links intact", cdn.links >= 15, JSON.stringify(cdn));
  await cctx.close();
} finally {
  await browser.close();
  server.close();
}
report.pass = pass; report.fail = failN;
if (process.env.DD_EXPLORE_JSON) fs.writeFileSync(process.env.DD_EXPLORE_JSON, JSON.stringify(report, null, 1));
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
