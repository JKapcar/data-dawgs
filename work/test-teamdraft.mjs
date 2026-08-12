/* teamdraft.html — the 2026 NFL team draft pool.

   What this suite is actually defending:

   1. NOTHING IS TYPED INTO THE PAGE. Every figure has to come out of
      /data/draft-2026.json. The test reads the file and asserts the DOM agrees, so a
      hardcoded number fails here rather than going stale the first time a pick lands.
   2. THE ARITHMETIC IS CONSERVED, PRESEASON AND IN-SEASON. Banked plus projected must
      equal 272 at every point in the season. It is the strongest test that the
      three-tier composite is wired correctly.
   3. THE IN-SEASON SWITCHOVER WORKS BEFORE THERE IS ANY IN-SEASON DATA. Nothing has
      been played, so the only way to know the composite is correct is to serve a
      payload with settled games and assert the page handles it. Done below.
   4. THE TRACKER'S SCALE IS FIXED. The par rule's whole value is sitting in the same
      place every week; autoscaling to the leader would move it.
   5. IT FAILS LOUD. Serve a 500 and every view says so. An empty tracker reads as
      "nobody has any wins", which is a different and false claim.
   6. COLOUR IS NEVER THE ONLY CHANNEL, and the palette is the one validated against
      THIS site's surfaces, not the mockup's near-black field.
   7. NOTHING CLAIMS A RESULT. The page's own tier chip is Pup and no cell asserts a win.
   8. No sideways overflow at 375/390/1280, both themes, no script errors.

   Run:  cd work && node test-teamdraft.mjs
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENV = JSON.parse(fs.readFileSync(path.join(ROOT, "data/draft-2026.json"), "utf8"));
const D = ENV.data;
const html = fs.readFileSync(path.join(ROOT, "teamdraft.html"), "utf8");
const EPS = 2e-5;

/* A payload with the draft FINISHED — nothing may assume 25 picks. */
function completed() {
  const c = JSON.parse(JSON.stringify(ENV));
  const pool = [...c.data.undrafted];
  c.data.board.filter(b => !b.team).forEach(b => {
    const team = pool.shift();
    c.data.picks.push({ pick: b.pick, round: b.round, drafter: b.drafter, team });
    Object.assign(b, { team, ew: c.data.teams[team].ew, best_available: team,
      best_available_ew: c.data.teams[team].ew, delta: 0, rank_at_pick: 1, available_at_pick: 1 });
    const dr = c.data.drafters[b.drafter];
    dr.roster.push(team);
    dr.ew = Math.round((dr.ew + c.data.teams[team].ew) * 100) / 100;
    dr.projected = Math.round((dr.projected + c.data.teams[team].projected) * 100) / 100;
    dr.picks_remaining -= 1;
    const w = c.data.wins_tracker[b.drafter];
    w.teams[b.round - 1] = team; w.rounds[b.round - 1] = 0; w.projected = dr.projected;
  });
  c.data.undrafted = [];
  c.data.picks_made = c.data.picks.length;
  return c;
}

/* A payload MID-SEASON: week 1 settled, one of them a tie. This is the only way to
   exercise the composite before September, and it is the part most likely to rot. */
function inSeason() {
  const c = JSON.parse(JSON.stringify(ENV));
  const played = new Set();
  let first = true;
  for (const [t, T] of Object.entries(c.data.teams)) {
    for (const g of T.schedule) {
      if (g.week !== 1) continue;
      const key = [t, g.opp].sort().join("|");
      const homeWin = first ? 0.5 : (t < g.opp ? 1 : 0);
      g.settled = true; g.tier = "settled";
      g.live = first ? 0.5 : (t < g.opp ? 1 : 0);
      if (!played.has(key)) { played.add(key); first = false; }
    }
    for (const g of T.schedule) if (g.week !== 1) { g.tier = g.week < 4 ? "market" : "model"; }
    T.banked = Math.round(T.schedule.filter(g => g.settled).reduce((a, g) => a + g.live, 0) * 10) / 10;
    T.remaining = Math.round(T.schedule.filter(g => !g.settled).reduce((a, g) => a + g.live, 0) * 1000) / 1000;
    T.projected = Math.round((T.banked + T.remaining) * 1000) / 1000;
  }
  for (const n of c.data.draft_order) {
    const r = c.data.drafters[n].roster;
    const b = r.reduce((a, t) => a + c.data.teams[t].banked, 0);
    const rem = r.reduce((a, t) => a + c.data.teams[t].remaining, 0);
    Object.assign(c.data.drafters[n], { banked: +b.toFixed(1), remaining: +rem.toFixed(3),
      projected: +(b + rem).toFixed(3) });
    const w = c.data.wins_tracker[n];
    w.rounds = w.teams.map(t => t ? c.data.teams[t].banked : null);
    w.total = +w.rounds.reduce((a, v) => a + (v || 0), 0).toFixed(1);
    w.projected = c.data.drafters[n].projected;
  }
  c.data.basis = { ...c.data.basis, mode: "in-season", settled_games: played.size,
    tiers: { settled: played.size * 2, market: 0, model: 0, preseason: 0 } };
  return c;
}
const FULL = completed(), MID = inSeason();

