/* Survivor — Stage B: double-pick weeks modelled exactly, on the page.
 *
 * Run: node work/test-survivor-double.mjs   (needs playwright; serves the repo on :8816)
 *
 * work/test-survivor-path.js already brute-forces the SOLVER. This file covers the
 * things brute force cannot see: that the page's config migrates an old suffix rule
 * without changing what the reader configured, that the season simulation spends two
 * teams in a double week rather than staying single-pick while the exact path goes
 * double, and that the warning which used to say "not simulated yet" was replaced by
 * the caveat that is still true instead of being deleted along with the one that died.
 *
 * ⚠️ The migration test is the one worth reading. `doublePickFrom: 9` has always meant
 * "two picks from week 9 ON" — a suffix. Reading it as a single week would halve a real
 * reader's remaining rules on their next page load, silently, with no error anywhere.
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
const PORT = 8816;

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

/* ---------- 1. the legacy suffix migrates to the full range, not one week ---------- */
{
  const { ctx, page, errors } = await open({ doublePickFrom: 9 });
  ok(errors.length === 0, "page loads with a legacy doublePickFrom config", errors[0]);
  const r = await page.evaluate(() => {
    const cfg = window.DDSurvivor.load();
    return { weeks: cfg.doublePickWeeks, legacy: cfg.doublePickFrom };
  });
  ok(JSON.stringify(r.weeks) === JSON.stringify([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]),
     "doublePickFrom: 9 migrates to weeks 9 THROUGH 18 — a suffix, not a single week",
     JSON.stringify(r.weeks));
  ok(r.legacy === 9, "the legacy key is still readable, not deleted from the stored config");
  await ctx.close();
}
{
  // an explicit array wins, and the legacy key does not re-expand over it
  const { ctx, page } = await open({ doublePickFrom: 9, doublePickWeeks: [12, 13] });
  const w = await page.evaluate(() => window.DDSurvivor.load().doublePickWeeks);
  ok(JSON.stringify(w) === JSON.stringify([12, 13]),
     "an explicit week list wins over the legacy suffix", JSON.stringify(w));
  await ctx.close();
}
{
  // a config from before any of this existed gains the key with a safe default
  const { ctx, page } = await open({ entries: 300 });
  const r = await page.evaluate(() => {
    const cfg = window.DDSurvivor.load();
    return { weeks: cfg.doublePickWeeks, entries: cfg.entries,
             anyUndefined: Object.keys(window.DDSurvivor.DEFAULTS).filter(k => cfg[k] === undefined) };
  });
  ok(JSON.stringify(r.weeks) === "[]", "an old config with no double keys loads as none", JSON.stringify(r.weeks));
  ok(r.entries === 300, "…and keeps what it did set");
  ok(r.anyUndefined.length === 0, "no DEFAULTS key comes back undefined", r.anyUndefined.join(","));
  await ctx.close();
}

