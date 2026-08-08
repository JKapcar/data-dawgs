/* cfb.html — the College Football lab page.

   What this suite is actually defending:
   1. The page renders 136 teams from the real /data/ files, with no typed-in numbers.
   2. The matchup calculator reproduces the transform the registry PUBLISHES, checked
      against an independent implementation of the published formula string's parameters
      — not against a copy of the page's own arithmetic.
   3. It FAILS CLOSED. Strip `matchup_probability` out of the response and the calculator
      must refuse rather than fall back to a formula typed into the page.
   4. Observed and modelled stay in separate column bands, because the source files keep
      them separate and a blended column is the one thing this data cannot support.
   5. No sideways overflow at 320, which is where every previous page has broken.
   6. The honesty copy is present. It is load-bearing, not decoration. */
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
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8919, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const errs = [];

// the truth the page must agree with, read from the file rather than from the page
const teamsEnv = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cfb-teams.json"), "utf8"));
const sysDef = teamsEnv.data.systems.find(s => s.system_id === "dd-cfb-elo");
const MX = sysDef.matchup_probability;
const TEAMS = teamsEnv.data.teams;

/* ---------------------------------------------------------------- render ---- */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("render: " + e.message));
  await p.goto("http://127.0.0.1:8919/cfb.html", { waitUntil: "load" });
  await p.waitForFunction(() => document.querySelectorAll("#cfbTblBody tr").length > 10, null, { timeout: 15000 });

  /* The table opens capped. Prove the cap is a cap and not a ceiling on the data:
     the count line must report the true total while the cap is on, and the button
     must reveal every row. */
  const capped = await p.evaluate(() => ({
    rows: document.querySelectorAll("#cfbTblBody tr").length,
    btn: document.getElementById("cfbTblMore").textContent,
    count: document.getElementById("cfbCount").textContent
  }));
  ok("the explorer opens capped", capped.rows === 30, String(capped.rows));
  ok("…and says so on the button", /show all 136/i.test(capped.btn), capped.btn);
  ok("…while the count line still reports every match",
    capped.count.indexOf(String(TEAMS.length)) >= 0, capped.count);
  await p.evaluate(() => document.getElementById("cfbTblMore").click());
  await p.waitForFunction(() => document.querySelectorAll("#cfbTblBody tr").length > 100, null, { timeout: 5000 });

  const r = await p.evaluate(() => ({
    rows: document.querySelectorAll("#cfbTblBody tr").length,
    dots: document.querySelectorAll("#cfbScatter circle").length,
    homeOpts: document.querySelectorAll("#cfbHome option").length,
    confOpts: document.querySelectorAll("#cfbConf option").length,
    bands: Array.from(document.querySelectorAll("#cfbTbl thead tr.cfbgrp th")).map(t => t.textContent.trim()),
    mxVisible: !document.getElementById("cfbMxOut").hidden,
    formula: document.getElementById("cfbMxFormula").textContent,
    count: document.getElementById("cfbCount").textContent,
    asOf: document.getElementById("cfbTblAsOf").textContent
  }));
  ok("136 team rows render", r.rows === TEAMS.length, `${r.rows} vs ${TEAMS.length}`);
  ok("every team is a dot (plus the highlight ring)", r.dots === TEAMS.length + 1, String(r.dots));
  ok("both team pickers list every team", r.homeOpts === TEAMS.length, String(r.homeOpts));
  ok("conference filter lists every conference", r.confOpts === new Set(TEAMS.map(t => t.conference)).size + 1);
  ok("observed and modelled are separate column bands",
    r.bands.length === 2 && /observed/i.test(r.bands[0]) && /modelled/i.test(r.bands[1]), r.bands.join(" | "));
  ok("the modelled band says retrodictive and ungraded",
    /retrodictive/i.test(r.bands[1]) && /ungraded/i.test(r.bands[1]), r.bands[1]);
  ok("calculator shows output on load", r.mxVisible);
  ok("the formula shown is the file's published string", r.formula === MX.formula, r.formula);
  ok("the count line names the real total", r.count.indexOf(String(TEAMS.length)) >= 0, r.count);
  ok("the table carries the envelope date", r.asOf.indexOf(teamsEnv.as_of) >= 0, r.asOf);

  /* -------- the calculator, against an independent implementation -------- */
  const strengths = Object.fromEntries(TEAMS.map(t => [t.team_slug, t.systems["dd-cfb-elo"].team_strength]));
  const expect = (hs, as, neutral) => {
    const hfa = neutral ? MX.neutral_site_home_field_elo : MX.home_field_elo;
    return 1 / (1 + Math.pow(10, -(strengths[hs] - strengths[as] + hfa) / MX.elo_scale));
  };
  const cases = [
    ["indiana", "ohio-state", false],
    ["ohio-state", "indiana", false],
    ["indiana", "ohio-state", true],
    [TEAMS[TEAMS.length - 1].team_slug, "indiana", false]
  ];
  for (const [hs, as, neutral] of cases) {
    const got = await p.evaluate(async ([hs, as, neutral]) => {
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("change")); };
      set("cfbHome", hs); set("cfbAway", as); set("cfbVenue", neutral ? "neutral" : "home");
      await new Promise(r => setTimeout(r, 30));
      return document.getElementById("cfbMxHome").textContent;
    }, [hs, as, neutral]);
    const want = (expect(hs, as, neutral) * 100).toFixed(1) + "%";
    ok(`matchup ${hs} vs ${as}${neutral ? " (neutral)" : ""} matches the published transform`,
      got.indexOf(want) >= 0, `page said "${got}", formula says ${want}`);
  }
  // the venue adjustment must actually do something, or the neutral case proves nothing
  {
    const home = await p.evaluate(async () => {
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("change")); };
      set("cfbHome", "indiana"); set("cfbAway", "ohio-state"); set("cfbVenue", "home");
      await new Promise(r => setTimeout(r, 30));
      return document.getElementById("cfbMxHome").textContent;
    });
    const neut = await p.evaluate(async () => {
      const e = document.getElementById("cfbVenue"); e.value = "neutral"; e.dispatchEvent(new Event("change"));
      await new Promise(r => setTimeout(r, 30));
      return document.getElementById("cfbMxHome").textContent;
    });
    ok("neutral site changes the answer", home !== neut, `${home} / ${neut}`);
  }
  // same team twice must refuse rather than print 50%
  {
    const refused = await p.evaluate(async () => {
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("change")); };
      set("cfbHome", "indiana"); set("cfbAway", "indiana");
      await new Promise(r => setTimeout(r, 30));
      return { hidden: document.getElementById("cfbMxOut").hidden, msg: document.getElementById("cfbMxErr").textContent };
    });
    ok("a team against itself is refused, not priced at 50%", refused.hidden === true && /different/i.test(refused.msg), refused.msg);
  }

  /* -------- the filter scopes every section at once -------- */
  const sec = await p.evaluate(async () => {
    const e = document.getElementById("cfbConf");
    e.value = "SEC"; e.dispatchEvent(new Event("change"));
    await new Promise(r => setTimeout(r, 60));
    return {
      rows: document.querySelectorAll("#cfbTblBody tr").length,
      lit: document.querySelectorAll('#cfbScatter circle[fill="var(--accent)"]').length,
      dim: document.querySelectorAll('#cfbScatter circle[fill="var(--ink-3)"]').length,
      count: document.getElementById("cfbCount").textContent
    };
  });
  const secN = TEAMS.filter(t => t.conference === "SEC").length;
  ok("filtering scopes the table", sec.rows === secN, `${sec.rows} vs ${secN}`);
  ok("filtering emphasises rather than deletes on the chart",
    sec.lit === secN && sec.dim === TEAMS.length - secN, `lit ${sec.lit}, dim ${sec.dim}`);
  ok("the count line reports the slice", sec.count.indexOf("SEC") >= 0, sec.count);
  await p.evaluate(() => { const e = document.getElementById("cfbConf"); e.value = ""; e.dispatchEvent(new Event("change")); });

  /* -------- sorting -------- */
  const sorted = await p.evaluate(async () => {
    const th = Array.from(document.querySelectorAll("#cfbTbl thead tr.cfbhd th")).find(t => t.getAttribute("data-k") === "elo");
    th.click(); await new Promise(r => setTimeout(r, 60));
    const first = document.querySelector("#cfbTblBody tr td").textContent;
    th.click(); await new Promise(r => setTimeout(r, 60));
    const flipped = document.querySelector("#cfbTblBody tr td").textContent;
    return { first, flipped, aria: th.getAttribute("aria-sort") };
  });
  const byElo = TEAMS.slice().sort((a, b) => b.systems["dd-cfb-elo"].team_strength - a.systems["dd-cfb-elo"].team_strength);
  ok("sorting by Elo puts the top-rated team first", sorted.first === byElo[0].team, sorted.first);
  ok("clicking again reverses it", sorted.flipped === byElo[byElo.length - 1].team, sorted.flipped);
  ok("the sorted column reports aria-sort", sorted.aria === "ascending" || sorted.aria === "descending", String(sorted.aria));

  /* -------- the lazy sections actually arrive -------- */
  await p.evaluate(() => document.getElementById("divergence").scrollIntoView());
  await p.waitForFunction(() => document.querySelectorAll("#cfbDivBody tr").length > 10, null, { timeout: 15000 });
  await p.evaluate(() => document.getElementById("cfbDivMore").click());
  await p.waitForFunction(() => document.querySelectorAll("#cfbDivBody tr").length > 100, null, { timeout: 5000 });
  const lazy = await p.evaluate(() => ({
    div: document.querySelectorAll("#cfbDivBody tr").length,
    kpis: document.querySelectorAll("#cfbEloKpis .cfbkpi").length,
    kpiText: document.getElementById("cfbEloKpis").textContent,
    eloCap: document.getElementById("cfbEloCap").textContent,
    divCap: document.getElementById("cfbDivCap").textContent
  }));
  const divEnv = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cfb-record-divergence.json"), "utf8"));
  const eloEnv = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cfb-elo.json"), "utf8"));
  ok("every divergence row renders", lazy.div === divEnv.data.rows.length, `${lazy.div} vs ${divEnv.data.rows.length}`);
  ok("the backtest strip renders", lazy.kpis >= 3, String(lazy.kpis));
  ok("the backtest Brier comes from the file",
    lazy.kpiText.indexOf(eloEnv.data.backtest.elo_baseline.brier_home_win.toFixed(2)) >= 0, lazy.kpiText.slice(0, 120));
  /* The market number is the one figure here that could be read as "the model lost, so
     the market is better." It must never appear without the timing caveat beside it. */
  ok("the market comparison is present and caveated",
    /market/i.test(lazy.kpiText) && /flatters the market/i.test(lazy.eloCap)
      && /observation\s+timestamp/i.test(lazy.eloCap), lazy.eloCap.slice(0, 160));
  ok("the divergence caption refuses forward value and team labels",
    /no forward value/i.test(lazy.divCap) && /no team labels/i.test(lazy.divCap), lazy.divCap.slice(0, 160));

  await ctx.close();
}