let mode = "normal";                       // normal | full | mid | error
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/data/draft-2026.json") {
    if (mode === "error") { res.writeHead(500); return res.end("nope"); }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(mode === "full" ? FULL : mode === "mid" ? MID : ENV));
  }
  const f = path.join(ROOT, url);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : f.endsWith(".md") ? "text/markdown" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8927, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const errs = [];

async function open(opts = {}) {
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push((opts.tag || "page") + ": " + e.message));
  p.on("console", m => {
    if (m.type() !== "error") return;
    if (mode === "error" && /Failed to load resource/.test(m.text())) return;
    errs.push((opts.tag || "page") + " console: " + m.text());
  });
  await p.goto("http://127.0.0.1:8927/teamdraft.html", { waitUntil: "load" });
  if (opts.theme) await p.evaluate(t => { document.documentElement.dataset.theme = t; }, opts.theme);
  return { ctx, p };
}
const teamsOfBoth = (a, b) =>
  [...new Set([...D.drafters[a].roster, ...D.drafters[b].roster])];
const ready = p => p.waitForFunction(
  () => document.querySelectorAll("#tdRace .td-rrow").length === 8, null, { timeout: 15000 });

/* ------------------------------------------------------- source-level ------- */
{
  ok("the payload is the /data/ envelope, not a bare object",
    !!(ENV.as_of && ENV.source && ENV.data && ENV.tier && ENV.tier_meaning));
  ok("the page's own tier chip is Pup",
    (html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</) || [])[1]?.trim() === "Pup");
  const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
  const topEw = Math.max(...Object.values(D.teams).map(t => t.ew)).toFixed(2);
  ok("no team's expected wins are typed into the markup", !main.includes(topEw), topEw);
  ok("no drafter total is typed into the markup",
    !Object.values(D.drafters).some(v => v.ew && main.includes(v.ew.toFixed(2))));
  ok("the page is precached for offline", fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes('"/teamdraft.html"'));
  ok("the page is findable by crawlers",
    fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8").includes("/teamdraft.html"));
  ok("the page has an arena row in the surfaces map", (() => {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, "data/surfaces.json"), "utf8"));
    const r = s.data.find(x => x.page === "/teamdraft.html");
    return r && r.domain === "arena" && r.machine.some(m => m.url === "/data/draft-2026.json" && m.status === "live");
  })());
  ok("DDSheets is the shared component, not a fork",
    (html.match(/window\.DDSheets = function/g) || []).length === 1
    && html.includes("LIFTED VERBATIM from receipts.html"));
  ok("no payment or contact detail reached the public page",
    !/venmo|@gmail|paypal|zelle/i.test(html));
  ok("no payment or contact detail reached the payload",
    !/venmo|@gmail|paypal|zelle/i.test(JSON.stringify(ENV)));

  /* Check 4: the tracker ceiling is a constant, not a max() over the field. */
  ok("the tracker scale is fixed, not autoscaled to the leader",
    /TRACK_MAX = 48/.test(html) && !/TRACK_MAX = Math\.max/.test(html));
  /* Check 6: the palette is the re-snapped one. The mockup's mint fails on this
     site's cream at 1.56:1 and must never come back. */
  ok("the mockup's unvalidated palette did not ship", !/#5FE3C0|#B4A5F5|#A8821A/i.test(html));
  ok("the Rules tab is styled to be noticed", /#tab-rules\{/.test(html));
  /* ⚠️ Shading means SELECTED. A permanent wash on Rules made it look like the open
     tab from every other sheet — two things competing to say "you are here". */
  ok("the tab wash belongs to the selected tab, not to Rules",
    /\.sheet-tab\.on\{background:color-mix/.test(html)
    && !/#tab-rules\{[^}]*background:color-mix/.test(html));
  ok("the page clears the remembered sheet so it always opens on Pool",
    /removeItem\("dd-sheet-teamdraft"\)/.test(html));
  ok("the sheet labels are short enough not to wrap",
    /label:"Pool"/.test(html) && /label:"Roster"/.test(html) && /label:"Rules"/.test(html));
  ok("both themes define all eight drafter slots",
    (html.match(/--d[1-8]:#[0-9a-f]{6}/gi) || []).length === 16);

  /* The revision removed three restatements of the same thesis. */
  ok("the standalone Conservation section is gone", !/id="conservation"/.test(html));
  ok("the fixed-payload caveat is gone from Week by week",
    !/do <b>not<\/b> re-add to the\s*expected-wins figures/.test(html));
}

/* ------------------------------------------------ arithmetic and the basis --- */
{
  const teams = D.teams;
  const total = Object.values(teams).reduce((a, t) => a + t.ew, 0);
  ok("the 32 expected-win values sum to the league total",
    Math.abs(total - D.total_wins) < 0.05, total.toFixed(2));
  const banked = Object.values(teams).reduce((a, t) => a + t.banked, 0);
  const remaining = Object.values(teams).reduce((a, t) => a + t.remaining, 0);
  ok("banked plus projected equals the season", Math.abs(banked + remaining - D.total_wins) < 0.05,
    (banked + remaining).toFixed(3));
  const games = Object.values(D.overlap).reduce((a, r) => a + Object.values(r).reduce((x, y) => x + y, 0), 0) / 2;
  ok("the head-to-head matrix holds exactly one season of games", games === D.total_wins, String(games));
  ok("par is the league total over the number of drafters",
    Math.abs(D.par - D.total_wins / D.draft_order.length) < 1e-9);
  ok("the diagnostics block reports no hard failure",
    (D.diagnostics?.hard_failures || []).length === 0, (D.diagnostics?.hard_failures || []).join(", "));

  /* the corrected payload: the supplied schedule now reconciles to expected wins */
  const worstRaw = Math.max(...Object.values(teams).map(t =>
    Math.abs(t.schedule.reduce((a, g) => a + g.wp, 0) - t.ew)));
  ok("the supplied game probabilities re-add to expected wins", worstRaw < 0.05, worstRaw.toFixed(5));
  const worstFit = Math.max(...Object.values(teams).map(t =>
    Math.abs(t.schedule.reduce((a, g) => a + g.wpf, 0) - t.ew)));
  ok("the refit still lands, as the regression guard", worstFit < 0.01, worstFit.toFixed(5));
  let asym = 0;
  for (const [t, v] of Object.entries(teams))
    for (const g of v.schedule) {
      const back = teams[g.opp].schedule.find(x => x.week === g.week && x.opp === t);
      if (!back || Math.abs(back.wpf + g.wpf - 1) > EPS) asym++;
    }
  ok("both sides of every game still sum to 1 after the refit", asym === 0, String(asym));

  /* every game says where its number came from */
  const tiers = new Set(Object.values(teams).flatMap(t => t.schedule.map(g => g.tier)));
  ok("every game carries a basis tier",
    Object.values(teams).every(t => t.schedule.every(g => g.tier)), [...tiers].join(","));
  ok("the payload names its mode and its feeds",
    ["preseason", "in-season"].includes(D.basis.mode) && D.basis.feeds.results && D.basis.feeds.prices);
  ok("the switch is data-driven, not a date",
    /data-driven/i.test(D.basis.switch) && !/\d{4}-\d{2}-\d{2}/.test(D.basis.switch));

  const sim = D.simulation;
  ok("finishing probabilities sum to one across the eight drafters",
    Math.abs(D.draft_order.reduce((a, n) => a + sim.drafters[n].p_first, 0) - 1) < 0.005);
  const key = D.basis.mode === "in-season" ? "projected" : "ew";
  const drift = Math.max(...D.draft_order.map(n => Math.abs(sim.drafters[n].mean - D.drafters[n][key])));
  ok(`simulated roster means land on each roster's ${key}`, drift < 0.15, drift.toFixed(3));
  ok("the tie-for-first rate is recorded rather than hidden", typeof sim.tie_for_first_rate === "number");
  ok("the simulation states that it has no tie outcome", sim.no_tie_outcome === true);

  /* the tracker's rounds are derived from the board, never typed */
  ok("each tracker row's rounds match that drafter's draft picks", D.draft_order.every(n => {
    const w = D.wins_tracker[n];
    return w.teams.every((t, i) => {
      const b = D.board.find(x => x.drafter === n && x.round === i + 1);
      return (t || null) === (b?.team || null);
    });
  }));
  ok("no game has been played: every tracker total is zero",
    Object.values(D.wins_tracker).every(w => w.total === 0));
}

/* ------------------------------------------------------------ rendering ----- */
{
  const { ctx, p } = await open({ tag: "render" });
  await ready(p);
  const got = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll(".sheet-tab")].map(t => t.dataset.id),
    trackRows: document.querySelectorAll("#tdRace .td-rrow").length,
    ghosts: document.querySelectorAll("#tdRace .td-ghost").length,
    pars: document.querySelectorAll("#tdRace .td-rpar").length,
    ticks: [...document.querySelectorAll("#tdRace .td-scale span")].map(s => s.textContent),
    aria: [...document.querySelectorAll("#tdRace .td-rrow")].map(r => r.getAttribute("aria-label")),
    discOpen: document.getElementById("tdDisc").open,
    trackTable: document.querySelectorAll("#tdTracker tbody tr").length,
    slices: document.querySelectorAll("#tdWheel .td-slice").length,
    wlabels: [...document.querySelectorAll("#tdWheel .td-wlab")].map(t => t.textContent.trim().split(/\s+/)[0]),
    needles: document.querySelectorAll("#tdWheel path[fill='var(--accent)']").length,
    ratio: [...document.querySelectorAll("#tdRatio tbody tr")].map(r => r.cells[0].textContent.trim()),
    cards: document.querySelectorAll("#tdCards .td-card").length,
    ladder: document.querySelectorAll("#tdLadder .td-row").length,
    cells: document.querySelectorAll("#tdMatrix .td-c").length,
    board: document.querySelectorAll("#tdBoard .td-bc").length,
    checks: document.querySelectorAll("#tdChecks .td-chk").length,
    perTeam: document.querySelectorAll("#tdPerTeam tbody tr").length,
    par: !!document.querySelector("#tdLadder .td-par"),
  }));

  ok("four sheets, pool first", got.tabs.join(",") === "pool,team,diag,rules", got.tabs.join(","));
  /* ⚠️ The Roster sheet is somebody's four teams. Defaulting it to the top of the
     expected-wins ladder opened it on the Rams — a club nobody in this league is
     called — and made the page read as though it were about NFL teams. */
  ok("the Roster sheet opens on a person, not an NFL team", await (async () => {
    await p.click('[data-sel="league:"]');
    await p.click('.sheet-tab[data-id="team"]');
    await p.waitForTimeout(250);
    const h = await p.evaluate(() => document.querySelector("#tdHero h2")?.textContent.trim());
    await p.click('.sheet-tab[data-id="pool"]');
    await p.waitForTimeout(150);
    return D.draft_order.includes(h);
  })());
  /* The rail filters two sheets; on the other two it is dead control. */
  ok("the rail is hidden where it does nothing", await (async () => {
    const seen = {};
    for (const id of ["pool", "team", "diag", "rules"]) {
      await p.click(`.sheet-tab[data-id="${id}"]`);
      await p.waitForTimeout(150);
      seen[id] = await p.evaluate(() => !document.querySelector(".td-rail").hidden);
    }
    await p.click('.sheet-tab[data-id="pool"]');
    await p.waitForTimeout(150);
    return seen.pool && seen.team && !seen.diag && !seen.rules;
  })());
  ok("the tracker opens the page with one row per drafter", got.trackRows === D.draft_order.length);
  ok("every tracker row draws the season still to play", got.ghosts === D.draft_order.length);
  ok("every tracker row carries the par rule", got.pars === D.draft_order.length);
  ok("the axis is 0 / 12 / 24 / 34 / 48", got.ticks.join(",") === "0,12,24,34,48", got.ticks.join(","));
  /* Colour cannot be the only carrier: every row has a text alternative naming the
     drafter and its numbers. */
  ok("every tracker row has a text alternative with the drafter and the numbers",
    got.aria.length === 8 && D.draft_order.every(n => got.aria.some(a => a.startsWith(n + ":"))));
  ok("the round-by-round table is a disclosure, collapsed by default", got.discOpen === false);
  ok("the disclosure still holds every drafter", got.trackTable === D.draft_order.length);

  ok("the ring has one slice per drafter", got.slices === D.draft_order.length);
  /* Labels outside the ring, one per slice, so nothing clips at 2.7%. */
  ok("every drafter is named outside the ring",
    D.draft_order.every(n => got.wlabels.includes(n)), got.wlabels.join(","));
  ok("there is exactly one needle", got.needles === 1, String(got.needles));
  ok("second place is a column, not a second needle", got.ratio.length === D.draft_order.length);

  ok("one card per drafter", got.cards === D.draft_order.length);
  ok("the ladder is all 32 teams", got.ladder === 32);
  ok("the matrix is 32 by 32", got.cells === 1024);
  ok("the board is one cell per pick slot", got.board === D.picks_total);
  ok("the diagnostics sheet renders every check", got.checks === D.diagnostics.checks.length);
  ok("the per-team table is all 32 rows", got.perTeam === 32);
  ok("the ladder par rule is drawn", got.par);

  /* selection reaches every view */
  const who = D.draft_order.find(n => D.drafters[n].internal_games > 0) || D.draft_order[0];
  await p.click(`[data-sel="drafter:${who}"]`);
  await p.waitForTimeout(180);
  const s = await p.evaluate(() => ({
    lit: [...document.querySelectorAll("#tdLadder .td-row.on .td-abbr")].map(e => e.textContent.trim()),
    outlined: document.querySelectorAll("#tdMatrix .td-c.in").length,
    undimmed: [...document.querySelectorAll("#tdWheel .td-slice")].filter(x => !x.classList.contains("dim")).length,
    ratioOn: document.querySelectorAll("#tdRatio tr.on").length,
    sheet: document.querySelector(".sheet-tab.on").dataset.id,
  }));
  const roster = D.drafters[who].roster;
  ok("selecting a drafter lights exactly their roster",
    s.lit.length === roster.length && roster.every(t => s.lit.includes(t)));
  ok("selecting a drafter outlines their own submatrix", s.outlined === roster.length ** 2);
  ok("selecting a drafter isolates their ring slice", s.undimmed === 1);
  ok("selecting a drafter highlights their ratio row", s.ratioOn === 1);
  /* A rail chip filters the sheet you are on; it must not teleport you. */
  ok("a rail chip does not jump sheets", s.sheet === "pool", s.sheet);

  /* Chips TOGGLE and selection is a set, so clear before testing the single-team
     case — otherwise the ladder click adds to the drafter already chosen, which is
     the multi-select behaviour tested separately below. */
  await p.click('[data-sel="league:"]');
  await p.waitForTimeout(120);
  /* clicking a TEAM on the pool sheet is a request to see it, so it does jump */
  await p.click('#tdLadder .td-row');
  await p.waitForTimeout(250);
  const jumped = await p.evaluate(() => ({
    sheet: document.querySelector(".sheet-tab.on").dataset.id,
    hero: document.querySelector("#tdHero h2")?.textContent.trim(),
    strips: document.querySelectorAll("#tdStrip .td-srow:not(.head)").length,
    curves: document.querySelectorAll("#tdCurves path").length,
    gameRows: document.querySelectorAll("#tdGameTable tbody tr").length,
    bases: [...new Set([...document.querySelectorAll("#tdGameTable .td-tierchip")].map(e => e.textContent.trim()))],
  }));
  const topTeam = Object.keys(D.teams).sort((a, x) => D.teams[x].ew - D.teams[a].ew)[0];
  ok("clicking a ladder bar opens the Team sheet", jumped.sheet === "team", jumped.sheet);
  ok("the Team sheet lands on the team that was clicked",
    jumped.hero === D.teams[topTeam].name, jumped.hero);
  /* Check: the all-32 default on these views is gone. */
  ok("the strip shows one team, not all 32", jumped.strips === 1, String(jumped.strips));
  ok("the curve shows one team, not all 32", jumped.curves === 2, String(jumped.curves));
  ok("every game in the table states its basis",
    jumped.gameRows === 17 && jumped.bases.length >= 1, jumped.bases.join(","));

  /* ---- multi-select: two rosters laid over each other ---------------------- */
  const [dA, dB] = D.draft_order;
  await p.click('[data-sel="league:"]');
  await p.waitForTimeout(100);
  await p.click(`[data-sel="drafter:${dA}"]`);
  await p.click(`[data-sel="drafter:${dB}"]`);
  await p.waitForTimeout(250);
  const multi = await p.evaluate(() => ({
    hero: document.querySelector("#tdHero h2")?.textContent.trim(),
    strips: document.querySelectorAll("#tdStrip .td-srow:not(.head)").length,
    quant: document.querySelectorAll("#tdQuant .td-qi").length,
    pressed: document.querySelectorAll('.td-chip[aria-pressed="true"]').length,
    ratioOn: document.querySelectorAll("#tdRatio tr.on").length,
    lit: document.querySelectorAll("#tdLadder .td-row.on").length,
  }));
  const both = teamsOfBoth(dA, dB);
  ok("two drafters can be selected at once", multi.pressed === 2, String(multi.pressed));
  ok("the hero names both", multi.hero === `${dA} vs ${dB}`, multi.hero);
  ok("every team from both rosters gets a strip", multi.strips === both.length,
    `${multi.strips} vs ${both.length}`);
  ok("every team from both rosters gets a curve legend chip", multi.quant === both.length);
  ok("both rosters light up on the ladder", multi.lit === both.length);
  ok("both drafters highlight in the ratio table", multi.ratioOn === 2, String(multi.ratioOn));

  await p.click(`[data-sel="drafter:${dA}"]`);
  await p.waitForTimeout(200);
  const one = await p.evaluate(() => ({
    hero: document.querySelector("#tdHero h2")?.textContent.trim(),
    strips: document.querySelectorAll("#tdStrip .td-srow:not(.head)").length,
  }));
  ok("toggling one drafter off leaves the other selected", one.hero === dB, one.hero);
  ok("the strip drops to the remaining roster",
    one.strips === D.drafters[dB].roster.length, String(one.strips));

  /* ⚠️ Tapping a second name ADDS. Silently dropping the first read as the page
     deselecting somebody behind your back. */
  ok("tapping a second name keeps the first", await (async () => {
    await p.click('.sheet-tab[data-id="pool"]');
    await p.waitForTimeout(120);
    await p.click('[data-sel="league:"]');
    await p.click('.sheet-tab[data-id="team"]');
    await p.waitForTimeout(220);
    const before = await p.evaluate(() =>
      document.querySelector("#tdHero h2")?.textContent.trim());
    const other = D.draft_order.find(n => n !== before);
    await p.click(`[data-sel="drafter:${other}"]`);
    await p.waitForTimeout(220);
    const after = await p.evaluate(() =>
      document.querySelector("#tdHero h2")?.textContent.trim());
    return after.includes(before) && after.includes(other);
  })());

  /* ...but an UNTOUCHED placeholder must not follow you to the Pool sheet either. */
  ok("an untouched placeholder is dropped when you leave the Roster sheet",
    await (async () => {
      await p.click('.sheet-tab[data-id="pool"]');
      await p.waitForTimeout(120);
      await p.click('[data-sel="league:"]');
      await p.click('.sheet-tab[data-id="team"]');
      await p.waitForTimeout(200);
      await p.click('.sheet-tab[data-id="pool"]');
      await p.waitForTimeout(200);
      return await p.evaluate(() =>
        document.querySelectorAll("#tdLadder .td-row.on").length) === 0;
    })());

  /* the Team sheet's placeholder must not survive as a selection nobody made */
  await p.click('[data-sel="league:"]');
  await p.waitForTimeout(120);
  await p.click(`[data-sel="drafter:${dA}"]`);
  await p.waitForTimeout(200);
  const clean = await p.evaluate(() =>
    document.querySelectorAll("#tdStrip .td-srow:not(.head)").length);
  ok("the sheet's default team does not linger once a real pick is made",
    clean === D.drafters[dA].roster.length, `${clean} vs ${D.drafters[dA].roster.length}`);

  /* "All 32" is a Pool control; on the Team sheet it reads Clear */
  await p.click('.sheet-tab[data-id="team"]');
  await p.waitForTimeout(180);
  ok("the Team sheet offers Clear, not the All 32 lever", await p.evaluate(() =>
    document.querySelector('[data-sel="league:"]')?.textContent.trim()) === "Clear");
  await p.click('.sheet-tab[data-id="pool"]');
  await p.waitForTimeout(200);
  ok("the Pool sheet keeps All 32", await p.evaluate(() =>
    document.querySelector('[data-sel="league:"]')?.textContent.trim()) === "All 32");

  await ctx.close();
}

/* ------------------------------------------- always opens on the pool ------- */
/* ⚠️ ITS OWN CONTEXT. DDSheets pushes the current sheet into location.hash, so a
   reload inside the main block carries a deep link — which correctly beats the
   default and would make this look broken. Fresh context, bare URL. */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8927/teamdraft.html", { waitUntil: "load" });
  await p.evaluate(() => localStorage.setItem("dd-sheet-teamdraft", "diag"));
  await p.goto("http://127.0.0.1:8927/teamdraft.html", { waitUntil: "load" });
  await ready(p);
  await p.waitForTimeout(200);
  ok("a remembered sheet does not override the Pool default",
    await p.evaluate(() => document.querySelector(".sheet-tab.on").dataset.id) === "pool");
  /* ...but a deep link still wins, which is why the hash is checked first. */
  await p.goto("http://127.0.0.1:8927/teamdraft.html#rules", { waitUntil: "load" });
  await ready(p);
  await p.waitForTimeout(200);
  ok("a #rules deep link still opens the Rules sheet",
    await p.evaluate(() => document.querySelector(".sheet-tab.on").dataset.id) === "rules");
  await ctx.close();
}

/* --------------------------------------------------- the season starts ------ */
{
  mode = "mid";
  const { ctx, p } = await open({ tag: "in-season" });
  await ready(p);
  const got = await p.evaluate(() => ({
    segs: document.querySelectorAll("#tdRace .td-seg").length,
    ghosts: document.querySelectorAll("#tdRace .td-ghost").length,
    firstRowAria: document.querySelector("#tdRace .td-rrow").getAttribute("aria-label"),
    meta: document.getElementById("trackMeta").textContent,
    sorted: [...document.querySelectorAll("#tdRace .td-rlab")].map(e => e.textContent.trim()),
  }));
  /* Banked wins appear as segments; the bar does not change shape, it fills in. */
  ok("banked wins render as segments once games are played", got.segs > 0, String(got.segs));
  ok("the projection still extends past what is banked", got.ghosts > 0);
  ok("the tracker reports how many games are in", /played/.test(got.meta), got.meta);
  ok("rows sort by total once there is something to sort by", (() => {
    const totals = got.sorted.map(n => MID.data.wins_tracker[n].total);
    return totals.every((v, i) => i === 0 || totals[i - 1] >= v);
  })(), got.sorted.join(","));
  ok("the row alternative reports the round totals, not a projection",
    /round 1/.test(got.firstRowAria), got.firstRowAria);

  /* the simulator must not replay a settled game */
  const simOk = await p.evaluate(() => {
    const before = document.getElementById("tdResult").textContent;
    document.getElementById("tdSpin").click();
    return before !== null;
  });
  await p.waitForTimeout(200);
  const banked = await p.evaluate(() => {
    /* the banner ends the sentence with a period, and [\d.]+ swallows it — "34.0." */
    const m = document.getElementById("tdResult").textContent.match(/wins it with (\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  });
  const minBanked = Math.min(...MID.data.draft_order.map(n => MID.data.drafters[n].banked));
  ok("a simulated season never returns fewer wins than are already banked",
    simOk && banked !== null && banked >= minBanked, `${banked} vs floor ${minBanked}`);

  const tiers = await p.evaluate(() => {
    document.querySelector('.sheet-tab[data-id="team"]').click();
    return null;
  });
  await p.waitForTimeout(250);
  const shown = await p.evaluate(() =>
    [...new Set([...document.querySelectorAll("#tdGameTable .td-tierchip")].map(e => e.textContent.trim()))]);
  ok("the game table shows the settled tier once games are played",
    shown.includes("settled"), shown.join(","));
  await ctx.close();
  mode = "normal";
}

/* ------------------------------------------- the rest of the draft lands ---- */
{
  mode = "full";
  const { ctx, p } = await open({ tag: "full-draft" });
  await ready(p);
  const got = await p.evaluate(() => ({
    empty: document.querySelectorAll("#tdBoard .td-bc.empty").length,
    openChips: document.querySelectorAll("#tdCards .td-tteam.open").length,
    undrafted: document.querySelectorAll("#tdLadder .td-row.und").length,
    rows: document.querySelectorAll("#tdRace .td-rrow").length,
  }));
  ok("a completed draft leaves no empty board cell", got.empty === 0);
  ok("a completed draft leaves no open roster slot", got.openChips === 0);
  ok("a completed draft leaves no undrafted bar", got.undrafted === 0);
  ok("a completed draft still renders eight tracker rows", got.rows === 8);
  await ctx.close();
  mode = "normal";
}

/* ----------------------------------------------------------- fails loud ---- */
{
  mode = "error";
  const { ctx, p } = await open({ tag: "broken" });
  await p.waitForFunction(() => document.querySelectorAll("#tdRace .p-error").length > 0,
    null, { timeout: 15000 }).catch(() => {});
  const got = await p.evaluate(() => ({
    race: document.getElementById("tdRace").textContent,
    ladder: document.getElementById("tdLadder").textContent,
    board: document.getElementById("tdBoard").textContent,
    rows: document.querySelectorAll("#tdRace .td-rrow").length,
  }));
  ok("an unreadable payload says so in the tracker", /could not be read/i.test(got.race));
  ok("an unreadable payload says so in the ladder", /could not be read/i.test(got.ladder));
  ok("an unreadable payload says so on the board", /could not be read/i.test(got.board));
  ok("an unreadable payload renders no tracker rows at all", got.rows === 0);
  await ctx.close();
  mode = "normal";
}

/* --------------------------------------------------- layout, both themes ---- */
for (const theme of ["dark", "light"]) {
  for (const width of [375, 390, 1280]) {
    const { ctx, p } = await open({ tag: `${theme}@${width}`, theme, viewport: { width, height: 800 } });
    await ready(p);
    await p.waitForTimeout(200);
    const over = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`no sideways overflow at ${width} (${theme})`, over <= 1, `${over}px`);
    const contained = await p.evaluate(() => {
      const w = document.querySelector(".td-mwrap");
      return w.scrollWidth > w.clientWidth ? getComputedStyle(w).overflowX !== "visible" : true;
    });
    /* ⚠️ The tab bar must not wrap. At 390px the old four-word labels put "Rules &
       method" alone on a second row, which is the tab a first-time reader most needs
       and the one they are then least likely to see. */
    const tabRows = await p.evaluate(() =>
      new Set([...document.querySelectorAll(".sheet-tab")].map(t =>
        Math.round(t.getBoundingClientRect().y))).size);
    ok(`the sheet tabs sit on one row at ${width} (${theme})`, tabRows === 1, `${tabRows} rows`);
    /* And the sticky header cannot eat the screen: wrapped, the rail alone was 206px
       of a 844px phone. */
    const stickyPct = await p.evaluate(() => {
      const e = document.querySelector(".td-sticky");
      return Math.round(e.getBoundingClientRect().height / innerHeight * 100);
    });
    ok(`the sticky header stays under a fifth of the screen at ${width} (${theme})`,
      stickyPct <= 20, `${stickyPct}%`);
    ok(`the matrix scrolls inside its own box at ${width} (${theme})`, contained);
    /* the tracker is the element that opens the page; it has to work at 375 */
    const fits = await p.evaluate(() => {
      const r = document.querySelector("#tdRace");
      return r.scrollWidth <= r.clientWidth + 1;
    });
    ok(`the tracker fits without its own scrollbar at ${width} (${theme})`, fits);
    await ctx.close();
  }
}

await b.close(); server.close();
ok("no script errors anywhere", errs.length === 0, errs.join(" | "));
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
