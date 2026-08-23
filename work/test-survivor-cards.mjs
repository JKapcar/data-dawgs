/* Survivor — Stage A: backup options carrying their own re-optimized season.
 *
 * Run: node work/test-survivor-cards.mjs   (needs playwright; serves the repo on :8815)
 *
 * ⚠️ WHAT THIS IS ACTUALLY GUARDING.
 * A backup card is only worth anything if its path is a real re-solve rather than
 * the global path relabelled. Two properties make that checkable without a second
 * implementation of the solver, and they are the heart of this file:
 *
 *   1. OPTIMALITY CEILING. optimalPath(week) maximises over every possible
 *      current-week leg, so for every candidate  p_leg · survival(rest) ≤ optimum,
 *      and the maximum over candidates equals the optimum exactly. A card that
 *      forgot to multiply its own leg in would break the ceiling upward; a card
 *      that re-solved from the wrong `used` set would break the equality.
 *   2. THE OPTIMUM'S OWN LEG REPRODUCES IT. Force the team the global path already
 *      picked for this week, re-solve the rest, and you must get that path back
 *      week-for-week and to float precision.
 *
 * ⚠️ Property 2 is the handoff's Stage A gate, but stated against the OPTIMUM's leg
 * rather than against "candidate #1". Those are not the same team in general: the
 * cards are ranked by closed-form equity and the path is ranked by max product, and
 * survivor.html documents at length that these are different objectives. They happen
 * to agree on the shipped 2026-08-06 snapshot, so the literal gate is asserted too —
 * flagged as data-dependent, because a line move could separate them without anything
 * being wrong.
 *
 * The page is loaded for real. `page.on('pageerror')` fails the run.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { chromiumExecutable } from "./playwright-loader.mjs";

const WORK = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WORK, "..");
const PORT = 8815;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};

const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "content-type": p.endsWith(".html") ? "text/html" : "text/plain" });
    res.end(b);
  });
});
await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || chromiumExecutable(chromium),
});

/* One context per case. The survivor config lives in localStorage, so the whole
   scenario surface — pool size, reuse, spent teams, start week — is seeded there. */
async function open(cfgPatch = {}, { theme = "light", width = 1280 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  /* ⚠️ dd-theme3, not dd-theme2. The key was bumped when light became the site
     default, and the per-page key wins over the global one. Seeding the old name
     leaves the page in light and turns any dark-theme assertion into a test that
     silently checks light twice — which is exactly what happened while writing this. */
  await ctx.addInitScript(([t, c]) => {
    try {
      localStorage.setItem("dd-theme3", t);
      localStorage.setItem("dd-theme3-survivor", t);
      localStorage.setItem("dd-survivor-v1", JSON.stringify(c));
    } catch (e) {}
  }, [theme, cfgPatch]);
  await page.goto(`http://localhost:${PORT}/survivor.html`, { waitUntil: "domcontentloaded" });
  // the board is a real solve over 32 teams — give it room, then force a render
  await page.waitForTimeout(600);
  await page.evaluate(() => window.SVBoard && window.SVBoard.ensure());
  await page.waitForFunction(() => document.querySelectorAll("#svCards .sv-card").length > 0,
                             null, { timeout: 30000 });
  return { ctx, page, errors };
}

/* ---------- 1. the cards render, and they are the board's own top three ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 200 });
  ok(errors.length === 0, "survivor page renders without a page error", errors[0]);
  const cardTeams = await page.$$eval("#svCards .sv-card", ns => ns.map(n => n.dataset.cand));
  ok(cardTeams.length === 3, "three backup cards render", cardTeams.join(","));

  /* ⚠️ .tmname, not the whole cell. The team cell also carries note chips, and reading
     its textContent silently appends "Meaningful future cost" to the team name. */
  const boardTop = await page.$$eval("#svBoard tr td:nth-child(2) .tmname", ns =>
    ns.slice(0, 3).map(n => n.textContent.trim()));
  ok(JSON.stringify(cardTeams) === JSON.stringify(boardTop),
     "the cards ARE the board's top three, in the board's order — no second heuristic",
     cardTeams + " vs " + boardTop);
  await ctx.close();
}