/* ---------- 2. the path spends two teams in a double week ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, doublePickWeeks: [3, 5] });
  ok(errors.length === 0, "board renders with double weeks configured", errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const op = S.optimalPath(cfg, D, 1, new Set(cfg.used));
    const legs = S.pathLegs(op.path);
    const count = w => (op.path[w] || []).length;
    return {
      w3: count(3), w5: count(5), w4: count(4),
      distinct3: new Set((op.path[3] || []).map(x => x.team)).size,
      distinct5: new Set((op.path[5] || []).map(x => x.team)).size,
      slots: op.slots, covered: op.covered, weeksCovered: op.weeksCovered,
      // no team may be spent twice across the whole path when reuse is off
      dupes: legs.map(l => l.team).filter((t, i, a) => a.indexOf(t) !== i),
      // survival must be the product of every leg, double weeks included
      product: legs.reduce((a, l) => a * l.p, 1),
      survival: op.survival,
      arrays: Object.keys(op.path).every(w => Array.isArray(op.path[w])),
    };
  });
  ok(r.w3 === 2 && r.w5 === 2, "both configured weeks get two legs", `w3=${r.w3} w5=${r.w5}`);
  ok(r.w4 === 1, "an ordinary week in between still gets one", String(r.w4));
  ok(r.distinct3 === 2 && r.distinct5 === 2, "each double week's two legs are different teams");
  ok(r.dupes.length === 0, "no team is spent twice across the season", r.dupes.join(","));
  ok(r.slots === 20 && r.covered === 20 && r.weeksCovered === 18,
     "20 slots over 18 weeks, all filled", `${r.covered}/${r.slots} slots, ${r.weeksCovered} weeks`);
  ok(Math.abs(r.product - r.survival) < 1e-15,
     "survival is the product of every leg, double legs included", `${r.product} vs ${r.survival}`);
  ok(r.arrays, "path[week] is uniformly an array");
  await ctx.close();
}

/* ---------- 3. the CURRENT week being double is handled, not half-priced ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, doublePickWeeks: [1] });
  ok(errors.length === 0, "board renders when week 1 itself is a double week", errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const cards = S.candidatePaths(1, cfg, D, S.rankWeek(1, cfg, D).rows.slice(0, 3).map(x => x.team));
    const opt = S.optimalPath(cfg, D, 1, new Set(cfg.used));
    return {
      partners: cards.map(c => c.partner && c.partner.team),
      legsInWeek1: cards.map(c => (c.path[1] || []).length),
      selfPaired: cards.filter(c => c.partner && c.partner.team === c.team).map(c => c.team),
      // the ceiling still holds with a doubled current week
      over: cards.filter(c => c.survival > opt.survival * (1 + 1e-9)).map(c => c.team),
      // and a card's survival is still the product of its own path
      productMismatch: cards.filter(c => {
        const p = S.pathLegs(c.path).reduce((a, l) => a * l.p, 1);
        return Math.abs(p - c.survival) > 1e-12;
      }).map(c => c.team),
    };
  });
  ok(r.legsInWeek1.every(n => n === 2),
     "every card fills BOTH slots of a doubled current week", JSON.stringify(r.legsInWeek1));
  ok(r.partners.every(Boolean), "every card names its partner", JSON.stringify(r.partners));
  ok(r.selfPaired.length === 0, "no card pairs a team with itself", r.selfPaired.join(","));
  ok(r.over.length === 0, "the optimality ceiling still holds with a doubled current week", r.over.join(","));
  ok(r.productMismatch.length === 0,
     "a card's survival is the product of its own legs", r.productMismatch.join(","));

  // and the reader is told, on the board, that this week takes two
  const note = await page.evaluate(() => {
    window.SVBoard.ensure();
    return document.getElementById("svBoardNote").textContent;
  });
  ok(/needs two picks/i.test(note), "the board says the week needs two picks", note.slice(0, 90));
  const mate = await page.$eval("#svCards .sv-card .mate", n => n.textContent.replace(/\s+/g, " ").trim());
  ok(/paired with/i.test(mate), "each card shows its partner leg", mate);
  await ctx.close();
}

/* ---------- 4. reuse + a double week must not pick the same team twice ---------- */
{
  const { ctx, page } = await open({ startWeek: 1, reuse: true, doublePickWeeks: [1, 4] });
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const op = S.optimalPath(cfg, D, 1, new Set(cfg.used));
    const cards = S.candidatePaths(1, cfg, D, S.rankWeek(1, cfg, D).rows.slice(0, 2).map(x => x.team));
    const same = w => { const ls = op.path[w] || []; return new Set(ls.map(x => x.team)).size !== ls.length; };
    return {
      pathRepeats: [1, 4].filter(same),
      cardRepeats: cards.filter(c => c.partner && c.partner.team === c.team).map(c => c.team),
      // reuse across weeks is still allowed — that is the whole point of the setting
      reusedAcrossWeeks: (() => {
        const seen = {}; let any = false;
        S.pathLegs(op.path).forEach(l => { if (seen[l.team]) any = true; seen[l.team] = 1; });
        return any;
      })(),
    };
  });
  ok(r.pathRepeats.length === 0,
     "reuse=true: a double week still takes two DIFFERENT teams", r.pathRepeats.join(","));
  ok(r.cardRepeats.length === 0, "reuse=true: no card pairs a team with itself", r.cardRepeats.join(","));
  ok(r.reusedAcrossWeeks, "reuse=true: teams still repeat ACROSS weeks — the setting still works");
  await ctx.close();
}

/* ---------- 5. the simulation spends two teams too ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, doublePickWeeks: [1], sims: 3000, entries: 100 });
  ok(errors.length === 0, "simulation runs with a double week", errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV;
    const cfg = S.load();
    const single = Object.assign({}, cfg, { doublePickWeeks: [] });
    const cands = ["KC", "PHI"];
    const a = S.simulateAll(1, single, D, cands);
    const b = S.simulateAll(1, cfg, D, cands);
    const tab = S.weekTable(1, cfg, D);
    return {
      singleWeek1: a.byTeam.KC.pSurviveWeek,
      doubleWeek1: b.byTeam.KC.pSurviveWeek,
      kcP: tab.KC.p,
      sims: b.sims,
    };
  });
  /* ⚠️ pSurviveWeek, not pAliveEnd, and the difference matters.
     pAliveEnd counts "alive at week 18 OR last one standing before then" — the sim
     breaks out and banks a win the moment the field empties. A double week kills the
     FIELD faster too (it must win two legs as well), so pAliveEnd goes UP in a small
     pool, and an assertion that it goes down fails for a reason that has nothing to do
     with whether the sim spends two teams. pSurviveWeek is incremented before the
     field-empty check and is a clean read on week 1 alone.
     Surviving week 1 with two legs must be strictly harder than with one: roughly
     p_KC × p_partner instead of p_KC. If the sim had stayed single-pick while the path
     went double, these two numbers would be equal — the silent divergence trap 6
     warns about, which looks like nothing at all on screen. */
  ok(r.doubleWeek1 < r.singleWeek1 - 0.02,
     "a doubled week 1 makes surviving it strictly harder in the simulation",
     `double ${r.doubleWeek1} vs single ${r.singleWeek1}`);
  ok(Math.abs(r.singleWeek1 - r.kcP) < 0.03,
     "the single-pick sim still reproduces the raw win probability",
     `${r.singleWeek1} vs ${r.kcP}`);
  ok(r.doubleWeek1 < r.kcP * 0.95,
     "the doubled number is a product of two legs, not one",
     `${r.doubleWeek1} vs ${r.kcP}`);
  ok(r.sims >= 3000, "the sim actually ran", String(r.sims));
  await ctx.close();
}

