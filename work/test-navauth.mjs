/* The universal sign-in, in a real browser, on real pages, with the Worker stubbed.

   What a screenshot cannot show and this can: whether the chip reads the session from
   the token instead of a request, whether the modal is genuinely hidden rather than
   merely off-colour, whether the nav still fits on a 360px phone with an eighth child
   in it, and whether signing in on one page is visible on the next one.

   Run:  cd work && node test-navauth.mjs        (serves ../ on :8904)
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
const SHOTS = process.env.DD_TEST_ARTIFACTS || path.join(ROOT, "work");
fs.mkdirSync(SHOTS, {recursive:true});
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8904, r));

/* A session token shaped exactly like the Worker's: base64url(JSON) "." signature.
   The nav must read the name straight out of this and never ask anyone. */
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenFor = (n, msFromNow) => b64u({ n, e: Date.now() + msFromNow }) + ".sigsigsig";
const GOOD = tokenFor("Jeff Carbaugh", 30 * 86400000);
const DEAD = tokenFor("Jeff Carbaugh", -1000);

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const errors = [];

let loginSeen = null, sessionSeen = null, rosterHits = 0;
await ctx.route("**/toto.jkapcar4.workers.dev/**", async route => {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postDataJSON() || {};
  const send = (o, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(o) });
  if (url.pathname === "/auth/roster") { rosterHits++; return send({ players: [{ name: "Kap", claimed: true }, { name: "Jeff Carbaugh", claimed: true }, { name: "Ghost", claimed: false }] }); }
  if (url.pathname === "/auth/login") {
    loginSeen = body;
    if (body.password !== "hunter2") return send({ error: "Wrong password." }, 403);
    return send({ ok: true, name: "Jeff Carbaugh", email: "jeff@example.com", session: GOOD });
  }
  sessionSeen = req.headers()["x-bozo-session"] || null;
  if (url.pathname === "/auth/mcp-token") {
    if (!sessionSeen) return send({ error: "Sign in first." }, 401);
    if (body.action === "mint") return send({ ok: true, player: "Jeff Carbaugh", token: "u_ABC", url: "https://toto.jkapcar4.workers.dev/mcp/u_ABC" });
    return send({ ok: true, revoked: true });
  }
  if (url.pathname === "/auth/email") return send({ ok: true, email: body.email });
  return send({ error: "unrouted " + url.pathname }, 404);
});
// RTDB and everything else the pages fetch — answer empty rather than hang
await ctx.route("**/*.firebaseio.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));

const page = await ctx.newPage();
page.on("pageerror", e => errors.push(e.message));

const go = async u => { await page.goto("http://127.0.0.1:8904/" + u, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(400); };

/* ---------------------------------------------------------------- signed out */
console.log("\nsigned out");
await go("index.html");
ok("the page loads with no script errors", errors.length === 0, errors.join(" | "));
ok("the sign-in section exists in the banner", await page.locator(".sitenav .navauth").count() === 1);
ok("it is its OWN section, a sibling of .brand and .links — not inside the links row",
  await page.evaluate(() => {
    const a = document.querySelector(".navauth");
    return a.parentElement.classList.contains("sitenav") && !a.closest(".links");
  }));
ok("it sits between the logo and the menu, which is the gap Kap circled",
  await page.evaluate(() => {
    const k = [...document.querySelector(".sitenav").children];
    return k.indexOf(document.querySelector(".brand")) < k.indexOf(document.querySelector(".navauth"))
      && k.indexOf(document.querySelector(".navauth")) < k.indexOf(document.querySelector(".links"));
  }));
ok("the chip says Sign in", (await page.locator("#ddAuthBtn").innerText()).trim() === "Sign in");
ok("nothing was fetched to work that out", rosterHits === 0);
ok("the dormant modal is never built", await page.locator("#ddAuthModal").count() === 0);

console.log("\nthe chip ROUTES to the sign-on page (8/7: one page owns identity)");
await page.click("#ddAuthBtn");
await page.waitForURL("**/signon.html?next=index.html", { timeout: 4000 });
ok("clicking navigates to signon.html carrying ?next=index.html", true);
ok("no modal opened anywhere along the way", await page.locator("#ddAuthModal").count() === 0);
ok("still no roster fetch from the chip itself — signon fetched it for ITS card, or not, but the chip cost nothing extra",
  rosterHits <= 1, "hits " + rosterHits);
await go("bozo.html");
await page.click("#ddAuthBtn");
await page.waitForURL("**/signon.html?next=bozo.html", { timeout: 4000 });
ok("from bozo.html the chip routes with ?next=bozo.html", true);
await go("connect.html");
await page.waitForURL("**/signon.html#connect", { timeout: 4000 });
ok("connect.html redirects to the folded-in sheet", true);
/* on signon itself the chip must NOT navigate — the cards are already here */
await page.click("#ddAuthBtn");
await page.waitForTimeout(350);
ok("on signon.html the chip stays put (scrolls, no navigation)",
  /signon\.html/.test(page.url()));

console.log("\nsigned-in state comes from the token, no request");
await page.evaluate(t => localStorage.setItem("dd-bozo-sess", t), GOOD);
await go("index.html");
ok("the chip shows the first name from the token",
  (await page.locator("#ddAuthBtn").innerText()).trim() === "Jeff");
ok("the full name is in the title, so nothing is lost to truncation",
  /Jeff Carbaugh/.test(await page.locator("#ddAuthBtn").getAttribute("title")));
ok("the section is marked signed-in for styling",
  await page.evaluate(() => document.querySelector(".navauth").classList.contains("in")));
ok("nothing was written to a near-miss key",
  (await page.evaluate(() => localStorage.getItem("dd-bozo-session"))) === null);

console.log("\nit is universal — the point of the whole change");
for (const p of ["guillotine.html", "dfs.html", "stats.html", "receipts.html", "survivor.html", "master.html"]) {
  await go(p);
  ok(p + " shows the same signed-in chip with no request",
    (await page.locator("#ddAuthBtn").innerText()).trim() === "Jeff");
}

console.log("\nthe account panel lives on signon.html now");
await go("index.html");
await page.click("#ddAuthBtn");
await page.waitForURL("**/signon.html?next=index.html", { timeout: 4000 });
await page.waitForTimeout(300);
ok("a signed-in click routes to the same page — account controls are there", true);
ok("no modal on arrival", await page.locator("#ddAuthModal").count() === 0);
/* sign-out itself is signon.html's job — test-signin.mjs covers it. Here: the chip
   must repaint when the key clears under it. */
await page.evaluate(() => window.DDAuth.clear());
await page.waitForTimeout(200);
ok("clearing the session flips the chip back", (await page.locator("#ddAuthBtn").innerText()).trim() === "Sign in");

console.log("\nexpiry — the nav must not show a dead session as live");
await page.evaluate(t => localStorage.setItem("dd-bozo-sess", t), DEAD);
await go("index.html");
ok("an expired token reads as signed out", (await page.locator("#ddAuthBtn").innerText()).trim() === "Sign in");
ok("and is thrown away rather than left to rot",
  (await page.evaluate(() => localStorage.getItem("dd-bozo-sess"))) === null);
await page.evaluate(() => localStorage.setItem("dd-bozo-sess", "not-a-token"));
await go("index.html");
ok("garbage reads as signed out too", (await page.locator("#ddAuthBtn").innerText()).trim() === "Sign in");
ok("and is cleared", (await page.evaluate(() => localStorage.getItem("dd-bozo-sess"))) === null);

console.log("\nConnect Your Dawg lives on signon.html");
await page.evaluate(t => localStorage.setItem("dd-bozo-sess", t), GOOD);
await go("connect.html");
await page.waitForURL("**/signon.html#connect", { timeout: 4000 });
ok("redirect lands signed in on signon.html", await page.locator("#sMe").isVisible());
ok("the Connect sheet is selected", await page.locator("#pConnect").isVisible());
ok("the greeting comes from the shared token", /Jeff/.test(await page.locator("#meName").innerText()));

console.log("\nlayout, measured — 18 pages would be a long way to find an overflow");
const PAGES = ["index.html", "bozo.html", "dfs.html", "guillotine.html", "dashboard.html", "stats.html", "connect.html"];
for (const p of PAGES) {
  for (const signedIn of [false, true]) {
    await page.evaluate(([t, s]) => s ? localStorage.setItem("dd-bozo-sess", t) : localStorage.removeItem("dd-bozo-sess"), [GOOD, signedIn]);
    for (const [w, h, label] of [[1200, 900, "desktop"], [390, 844, "phone"], [360, 780, "small"]]) {
      await page.setViewportSize({ width: w, height: h });
      await go(p);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
        await page.waitForTimeout(90);
        const bad = await page.evaluate(() => {
          const W = document.documentElement.clientWidth, out = [];
          const nav = document.querySelector(".sitenav");
          for (const n of nav.querySelectorAll(".brand, .navauth, .links, .links > *, .authbtn")) {
            const r = n.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.right > W + 1.5) out.push((n.id || n.className || n.tagName) + " +" + (r.right - W).toFixed(1));
            if (r.left < -1.5) out.push((n.id || n.className || n.tagName) + " left " + r.left.toFixed(1));
          }
          return out;
        });
        ok(`${p} ${label} ${theme} ${signedIn ? "in " : "out"}: nav fits`, bad.length === 0, bad.slice(0, 3).join(", "));
      }
    }
  }
}

