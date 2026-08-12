/* CEP-7 join links, page side: signon.html?league=<code> and bozo.html's manager block.
   Real pages in a real browser; only the Worker is faked.

   Run:  cd work && node test-league-join-ui.mjs
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (x ? " — " + x : "")); } };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8921, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });

const CODE = "AbCdEfGhIjKlMnOpQrStUv";          // 22 url-safe chars
// DDAuth stores the RAW session string under "dd-bozo-sess" and decodes its first
// dot-segment as base64url JSON {n, e}. Build a real-shaped one or me() returns null
// and every "already signed in" assertion silently tests the signed-out path instead.
const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SESSION = b64url(JSON.stringify({ n: "Sam", e: Date.now() + 864e5, p: 0 })) + ".sig";
let state;
const resetState = () => { state = { size: 4, cap: 20, full: false, joinFails: null, joined: false, preview: 200 }; };

async function newPage({ signedIn = false, url } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));

  await p.route("https://toto.jkapcar4.workers.dev/**", route => {
    const u = new URL(route.request().url());
    const method = route.request().method();
    const j = (o, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
    if (u.pathname === "/auth/roster") return j({ players: [{ name: "Sam", claimed: true }] });
    if (u.pathname === "/auth/lookup") return j({ ok: true, known: true });
    if (u.pathname === "/league/join" && method === "GET") {
      if (state.preview !== 200) return j({ error: "That join link is no longer good — ask the manager for a new one." }, state.preview);
      return j({ league: "main", name: "Data Dawgs", manager: "Kap", size: state.size, cap: state.cap, full: state.full, open: true });
    }
    if (u.pathname === "/league/join" && method === "POST") {
      if (state.joinFails) return j({ error: state.joinFails }, 409);
      state.joined = true;
      return j({ ok: true, league: "main", name: "Data Dawgs", size: state.size + 1, cap: state.cap });
    }
    if (u.pathname === "/auth/login") return j({ session: SESSION, name: "Sam", email: "sam@example.com" });
    if (u.pathname === "/auth/signup") return j({ session: SESSION, name: "Sam", email: "sam@example.com" });
    return j({ error: "unexpected " + u.pathname }, 500);
  });

  if (signedIn) {
    await p.addInitScript(sess => { localStorage.setItem("dd-bozo-sess", sess); }, SESSION);
  }
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(700);
  return { p, ctx, errs };
}

const txt = (p, sel) => p.$eval(sel, e => (e.textContent || "").replace(/\s+/g, " ").trim()).catch(() => null);
const shown = (p, sel) => p.$eval(sel, e => !e.hidden && getComputedStyle(e).display !== "none").catch(() => false);

/* 1 — signed out, valid code */
{
  resetState();
  const { p, ctx, errs } = await newPage({ url: `http://127.0.0.1:8921/signon.html?league=${CODE}` });
  ok("signed out: the join card appears", await shown(p, "#sLeague"));
  ok("signed out: it names the league", (await txt(p, "#lgName")) === "Data Dawgs");
  ok("signed out: it explains you'll join after signing in", /join automatically/i.test(await txt(p, "#lgSub") || ""));
  ok("signed out: seats are shown", /4 of 20 seats/.test(await txt(p, "#lgSub") || ""));
  ok("signed out: no Join button yet", !(await shown(p, "#lgGo")));
  ok("signed out: the email-first card is still offered", await shown(p, "#sIn") && await shown(p, "#stepEmail"));
  ok("signed out: no page errors", errs.length === 0, errs[0]);
  await ctx.close();
}

