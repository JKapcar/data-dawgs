/* teamdraft.html — the 2026 NFL team draft pool.

   What this suite is actually defending:

   1. NOTHING IS TYPED INTO THE PAGE. Every figure on every view has to come out of
      /data/draft-2026.json. The test reads the file itself and asserts the DOM agrees,
      so a hardcoded number fails here rather than quietly going stale the first time
      a pick lands.
   2. THE ARITHMETIC IS CONSERVED. Rostered wins plus the pool equal the league total,
      and the head-to-head matrix holds exactly 272 games. If a future edit breaks the
      identity the whole page rests on, this is where it shows up.
   3. IT SURVIVES THE REST OF THE DRAFT. The page is built while the draft is in
      progress. Serve it a payload with all 32 picks in and every view must still
      render — no empty-slot assumption anywhere.
   4. IT FAILS LOUD. Serve a 500 for the payload and every view says so. An empty
      ladder reads as "nobody has drafted", which is a different and false claim.
   5. COLOUR IS NEVER THE ONLY CHANNEL. Eight categorical colours cannot be pairwise
      safe under simulated CVD, so every drafter-coloured mark carries a name or a
      number too. Enforced by query, because it is the check a later "cleanup" breaks.
   6. NOTHING CLAIMS A RESULT. No game has been played: the wins tracker is all zeroes,
      and the page's own tier chip is Pup.
   7. No sideways overflow at 320/390/1280, both themes, no script errors.

   Run:  cd work && node test-teamdraft.mjs
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* The payload the page must agree with, read from the file and not from the page. */
const ENV = JSON.parse(fs.readFileSync(path.join(ROOT, "data/draft-2026.json"), "utf8"));
const D = ENV.data;
const html = fs.readFileSync(path.join(ROOT, "teamdraft.html"), "utf8");

/* A second payload with the draft FINISHED, built by filling the open slots with the
   teams still on the board. Nothing about the page may assume 22 picks. */
function completed() {
  const c = JSON.parse(JSON.stringify(ENV));
  const open = c.data.board.filter(b => !b.team);
  const pool = [...c.data.undrafted];
  open.forEach(b => {
    const team = pool.shift();
    c.data.picks.push({ pick: b.pick, round: b.round, drafter: b.drafter, team });
    b.team = team;
    b.ew = c.data.teams[team].ew;
    b.best_available = team; b.best_available_ew = c.data.teams[team].ew;
    b.delta = 0; b.rank_at_pick = 1; b.available_at_pick = 1;
    const dr = c.data.drafters[b.drafter];
    dr.roster.push(team);
    dr.ew = Math.round((dr.ew + c.data.teams[team].ew) * 100) / 100;
    dr.picks_remaining -= 1;
  });
  c.data.undrafted = [];
  c.data.picks_made = c.data.picks.length;
  return c;
}
const FULL = completed();

/* ------------------------------------------------------------ the server ---- */
let payloadMode = "normal";                 // normal | full | error
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/data/draft-2026.json") {
    if (payloadMode === "error") { res.writeHead(500); return res.end("nope"); }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(payloadMode === "full" ? FULL : ENV));
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
    /* The fail-loud case serves a deliberate 500, and the browser logs the network
       failure itself. That log is the test working, not the page breaking. */
    if (m.type() !== "error") return;
    if (payloadMode === "error" && /Failed to load resource/.test(m.text())) return;
    errs.push((opts.tag || "page") + " console: " + m.text());
  });
  await p.goto("http://127.0.0.1:8927/teamdraft.html", { waitUntil: "load" });
  if (opts.theme) await p.evaluate(t => { document.documentElement.dataset.theme = t; }, opts.theme);
  return { ctx, p };
}
const ready = p => p.waitForFunction(
  () => document.querySelectorAll("#tdLadder .td-row").length === 32, null, { timeout: 15000 });

/* ------------------------------------------------------- source-level ------- */
{
  ok("the payload is the /data/ envelope, not a bare object",
    !!(ENV.as_of && ENV.source && ENV.data && ENV.tier && ENV.tier_meaning));
  ok("the page's own tier chip is Pup",
    (html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</) || [])[1]?.trim() === "Pup");
  /* Expected wins are the one number this page must never recompute — the devig is
     upstream work. A number typed into the markup is the failure mode. */
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
  /* AGENTS.md rule 4. This is a private pool on a public repo. */
  ok("no payment or contact detail reached the public page",
    !/venmo|@gmail|paypal|zelle/i.test(html));
  ok("no payment or contact detail reached the payload",
    !/venmo|@gmail|paypal|zelle/i.test(JSON.stringify(ENV)));
}

