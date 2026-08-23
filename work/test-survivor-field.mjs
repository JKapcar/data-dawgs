/* Survivor — Stage C: survival-adjusted ownership, Week 18 keepOpen, objective toggle.
 *
 * Run: node work/test-survivor-field.mjs   (needs playwright; serves the repo on :8819)
 *
 * ⚠️ WHAT THIS IS ACTUALLY GUARDING.
 * The alive projection and the equity denominator share one term — Σ own × win% — and
 * the whole reason to share it is that two copies would agree today and disagree in the
 * fifth decimal the first time either is touched. Test 1 pins the arithmetic against a
 * hand-computed example; test 2 pins the SHARING, by asserting the projection's rate is
 * literally the number leverage reports rather than a number that merely resembles it.
 *
 * Test 5 is the one that matters for honesty: keepOpen must read as a choice, not as a
 * solver failure. "no team available" and "left open by choice" are different claims and
 * the page must not print the first when it means the second.
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
const PORT = 8819;

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

async function open(rawCfg = {}, { sheet = null, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await ctx.addInitScript(([t, c]) => {
    try {
      localStorage.setItem("dd-theme3", t);
      localStorage.setItem("dd-theme3-survivor", t);
      localStorage.setItem("dd-survivor-v1", JSON.stringify(c));
    } catch (e) {}
  }, [theme, rawCfg]);
  await page.goto(`http://localhost:${PORT}/survivor.html${sheet || ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}

/* ---------- 1. the alive projection, against a hand-computed example ----------
   Two weeks, three teams in two games. Posted ownership so nothing is modelled.

     week 1:  A beats B with p=0.80.  own A=0.60, own B=0.10
              C has a game against D with p=0.50. own C=0.30, own D=0
       field survival rate = 0.60·0.80 + 0.10·0.20 + 0.30·0.50 + 0·0.50
                           = 0.48 + 0.02 + 0.15 = 0.65
     alive(2) = 100 · 0.65 = 65

   ⚠️ Both sides of a game are counted, because a game contributes
   own_away + (own_home − own_away)·p_home — the two sides are perfectly
   anti-correlated and an entry on the underdog survives when it wins.            */
{
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 100 });
  ok(errors.length === 0, "page loads", errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor;
    // a synthetic two-game week, so the arithmetic is checkable by hand
    const D = {
      meta: { sd: 13.18, season: 2026, captured: "2026-08-06" },
      elo: { A: 1600, B: 1400, C: 1500, E: 1500 },
      teams: {},
      games: [
        { id: "g1", wk: 1, h: "A", a: "B", d: "2026-09-13", mm: 0, mk: 0.8, p: 0.8, src: "market" },
        { id: "g2", wk: 1, h: "C", a: "E", d: "2026-09-13", mm: 0, mk: 0.5, p: 0.5, src: "market" },
      ],
    };
    const cfg = Object.assign({}, S.DEFAULTS, {
      entries: 100, startWeek: 1, blendMarket: 1, week18Mode: "normal",
      popularity: { 1: { A: 0.6, B: 0.1, C: 0.3 } },
    });
    const f = S.fieldWeek(1, cfg, D);
    const proj = S.aliveProjection(1, cfg, D);
    const lev = S.leverage(1, cfg, D);
    return { share: f.share, real: f.real, alive2: proj.alive[2],
             levShare: lev.fieldSurvivingShare, rate1: proj.rate[1] };
  });
  /* ⚠️ Tolerance 1e-6, not 1e-12, and the reason is not sloppiness. gameProb RE-BLENDS
     every game rather than reading the shipped p, so a market probability of 0.80 goes
     through nppf then ncdf and comes back as 0.80000002 — Abramowitz & Stegun 26.2.17 is
     good to ~7.5e-8 and Acklam's inverse to ~1e-9. The arithmetic under test is exact;
     the inputs it is handed are approximations, and asserting past their precision would
     be testing the erf approximation instead of the projection. */
  ok(Math.abs(r.share - 0.65) < 1e-6, "field survival rate is the hand-computed 0.65", String(r.share));
  ok(Math.abs(r.alive2 - 65) < 1e-4, "alive(2) is 100 × 0.65 = 65", String(r.alive2));
  ok(r.real === true, "posted ownership is reported as real");
  /* ⚠️ THE SHARING, not merely the value. If leverage and the projection ever grow two
     implementations, this is the assertion that goes red. */
  ok(r.levShare === r.share && r.rate1 === r.share,
     "leverage's denominator term and the projection's rate are the SAME number",
     `${r.levShare} / ${r.share} / ${r.rate1}`);
  await ctx.close();
}

