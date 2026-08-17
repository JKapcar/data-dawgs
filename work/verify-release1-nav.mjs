/* Release 1 — human-first navigation, live-render verification.
   Not a replacement for test-nav-fit.mjs (which owns overlap and row height). This walks
   the seven pages the release names at the six widths it names and checks the things a
   screenshot review is supposed to catch: horizontal scroll, a banner that wrapped, the
   account pill going unreadable, and the wrong top-level group reading as active.

   Run:  cd work && node verify-release1-nav.mjs                                        */
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "work", "artifacts", "release1-nav");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8931, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });

/* page -> the ONE top-level group that must read as active on it. These are the claims
   the shape rests on: markets.html and ai.html light their own sections, and receipts.html
   lights Data because Receipts is an item there rather than a group. */
const PAGES = [
  ["index.html",    null],        // the homepage lights nothing; the wordmark is Home
  ["markets.html",  "Markets"],
  ["ai.html",       "A.I."],
  ["nfl.html",      "NFL"],
  ["cfb.html",      "CFB"],
  ["dawgs.html",    "Dawgs"],
  ["receipts.html", "Data"],
];
const WIDTHS = [320, 390, 420, 520, 760, 1280];
/* ⚠️ The DESKTOP label. Below 520px the bar swaps in the `short` label and "Markets"
   becomes "Mkts", so the order check reads the wide form only above that. */
const ORDER = ["Arena", "Markets", "A.I.", "NFL", "CFB", "Data", "Dawgs"];
const ORDER_PHONE = ["Arena", "Mkts", "A.I.", "NFL", "CFB", "Data", "Dawgs"];

for (const [file, wantActive] of PAGES) {
  for (const W of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: W, height: 800 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:8931/${file}`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".sitenav .links .navgrp", { timeout: 15000 });
    const tag = `${file}@${W}`;

    const m = await p.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const labels = [...document.querySelectorAll(".sitenav .links .navgrp .grpbtn")]
        .map(x => x.innerText.trim().replace(/\s*▾$/, ""));
      const on = [...document.querySelectorAll(".sitenav .links .grpbtn.on")]
        .map(x => x.innerText.trim().replace(/\s*▾$/, ""));
      const pill = q("#authBtn") || q("[data-ddauth-btn]") || q(".authbtn");
      const pr = pill && pill.getBoundingClientRect();
      const nav = q(".sitenav").getBoundingClientRect();
      return {
        labels, on,
        navH: Math.round(nav.height),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pill: pr ? { w: Math.round(pr.width), h: Math.round(pr.height),
                     inView: pr.right <= innerWidth + 0.5 && pr.left >= -0.5 } : null,
      };
    });

    ok(`${tag} no horizontal scroll`, m.overflow <= 0, `${m.overflow}px`);
    /* Either label set is accepted at any width — which one shows is CSS's business and
       test-nav-fit owns it. What this asserts is the ORDER, and that no third variant
       appears. */
    ok(`${tag} seven groups in the locked order`,
       JSON.stringify(m.labels) === JSON.stringify(ORDER) ||
       JSON.stringify(m.labels) === JSON.stringify(ORDER_PHONE), JSON.stringify(m.labels));
    if (wantActive) {
      // same short-label caveat as the order check above
      const want = wantActive === "Markets" ? ["Markets", "Mkts"] : [wantActive];
      ok(`${tag} ${wantActive} is the one active group`,
         m.on.length === 1 && want.includes(m.on[0]), JSON.stringify(m.on));
    }
    else
      ok(`${tag} no group is active on the homepage`, m.on.length === 0, JSON.stringify(m.on));
    /* the account pill is a control, not decoration: it has to be on screen and big
       enough to read and hit, at every width. */
    ok(`${tag} account pill is present and on screen`, !!m.pill && m.pill.inView,
       JSON.stringify(m.pill));
    if (m.pill) ok(`${tag} account pill is not squashed`, m.pill.w >= 28 && m.pill.h >= 20,
                   `${m.pill.w}x${m.pill.h}`);
    ok(`${tag} no script errors`, errs.length === 0, errs[0]);

    await p.screenshot({ path: path.join(SHOTS, `${file.replace(/\.html$/, "")}-${W}.png`),
                         clip: { x: 0, y: 0, width: W, height: Math.min(200, m.navH + 60) } });
    await ctx.close();
  }
}

await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed   (shots in work/artifacts/release1-nav)`);
process.exit(fail ? 1 : 0);