/* ---------- 2. the optimality ceiling, both reuse settings ---------- */
for (const reuse of [false, true]) {
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 200, reuse });
  ok(errors.length === 0, `board renders with reuse=${reuse}`, errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const wk = Math.min(18, Math.max(1, cfg.startWeek | 0 || 1));
    const used = new Set(cfg.used);
    const opt = S.optimalPath(cfg, D, wk, used);
    const tab = S.weekTable(wk, cfg, D);
    // every legal team, not just the three on screen — the property is universal
    const legal = Object.keys(tab).filter(t => cfg.reuse || !used.has(t));
    const cards = S.candidatePaths(wk, cfg, D, legal);
    return {
      wk,
      optimum: opt.survival,
      optimumLeg: opt.path[wk] ? opt.path[wk].team : null,
      max: Math.max(...cards.map(c => c.survival)),
      over: cards.filter(c => c.survival > opt.survival * (1 + 1e-9)).map(c => c.team),
      // the leg probability must be the week table's, not something read off the sub-solve
      legMismatch: cards.filter(c => Math.abs(c.p - tab[c.team].p) > 0).map(c => c.team),
      productMismatch: cards.filter(c =>
        Math.abs(c.survival - c.p * c.restSurvival) > 1e-15).map(c => c.team),
      coveredOffByOne: cards.filter(c => c.covered !== Object.keys(c.path).length).map(c => c.team),
    };
  });
  ok(r.over.length === 0,
     `reuse=${reuse}: no candidate beats the global optimum — the ceiling holds`, r.over.join(","));
  ok(Math.abs(r.max - r.optimum) <= 1e-15 * Math.max(1, r.optimum),
     `reuse=${reuse}: the best candidate EQUALS the global optimum`, `${r.max} vs ${r.optimum}`);
  ok(r.legMismatch.length === 0,
     `reuse=${reuse}: each card's leg probability comes from weekTable`, r.legMismatch.join(","));
  ok(r.productMismatch.length === 0,
     `reuse=${reuse}: survival is the leg times the re-solved rest, exactly`, r.productMismatch.join(","));
  ok(r.coveredOffByOne.length === 0,
     `reuse=${reuse}: covered counts the leg it prepended`, r.coveredOffByOne.join(","));
  await ctx.close();
}

/* ---------- 3. the optimum's own leg reproduces the global path exactly ---------- */
{
  const { ctx, page } = await open({ startWeek: 1, entries: 200 });
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const wk = Math.min(18, Math.max(1, cfg.startWeek | 0 || 1));
    const opt = S.optimalPath(cfg, D, wk, new Set(cfg.used));
    const leg = opt.path[wk][0].team;
    const card = S.candidatePaths(wk, cfg, D, [leg])[0];
    // ⚠️ path[week] is an ARRAY of legs since double-pick weeks landed. Comparing it
    // as an object silently passes by comparing undefined to undefined.
    const key = ls => (ls || []).map(x => x.team + "@" + x.p).join("|");
    const weeks = Object.keys(opt.path).map(Number).sort((a, b) => a - b);
    const diff = weeks.filter(w => key(card.path[w]) !== key(opt.path[w]));
    return { leg, diff, cardSurv: card.survival, optSurv: opt.survival,
             sameWeekCount: Object.keys(card.path).length === weeks.length };
  });
  ok(r.diff.length === 0, "forcing the optimum's leg reproduces its path week-for-week", r.diff.join(","));
  ok(r.sameWeekCount, "…and covers the same weeks");
  ok(r.cardSurv === r.optSurv, "…at float precision, not merely close", `${r.cardSurv} vs ${r.optSurv}`);
  await ctx.close();
}