/* ---------- 2. the projection chains, and a double week squares the rate ---------- */
{
  const { ctx, page } = await open({ startWeek: 1, entries: 200 });
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV;
    const base = Object.assign({}, S.load(), { entries: 200, startWeek: 1, doublePickWeeks: [] });
    const dbl = Object.assign({}, base, { doublePickWeeks: [2] });
    const a = S.aliveProjection(1, base, D);
    const b = S.aliveProjection(1, dbl, D);
    return {
      chains: Math.abs(a.alive[3] - a.alive[2] * a.rate[2]) < 1e-9,
      monotone: [1, 2, 3, 4, 5].every(w => a.alive[w + 1] <= a.alive[w] + 1e-12),
      singleRate2: a.rate[2], doubleRate2: b.rate[2],
      start: a.alive[1],
      allReal: a.allReal,
    };
  });
  ok(r.start === 200, "the projection starts at the configured pool size", String(r.start));
  ok(r.chains, "alive(w+1) = alive(w) × rate(w), week over week");
  ok(r.monotone, "the field never grows");
  ok(Math.abs(r.doubleRate2 - r.singleRate2 * r.singleRate2) < 1e-12,
     "a double week squares the survival rate — two legs, both must win",
     `${r.doubleRate2} vs ${r.singleRate2}**2`);
  ok(r.allReal === false, "with no posted ownership the projection reports itself modelled");
  await ctx.close();
}

/* ---------- 3. the badge takes the WORST input in the chain ---------- */
{
  const { ctx, page } = await open({ startWeek: 1, entries: 200, popularity: { 1: { KC: 0.2, PHI: 0.15 } } });
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const proj = S.aliveProjection(1, cfg, D);
    return { week1Real: proj.realBy[1], week2Real: proj.realBy[2], allReal: proj.allReal };
  });
  ok(r.week1Real === true, "week 1 has posted ownership and says so");
  ok(r.week2Real === false, "week 2 does not");
  /* ⚠️ One real week feeding modelled future weeks is a MODELLED projection. Reporting
     it as real because the first term was measured is the flattering lie this rule
     exists to prevent. */
  ok(r.allReal === false,
     "a chain with any modelled week reports itself modelled, not real");
  await ctx.close();
}

/* ---------- 4. the objective toggle reorders the board, never the path ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 200 });
  ok(errors.length === 0, "board renders", errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV;
    const winnings = Object.assign({}, S.load(), { objective: "winnings" });
    const survival = Object.assign({}, S.load(), { objective: "survival" });
    const a = S.rankWeek(1, winnings, D), b = S.rankWeek(1, survival, D);
    const pa = S.optimalPath(winnings, D, 1, new Set()), pb = S.optimalPath(survival, D, 1, new Set());
    return {
      winningsTop: a.rows[0].team, survivalTop: b.rows[0].team,
      survivalSorted: b.rows.every((r2, i) => i === 0 || b.rows[i - 1].p >= r2.p - 1e-12),
      winningsSorted: a.rows.every((r2, i) => i === 0 || a.rows[i - 1].equity >= r2.equity - 1e-12),
      sameSet: JSON.stringify(a.rows.map(x => x.team).sort()) === JSON.stringify(b.rows.map(x => x.team).sort()),
      pathSame: pa.survival === pb.survival &&
        JSON.stringify(S.pathLegs(pa.path)) === JSON.stringify(S.pathLegs(pb.path)),
    };
  });
  ok(r.winningsSorted, "winnings mode is sorted by closed-form equity");
  ok(r.survivalSorted, "survival mode is sorted by raw win probability");
  ok(r.sameSet, "both modes rank the same set of legal picks — only the order moves");
  /* ⚠️ The path is max-product under BOTH. A season-long prize-share optimiser is a
     different objective function; wiring the toggle into the path would ship one by
     accident and label it as a sort order. */
  ok(r.pathSame, "the season path is byte-identical under both objectives");
  await ctx.close();
}

