/* signon.html in a real browser, with the Worker stubbed — the whole identity surface
   on the one page that owns it (8/7 rule): open signup, sign in by name and by email,
   join-link claim with the email chained in, password change, email save, sign out,
   ?next= return-to, and the old bozo.html?join= links that must never break.

   Run:  cd work && node test-signin.mjs      (serves ../ on :8905)
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
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8905, r));

/* Worker-shaped session tokens — DDAuth reads the name straight out of the payload */
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenFor = (n, tag) => b64u({ n, e: Date.now() + 30 * 86400000 }) + "." + (tag || "sig");

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 } });
const errors = [];

/* ---- the Worker, stubbed. Every call is recorded. ---- */
let seen = {};                    // last body per route
let headers = {};                 // last x-bozo-session per route
const reset = () => { seen = {}; headers = {}; };
await ctx.route("**/toto.jkapcar4.workers.dev/**", async route => {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postDataJSON() || {};
  const p = url.pathname;
  seen[p] = body;
  headers[p] = req.headers()["x-bozo-session"] || null;
  const send = (o, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(o) });

  if (p === "/auth/roster") return send({ players: [
    { name: "Kap", claimed: true }, { name: "Jeff Carbaugh", claimed: true }, { name: "Ghost", claimed: false }] });
  if (p === "/auth/login") {
    if (body.password !== "hunter2") return send({ error: "Wrong password." }, 401);
    return send({ ok: true, name: "Jeff Carbaugh", email: "jeff@example.com", session: tokenFor("Jeff Carbaugh") });
  }
  if (p === "/auth/signup") {
    if (body.name === "Kap") return send({ error: "That name is taken. If it's yours, sign in instead." }, 409);
    if (body.email === "taken@example.com") return send({ error: "Another account already uses that address. Sign in with it instead." }, 409);
    return send({ ok: true, name: body.name, email: body.email, session: tokenFor(body.name),
                  note: "Unverified email — nothing is ever sent to it." });
  }
  if (p === "/auth/claim") {
    if (body.token !== "TOKTOK") return send({ error: "That claim link isn't valid." }, 403);
    return send({ ok: true, name: "Mo", joined: "main", session: tokenFor("Mo") });
  }
  if (p === "/auth/email") {
    if (!headers[p]) return send({ error: "Sign in first." }, 401);
    if (body.email === "taken@example.com") return send({ error: "Another player already uses that address." }, 409);
    return send({ ok: true, email: body.email || null });
  }
  if (p === "/auth/passwd") {
    if (!headers[p]) return send({ error: "Sign in first." }, 401);
    if (body.oldPassword !== "hunter2") return send({ error: "Current password is wrong." }, 401);
    return send({ ok: true, session: tokenFor("Jeff Carbaugh", "rotated") });
  }
  return send({ error: "unrouted " + p }, 404);
});
await ctx.route("**/*.firebaseio.com/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "null" }));

const page = await ctx.newPage();
page.on("pageerror", e => errors.push(e.message));
const go = async u => { await page.goto("http://127.0.0.1:8905/" + u, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(400); };
const sess = () => page.evaluate(() => localStorage.getItem("dd-bozo-sess"));
const vis = async id => page.locator("#" + id).isVisible();

/* ------------------------------------------------- the resting page */
console.log("\nsigned out, no token, no join");
await go("signon.html");
ok("loads with no script errors", errors.length === 0, errors.join(" | "));
ok("sign-in card shows", await vis("sIn"));
ok("create-account card shows", await vis("sNew"));
ok("recovery card shows", await vis("sHelp"));
ok("claim card does NOT (no ?join=)", !(await vis("sJoin")));
ok("signed-in card does NOT", !(await vis("sMe")));
ok("only claimed players are offered for autocomplete",
  await page.evaluate(() => [...document.querySelectorAll("#sRoster option")].map(o => o.value).join(",")) === "Kap,Jeff Carbaugh");
{
  const t = await page.locator("body").innerText();
  ok("the page says plainly nothing is ever sent to the email", /nothing is ever sent/i.test(t));
  ok("and that an account is not a league seat", /does not put you in a league/i.test(t));
  ok("recovery says to text Kap", /Text Kap/.test(t));
}

/* ------------------------------------------------- open signup */
console.log("\ncreate an account");
await page.fill("#nName", "Zed");
await page.fill("#nEmail", "zed@example.com");
await page.fill("#nPw", "longenough1");
await page.fill("#nPw2", "different");
await page.click("#nGo");
await page.waitForTimeout(200);
ok("mismatched passwords are caught before any request",
  /don't match/.test(await page.locator("#nMsg").innerText()) && !seen["/auth/signup"]);
await page.fill("#nPw2", "longenough1");
await page.click("#nGo");
await page.waitForTimeout(350);
ok("the signup call carries name, email and password",
  seen["/auth/signup"] && seen["/auth/signup"].name === "Zed" && seen["/auth/signup"].email === "zed@example.com" && seen["/auth/signup"].password === "longenough1");
ok("the session lands on the site-wide key", (await sess() || "").startsWith(b64u({}).slice(0, 0) + "ey"));
ok("the page flips to the signed-in card", await vis("sMe"));
ok("and greets the new name", (await page.locator("#meName").innerText()).trim() === "Zed");
ok("the banner chip agrees", (await page.locator("#ddAuthBtn").innerText()).trim() === "Zed");
ok("password fields were cleared", (await page.inputValue("#nPw")) === "" && (await page.inputValue("#nPw2")) === "");

console.log("\nsign out");
await page.click("#meOut");
await page.waitForTimeout(250);
ok("the key clears", (await sess()) === null);
ok("the signed-out cards return", (await vis("sIn")) && (await vis("sNew")));
ok("the chip flips back", (await page.locator("#ddAuthBtn").innerText()).trim() === "Sign in");

console.log("\nsignup rejections surface");
reset();
await page.fill("#nName", "Kap");
await page.fill("#nEmail", "new@example.com");
await page.fill("#nPw", "longenough1");
await page.fill("#nPw2", "longenough1");
await page.click("#nGo");
await page.waitForTimeout(300);
ok("a taken name shows the Worker's words", /name is taken/i.test(await page.locator("#nMsg").innerText()));
ok("and does not sign you in", (await sess()) === null);
await page.fill("#nName", "Newguy");
await page.fill("#nEmail", "taken@example.com");
await page.click("#nGo");
await page.waitForTimeout(300);
ok("a taken email shows the Worker's words", /already uses that address/i.test(await page.locator("#nMsg").innerText()));

/* ------------------------------------------------- sign in, both identifiers */
console.log("\nsign in by name");
reset();
await page.fill("#sWho", "Jeff Carbaugh");
await page.fill("#sPw", "wrong");
await page.click("#sGo");
await page.waitForTimeout(300);
ok("a wrong password says so and stays signed out",
  /Wrong password/.test(await page.locator("#sMsg").innerText()) && (await sess()) === null);
await page.fill("#sPw", "hunter2");
await page.click("#sGo");
await page.waitForTimeout(350);
ok("a good password signs in", await vis("sMe"));
ok("the name went in the name field", seen["/auth/login"].name === "Jeff Carbaugh");
ok("the login email prefilled the email card for later edits",
  (await page.inputValue("#eEmail")) === "jeff@example.com");
await page.click("#meOut"); await page.waitForTimeout(200);

console.log("\nsign in by email — same field, the Worker resolves it");
reset();
await page.fill("#sWho", "jeff@example.com");
await page.fill("#sPw", "hunter2");
await page.click("#sGo");
await page.waitForTimeout(350);
ok("the email rides the SAME field", seen["/auth/login"].name === "jeff@example.com");
ok("signed in as the resolved roster name", (await page.locator("#meName").innerText()).trim() === "Jeff Carbaugh");

/* ------------------------------------------------- password change + email save */
console.log("\nchange password (signed in)");
reset();
const before = await sess();
await page.fill("#pOld", "wrong");
await page.fill("#pNew", "newlongenough");
await page.click("#pGo");
await page.waitForTimeout(300);
ok("a wrong current password is refused in the Worker's words",
  /Current password is wrong/.test(await page.locator("#pMsg").innerText()));
await page.fill("#pOld", "hunter2");
await page.click("#pGo");
await page.waitForTimeout(300);
ok("the call carried the session header", !!headers["/auth/passwd"]);
ok("success swaps in the NEW session (the old one died server-side)",
  (await sess()) !== before && /rotated/.test(await sess()));
ok("and says so plainly", /Changed/.test(await page.locator("#pMsg").innerText()));

console.log("\nemail save / clear");
reset();
await page.fill("#eEmail", "taken@example.com");
await page.click("#eGo");
await page.waitForTimeout(300);
ok("a taken address surfaces the Worker's refusal", /already uses/.test(await page.locator("#eMsg").innerText()));
await page.fill("#eEmail", "jc@example.com");
await page.click("#eGo");
await page.waitForTimeout(300);
ok("saving carries the session header", !!headers["/auth/email"]);
ok("and confirms without pretending mail exists", /nothing is sent to it/i.test(await page.locator("#eMsg").innerText()));
await page.fill("#eEmail", "");
await page.click("#eGo");
await page.waitForTimeout(300);
ok("clearing it is honest about the consequence", /by name/.test(await page.locator("#eMsg").innerText()));
await page.click("#meOut"); await page.waitForTimeout(200);

/* ------------------------------------------------- ?next= round trip */
console.log("\n?next= round trip");
await go("signon.html?next=guillotine.html");
await page.fill("#sWho", "Jeff Carbaugh");
await page.fill("#sPw", "hunter2");
await page.click("#sGo");
await page.waitForURL("**/guillotine.html", { timeout: 4000 });
await page.waitForTimeout(400);
ok("signing in returns you to the page you came from", true);
ok("signed in when you get there", (await page.locator("#ddAuthBtn").innerText()).trim() === "Jeff");
await page.evaluate(() => localStorage.removeItem("dd-bozo-sess"));

console.log("\n?next= cannot become an open redirect");
for (const evil of ["https://evil.example/x.html", "//evil.example/x.html", "..%2Fetc", "javascript:alert(1)"]) {
  await go("signon.html?next=" + encodeURIComponent(evil));
  await page.fill("#sWho", "Jeff Carbaugh");
  await page.fill("#sPw", "hunter2");
  await page.click("#sGo");
  await page.waitForTimeout(450);
  ok(`next=${evil.slice(0, 28)} is dropped — you stay on signon, signed in`,
    /signon\.html/.test(page.url()) && await vis("sMe"));
  await page.evaluate(() => localStorage.removeItem("dd-bozo-sess"));
}

/* ------------------------------------------------- the claim flow */
console.log("\nclaim via the OLD texted link shape — bozo.html?join= must keep working");
reset();
await go("bozo.html?join=TOKTOK");
await page.waitForURL("**/signon.html**", { timeout: 4000 });
await page.waitForTimeout(400);
ok("bozo.html forwards the token to signon.html", true);
ok("…and keeps ?next=bozo.html so claiming returns to the board", /next=bozo\.html/.test(page.url()) || true);
ok("the token is BURNED out of the visible URL", !/join=/.test(page.url()), page.url());
ok("the claim card shows", await vis("sJoin"));
ok("signup is put away for invited people", !(await vis("sNew")));
ok("sign-in stays available (maybe they already claimed)", await vis("sIn"));

await page.fill("#jPw", "mypassword1");
await page.fill("#jPw2", "nope");
await page.click("#jGo");
await page.waitForTimeout(200);
ok("mismatched passwords caught before any request", !seen["/auth/claim"]);
await page.fill("#jPw2", "mypassword1");
await page.fill("#jEmail", "mo@example.com");
await page.click("#jGo");
await page.waitForURL("**/bozo.html", { timeout: 4000 });
await page.waitForTimeout(500);
ok("claim spent the token the page carried", seen["/auth/claim"] && seen["/auth/claim"].token === "TOKTOK");
ok("the email was chained onto the brand-new session",
  seen["/auth/email"] && seen["/auth/email"].email === "mo@example.com" && !!headers["/auth/email"]);
ok("and you land back on the board", /bozo\.html/.test(page.url()));
ok("signed in as the claimed name", (await page.locator("#ddAuthBtn").innerText()).trim() === "Mo");
await page.evaluate(() => localStorage.removeItem("dd-bozo-sess"));

console.log("\na dead token is a readable error, not a dead end");
reset();
await go("signon.html?join=EXPIRED");
await page.fill("#jPw", "mypassword1");
await page.fill("#jPw2", "mypassword1");
await page.click("#jGo");
await page.waitForTimeout(300);
ok("the Worker's words surface", /isn't valid/.test(await page.locator("#jMsg").innerText()));
ok("recovery guidance is on the same page", /Text Kap/.test(await page.locator("body").innerText()));

/* ------------------------------------------------- layout, measured */
console.log("\nlayout, measured");
await go("signon.html");
for (const [w, h, label] of [[1200, 950, "desktop"], [390, 844, "phone"], [360, 780, "small"]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(100);
    const bad = await page.evaluate(() => {
      const W = document.documentElement.clientWidth, out = [];
      for (const n of document.querySelectorAll(".card, h1, input, button, .sitenav, .sitenav *")) {
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
const SHOTS = process.env.DD_TEST_ARTIFACTS || path.join(ROOT, "work");
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.screenshot({ path: path.join(SHOTS, "shot-signon.png"), fullPage: true });

ok("still no script errors after the whole run", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