/* 2 — sign in with a code pending auto-joins */
{
  resetState();
  const { p, ctx, errs } = await newPage({ url: `http://127.0.0.1:8921/signon.html?league=${CODE}` });
  await p.fill("#sEmail", "sam@example.com"); await p.click("#lookupGo");
  await p.fill("#sPw", "password123");
  await p.click("#sGo");
  await p.waitForTimeout(900);
  ok("sign-in triggers the join", state.joined === true);
  ok("the card reports membership", /You're in Data Dawgs/.test(await txt(p, "#lgSub") || ""), await txt(p, "#lgSub"));
  ok("the code is stripped from the URL once spent", !p.url().includes("league="), p.url());
  ok("no page errors through the join", errs.length === 0, errs[0]);
  await ctx.close();
}

/* 3 — already signed in: redeem on load, no click needed */
{
  resetState();
  const { p, ctx, errs } = await newPage({ signedIn: true, url: `http://127.0.0.1:8921/signon.html?league=${CODE}` });
  ok("signed in: joins without a click", state.joined === true);
  ok("signed in: URL is cleaned", !p.url().includes("league="), p.url());
  ok("signed in: no errors", errs.length === 0, errs[0]);
  await ctx.close();
}

/* 4 — a dead code says so and does not pretend */
{
  resetState(); state.preview = 404;
  const { p, ctx, errs } = await newPage({ url: `http://127.0.0.1:8921/signon.html?league=${CODE}` });
  ok("dead code: card explains the link is no good", /no longer good/i.test(await txt(p, "#lgSub") || ""), await txt(p, "#lgSub"));
  ok("dead code: no Join button", !(await shown(p, "#lgGo")));
  ok("dead code: sign-in still works normally", await shown(p, "#sIn"));
  ok("dead code: no errors", errs.length === 0, errs[0]);
  await ctx.close();
}

/* 5 — a full league is honest before anyone signs up for nothing */
{
  resetState(); state.size = 20; state.full = true;
  const { p, ctx } = await newPage({ url: `http://127.0.0.1:8921/signon.html?league=${CODE}` });
  ok("full league: says full and names the cap", /full \(20 members\)/.test(await txt(p, "#lgSub") || ""), await txt(p, "#lgSub"));
  ok("full league: tells you who can fix it", /Kap/.test(await txt(p, "#lgSub") || ""));
  await ctx.close();
}

/* 6 — a failed join keeps the code so the same link works later */
{
  resetState(); state.joinFails = "This week's ticket is already placed — you can join once next week opens.";
  const { p, ctx } = await newPage({ signedIn: true, url: `http://127.0.0.1:8921/signon.html?league=${CODE}` });
  ok("failed join: shows the Worker's reason", /already placed/.test(await txt(p, "#lgMsg") || ""), await txt(p, "#lgMsg"));
  ok("failed join: the code SURVIVES in the URL", p.url().includes("league=" + CODE), p.url());
  await ctx.close();
}

/* 7 — ?next= must not bounce the user before the join runs */
{
  resetState();
  const { p, ctx } = await newPage({ signedIn: true, url: `http://127.0.0.1:8921/signon.html?league=${CODE}&next=bozo.html` });
  ok("with ?next=: the join still happened", state.joined === true);
  ok("with ?next=: it did leave for the target afterwards", p.url().endsWith("/bozo.html"), p.url());
  await ctx.close();
}

/* 8 — no code at all: the page is exactly as it was */
{
  resetState();
  const { p, ctx, errs } = await newPage({ url: "http://127.0.0.1:8921/signon.html" });
  ok("no code: join card stays hidden", !(await shown(p, "#sLeague")));
  ok("no code: email-first sign-in and help render", await shown(p, "#sIn") && await shown(p, "#stepEmail") && await shown(p, "#sHelp"));
  ok("no code: no errors", errs.length === 0, errs[0]);
  await ctx.close();
}

/* 9 — a malformed code is ignored rather than sent to the Worker */
{
  resetState();
  let previewCalls = 0;
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.route("https://toto.jkapcar4.workers.dev/**", route => {
    if (new URL(route.request().url()).pathname === "/league/join") previewCalls++;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ players: [] }) });
  });
  await p.goto("http://127.0.0.1:8921/signon.html?league=not-a-real-code", { waitUntil: "load" });
  await p.waitForTimeout(600);
  ok("malformed code: never reaches the Worker", previewCalls === 0, String(previewCalls));
  ok("malformed code: join card stays hidden", !(await shown(p, "#sLeague")));
  await ctx.close();
}

/* 10 — bozo.html manager block exists and is wired */
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.route("https://toto.jkapcar4.workers.dev/**", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ players: [], leagues: [] }) }));
  await p.goto("http://127.0.0.1:8921/bozo.html", { waitUntil: "load" });
  await p.waitForTimeout(800);
  const ids = await p.evaluate(() => ["jlGet", "jlRot", "jlCap", "jlCapGo", "jlOff", "jlOut", "jlErr"].map(i => !!document.getElementById(i)));
  ok("bozo: every join-link control is present", ids.every(Boolean), JSON.stringify(ids));
  const wired = await p.evaluate(() => !!document.getElementById("jlGet").onclick && !!document.getElementById("jlRot").onclick);
  ok("bozo: the controls are wired", wired);
  ok("bozo: no page errors", errs.length === 0, errs[0]);
  await ctx.close();
}

await b.close(); server.close();
console.log("\nleague-join-ui: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