console.log("\nthe compact draft-league hub carries the whole auth module");
await page.evaluate(() => localStorage.removeItem("dd-bozo-sess"));
await page.setViewportSize({width:390,height:844});
await go("draft-leagues.html");
ok("draft hub: exactly one auth chip lands in the compact header",
  await page.locator(".top #ddAuthBtn").count() === 1 && await page.locator("#ddAuthBtn").count() === 1);
await page.click("#ddAuthBtn");
await page.waitForURL("**/signon.html?next=draft-leagues.html", { timeout: 4000 });
ok("draft hub: the chip routes to signon with ?next=draft-leagues.html", true);
for (const width of [390,360]){
  await page.evaluate(t=>localStorage.setItem("dd-bozo-sess",t),GOOD);
  await page.setViewportSize({width,height:844});
  await go("draft-leagues.html");
  const hub=await page.evaluate(()=>({
    chip:document.getElementById("ddAuthBtn").textContent.trim(),
    one:document.querySelectorAll("#ddAuthBtn").length,
    fits:document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,
    topRight:document.querySelector(".top").getBoundingClientRect().right,
    docWidth:document.documentElement.clientWidth,
  }));
  ok(`draft hub ${width}px: signed-in state renders from the shared token`,hub.chip==="Jeff"&&hub.one===1,hub.chip);
  ok(`draft hub ${width}px: compact header and page do not overflow`,hub.fits&&hub.topRight<=hub.docWidth+1,`${hub.topRight} vs ${hub.docWidth}`);
}

