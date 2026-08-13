/* Bozo — the entry form opens on the leg you already have.
 *
 * Run: node work/test-bozo-prefill.mjs      (needs playwright; serves the repo on :8813)
 *
 * ⚠️ WHAT THIS IS GUARDING, AND WHY IT IS NOT COSMETIC.
 * The form used to open on its own defaults — Market fell to Spread, the first <option>
 * — while the member's real leg sat in their sheet below. There was no `fMkt.value =`
 * anywhere in bozo.html. A member holding a moneyline therefore saw "Spread", typed
 * their moneyline price against it, and got priceWarning()'s "far off market for a
 * spread" — the page blaming the bet for a mistake the form had made.
 *
 * Two properties are pinned here and they pull against each other:
 *   1. the SELECTION comes back (sport, game, market, side, number), so the form tells
 *      the truth about what is on the board; and
 *   2. the PRICE never does. "Editing resets your clock AND your price" is a rule — an
 *      edit must take the price at the moment of the edit, not ride an old number out
 *      on a fresh timestamp.
 * A prefill that helpfully restored the price would pass every "is the form populated"
 * check and quietly break the second one, so it is asserted directly.
 *
 * The page is loaded for real against stubbed network — RTDB, the Worker and ESPN are
 * routed, nothing else is. `pageerror` fails the run rather than being swallowed.
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
const MEMBERS = ["Butts", "JWhite", "Kap", "Manzeo", "Squatch", "The Kid", "Tony", "Tucholski"];
const NOW = 1786658669208;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};

/* A session blob shaped the way loadSession() reads it: base64url(payload).signature.
   Only the Worker can verify the signature and nothing here asks it to, which is
   exactly the real page's behaviour when it decides whose sheet to show. */
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SESSION = b64u({ n: "Kap", e: Date.now() + 864e5 }) + ".sig";

const ESPN = {
  events: [
    { id: "401873272", shortName: "DET @ CIN", date: "2026-08-13T23:00:00Z",
      status: { type: { state: "pre", completed: false } },
      competitions: [{ competitors: [
        { team: { abbreviation: "CIN", displayName: "Cincinnati Bengals" }, homeAway: "home", score: null },
        { team: { abbreviation: "DET", displayName: "Detroit Lions" }, homeAway: "away", score: null }] }] },
    { id: "401873275", shortName: "GB @ PIT", date: "2026-08-13T23:00:00Z",
      status: { type: { state: "pre", completed: false } },
      competitions: [{ competitors: [
        { team: { abbreviation: "PIT", displayName: "Pittsburgh Steelers" }, homeAway: "home", score: null },
        { team: { abbreviation: "GB", displayName: "Green Bay Packers" }, homeAway: "away", score: null }] }] },
  ],
};

// The real leg this session wrote through dd_submit_bozo_leg, verbatim from RTDB.
const ML_LEG = {
  sport: "nfl", eventId: "401873272", game: "DET @ CIN", mkt: "ml", side: "CIN",
  line: 0, dir: "over", price: -285, entryPriceOpp: 230, entryBook: "draftkings",
  label: "CIN ML", priceSource: "self", startsAt: "2026-08-13T23:00:00Z",
  selectionKey: "401873272|ml|CIN||", marketKey: "401873272|ml|", ts: NOW, via: "mcp",
};
const SPREAD_LEG = { ...ML_LEG, mkt: "spread", line: -6.5, side: "CIN", price: -150,
  label: "CIN -6.5", selectionKey: "401873272|spread|CIN|-6.5|", marketKey: "401873272|spread|-6.5" };

const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "content-type": p.endsWith(".html") ? "text/html" : "text/plain" });
    res.end(b);
  });
});
await new Promise(r => srv.listen(8813, r));
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || chromiumExecutable(chromium),
});

async function open(picks) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await ctx.addInitScript(s => { try { localStorage.setItem("dd-bozo-sess", s); } catch (e) {} }, SESSION);
  // ⚠️ Playwright matches the MOST RECENTLY registered route first — catch-alls first.
  await page.route("**firebaseio.com**", r => r.abort());
  await page.route("**toto.jkapcar4.workers.dev**", r => r.fulfill({ json: {} }));
  await page.route("**site.api.espn.com**", r => r.fulfill({ json: ESPN }));
  await page.route("**/auth/roster*", r => r.fulfill({ json: { players: MEMBERS.map(n => ({ name: n, claimed: true })) } }));
  await page.route("**/league/list*", r => r.fulfill({ json: { defaultLeague: "main", leagues: [{
    id: "main", name: "Bozo Boyz", manager: "Kap", size: 8, members: MEMBERS,
    week: 1, status: "open",
    settings: { stake: 50, allowEdit: true, lockRule: "all", lockCount: 0,
                levers: [0, 1, 2, 3], format: "standard", buyback: 0, formatLocked: false, synthetic: false },
  }] } }));
  await page.route("**/bozo/leagues/main.json*", r => r.fulfill({ json: {
    season: 2026, week: 1, status: "open", order: null, picks } }));
  await page.goto("http://localhost:8813/bozo.html?l=main#s=Kap", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  return { ctx, page, errors };
}
const val = (page, id) => page.$eval("#" + id, n => n.value);