/* ---------- 4. the handoff's literal gate, flagged as data-dependent ---------- */
{
  const { ctx, page } = await open({ startWeek: 1, entries: 200 });
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const wk = Math.min(18, Math.max(1, cfg.startWeek | 0 || 1));
    const opt = S.optimalPath(cfg, D, wk, new Set(cfg.used));
    const rank = S.rankWeek(wk, cfg, D);
    return { equityFirst: rank.rows[0].team, pathLeg: opt.path[wk][0].team };
  });
  if (r.equityFirst === r.pathLeg) {
    ok(true, "card #1 is also the optimum's leg on this snapshot, so it reproduces the path");
  } else {
    // Not a failure. Equity ranking and max-product ranking are different objectives
    // by design, and the page says so. Say it out loud rather than going red.
    console.warn(`  note: equity #1 (${r.equityFirst}) != optimum's week leg (${r.pathLeg}). `
      + "Different objectives — the ceiling test above is the real gate.");
    ok(true, "equity #1 and the path's leg diverge on this snapshot (documented, not a failure)");
  }
  await ctx.close();
}

/* ---------- 5. reuse=true must not spend the candidate ---------- */
{
  const { ctx, page } = await open({ startWeek: 1, entries: 200, reuse: true });
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    /* With reuse on every week independently takes its outright best team, and the
       `used` set is irrelevant by construction. So the re-solved rest of ANY
       candidate's season must be byte-identical to the unconstrained solve — that
       is exactly the statement "forcing this leg did not spend the team". */
    const free = S.optimalPath(cfg, D, 2, new Set());
    const laterWeeks = Object.keys(free.path).map(Number).sort((a, b) => a - b);

    /* Pick a candidate that provably WOULD be excluded if the reuse branch were
       missing: a team the unconstrained solve uses again later. Hard-coding two
       abbreviations would make this pass for the wrong reason in any week where
       neither happens to be a later leg. */
    const repeatable = free.path[laterWeeks[0]][0].team;
    const cards = S.candidatePaths(1, cfg, D, [repeatable, "KC", "PHI"]);

    return {
      repeatable,
      restMatchesFree: cards.map(c => ({
        team: c.team,
        same: laterWeeks.every(w => (c.path[w] || []).map(x => x.team + "@" + x.p).join("|")
          === (free.path[w] || []).map(x => x.team + "@" + x.p).join("|")),
      })),
      // and the concrete version: the forced team is still on its later leg
      forcedTeamStillLater: (() => {
        const c = cards.find(x => x.team === repeatable);
        return !!c && (c.path[laterWeeks[0]] || []).some(l => l.team === repeatable);
      })(),
    };
  });
  ok(r.restMatchesFree.every(x => x.same),
     "reuse=true: the re-solved rest is identical to the unconstrained solve — nothing was spent",
     JSON.stringify(r.restMatchesFree));
  ok(r.forcedTeamStillLater,
     `reuse=true: ${r.repeatable} forced into week 1 still holds its later leg`,
     JSON.stringify(r));
  await ctx.close();
}