/* ---------- 5. keepOpen reads as a choice, not as a failure ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 200, week18Mode: "keepOpen" });
  ok(errors.length === 0, "board renders with Week 18 kept open", errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const op = S.optimalPath(cfg, D, 1, new Set(cfg.used));
    const normal = S.optimalPath(Object.assign({}, cfg, { week18Mode: "normal" }), D, 1, new Set(cfg.used));
    return {
      last: S.lastPathWeek(cfg),
      has18: !!op.path[18],
      openWeeks: op.openWeeks,
      covered: op.covered, slots: op.slots, complete: op.complete,
      normalHas18: !!normal.path[18],
      // an unspent week means a team stays in hand
      teamsUsed: S.pathLegs(op.path).length,
      normalTeamsUsed: S.pathLegs(normal.path).length,
    };
  });
  ok(r.last === 17, "the solve horizon stops at 17", String(r.last));
  ok(!r.has18 && r.normalHas18, "no team is spent in week 18, and normal mode still does");
  ok(JSON.stringify(r.openWeeks) === "[18]", "week 18 is reported as open", JSON.stringify(r.openWeeks));
  ok(r.complete === true, "the path is COMPLETE — an open week is not an unfilled one");
  ok(r.teamsUsed === r.normalTeamsUsed - 1, "exactly one fewer team is spent",
     `${r.teamsUsed} vs ${r.normalTeamsUsed}`);

  await page.evaluate(() => window.SVBoard.ensure());
  await page.waitForFunction(() => document.querySelectorAll("#svPathTable tr").length > 2,
                             null, { timeout: 30000 });
  const rows = await page.$$eval("#svPathTable tr", ns => ns.map(n => n.textContent.replace(/\s+/g, " ").trim()));
  const w18 = rows[rows.length - 1];
  /* ⚠️ The whole point. "no team available" is what the solver prints when it RAN OUT;
     printing it for a week nobody asked it to fill turns a deliberate choice into what
     looks like a bug. */
  ok(/left open/i.test(w18) && !/no team available/i.test(w18),
     "week 18 prints as left open, NOT as no team available", w18);
  const marked = await page.$$eval("#svHeat th.sv-openh", ns => ns.map(n => n.textContent.trim()));
  ok(marked.length === 1 && marked[0] === "18", "the heatmap marks the open column", marked.join(","));
  const note = await page.textContent("#svBoardNote");
  ok(/left <b>open<\/b>|left open/i.test(note.replace(/\s+/g, " ")) || /open/i.test(note),
     "the board note mentions the open week", note.slice(-90));

  // covered counts only what was asked for
  const tile = await page.$$eval("#svPathTiles .nf-tile", ns => {
    const t = ns.find(n => /Picks covered/i.test(n.querySelector(".k").textContent));
    return t ? t.querySelector(".v").textContent.trim() : null;
  });
  ok(tile === "17 of 17", "picks covered counts the 17 weeks it was asked to fill", tile);
  await ctx.close();
}