/* ---------- 6. the dead warning is replaced, not deleted ---------- */
{
  const { ctx, page, errors } = await open({ doublePickWeeks: [9, 12, 13] }, { sheet: "#settings" });
  ok(errors.length === 0, "settings sheet renders", errors[0]);
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const el = document.getElementById("svDoubleWarn");
    return { shown: el && getComputedStyle(el).display !== "none", text: el ? el.textContent.replace(/\s+/g, " ").trim() : "" };
  });
  ok(box.shown, "the double-pick callout is shown when double weeks are set");
  ok(!/not simulated yet/i.test(box.text) && !/too optimistic/i.test(box.text),
     "the dead 'not simulated yet' warning is gone", box.text.slice(0, 100));
  ok(/modelled/i.test(box.text), "…replaced by a statement that they ARE modelled");
  /* ⚠️ and the caveat that is STILL true survives the replacement. Deleting the box
     outright would have taken a live limitation out with a dead one. */
  ok(/count/i.test(box.text) && /roster/i.test(box.text),
     "the still-true field-is-a-count caveat survived", box.text.slice(0, 200));
  const weeks = await page.textContent("#svDW");
  ok(weeks.includes("9") && weeks.includes("12"), "the callout names the configured weeks", weeks);
  await ctx.close();
}

/* ---------- 7. the settings control round-trips ---------- */
{
  const { ctx, page } = await open({ doublePickFrom: 12 }, { sheet: "#settings" });
  await page.waitForTimeout(400);
  const shown = await page.inputValue("#cDoubleWeeks");
  ok(shown === "12-18", "a migrated suffix prints back as a compact range", shown);

  await page.fill("#cDoubleWeeks", "9, 12-16");
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const cfg = window.DDSurvivor.load();
    return { weeks: cfg.doublePickWeeks, legacy: cfg.doublePickFrom,
             out: document.getElementById("cDoubleOut").textContent };
  });
  ok(JSON.stringify(r.weeks) === JSON.stringify([9, 12, 13, 14, 15, 16]),
     "a list plus a range parses to the right weeks", JSON.stringify(r.weeks));
  /* ⚠️ Editing the array clears the legacy scalar. Left behind, load()'s migration
     would re-expand it the moment the reader cleared the box, resurrecting a rule
     they had just deleted. */
  ok(r.legacy === 0, "editing the list clears the legacy suffix so it cannot resurrect",
     String(r.legacy));

  await page.fill("#cDoubleWeeks", "9, banana, 30");
  await page.waitForTimeout(200);
  const bad = await page.evaluate(() => ({
    weeks: window.DDSurvivor.load().doublePickWeeks,
    out: document.getElementById("cDoubleOut").textContent,
  }));
  ok(JSON.stringify(bad.weeks) === JSON.stringify([9]), "good tokens still parse", JSON.stringify(bad.weeks));
  ok(/ignored/i.test(bad.out) && /banana/.test(bad.out),
     "unparseable tokens are REPORTED, not dropped quietly", bad.out);

  await page.fill("#cDoubleWeeks", "");
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => window.DDSurvivor.load().doublePickWeeks);
  ok(JSON.stringify(cleared) === "[]", "clearing the box really clears it", JSON.stringify(cleared));
  await ctx.close();
}

/* ---------- 8. the path table and heatmap show both legs ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, doublePickWeeks: [2] });
  await page.evaluate(() => window.SVBoard.ensure());
  await page.waitForFunction(() => document.querySelectorAll("#svPathTable tr").length > 2,
                             null, { timeout: 30000 });
  const rows = await page.$$eval("#svPathTable tr", ns => ns.slice(1).map(n =>
    n.textContent.replace(/\s+/g, " ").trim()));
  const week2Rows = rows.filter((t, i) => i === 1 || i === 2);
  ok(/2 picks/i.test(week2Rows[0]), "the double week is marked in the path table", week2Rows[0]);
  const marked = await page.$$eval("#svHeat .sv-cell.sv-path[data-week='2']", ns => ns.map(n => n.dataset.team));
  ok(marked.length === 2, "two week-2 cells are marked on the heatmap", marked.join(","));

  // the overlay visits both cells rather than pretending the week had one pick
  await page.click("#svShowPath");
  await page.waitForTimeout(300);
  const pts = await page.$eval(".sv-path-overlay .sv-path-route", n => n.getAttribute("points"));
  ok(pts.trim().split(/\s+/).length === 19,
     "the overlay draws one point per LEG — 19 for 18 weeks with one double", String(pts.trim().split(/\s+/).length));
  ok(errors.length === 0, "no page error through the double-week render", errors[0]);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`survivor double-pick: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