/* ---------- 1. a moneyline leg brings the form back as a moneyline ---------- */
{
  const { ctx, page, errors } = await open({ Kap: ML_LEG });
  ok(errors.length === 0, "sheet with a leg renders without a page error", errors[0]);
  ok(await page.isVisible("#submitCard"), "the submit form is on your own sheet");
  // THE BUG, pinned: this was "spread" — the first <option> — for a moneyline leg.
  ok(await val(page, "fMkt") === "ml", "market comes back as Moneyline, not the Spread default",
     await val(page, "fMkt"));
  ok(await val(page, "fGame") === "401873272", "the game comes back", await val(page, "fGame"));
  ok(await val(page, "fSport") === "nfl", "the sport comes back");
  ok(await val(page, "fSide") === "CIN", "the side comes back", await val(page, "fSide"));
  // ⚠️ A moneyline has no number, so the Number field must be HIDDEN, not merely empty.
  ok(!(await page.isVisible("#lineWrap")), "Number is hidden for a moneyline");
  // ⚠️ THE RULE. Editing resets your price: the selection returns, the price never does.
  ok(await val(page, "fPrice") === "", "the PRICE is deliberately NOT prefilled",
     await val(page, "fPrice"));
  ok(await val(page, "fPriceOpp") === "", "the other side is not prefilled either");
  // and with the market right, the leg is no longer accused of being off-market
  ok(!(await page.isVisible("#priceWarn")), "no off-market warning is raised against a correct leg");
  ok((await page.textContent("#legPrev")).includes("CIN ML"), "the preview reads back the real leg");
  await ctx.close();
}

/* ---------- 2. a spread leg brings its number back too ---------- */
{
  const { ctx, page, errors } = await open({ Kap: SPREAD_LEG });
  ok(errors.length === 0, "spread leg renders without a page error", errors[0]);
  ok(await val(page, "fMkt") === "spread", "market comes back as Spread");
  ok(await page.isVisible("#lineWrap"), "Number is shown for a spread");
  ok(Number(await val(page, "fLine")) === -6.5, "the number comes back, sign intact",
     await val(page, "fLine"));
  ok(await val(page, "fPrice") === "", "the price is still not prefilled on a spread either");
  await ctx.close();
}

/* ---------- 3. no leg in → the form is left alone ---------- */
{
  const { ctx, page, errors } = await open({});
  ok(errors.length === 0, "empty board renders without a page error", errors[0]);
  ok(await val(page, "fPrice") === "" && await val(page, "fSide") !== "",
     "with no leg in, the form is a normal empty entry form");
  await ctx.close();
}

/* ---------- 4. a poll must not overwrite what you are typing ---------- */
{
  const { ctx, page, errors } = await open({ Kap: ML_LEG });
  // the reader takes the form somewhere else entirely
  await page.selectOption("#fMkt", "spread");
  await page.fill("#fLine", "-3.5");
  // ⚠️ render() runs on the 15s poll and on every EventSource put. Before the
  // formTouched guard this re-fired the prefill and yanked the market back under them.
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await page.waitForTimeout(400);
  ok(await val(page, "fMkt") === "spread", "a re-render does NOT overwrite the market you chose",
     await val(page, "fMkt"));
  ok(Number(await val(page, "fLine")) === -3.5, "…nor the number you typed");
  await ctx.close();
}

/* ---------- 5. moneyline price on an un-numbered spread converts ---------- */
{
  const { ctx, page } = await open({});
  await page.selectOption("#fMkt", "spread");
  await page.fill("#fLine", "");
  await page.fill("#fPrice", "-285");
  await page.dispatchEvent("#fPrice", "change");     // bound to change, not input
  await page.waitForTimeout(200);
  ok(await val(page, "fMkt") === "ml",
     "a moneyline price on a spread with NO number switches to Moneyline", await val(page, "fMkt"));
  ok((await page.textContent("#priceWarn")).includes("Switched to Moneyline"),
     "…and says so rather than doing it silently");
  await ctx.close();
}

/* ---------- 6. …but a NUMBERED spread is never converted ---------- */
{
  const { ctx, page } = await open({});
  await page.selectOption("#fMkt", "spread");
  await page.fill("#fLine", "-9.5");
  await page.fill("#fPrice", "-285");
  await page.dispatchEvent("#fPrice", "change");
  await page.waitForTimeout(200);
  // ⚠️ THE ONE THAT MATTERS. A bought-down alternate line is a real spread at a real
  // price. Converting would silently drop the -9.5 and change which bet is being made.
  ok(await val(page, "fMkt") === "spread", "a spread WITH a number is left alone", await val(page, "fMkt"));
  ok(Number(await val(page, "fLine")) === -9.5, "…and keeps its number");
  ok((await page.textContent("#priceWarn")).includes("far off market"),
     "…and still gets the honest warning instead of a silent rewrite");
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