/* --------------------------------------------------- conserved arithmetic --- */
{
  const total = Object.values(D.teams).reduce((a, t) => a + t.ew, 0);
  ok("the 32 expected-win values sum to the league total",
    Math.abs(total - D.total_wins) < 0.05, total.toFixed(2));
  const owned = D.draft_order.reduce((a, n) => a + D.drafters[n].ew, 0);
  const pool = D.undrafted.reduce((a, t) => a + D.teams[t].ew, 0);
  ok("rosters plus the pool equal the league total",
    Math.abs(owned + pool - total) < 0.05, (owned + pool).toFixed(2));
  const games = Object.values(D.overlap).reduce((a, r) => a + Object.values(r).reduce((x, y) => x + y, 0), 0) / 2;
  ok("the head-to-head matrix holds exactly one season of games",
    games === D.total_wins, String(games));
  ok("par is the league total over the number of drafters",
    Math.abs(D.par - D.total_wins / D.draft_order.length) < 1e-9);
  ok("the diagnostics block reports no hard failure",
    Array.isArray(D.diagnostics?.hard_failures) && D.diagnostics.hard_failures.length === 0,
    (D.diagnostics?.hard_failures || []).join(", "));
  ok("no game has been played: every tracker cell is zero",
    Object.values(D.wins_tracker).every(w => w.total === 0 && w.rounds.every(v => v === 0)));
}

/* ------------------------------------------------------------ rendering ----- */
{
  const { ctx, p } = await open({ tag: "render" });
  await ready(p);
  const got = await p.evaluate(() => ({
    rows: [...document.querySelectorAll("#tdLadder .td-row")].map(r => ({
      abbr: r.querySelector(".td-abbr").textContent.trim(),
      ew: r.querySelector(".td-ew").textContent.trim(),
      owner: r.querySelector(".td-own")?.textContent.trim(),
    })),
    cells: document.querySelectorAll("#tdMatrix .td-c").length,
    self: document.querySelectorAll("#tdMatrix .td-c.self").length,
    cards: [...document.querySelectorAll("#tdCards .td-card")].map(c => c.querySelector("h3").childNodes[0].textContent.trim()),
    board: document.querySelectorAll("#tdBoard .td-bc").length,
    empty: document.querySelectorAll("#tdBoard .td-bc.empty").length,
    curves: document.querySelectorAll("#tdCurves path").length,
    checks: document.querySelectorAll("#tdChecks .td-chk").length,
    perTeam: document.querySelectorAll("#tdPerTeam tbody tr").length,
    tracker: [...document.querySelectorAll("#tdTracker tbody tr")].map(r => r.lastElementChild.textContent.trim()),
    par: !!document.querySelector("#tdLadder .td-par"),
  }));

  const byEw = Object.keys(D.teams).sort((a, x) => D.teams[x].ew - D.teams[a].ew);
  ok("the ladder is all 32 teams, sorted by expected wins",
    got.rows.length === 32 && got.rows.every((r, i) => r.abbr === byEw[i]));
  ok("every bar prints the payload's expected wins",
    got.rows.every((r, i) => r.ew === D.teams[byEw[i]].ew.toFixed(2)));
  /* Check 5: colour is never alone. Every drafted bar names its owner in text. */
  ok("every drafted bar direct-labels its owner", got.rows.every((r, i) => {
    const own = D.board.find(x => x.team === byEw[i])?.drafter;
    return own ? r.owner === own : r.owner === "—";
  }));
  ok("the matrix is 32 by 32", got.cells === 1024);
  /* Every internal game shows up twice — the matrix is symmetric. */
  const internal = D.draft_order.reduce((a, n) => a + D.drafters[n].internal_games, 0);
  ok("same-owner cells match the internal game count", got.self === internal * 2,
    `${got.self} cells vs ${internal} games`);
  ok("one card per drafter, sorted by expected wins",
    got.cards.length === D.draft_order.length
    && got.cards.every((n, i, arr) => i === 0 || D.drafters[arr[i - 1]].ew >= D.drafters[n].ew));
  ok("the board is one cell per pick slot", got.board === D.picks_total);
  ok("empty board cells match the picks not yet made",
    got.empty === D.picks_total - D.picks_made, `${got.empty}`);
  ok("one curve per team", got.curves === 32);
  ok("the diagnostics sheet renders every check",
    got.checks === D.diagnostics.checks.length);
  ok("the per-team table is all 32 rows", got.perTeam === 32);
  ok("the wins tracker reads zero for everybody", got.tracker.every(v => v === "0"));
  ok("the par rule is drawn", got.par);

  /* selection re-centres every view rather than navigating */
  const who = D.draft_order.find(n => D.drafters[n].internal_games > 0) || D.draft_order[0];
  await p.click(`[data-sel="drafter:${who}"]`);
  await p.waitForTimeout(160);
  const selected = await p.evaluate(() => ({
    url: location.pathname,
    lit: [...document.querySelectorAll("#tdLadder .td-row.on .td-abbr")].map(e => e.textContent.trim()),
    strips: document.querySelectorAll("#tdStrip .td-srow:not(.head)").length,
    outlined: document.querySelectorAll("#tdMatrix .td-c.in").length,
    meta: document.getElementById("matrixMeta").textContent,
  }));
  const roster = D.drafters[who].roster;
  ok("selecting a drafter lights exactly their roster",
    selected.lit.length === roster.length && roster.every(t => selected.lit.includes(t)));
  ok("selecting a drafter stacks one schedule strip per team",
    selected.strips === roster.length);
  /* The whole n x n block, diagonal included — it is the roster's own square, and a
     square with a hole punched in it does not read as one block. */
  ok("selecting a drafter outlines their own submatrix",
    selected.outlined === roster.length ** 2, String(selected.outlined));
  ok("the matrix reports that drafter's internal game count",
    selected.meta.includes(String(D.drafters[who].internal_games)), selected.meta);
  ok("selection does not navigate away", selected.url.endsWith("/teamdraft.html"));

  /* the selector is reachable and operable from the keyboard */
  const kb = await p.evaluate(() => {
    const chip = document.querySelector('[data-sel^="drafter:"]');
    chip.focus();
    const focused = document.activeElement === chip;
    const style = getComputedStyle(chip, ":focus-visible");
    return { focused, tag: chip.tagName, hasSelect: !!document.getElementById("tdTeamPick"),
             pressed: chip.getAttribute("aria-pressed") !== null, outline: style.outlineStyle };
  });
  ok("drafter chips are real buttons, focusable and stateful",
    kb.focused && kb.tag === "BUTTON" && kb.pressed);
  ok("teams are selectable from a native control too", kb.hasSelect);

  await ctx.close();
}

