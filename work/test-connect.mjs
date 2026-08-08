/* connect.html in a real browser, with the Worker stubbed.
   The page is the only way anyone gets a personal URL, so its failure modes matter as
   much as the Worker's: a wrong localStorage key, a wrong response field, or a card that
   stays visible when it should be hidden all look fine in a screenshot.

   Run:  cd work && node test-connect.mjs      (serves ../ on :8903)
*/
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const ROOT = path.resolve("..");
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.env.DD_TEST_ARTIFACTS || path.join(ROOT, "work");
fs.mkdirSync(SHOTS, {recursive:true});
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8903, r));

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));

/* ---- stub the Worker ---- */
/* ⚠️ A realistic session token, not a placeholder string. The nav's DDAuth decodes
   the token to learn who is signed in and DISCARDS anything it cannot parse — so a
   stub returning "SESS.TOKEN" would be thrown away the moment it was stored, and the
   page would look broken for a reason that exists nowhere but this file. Shape is
   base64url(JSON{n,e}) "." signature, exactly what the Worker mints. */
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SESSTOK = b64u({ n: "Jeff", e: Date.now() + 30 * 86400000 }) + ".sigsigsig";
let minted = null, revoked = false, savedEmail = null, sessionSeen = null;
await page.route("**/toto.jkapcar4.workers.dev/**", async route => {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postDataJSON() || {};
  sessionSeen = req.headers()["x-bozo-session"] || null;
  const send = (obj, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(obj) });

  if (url.pathname === "/auth/login") {
    if (body.password !== "hunter2") return send({ error: "Wrong password." }, 403);
    return send({ ok: true, name: "Jeff", email: "jeff@example.com", session: SESSTOK });
  }
  if (url.pathname === "/auth/mcp-token") {
    if (!sessionSeen) return send({ error: "Sign in first." }, 401);
    if (body.action === "mint") { minted = "https://toto.jkapcar4.workers.dev/mcp/u_ABC123"; revoked = false; return send({ ok: true, player: "Jeff", token: "u_ABC123", url: minted }); }
    if (body.action === "revoke") { revoked = true; return send({ ok: true, revoked: true }); }
    return send({ error: "action must be mint or revoke" }, 400);
  }
  if (url.pathname === "/auth/email") { savedEmail = body.email; return send({ ok: true, email: body.email }); }
  return send({ error: "unrouted" }, 404);
});

await page.goto("http://127.0.0.1:8903/connect.html", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);

console.log("\nsigned out");
ok("the page loads with no script errors", errors.length === 0, errors.join(" | "));
ok("the signed-out card is visible", await page.locator("#cSignedOut").isVisible());
/* the sign-in FORM moved to signon.html (8/7 rule) — this page only points there */
ok("it points at the sign-on page, carrying ?next= back here",
   await page.locator('#cSignedOut a[href="signon.html?next=connect.html"]').count() === 1);
ok("no password field remains anywhere on this page",
   await page.locator('input[type="password"]').count() === 0);
// ⚠️ the failure a screenshot would not show: hidden cards that still render
ok("the signed-in card is genuinely hidden, not merely styled",
   await page.evaluate(() => { const r = document.getElementById("cSignedIn").getBoundingClientRect(); return r.width === 0 && r.height === 0; }));
ok("the URL box is hidden before anything is minted",
   await page.evaluate(() => { const r = document.getElementById("cUrlBox").getBoundingClientRect(); return r.width === 0 && r.height === 0; }));

console.log("\narriving with a session (signed in on signon.html, sent back here)");
/* ⚠️ the key must match signon/bozo exactly or the pages cannot see each other */
await page.evaluate(t => localStorage.setItem("dd-bozo-sess", t), SESSTOK);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
ok("a stored session reveals the connector card with no probe request",
   await page.locator("#cSignedIn").isVisible());
ok("the signed-out card is put away", !(await page.locator("#cSignedOut").isVisible()));
ok("the page greets the name straight from the token",
   (await page.locator("#cWho2").innerText()).trim() === "Jeff");

console.log("\nminting");
await page.click("#cMint");
await page.waitForTimeout(300);
ok("the mint call carried the session header", sessionSeen === SESSTOK);
ok("the URL box appears", await page.locator("#cUrlBox").isVisible());
ok("the URL is the one the Worker minted",
   (await page.inputValue("#cUrl")) === "https://toto.jkapcar4.workers.dev/mcp/u_ABC123");
ok("the button now offers replacement, not creation",
   /Replace/.test(await page.locator("#cMint").innerText()));
ok("and warns that any earlier URL just died",
   /stopped working/.test(await page.locator("#cMintMsg").innerText()));
ok("the save-it-now warning is on screen",
   /never be shown to you again/.test(await page.locator("#cUrlBox .banner").innerText()));

console.log("\ncopy");
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
await page.click("#cCopy");
await page.waitForTimeout(200);
ok("copy gives feedback", /Copied/.test(await page.locator("#cCopy").innerText()));

console.log("\nemail card is gone — it lives on signon.html now");
ok("no email input on this page", await page.locator("#cEmail").count() === 0);
ok("no email-save call can originate here", savedEmail === null);

console.log("\nrevoke");
page.on("dialog", d => d.accept());
await page.click("#cRevoke");
await page.waitForTimeout(300);
ok("revoke reaches the Worker", revoked === true);
ok("the URL is removed from the screen", !(await page.locator("#cUrlBox").isVisible()));
ok("the input is actually emptied, not just hidden", (await page.inputValue("#cUrl")) === "");
ok("the button returns to offering creation", /Create my URL/.test(await page.locator("#cMint").innerText()));

console.log("\nsign out lives on signon.html — this page just reacts");
ok("no sign-out button here", await page.locator("#cOut").count() === 0);
await page.evaluate(() => { window.DDAuth.clear(); });   // what signon (or the chip) does
await page.waitForTimeout(200);
ok("the session is cleared", (await page.evaluate(() => localStorage.getItem("dd-bozo-sess"))) === null);
ok("the pointer card returns without a reload", await page.locator("#cSignedOut").isVisible());
ok("the connector card is hidden again", !(await page.locator("#cSignedIn").isVisible()));
await page.evaluate(t => localStorage.setItem("dd-bozo-sess", t), SESSTOK);
await page.waitForTimeout(150);

console.log("\nhonesty copy is actually on the page");
{
  const t = await page.locator("body").innerText();
  ok("it says the URL is the password", /URL is the password/i.test(t));
  ok("it says read-only", /only read/i.test(t));
  ok("it refuses to call itself secure", /not the same thing as secure/i.test(t));
  ok("it states no DFS data is served", /No DFS projections or ownership are served/i.test(t));
}

console.log("\nlayout, measured");
for (const [w, h, label] of [[1200, 950, "desktop"], [390, 844, "phone"]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(120);
    const bad = await page.evaluate(() => {
      const W = document.documentElement.clientWidth, out = [];
      for (const n of document.querySelectorAll(".card, .honesty, h1, input, button")) {
        const r = n.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > W + 1.5) out.push((n.id || n.className || n.tagName) + " +" + (r.right - W).toFixed(1));
      }
      return out;
    });
    ok(`${label} ${theme}: nothing overflows`, bad.length === 0, bad.slice(0, 3).join(", "));
  }
}
await page.setViewportSize({ width: 1200, height: 950 });
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.screenshot({ path: path.join(SHOTS, "shot-connect.png") });

ok("still no script errors after the whole run", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