console.log("\nthe chip is legible on the brown light-theme bar");
await page.setViewportSize({ width: 1200, height: 900 });
await page.evaluate(t => localStorage.setItem("dd-bozo-sess", t), GOOD);
await go("index.html");
for (const theme of ["light", "dark"]) {
  await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(120);
  const c = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById("ddAuthBtn"));
    const parse = v => (v.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const bg = parse(getComputedStyle(document.querySelector(".sitenav")).backgroundColor);
    const fg = parse(s.color);
    if (bg.length < 3 || fg.length < 3) return null;
    const a = lum(fg), b2 = lum(bg);
    return (Math.max(a, b2) + .05) / (Math.min(a, b2) + .05);
  });
  ok(`${theme}: chip text clears 4.5:1 against the bar`, c === null || c >= 4.5, c === null ? "" : c.toFixed(2));
}

await page.screenshot({ path: path.join(SHOTS, "shot-navauth-dark.png"), clip: { x: 0, y: 0, width: 1200, height: 120 } });
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(SHOTS, "shot-navauth-light.png"), clip: { x: 0, y: 0, width: 1200, height: 120 } });
await page.setViewportSize({ width: 390, height: 844 });
await go("index.html");
await page.screenshot({ path: path.join(SHOTS, "shot-navauth-phone.png"), clip: { x: 0, y: 0, width: 390, height: 110 } });

ok("still no script errors after the whole run", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