/* ------------------------------------------------------- honesty copy ---- */
{
  const html = fs.readFileSync(path.join(ROOT, "cfb.html"), "utf8");
  const must = [
    ["2025 only", /<b>2025 only\.<\/b>/],
    ["no 2026 schedule", /no 2026 schedule in this\s+data/],
    ["one rating, not a consensus", /It is one rating, not a consensus/],
    ["retrodictive, not prospective", /It is retrodictive, not prospective/],
    ["ledger empty by design", /empty by design/],
    ["no market prices", /There are no market prices on this page/],
    ["not closing lines", /not closing lines/],
    ["hypothetical, not a forecast", /This is a hypothetical, not a forecast/],
    ["residual, not luck", /not luck/],
    ["no predictive label", /descriptive/]
  ];
  for (const [name, re] of must) ok("honesty copy: " + name, re.test(html));
  // a headline figure typed into the page is a future lie; they must all be read at runtime
  for (const n of ["0.7017", "0.1862", "0.1814", "0.7241", "0.5953", "0.2409"])
    ok(`no hardcoded ${n}`, html.indexOf(n) < 0);
  ok("the page is in the service worker's core list",
    fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").indexOf('"/cfb.html"') >= 0);
}

/* ------------------------------------------------- narrow viewport ---- */
for (const W of [320, 390]) {
  const ctx = await b.newContext({ viewport: { width: W, height: 800 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(`${W}: ${e.message}`));
  await p.goto("http://127.0.0.1:8919/cfb.html", { waitUntil: "load" });
  await p.waitForFunction(() => document.querySelectorAll("#cfbTblBody tr").length > 10, null, { timeout: 15000 });
  await p.evaluate(() => document.getElementById("cfbTblMore").click());
  await p.evaluate(() => document.getElementById("divergence").scrollIntoView());
  await p.waitForFunction(() => document.querySelectorAll("#cfbDivBody tr").length > 10, null, { timeout: 15000 });
  await p.evaluate(() => document.getElementById("cfbDivMore").click());
  const r = await p.evaluate(() => ({
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // the tables are allowed to scroll sideways INSIDE their wrapper; that is the fix,
    // not the bug, so prove the wrapper is the thing that scrolls
    wrapScrolls: document.querySelector(".cfbwrap").scrollWidth > document.querySelector(".cfbwrap").clientWidth
  }));
  ok(`no document overflow at ${W}`, r.over <= 1, `+${r.over}px`);
  if (W === 320) ok("the table scroller is what absorbs it", r.wrapScrolls === true);
  await ctx.close();
}

/* ------------------------------------------------------- fail closed ---- */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("failclosed: " + e.message));
  /* Serve a doctored cfb-teams.json with the published transform removed. The page must
     say it has nothing to apply — NOT quietly fall back to a formula typed into the page.
     Without this test, deleting the guard would look like a passing build. */
  await p.route("**/data/cfb-teams.json", async route => {
    const raw = fs.readFileSync(path.join(ROOT, "data/cfb-teams.json"), "utf8");
    const j = JSON.parse(raw);
    delete j.data.systems[0].matchup_probability;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  });
  await p.goto("http://127.0.0.1:8919/cfb.html", { waitUntil: "load" });
  await p.waitForFunction(() => document.querySelectorAll("#cfbTblBody tr").length > 10, null, { timeout: 15000 });
  const r = await p.evaluate(() => ({
    hidden: document.getElementById("cfbMxOut").hidden,
    msg: document.getElementById("cfbMxErr").textContent,
    rows: document.querySelectorAll("#cfbTblBody tr").length
  }));
  ok("no published transform ⇒ the calculator refuses", r.hidden === true && /will not guess/i.test(r.msg), r.msg);
  ok("…and the rest of the page still works", r.rows === 30, String(r.rows));
  await ctx.close();
}

ok("no script errors anywhere", errs.length === 0, errs.slice(0, 4).join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
