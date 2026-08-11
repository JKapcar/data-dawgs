/* challenge.html in a real browser, with the Worker stubbed — the forecasting challenge
   board (Stage FC-E).

   The assertions that matter here are not "does it render". They are the three rules that
   are silent and unrecoverable when broken:

     1. `touched` comes from a real input event and is NEVER inferred from the slider's
        value. Three saves below all send slider_value 50 and must NOT all send the same
        `touched` — that single fact is what a value-derived implementation cannot fake.
     2. The Worker's 409 is the lock, not the browser clock. A game whose kickoff is a
        month away must still lock when the server says so.
     3. The client never sends home_win_probability. The Worker derives it, which is what
        makes it impossible for the raw input and the scored number to disagree.

   Run:  cd work && node test-challenge.mjs      (serves ../ on :8907)
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTABLE = chromiumExecutable(chromium);
const TYPES = { ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".xml": "application/xml" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "text/plain" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8907, r));

const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenFor = n => b64u({ n, e: Date.now() + 30 * 86400000, p: 0 }) + ".sig";

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const errors = [];

/* ---- the Worker, stubbed. Every /forecast/entry body is recorded. ---- */
let posted = [];
let entryStatus = 200;
await ctx.route("**/toto.jkapcar4.workers.dev/**", async route => {
  const req = route.request();
  const p = new URL(req.url()).pathname;
  const send = (o, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(o) });

  if (p === "/forecast/entries") return send({ ok: true, entries: [], sealed: [] });
  if (p === "/forecast/entry") {
    const body = req.postDataJSON() || {};
    posted.push(body);
    if (entryStatus === 409)
      return send({ error: "That game has kicked off. Forecasts are locked." }, 409);
    return send({ ok: true, entry: Object.assign({ revision: 1 }, body) });
  }
  return send({ error: "unrouted " + p }, 404);
});

const page = await ctx.newPage();
page.on("pageerror", e => errors.push(e.message));
const go = async () => {
  await page.goto("http://127.0.0.1:8907/challenge.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
};
const signIn = async () => {
  await page.evaluate(t => window.DDAuth.set(t), tokenFor("Kap"));
  await page.waitForTimeout(500);
};

/* ------------------------------------------------- the page, signed out */
console.log("\nthe board, signed out");
await go();
ok("loads with no script errors", errors.length === 0, errors.join(" | "));
ok("all four sheets mount",
  (await page.locator("#sheetBoard").count()) === 1 &&
  (await page.locator("#sheetBoardLb").count()) === 1 &&
  (await page.locator("#sheetBoardModels").count()) === 1 &&
  (await page.locator("#sheetBoardMethod").count()) === 1);
ok("the week's games render from the canonical schedule",
  (await page.locator("#cwGames .card").count()) > 0);
ok("every game has a slider", (await page.locator("#cwGames input[type=range]").count()) > 0);

/* An unsigned visitor sees the board and the models — the argument is public even though
   entering is not. */
ok("an unsigned visitor still sees the board",
  (await page.locator("#cwGames .card").count()) > 0);
ok("…but cannot enter a forecast",
  (await page.locator("#cwGames input[type=range]:not([disabled])").count()) === 0);
ok("…and is pointed at the one page that owns sign-in",
  /signon\.html\?next=challenge\.html/.test(await page.locator("#cwAuth").innerHTML()));

/* The model lines are derived from the receipts, not typed into the page. */
ok("the registered model lines render", (await page.locator("#cwModels tbody tr").count()) >= 2);
{
  const t = await page.locator("#cwCorr").innerText();
  ok("the agreement between the two independent models is MEASURED, not asserted",
    /r = 0\.\d{3}/.test(t), t);
}
/* The Method sheet renders from the contract, so the page cannot drift from it. */
{
  const m = await page.locator("#cwMethod").innerText();
  ok("the method comes from the contract file", /25 - 100/.test(m), m.slice(0, 120));
  ok("…including the touched rule", /never derived/i.test(m));
  ok("…and the ties-void deviation", /ties void/i.test(m));
}
/* Zero rows and a broken read must not look alike. */
ok("the leaderboard says it is not built, rather than showing an empty table",
  /not built yet/i.test(await page.locator("#cwLbState").innerText()));

/* ------------------------------------------- ⚠️ THE RULE THAT POISONS THE CROWD */
console.log("\ntouched is an event, never a value");
await signIn();
ok("signing in enables the board",
  (await page.locator("#cwGames input[type=range]:not([disabled])").count()) > 0);

posted = [];
const cards = page.locator("#cwGames .card");
const saveIn = i => cards.nth(i).locator("button", { hasText: /^Save$/ });
const flipIn = i => cards.nth(i).locator("button", { hasText: /^Reading:/ });

// A: never touched at all.
await saveIn(0).click();
await page.waitForTimeout(220);
// B: only the side toggle pressed. Flipping a label is not a forecast.
await flipIn(1).click();
await saveIn(1).click();
await page.waitForTimeout(220);
// C: a real drag that lands on exactly 50 — the value says nothing, the intent says all.
await cards.nth(2).locator("input[type=range]").evaluate(el => {
  el.value = "50";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await saveIn(2).click();
await page.waitForTimeout(220);

ok("three saves reached the Worker", posted.length === 3, JSON.stringify(posted));
ok("…and all three carry the SAME slider value of 50",
  posted.every(b => b.slider_value === 50), JSON.stringify(posted.map(b => b.slider_value)));
ok("an untouched slider is recorded untouched", posted[0].touched === false);
ok("a side toggle alone does NOT mark it touched", posted[1].touched === false);
/* ⚠️ The whole point. Same value, opposite meaning. A `slider_value !== 50` implementation
   returns false here and the crowd line silently loses every deliberate 50. */
ok("a dragged slider left on 50 IS touched", posted[2].touched === true);
ok("so `touched` cannot have been derived from the value",
  posted[0].touched !== posted[2].touched && posted[0].slider_value === posted[2].slider_value);

/* ⚠️ The client may not assert the canonical probability — the Worker derives it. */
ok("the client never sends home_win_probability",
  posted.every(b => !("home_win_probability" in b)), JSON.stringify(posted));
ok("it sends the raw slider and the side instead",
  posted.every(b => typeof b.slider_value === "number" && /^(home|away)$/.test(b.slider_side)));
ok("the side toggle actually flips the side", posted[1].slider_side === "away");

/* ------------------------------------------- ⚠️ THE SERVER OWNS THE LOCK */
console.log("\nthe lock is the Worker's 409, not the browser clock");
{
  const kickoff = await cards.nth(4).locator("p.sub").first().innerText();
  ok("the game under test kicks off in the future by the local clock",
    new Date(kickoff).getTime() > Date.now(), kickoff);
  entryStatus = 409;
  await saveIn(4).click();
  await page.waitForTimeout(300);
  ok("a 409 disables the slider even though the clock says it is open",
    await cards.nth(4).locator("input[type=range]").isDisabled());
  ok("…and disables saving", await saveIn(4).isDisabled());
  ok("…and surfaces the Worker's own words",
    /kicked off/i.test(await cards.nth(4).innerText()));
  entryStatus = 200;
}

/* ------------------------------------------------------------ layout, measured */
console.log("\nlayout, measured");
for (const [w, h, label] of [[1280, 950, "desktop"], [390, 844, "phone"], [320, 700, "small"]]) {
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(160);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${label} ${theme}: nothing overflows sideways`, over <= 0, String(over));
  }
}
ok("still no script errors after the whole run", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