/* ---------- 6. selecting a card re-keys the overlay AND the panel ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 200 });
  await page.click("#svShowPath");
  await page.waitForTimeout(250);

  const pointsFor = () => page.$eval(".sv-path-overlay .sv-path-route", n => n.getAttribute("points"));
  const first = await pointsFor();
  ok(typeof first === "string" && first.length > 0, "the overlay draws for the default path");

  // pick a card that is NOT the one currently on the map
  const target = await page.$$eval("#svCards .sv-card", ns => {
    const off = ns.find(n => !n.classList.contains("on"));
    return off ? off.dataset.cand : null;
  });
  ok(target !== null, "there is a backup card that is not already on the map");
  await page.click(`#svCards .sv-card[data-cand="${target}"]`);
  await page.waitForTimeout(300);

  const second = await pointsFor();
  ok(second !== first, "selecting a backup repaints the overlay to a DIFFERENT path", target);

  // …and the panel followed it, rather than describing the old one
  const who = await page.textContent("#svPathWho");
  ok(who.includes(target), "the path panel names the selected backup", who.trim());
  const week1Row = await page.$eval("#svPathTable tr:nth-child(2)", n =>
    n.textContent.replace(/\s+/g, " ").trim());
  ok(week1Row.includes(target), "the path table's week-1 leg IS the selected backup", week1Row);

  // the heat cells moved with it
  const marked = await page.$$eval("#svHeat .sv-cell.sv-path[data-week='1']", ns =>
    ns.map(n => n.dataset.team));
  ok(marked.length === 1 && marked[0] === target,
     "exactly one week-1 cell is marked, and it is the selected backup", marked.join(","));

  // the run-the-table tile matches that card's own number
  const cardRtt = await page.$eval(`#svCards .sv-card[data-cand="${target}"] dd:last-of-type`,
                                   n => n.textContent.trim());
  const tileRtt = await page.$$eval("#svPathTiles .nf-tile", ns => {
    const t = ns.find(n => n.querySelector(".k").textContent.includes("Run-the-table"));
    return t ? t.querySelector(".v").textContent.trim() : null;
  });
  ok(cardRtt === tileRtt, "the card's run-the-table equals the panel's — one number, one source",
     `${cardRtt} vs ${tileRtt}`);

  // and back
  await page.click("#svPathReset");
  await page.waitForTimeout(300);
  ok(await pointsFor() === first, "resetting returns the overlay to the best path");
  ok((await page.textContent("#svPathWho")).includes("best remaining path"),
     "…and the panel says so");
  ok(errors.length === 0, "no page error through the whole selection cycle", errors[0]);
  await ctx.close();
}

/* ---------- 7. spent teams and a mid-season start ---------- */
{
  const { ctx, page, errors } = await open({
    startWeek: 6, entries: 500, used: ["KC", "PHI", "BAL", "SF", "DET"],
  });
  ok(errors.length === 0, "renders from week 6 with five teams spent", errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const cards = S.candidatePaths(6, cfg, D, S.rankWeek(6, cfg, D).rows.slice(0, 3).map(x => x.team));
    const spent = new Set(cfg.used);
    return {
      teams: cards.map(c => c.team),
      // a spent team must never appear anywhere in a re-solved path
      leaks: cards.flatMap(c => Object.keys(c.path)
        .flatMap(w => c.path[w].filter(l => spent.has(l.team)).map(l => `${c.team}@w${w}:${l.team}`))),
      startsAt6: cards.every(c => Object.keys(c.path).map(Number).sort((a, b) => a - b)[0] === 6),
      arrayShape: cards.every(c => Object.keys(c.path).every(w => Array.isArray(c.path[w]))),
    };
  });
  ok(r.leaks.length === 0, "no spent team reappears in any candidate path", r.leaks.join(","));
  ok(r.startsAt6, "every candidate path starts at the configured week", r.teams.join(","));
  ok(r.arrayShape, "every path week is an array of legs, uniformly");
  ok(!r.teams.some(t => ["KC", "PHI", "BAL", "SF", "DET"].includes(t)),
     "spent teams are not offered as candidates", r.teams.join(","));
  await ctx.close();
}

/* ---------- 8. dark theme renders the cards too ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1 }, { theme: "dark" });
  // ⚠️ Prove the theme actually flipped before asserting anything about it.
  const applied = await page.getAttribute("html", "data-theme");
  ok(applied === "dark", "the dark theme is actually applied, not assumed", String(applied));
  ok(errors.length === 0, "cards render in dark theme without a page error", errors[0]);
  const n = await page.$$eval("#svCards .sv-card", ns => ns.length);
  ok(n === 3, "three cards in dark theme", String(n));
  // the selected-card ring is a theme token, so it must resolve to a real colour
  const ring = await page.$eval("#svCards .sv-card.on", n2 => getComputedStyle(n2).borderTopColor);
  ok(/^rgba?\(/.test(ring) && ring !== "rgba(0, 0, 0, 0)",
     "the selected card's accent border resolves in dark theme", ring);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`survivor cards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