/* ---------- 6. the projected-alive ownership reaches the table ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 500 });
  await page.evaluate(() => window.SVBoard.ensure());
  await page.waitForFunction(() => document.querySelectorAll("#svPathTable tr").length > 2,
                             null, { timeout: 30000 });
  const head = await page.$$eval("#svPathTable tr:first-child th", ns => ns.map(n => n.textContent.trim()));
  ok(head.includes("Owned"), "the path table carries an Owned column", head.join("|"));
  const r = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("#svPathTable tr")].slice(1)
      .map(tr => tr.children[4]).filter(Boolean);
    return {
      n: cells.length,
      modelled: cells.filter(c => /~/.test(c.textContent)).length,
      withHeads: cells.filter(c => c.querySelector(".sv-heads")).length,
      firstTitle: cells[0] ? cells[0].getAttribute("title") : "",
    };
  });
  ok(r.n >= 17, "every path row has an ownership cell", String(r.n));
  ok(r.modelled === r.n, "modelled ownership is tilde-marked on every row", `${r.modelled}/${r.n}`);
  ok(r.withHeads >= 1, "head counts render against the projected field", String(r.withHeads));
  ok(/projected live entries/i.test(r.firstTitle),
     "the cell says what the denominator is", r.firstTitle);
  // and the field tile exists
  const tile = await page.$$eval("#svPathTiles .nf-tile", ns => {
    const t = ns.find(n => /Field by the end/i.test(n.querySelector(".k").textContent));
    return t ? t.querySelector(".d").textContent.trim() : null;
  });
  ok(tile && /modelled/i.test(tile),
     "the field tile flags that the projection is modelled", tile);
  ok(errors.length === 0, "no page error", errors[0]);
  await ctx.close();
}

/* ---------- 7. the honest-limit callout is on the page, not in a footnote ---------- */
{
  const { ctx, page } = await open({ startWeek: 1 });
  const txt = await page.evaluate(() =>
    [...document.querySelectorAll(".callout")].map(n => n.textContent.replace(/\s+/g, " ")).join(" "));
  ok(/shrinking field/i.test(txt), "the ownership callout is present");
  ok(/count/i.test(txt) && /roster/i.test(txt),
     "…and it says the field is a count rather than rosters");
  ok(/cannot say/i.test(txt) || /does not do/i.test(txt),
     "…and states what it explicitly does NOT do");
  await ctx.close();
}

/* ---------- 8. settings round-trip, including a config that predates all of it ---------- */
{
  const { ctx, page, errors } = await open({ entries: 250, lives: 1 }, { sheet: "#settings" });
  ok(errors.length === 0, "settings sheet renders from an old config", errors[0]);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const cfg = window.DDSurvivor.load();
    const missing = Object.keys(window.DDSurvivor.DEFAULTS).filter(k => cfg[k] === undefined);
    return { missing, w18: cfg.week18Mode, obj: cfg.objective,
             selW18: document.getElementById("cWeek18").value,
             selObj: document.getElementById("cObjective").value };
  });
  ok(r.missing.length === 0, "no key comes back undefined", r.missing.join(","));
  ok(r.w18 === "normal" && r.obj === "winnings", "new keys default to the shipped behaviour");
  ok(r.selW18 === "normal" && r.selObj === "winnings", "…and the controls show it");

  await page.selectOption("#cWeek18", "keepOpen");
  await page.selectOption("#cObjective", "survival");
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() => {
    const c = window.DDSurvivor.load();
    return { w18: c.week18Mode, obj: c.objective, entries: c.entries };
  });
  ok(saved.w18 === "keepOpen" && saved.obj === "survival", "both settings persist",
     JSON.stringify(saved));
  ok(saved.entries === 250, "…without disturbing what was already there");

  // a garbage value in storage must not become a third mode
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("dd-survivor-v1"));
    c.week18Mode = "banana"; c.objective = "banana";
    localStorage.setItem("dd-survivor-v1", JSON.stringify(c));
  });
  const coerced = await page.evaluate(() => {
    const c = window.DDSurvivor.load();
    return { w18: c.week18Mode, obj: c.objective };
  });
  ok(coerced.w18 === "normal" && coerced.obj === "winnings",
     "an unrecognised stored value falls back to the default, not to undefined",
     JSON.stringify(coerced));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`survivor field/objective: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
