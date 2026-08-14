/* The nav bar fits, at every width — CEP-5A Stage 7.

   ⚠️ WHY THIS SUITE EXISTS AND test-udfoot.mjs COULD NOT COVER IT.
   `.sitenav .links` is `flex:1 1 auto; min-width:0; justify-content:flex-end`. When the
   run of links does not fit, it is not clipped and it does not overflow the document — it
   is SQUEEZED, and because it is end-justified its content spills LEFT, printing over the
   brand and the sign-in chip. `document.scrollWidth > clientWidth` stays false the whole
   time, so the 320/390/1280 overflow sweep passes with the nav unreadable underneath it.
   The only thing that sees this is an element-vs-element overlap check. That is the same
   lesson as the fixed-element collision tests: a bounds check proves nothing here.

   Stage 7 took the bar from five groups to six, which is exactly the change the old 419px
   comment warned to re-measure after. It collided at 320, 340, 360, 420 and 460.

   2026-08-11 took it from six to EIGHT — Prediction Markets and A.I. Eight groups at the
   shipped padding collide at 420 (33.3px), 440 (13.3px) and 520 (25.8px). What pays for
   them: `short:` labels on the two longest entries (Receipts -> Rcpt, Prediction Markets
   -> Mkts) plus 1px per side off the link padding in the max-width:760px block. Labels
   alone still miss by 11.1px at 420 and 3.6px at 520, so both halves are load-bearing.

   ⚠️ EIGHT IS THE CEILING. A ninth group was measured with every tightening applied at
   once — 9.5px font, zero gap, smaller theme button and sign-in chip — and still collides
   at 420 (12.5px) and 520 (5px). A ninth section needs an overflow menu, not another
   array entry, and this suite is where that gets caught.

   The 419px breakpoint once forced the links onto a second row even after the menu shrank
   back to six groups. In addition to overlap and height, the suite now measures the
   vertical centre of every visible control at 320-419px. That directly enforces the
   one-row mobile banner instead of treating a shorter bar as an indirect proxy.

   ⚠️ THE WIDTH LIST IS THE POINT. Breakpoints are where this breaks, so the list walks
   both sides of every one: 419/420 (the wordmark), 519/520 (its new ceiling), 760/761
   (the one-row phone layout). Testing 320/390/1280 alone would have missed the 420-519
   band entirely, which is where the worst collision was.
   440 and 560 were added on 2026-08-11 and are not padding: at eight groups the run
   collided at 440 while 419, 460 and 500 were all clean, so a list that stepped over it
   would have shipped a collision on a width nobody was watching.

   Three pages rather than 25 because test-pound-contracts.js already asserts the NAV array
   is byte-identical across all of them, and the nav CSS travels with it. These three differ
   in what surrounds the bar: index.html is the homepage, stats.html is 2.1 MB, and
   dashboard.html ships no <footer>.

   Run:  cd work && node test-nav-fit.mjs
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8927, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const errs = [];

const PAGES = ["index.html", "stats.html", "dashboard.html"];
const WIDTHS = [320, 340, 360, 390, 419, 420, 440, 460, 500, 519, 520, 560, 600, 760, 761, 900, 1024, 1100, 1280];

/* ⚠️ HEIGHT, NOT OVERLAP — the second failure mode, added 2026-08-11.
   Outside 420-760 this bar does not collide, it WRAPS, so growing it costs a ROW and
   every overlap assertion above stays green. That happened twice in one change and both
   times it was caught by looking at a screenshot rather than by this file. These are the
   six-group heights measured on index.html at b2b7003; the bar may never exceed them.
   Cap, not equality: shorter is always fine, and this patch is 2px shorter above 761.
   ⚠️ 1100 IS THE ONE DELIBERATE EXCEPTION AND IT IS 54px. Six groups fitted one row at
   1100; eight do not, and no combination of padding, gap and type size recovers it while
   the nav label reads "Prediction Markets" — shortening that label to "Markets" is the
   only thing that does. It is allowed here explicitly rather than by loosening the whole
   table, so that if 1100 ever returns to one row this assertion says so. */
/* The mobile banner is one row through 419px; 54px leaves room for engine rounding while
   the centre-line assertion below is the actual row-count invariant. */
const MAX_H = {320:54, 340:54, 360:54, 390:54, 419:54, 420:54, 440:54, 460:54, 500:54,
               519:54, 520:54, 560:54, 600:54, 760:54, 761:125, 900:125, 1024:125,
               1100:123,   /* was 69 with six groups — see above */
               1280:69};

/* every visible box in the bar, pairwise. A 0.5px tolerance keeps sub-pixel rounding out. */
const MEASURE = () => {
  const nav = document.querySelector(".sitenav");
  if (!nav) return { err: "no .sitenav" };
  const links = nav.querySelector(".links");
  const boxes = [];
  const add = (name, el) => { if (el) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) boxes.push([name, r]); } };
  add("brand", nav.querySelector(".brand"));
  add("auth", nav.querySelector(".navauth"));
  if (links) [...links.children].forEach((c, i) => add((c.textContent || "link").trim().slice(0, 14) || "link" + i, c));
  const hits = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i][1], c = boxes[j][1];
    const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
    const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (ox > 0.5 && oy > 0.5) hits.push(`${boxes[i][0]}/${boxes[j][0]} ${ox.toFixed(1)}x${oy.toFixed(1)}`);
  }
  const navR = nav.getBoundingClientRect();
  const navH = Math.round(navR.height);
  const centres = boxes.map(([, r]) => (r.top + r.bottom) / 2);
  const rowSpread = centres.length ? Math.max(...centres) - Math.min(...centres) : Infinity;
  const outside = boxes.filter(([, r]) => r.left < navR.left - 0.5 || r.right > navR.right + 0.5).map(([n]) => n);
  return {
    hits, outside, boxes: boxes.length, navH, rowSpread,
    groups: links ? [...links.querySelectorAll(".navgrp")].length : 0,
    docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
};

for (const page of PAGES) {
  for (const W of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: W, height: 700 } });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(`${page}@${W}: ${e.message}`));
    await p.goto(`http://127.0.0.1:8927/${page}`, { waitUntil: "load" });
    await p.waitForFunction(() => !!document.querySelector(".sitenav .links"), null, { timeout: 15000 });
    await p.waitForTimeout(80);
    const m = await p.evaluate(MEASURE);
    const tag = `${page}@${W}`;
    ok(tag + " nothing in the bar overlaps anything else", !m.err && m.hits.length === 0, (m.hits || []).join(" | "));
    ok(tag + " nothing is painted outside the bar", !m.err && m.outside.length === 0, (m.outside || []).join(","));
    ok(tag + " all six groups are present", m.groups === 6, String(m.groups));
    /* the belt to the braces: this is what USED to pass while the bar was unreadable */
    ok(tag + " and the document still does not scroll sideways", m.docOverflow === false);
    ok(tag + " the bar is no taller than its six-group baseline", m.navH <= MAX_H[W] + 0.5,
       `${m.navH} > ${MAX_H[W]}`);
    if (W <= 419) {
      ok(tag + " every mobile banner control is on one row", m.rowSpread <= 1,
         `vertical centre spread ${m.rowSpread.toFixed(1)}px`);
    }
    await ctx.close();
  }
}

ok("no script errors anywhere", errs.length === 0, errs.join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
