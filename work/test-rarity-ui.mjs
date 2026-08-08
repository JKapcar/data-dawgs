/* The projection-vs-rarity card, driven in a real browser.

   ⚠️ WHY A LIVE TEST AND NOT A UNIT TEST. work/test-frontier.js already proves the maths.
   What it cannot prove is that the card is wired up, that the Worker branch is the one
   that actually runs, that the chart has as many marks as there are points, or that the
   honesty note is still on the page. Every one of those has a plausible way to silently
   go missing — a renamed id, a card that renders before its container has a width, a note
   someone shortened. So this drives the real page: demo slate, solve, trace, then read
   the DOM back.

   ⚠️ THE SHEET MUST BE VISIBLE FIRST. The chart sizes its viewBox to clientWidth, and a
   hidden section measures 0. Switching to the Portfolio sheet is not test decoration.

   Run: node work/test-rarity-ui.mjs      (from the repo root)
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8921, r));

const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://127.0.0.1:8921/dfs.html", { waitUntil: "load" });

/* ---------------------------------------------------------------- set the page up */
await p.evaluate(() => { localStorage.removeItem("dd-dfs-v1"); });
await p.reload({ waitUntil: "load" });
await p.click("#salDemo");
await p.evaluate(() => {
  document.getElementById("cfCount").value = "12";
  document.getElementById("cfTime").value = "20";
});
await p.click('#fsTabs button[data-s="solver"]');
await p.click("#solveGo");
await p.waitForFunction(() => document.getElementById("solveGo").disabled === false && /in \d/.test(document.getElementById("solveState").textContent), null, { timeout: 90000 });
const built = await p.evaluate(() => document.querySelectorAll("#luList .lu").length);
ok("the demo slate solved into a pool of lineups", built > 0, `${built} lineups`);

await p.click('#fsTabs button[data-s="exposure"]');
await p.waitForTimeout(150);

/* ---------------------------------------------------------------- before tracing */
{
  const s = await p.evaluate(() => ({
    card: !!document.getElementById("rarityCard"),
    visible: !document.getElementById("rarityCard").hidden,
    chart: document.getElementById("rarityChart").innerHTML.length,
    note: document.getElementById("rarityNote").textContent.length,
    btn: document.getElementById("rarityGo").textContent.trim()
  }));
  ok("the card exists and shows once a pool is built", s.card && s.visible);
  ok("nothing is drawn, and nothing is claimed, before the sweep runs", s.chart === 0 && s.note === 0, `chart ${s.chart}B note ${s.note}B`);
  ok("the button says what it will do", /frontier/i.test(s.btn), s.btn);
}

/* ---------------------------------------------------------------- trace it */
await p.click("#rarityGo");
await p.waitForFunction(() => document.getElementById("rarityGo").disabled === false, null, { timeout: 90000 });
await p.waitForTimeout(200);

const R = await p.evaluate(() => {
  const card = document.getElementById("rarityCard");
  const svg = document.getElementById("raritySvg");
  const d = card.dataset;
  return {
    points: d.points ? +d.points : 0,
    solves: d.solves ? +d.solves : 0,
    capped: d.capped === "true",
    overlay: d.lineups ? +d.lineups : 0,
    unavailable: d.unavailable || null,
    squares: svg ? svg.querySelectorAll("rect").length : -1,
    dots: svg ? svg.querySelectorAll("circle").length : -1,
    paths: svg ? svg.querySelectorAll("path").length : -1,
    aria: svg ? svg.getAttribute("aria-label") : "",
    costSvg: document.getElementById("rarityCost").querySelectorAll("svg").length,
    costSteps: document.getElementById("rarityCost").querySelectorAll("line.cstep").length,
    costGrid: document.getElementById("rarityCost").querySelectorAll("line:not(.cstep)").length,
    note: document.getElementById("rarityNote").textContent,
    stats: [...document.querySelectorAll("#rarityStats .sl")].map(e => e.textContent),
    legend: !document.getElementById("rarityLegend").hidden,
    rows: document.querySelectorAll("#rarityTabT tbody tr").length,
    tabHidden: document.getElementById("rarityTab").hidden,
    expMeta: document.getElementById("expMeta").textContent,
    vb: svg ? svg.getAttribute("viewBox") : ""
  };
});
const shownLineups = +(R.expMeta.match(/\d+/) || [0])[0];

ok("the sweep produced a frontier", R.points >= 2 && !R.unavailable,
  `${R.points} points, unavailable=${R.unavailable}`);
ok("it ran real solves and says how many", R.solves >= 2 && R.note.indexOf(String(R.solves)) >= 0,
  `${R.solves} solves`);
ok("one square per frontier point, no more and no fewer", R.squares === R.points, `${R.squares} squares vs ${R.points} points`);
ok("one dot per lineup in the portfolio overlay", R.dots === shownLineups && R.overlay === shownLineups,
  `${R.dots} dots, overlay ${R.overlay}, pool ${shownLineups}`);
ok("the frontier is drawn as a single path", R.paths === 1, String(R.paths));
ok("the cost curve has exactly one step per frontier segment", R.costSteps === R.points - 1,
  `${R.costSteps} steps for ${R.points - 1} segments`);
ok("and at least two labelled decades to read them against", R.costGrid >= 2, `${R.costGrid} gridlines`);

/* ---- the honesty half: the chart must not read as more than it is ---- */
ok("⚠️ the note says the line is the hull, not the frontier", /convex hull, not the frontier/i.test(R.note), R.note.slice(0, 90));
ok("⚠️ the note says the hull is a floor", /floor/i.test(R.note));
ok("⚠️ the note says ownership is imported, not observed", /not an observation of it/i.test(R.note));
ok("⚠️ a capped sweep says it stopped on the budget", !R.capped || /budget rather than on convergence/i.test(R.note));

