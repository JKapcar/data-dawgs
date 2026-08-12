/* Bozo — carnival-casino skin + per-reader lever reveal.
 *
 * Run: node work/test-bozo-carnival.mjs      (needs playwright; serves the repo on :8811)
 *
 * ⚠️ WHAT THIS IS ACTUALLY GUARDING.
 * The draw is the SERVER's — one permutation, written once at the close, immutable.
 * The only thing this change made per-reader is whether you have watched it land.
 * So the assertions below are mostly about one property: the page must never let the
 * reveal state change what the reels stop on, and must never leak the order before
 * the pull. A test that only screenshots the skin would miss both.
 *
 * The page is loaded for real against stubbed network — RTDB and the Worker are
 * routed, nothing else is. If bozo.html throws during render, `pageerror` fails the
 * run rather than being swallowed, which is the same lesson refresh() learned.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
// ⚠️ The repo installs playwright WITHOUT its browsers and drives the system Chrome
// instead, so chromium.executablePath() points at something that isn't there. Every
// other suite here resolves through this helper; going straight to playwright's default
// makes this the one test that needs an env var set by hand to run at all.
import { chromiumExecutable } from "./playwright-loader.mjs";

const WORK = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WORK, "..");
const MEMBERS = ["Butts", "JWhite", "Kap", "Manzeo", "Squatch", "The Kid", "Tony", "Tucholski"];
// LEVERS order in the page: 0 Shortest Odds, 1 Worst Beat, 2 Last In, 3 Worst CLV
const DRAW = [2, 3, 0, 1];
const NAMES = ["Shortest Odds", "Worst Beat", "Last In", "Worst CLV"];

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};

const legs = () => Object.fromEntries(MEMBERS.map((m, i) => [encodeURIComponent(m), {
  price: -150 - i * 10, sport: "nfl", mkt: "spread", line: -3.5, side: "KC",
  game: "KC vs DEN", eventId: "g" + i, ts: 1759990000000 + i * 1000,
}]));

const SCEN = {
  open:   { week: 1, status: "open", picks: {}, order: null },
  drawn:  { week: 1, status: "placed", order: DRAW, closeTs: 1760000000000, picks: legs() },
  redraw: { week: 1, status: "placed", order: [0, 1, 2, 3], closeTs: 1760000000000, picks: legs() },
  graded: { week: 1, status: "graded", order: [1, 0, 3, 2], closeTs: 1760000000000,
            bozo: "Manzeo", bozoWhy: "Worst Beat.", history: [{ week: 1, bozo: "Manzeo" }],
            picks: legs(),
            results: Object.fromEntries(MEMBERS.map((m, i) => [encodeURIComponent(m), { won: i !== 3, actual: i !== 3 ? 7 : -9 }])) },
};

const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "content-type": p.endsWith(".html") ? "text/html" : "text/plain" });
    res.end(b);
  });
});
await new Promise(r => srv.listen(8811, r));
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || chromiumExecutable(chromium),
});

/* One browser context per case. `storage` lets a case start with a reveal already
   recorded, which is how "second visit paints statically" is tested. */