/* ------------------------------------------- the rest of the draft lands ---- */
{
  payloadMode = "full";
  const { ctx, p } = await open({ tag: "full-draft" });
  await ready(p);
  const got = await p.evaluate(() => ({
    empty: document.querySelectorAll("#tdBoard .td-bc.empty").length,
    openChips: document.querySelectorAll("#tdCards .td-tteam.open").length,
    undrafted: document.querySelectorAll("#tdLadder .td-row.und").length,
    cards: document.querySelectorAll("#tdCards .td-card").length,
    now: document.getElementById("tdNow").textContent,
  }));
  ok("a completed draft leaves no empty board cell", got.empty === 0);
  ok("a completed draft leaves no open roster slot", got.openChips === 0);
  ok("a completed draft leaves no undrafted bar", got.undrafted === 0);
  ok("a completed draft still renders all eight cards", got.cards === 8);
  ok("a completed draft says so rather than counting down",
    /complete/i.test(got.now), got.now.slice(0, 90));
  await ctx.close();
  payloadMode = "normal";
}

/* ----------------------------------------------------------- fails loud ---- */
{
  payloadMode = "error";
  const { ctx, p } = await open({ tag: "broken" });
  await p.waitForFunction(() => document.querySelectorAll("#tdLadder .p-error").length > 0,
    null, { timeout: 15000 }).catch(() => {});
  const got = await p.evaluate(() => ({
    ladder: document.getElementById("tdLadder").textContent,
    matrix: document.getElementById("tdMatrix").textContent,
    board: document.getElementById("tdBoard").textContent,
    now: document.getElementById("tdNow").textContent,
    rows: document.querySelectorAll("#tdLadder .td-row").length,
  }));
  ok("an unreadable payload says so in the ladder", /could not be read/i.test(got.ladder));
  ok("an unreadable payload says so in the matrix", /could not be read/i.test(got.matrix));
  ok("an unreadable payload says so on the board", /could not be read/i.test(got.board));
  ok("an unreadable payload names the file", /draft-2026\.json/.test(got.now));
  ok("an unreadable payload renders no bars at all", got.rows === 0);
  await ctx.close();
  payloadMode = "normal";
}

/* --------------------------------------------------- layout, both themes ---- */
for (const theme of ["dark", "light"]) {
  for (const width of [320, 390, 1280]) {
    const { ctx, p } = await open({ tag: `${theme}@${width}`, theme, viewport: { width, height: 800 } });
    await ready(p);
    await p.waitForTimeout(180);
    const over = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`no sideways overflow at ${width} (${theme})`, over <= 1, `${over}px`);
    /* The matrix is 32 columns wide by definition — it scrolls inside its own box
       rather than pushing the page sideways. */
    const contained = await p.evaluate(() => {
      const w = document.querySelector(".td-mwrap");
      return w.scrollWidth > w.clientWidth ? getComputedStyle(w).overflowX !== "visible" : true;
    });
    ok(`the matrix scrolls inside its own box at ${width} (${theme})`, contained);
    await ctx.close();
  }
}

await b.close(); server.close();
ok("no script errors anywhere", errs.length === 0, errs.join(" | "));
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