/* ---- accessibility: two series, so a legend; a table twin; a describing label ---- */
ok("a legend is present for the two mark kinds", R.legend);
ok("the svg carries a describing aria-label with real numbers", /projected points against cumulative ownership/i.test(R.aria) && /\d/.test(R.aria));
ok("the aria-label points at the table rather than pretending to be it", /table below/i.test(R.aria));
ok("a table view exists with one row per frontier point", R.rows === R.points, `${R.rows} rows vs ${R.points}`);
ok("the table starts collapsed", R.tabHidden === true);
ok("the cost curve is its own plot, not a second axis on the first",
  R.costSvg === 1, `${R.costSvg} svg in the cost container`);
ok("the viewBox is sized to the live container, not a fixed width",
  /^0 0 \d+ 260$/.test(R.vb) && +R.vb.split(" ")[2] > 400, R.vb);
ok("the headline stats name the gap the portfolio gives up",
  R.stats.some(s => /gives up/i.test(s)), R.stats.join(" | "));

/* ---- the table toggle is real ---- */
await p.click("#rarityTabGo");
const t2 = await p.evaluate(() => ({
  hidden: document.getElementById("rarityTab").hidden,
  aria: document.getElementById("rarityTabGo").getAttribute("aria-expanded"),
  label: document.getElementById("rarityTabGo").textContent.trim()
}));
ok("the toggle opens the table and says so to a screen reader", t2.hidden === false && t2.aria === "true" && /hide/i.test(t2.label));

/* ---- the table the user reads must be internally consistent ---- */
const tableOk = await p.evaluate(() => {
  const rows = [...document.querySelectorAll("#rarityTabT tbody tr")].map(tr => {
    const c = tr.querySelectorAll("td");
    return { own: parseFloat(c[0].textContent), proj: parseFloat(c[1].textContent),
             rate: parseFloat(c[3].textContent) };
  });
  const rising = rows.every((r, i) => i === 0 || (r.own > rows[i - 1].own && r.proj > rows[i - 1].proj));
  // the published rate must be the chord slope to the NEXT row, to the precision printed
  const rates = rows.slice(0, -1).every((r, i) =>
    Math.abs(r.rate - (rows[i + 1].proj - r.proj) / (rows[i + 1].own - r.own)) < 0.06);
  const lastBlank = rows[rows.length - 1] && isNaN(rows[rows.length - 1].rate);
  const falling = rows.slice(0, -2).every((r, i) => r.rate >= rows[i + 1].rate - 1e-9);
  return { rising, rates, lastBlank, falling, n: rows.length };
});
ok("the table rises on both axes, the way the chart does", tableOk.rising);
ok("⚠️ each published exchange rate is the chord slope to the next row", tableOk.rates);
ok("the last row has no next point to cost anything", tableOk.lastBlank);
ok("the exchange rate falls down the table — the curve is concave", tableOk.falling);

/* ---- the block Ask Toto reads must carry the same caveat the chart does ---- */
const toto = await p.evaluate(() => {
  const c = window.DD_BOTCTX;
  return c && typeof c.ctx === "function" ? c.ctx() : null;
});
if (toto == null) ok("Ask Toto context hook found", false, "window.DD_BOTCTX.ctx() not reachable");
else {
  ok("⚠️ Toto is told the curve is a hull, not the frontier", /CONVEX HULL OF THE FRONTIER, NOT THE FRONTIER/.test(toto));
  ok("⚠️ Toto is told what words not to use", /never "the best lineup at that ownership"/.test(toto));
  ok("Toto gets the vocabulary for cumulative own", /Cumulative own = the sum of the projected ownership/.test(toto));
}

/* ---- rebuilding the pool must invalidate the overlay rather than mixing pools ---- */
await p.click('#fsTabs button[data-s="solver"]');
await p.evaluate(() => { document.getElementById("cfCount").value = "6"; });
await p.click("#solveGo");
await p.waitForFunction(() => document.getElementById("solveGo").disabled === false, null, { timeout: 90000 });
await p.click('#fsTabs button[data-s="exposure"]');
await p.waitForTimeout(200);
const after = await p.evaluate(() => ({
  points: document.getElementById("rarityCard").dataset.points || null,
  chart: document.getElementById("rarityChart").innerHTML.length,
  note: document.getElementById("rarityNote").textContent.length,
  meta: document.getElementById("expMeta").textContent
}));
ok("⚠️ a new pool clears the old frontier instead of overlaying the wrong lineups",
  after.points === null && after.chart === 0 && after.note === 0,
  `points=${after.points} chart=${after.chart}B meta=${after.meta}`);
const toto2 = await p.evaluate(() => window.DD_BOTCTX.ctx());
ok("and Toto is told there is no frontier rather than describing the old one",
  /No projection-vs-rarity frontier has been traced/.test(toto2) && !/CONVEX HULL/.test(toto2));

/* ---- refusals ----
   ⚠️ Only the ones a user can actually reach from this page are driven here. Zero
   ownership cannot be produced through the UI without hand-editing every pool row, and
   switching the site to showdown clears the lineup pool, which hides this whole card. So
   both refusals are proved against the engine in work/test-frontier.js, and what is
   checked here is that the page still carries the wording that fires them. */
const guards = await p.evaluate(() => document.documentElement.outerHTML);
ok("the page still guards the no-ownership case in words", /No ownership\.<\/b> This chart is entirely about ownership/.test(guards));
ok("the page still explains the showdown refusal", /Not available on a showdown slate/.test(guards));

ok("no uncaught page errors throughout", errs.length === 0, errs.slice(0, 3).join(" | "));

await b.close(); server.close();
console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