async function open(scen, { theme = "light", width = 1200, reduced = false, seen = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 1100 },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await ctx.addInitScript(([t, s]) => {
    try {
      localStorage.setItem("dd-theme2", t);
      localStorage.setItem("dd-theme2-bozo", t);
      if (s) localStorage.setItem("dd-bozo-seen-draw", s);
    } catch (e) {}
  }, [theme, seen]);
  // ⚠️ Playwright matches the MOST RECENTLY registered route first — catch-alls go on
  // before the specific routes or they swallow them.
  await page.route("**firebaseio.com**", r => r.abort());
  await page.route("**toto.jkapcar4.workers.dev**", r => r.fulfill({ json: {} }));
  await page.route("**/auth/roster*", r => r.fulfill({ json: { players: MEMBERS.map(n => ({ name: n, claimed: true })) } }));
  await page.route("**/league/list*", r => r.fulfill({ json: { defaultLeague: "main", leagues: [{
    id: "main", name: "Bozo Boyz", manager: "Kap", size: 8, members: MEMBERS,
    week: scen.week, status: scen.status,
    settings: { stake: 50, allowEdit: true, lockRule: "all", lockCount: 0,
                levers: [0, 1, 2, 3], format: "standard", buyback: 0, formatLocked: false, synthetic: false },
  }] } }));
  await page.route("**/bozo/leagues/main.json*", r => r.fulfill({ json: { season: 2026, ...scen } }));
  await page.goto("http://localhost:8811/bozo.html?l=main", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}
const machineClasses = page => page.getAttribute("#machine", "class");
const orderText = page => page.$eval("#ord", n => n.textContent.replace(/\s+/g, " ").trim());

/* ---------- 1. not drawn: the lever is inert ---------- */
{
  const { ctx, page, errors } = await open(SCEN.open);
  ok(errors.length === 0, "open board renders without a page error", errors[0]);
  ok((await machineClasses(page)).includes("armed"), "no draw → machine armed");
  ok(!(await machineClasses(page)).includes("pending"), "no draw → NOT pending");
  ok(await page.getAttribute("#lever", "disabled") !== null, "no draw → lever disabled");
  ok((await page.textContent("#pullLab")).trim() === "armed", "no draw → decal reads 'armed'");
  ok((await page.textContent("#drawState")).includes("not drawn"), "no draw → state line says not drawn");
  await ctx.close();
}

/* ---------- 2. drawn, unseen: armed, live lever, order NOT leaked ---------- */
{
  const { ctx, page, errors } = await open(SCEN.drawn);
  ok(errors.length === 0, "drawn board renders without a page error", errors[0]);
  const cls = await machineClasses(page);
  ok(cls.includes("armed") && cls.includes("pending"), "drawn + unseen → armed AND pending", cls);
  ok(await page.getAttribute("#lever", "disabled") === null, "drawn + unseen → lever enabled");
  ok((await page.textContent("#pullLab")).trim() === "Pull", "drawn + unseen → decal reads 'Pull'");
  ok((await page.$$eval(".win.locked", n => n.length)) === 0, "drawn + unseen → no reel is locked");
  // ⚠️ the leak test: the ghost list must be the lever SET in declaration order,
  // never the drawn order. DRAW is [2,3,0,1], so a leaked list would start "Last In".
  const ghost = await orderText(page);
  ok(ghost.indexOf(NAMES[0]) < ghost.indexOf(NAMES[2]), "ghost list is the lever set, not the draw", ghost.slice(0, 60));
  ok((await page.$$eval("#ord li.ghost", n => n.length)) === 4, "every pre-pull row is a ghost row");
  ok((await page.textContent("#drawState")).includes("waiting on your pull"), "state line asks for the pull");
  // idempotence: render() runs on a 15s poll and on every hashchange
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await page.waitForTimeout(150);
  ok((await machineClasses(page)).includes("pending"), "a re-render does not un-arm the pending machine");
  ok((await page.$$eval("#ord li.ghost", n => n.length)) === 4, "a re-render does not leak the order either");
  await ctx.close();
}

/* ---------- 3. the pull ---------- */
{
  const { ctx, page, errors } = await open(SCEN.drawn);
  await page.click("#lever");
  await page.waitForTimeout(4200);
  ok(errors.length === 0, "pull raises no page error", errors[0]);
  ok((await page.$$eval(".win.locked", n => n.length)) === 4, "after the pull every reel is locked");
  const txt = await orderText(page);
  const want = DRAW.map(i => NAMES[i]);
  ok(want.every((n, i) => txt.indexOf(n) >= 0 && (i === 0 || txt.indexOf(n) > txt.indexOf(want[i - 1]))),
     "the painted order is exactly the server's draw, in order", txt.slice(0, 80));
  ok((await page.textContent("#pullLab")).trim() === "drawn", "after the pull the decal reads 'drawn'");
  ok(await page.getAttribute("#lever", "disabled") !== null, "the lever cannot be pulled twice");
  const cls = await machineClasses(page);
  ok(!cls.includes("armed") && !cls.includes("pending") && cls.includes("locked"), "machine ends locked", cls);
  const flag = await page.evaluate(() => localStorage.getItem("dd-bozo-seen-draw"));
  ok(/main:2026:1:2301/.test(flag), "the reveal is recorded against league:season:week:order", flag);
  await ctx.close();
}

/* ---------- 4. second visit on the same device: static, no second show ---------- */
{
  const seen = JSON.stringify({ "main:2026:1:2301": 1 });
  const { ctx, page } = await open(SCEN.drawn, { seen });
  ok(!(await machineClasses(page)).includes("pending"), "already seen → not pending");
  ok((await page.$$eval(".win.locked", n => n.length)) === 4, "already seen → reels are locked on load");
  ok(await page.getAttribute("#lever", "disabled") !== null, "already seen → lever disabled");
  await ctx.close();
}

/* ---------- 5. a re-drawn week is a fresh reveal ---------- */
{
  const seen = JSON.stringify({ "main:2026:1:2301": 1 });   // the OLD order
  const { ctx, page } = await open(SCEN.redraw, { seen });
  ok((await machineClasses(page)).includes("pending"), "a different order on the same week arms again");
  await ctx.close();
}

/* ---------- 6. graded weeks auto-reveal ---------- */
{
  const { ctx, page, errors } = await open(SCEN.graded);
  ok(errors.length === 0, "graded board renders without a page error", errors[0]);
  ok(!(await machineClasses(page)).includes("pending"), "graded → no pull required");
  ok((await page.$$eval(".win.locked", n => n.length)) === 4, "graded → the hierarchy is on the reels");
  // the season board is the other half of a graded week
  ok((await page.$$eval('#seasonCard .trow[data-worn="1"]', n => n.length)) === 1, "exactly one dawg has worn one");
  ok((await page.$$eval("#seasonCard .fund", n => n.length)) === 1, "the leader carries the funding plaque");
  await ctx.close();
}

/* ---------- 7. reduced motion: the pull survives, the motion does not ---------- */
{
  const { ctx, page } = await open(SCEN.drawn, { reduced: true });
  ok((await machineClasses(page)).includes("pending"), "reduced motion still gets the pull");
  // ⚠️ frozen strips would park every window on the SAME cell, which reads as a
  // drawn hierarchy of four identical levers. The glass is blanked instead.
  const vis = await page.$eval(".strip", n => getComputedStyle(n).visibility);
  ok(vis === "hidden", "reduced motion + armed → reel strips are blanked, not frozen mid-word", vis);
  await page.click("#lever");
  await page.waitForTimeout(400);
  ok((await page.$$eval(".win.locked", n => n.length)) === 4, "reduced motion reveals instantly on pull");
  ok((await page.$eval(".strip", n => getComputedStyle(n).visibility)) === "visible", "the reels come back for the result");
  await ctx.close();
}

/* ---------- 8. the skin is on exactly the three cards, and nothing else ---------- */
{
  const { ctx, page } = await open(SCEN.graded);
  const skinned = await page.$$eval(".bz-carnival", n => n.map(x => x.id));
  ok(skinned.length === 3 && ["drawCard", "diagCard", "seasonCard"].every(id => skinned.includes(id)),
     "three cards carry the skin", skinned.join(","));
  const canopy = await page.$eval("#drawCard", n => getComputedStyle(n, "::before").height);
  ok(canopy === "42px", "the tent canopy renders", canopy);
  const pennant = await page.$eval("#drawCard", n => getComputedStyle(n, "::after").height);
  ok(pennant === "16px", "the pennant pole renders at the peak", pennant);
  // the marquee sign is the strongest carnival cue on the page — assert it survives
  const sign = await page.$eval("#seasonCard .bz-hdr h2.bz", n => getComputedStyle(n).borderTopStyle);
  ok(sign === "dotted", "card titles are bulb-outlined marquee signs", sign);
  // the reel windows stay cream with dark type in BOTH themes — the one part of the
  // machine that must not go dark, or the lever names stop being readable
  for (const theme of ["light", "dark"]) {
    const c = await open(SCEN.graded, { theme });
    const ink = await c.page.$eval(".cell", n => getComputedStyle(n).color);
    ok(ink === "rgb(43, 28, 14)", `reel type stays dark in ${theme} theme`, ink);
    await c.ctx.close();
  }
  await ctx.close();
}

/* ---------- 9. the reels stay one row on a phone ---------- */
{
  const { ctx, page } = await open(SCEN.drawn, { width: 390 });
  const cols = await page.$eval("#reels", n => getComputedStyle(n).gridTemplateColumns.split(" ").length);
  ok(cols === 4, "four reels stay in one row at 390px — the row IS the hierarchy", cols);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
