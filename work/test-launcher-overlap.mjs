/* What Ask Toto's fixed launcher covers, measured element against element.
   Rebuilt 2026-08-10 from work/measure-launcher-overlap.mjs, which was written the same day,
   never committed, and then lost with the chat that held it. It is a committed gate now.

   ⚠️ THE THREE TRAPS THIS FILE EXISTS TO AVOID (all three cost real time on 8/10):
   1. `scrollWidth > clientWidth` NEVER sees a position:fixed element. Nothing here uses it;
      every number below is one rect intersected with another.
   2. A hash-routed sheet must be REQUESTED BY HASH. The first measurement run loaded
      receipts.html with no hash, so the models sheet — the exact surface the complaint named
      — never rendered and the page reported clean. See [[sheets-traps]].
   3. Measuring at ONE scroll position answers the wrong question. Max scroll alone finds one
      page. Mid scroll alone finds the big numbers. Both are needed and they mean different
      things:
        UNREACHABLE — still covered at MAXIMUM scroll, so no amount of scrolling reveals it.
                      A real defect. This is the assertion.
        TRANSIENT   — covered now, revealed by scrolling. Reported, NOT asserted, because the
                      launcher is meant to sit there at rest; guard B is what handles it.

   Baseline on 45299e0, before either guard, at 1280:
     unreachable   bigboard.html 754 px2 (a .pf-stat .v of player prices)   — every other surface 0
     transient     receipts.html#models 4,303 px2 · nfl.html 3,947 px2
   ⚠️ If a change makes this suite green WITHOUT reproducing those numbers on the old build,
   the suite is decoration. See [[feedback-fixed-elements]]. */
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8931;               // udfoot holds 8917; do not share a port with another suite
const REPORT = process.env.DD_LAUNCHER_REPORT === "1";   // print the transient table too

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });

/* Every page that carries the launcher. Derived from source rather than typed, so a new page
   cannot quietly escape the gate the way it could from a hand-maintained list. */
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith(".html"))
  .filter(f => fs.readFileSync(path.join(ROOT, f), "utf8").includes("ddbLaunch")).sort();
/* ⚠️ Hash-routed sheets render NOTHING until their hash is set, so they need their own entries
   even though the bare page is already in PAGES above. */
const HASHED = ["receipts.html#models", "receipts.html#audit", "receipts.html#calls",
                "data.html#shelves", "cfb.html#roadmap"];
const SURFACES = [...PAGES, ...HASHED];

/* Both widths matter: the launcher moves to right:12px/bottom:12px and shrinks at <=760, so
   the band it owns is a different rectangle on a phone. */
const WIDTHS = [1280, 390];

/* One rect against every element that paints its own text or is media. Ancestors are skipped
   by construction — a <div> that only wraps children has no own text node — which is what
   keeps <body> and .wrap out of the results. */
const PROBE = () => {
  const L = document.getElementById("ddbLaunch");
  if (!L) return { missing: true };
  const cs = getComputedStyle(L);
  const away = cs.display === "none" || cs.visibility === "hidden"
    || parseFloat(cs.opacity) < 0.05 || cs.pointerEvents === "none";
  const lr = L.getBoundingClientRect();
  const hits = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el === L || L.contains(el) || el.contains(L)) continue;
    if (el.id === "ddbDock" || el.closest("#ddbDock") || el.closest("#ddmePanel")) continue;
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!ownText && !/^(IMG|SVG|CANVAS|VIDEO)$/.test(el.tagName)) continue;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const ox = Math.min(r.right, lr.right) - Math.max(r.left, lr.left);
    const oy = Math.min(r.bottom, lr.bottom) - Math.max(r.top, lr.top);
    if (ox > 0 && oy > 0) {
      hits.push({
        area: Math.round(ox * oy),
        what: el.tagName + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 58),
      });
    }
  }
  hits.sort((a, c) => c.area - a.area);
  return { away, total: hits.reduce((s, h) => s + h.area, 0), hits: hits.slice(0, 3) };
};

const unreachable = [], transient = [];
for (const W of WIDTHS) {
  for (const surf of SURFACES) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/${surf}`, { waitUntil: "load" });
    /* The launcher is appended 300ms after load, so every measurement below has to wait for
       the element itself rather than a fixed sleep. */
    /* ⚠️ THE ONE EXEMPTION, AND IT IS ASSERTED RATHER THAN SKIPPED. auction.html is the
       operator console: it ships its own Toto button in the toolbar and the widget bails on
       any page that has one (`if(document.getElementById("aiBtn")) return;`). So there is no
       fixed launcher there and nothing to measure. Proving WHY is what keeps this from
       becoming a hole: if auction gains a fixed launcher ALONGSIDE its own button, or its own
       button is switched to fixed bottom-right (which bigboard.html's 🙃 comment explicitly
       warns against), this goes red. Mutation-proved by M5 in work/atc_mutations.py.
       ⚠️ It does NOT go red if auction merely LOSES #aiBtn — the page would then mount the
       normal launcher and be measured like any other surface, which is correct behaviour, not
       a hole. Stated because the first draft of this comment claimed otherwise.
       [[test-suites]]: an exemption that is merely skipped reads as a pass. */
    const own = await p.evaluate(() => {
      const a = document.getElementById("aiBtn");
      return a ? { has: true, fixed: getComputedStyle(a).position === "fixed" } : { has: false };
    });
    let there = true;
    await p.waitForSelector("#ddbLaunch", { timeout: own.has ? 1500 : 6000 }).catch(() => { there = false; });
    if (own.has) {
      ok(`${surf}@${W} ships its own in-flow #aiBtn instead of the fixed launcher`, there === false && own.fixed === false,
         `launcher=${there} aiBtnFixed=${own.fixed}`);
      await ctx.close();
      continue;
    }
    if (!there) { ok(`${surf}@${W} launcher mounts`, false, "no #ddbLaunch after 6s"); await ctx.close(); continue; }
    await p.waitForTimeout(250);

    /* MAX scroll — the unreachable question. */
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(450);          // must exceed guard B's idle delay, or the chip is away
    const mx = await p.evaluate(PROBE);
    /* MID scroll — the transient question. Reported only. */
    await p.evaluate(() => window.scrollTo(0, Math.max(0, (document.body.scrollHeight - innerHeight) / 2)));
    await p.waitForTimeout(450);
    const md = await p.evaluate(PROBE);

    const tag = `${surf}@${W}`;
    /* ⚠️ THE ASSERTION. Zero content may sit under the launcher at maximum scroll, because
       nothing the reader does can move it out from under. */
    ok(`${tag} nothing unreachable under the launcher`, mx.total === 0,
       mx.total ? `${mx.total} px2 — ${mx.hits.map(h => `${h.what} "${h.text}"`).join(" | ")}` : "");
    if (mx.total) unreachable.push({ tag, ...mx });
    if (md.total) transient.push({ tag, ...md });
    await ctx.close();
  }
}

/* ---- guard B: the chip gets out of the way while the page is moving ---- */
const SCROLLERS = ["receipts.html#models", "nfl.html", "bigboard.html"];
for (const surf of SCROLLERS) {
  for (const reduced of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: reduced ? "reduce" : "no-preference" });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/${surf}`, { waitUntil: "load" });
    let there = true;
    await p.waitForSelector("#ddbLaunch", { timeout: 6000 }).catch(() => { there = false; });
    if (!there) { ok(`${surf} launcher mounts (rm=${reduced})`, false); await ctx.close(); continue; }
    await p.waitForTimeout(250);
    const tag = `${surf}${reduced ? " reduced-motion" : ""}`;
    ok(`${tag} chip is present at rest`, (await p.evaluate(PROBE)).away === false);
    await p.evaluate(() => window.scrollBy(0, 600));
    await p.waitForTimeout(90);
    /* ⚠️ Reduced motion must still HIDE it. Honouring the preference means dropping the
       transform and the transition, not keeping the chip over the text. */
    ok(`${tag} chip leaves while scrolling`, (await p.evaluate(PROBE)).away === true);
    await p.waitForTimeout(900);
    ok(`${tag} chip returns once scrolling stops`, (await p.evaluate(PROBE)).away === false);
    await ctx.close();
  }
}

/* ---- guard B, INNER CONTAINERS: the capture:true claim, measured rather than reasoned ----

   The widget comment says capture is load-bearing because some surfaces scroll INSIDE their own
   container while the document never grows. Everything above this block scrolls the WINDOW, and
   a window scroll reaches a window listener whether or not capture is set — so with only those
   assertions, flipping capture:true to false stays GREEN and settles nothing. M3 would have been
   decoration.

   Measured on the patched tree (work/_probe-scrollers.mjs, not committed): the containers that
   genuinely overflow are HORIZONTAL and appear at NARROW widths only — nothing on any launcher
   page overflows its own box at 1280. At 390: receipts #models .p-table-wrap dx=530,
   cfb #teams .cfbwrap dx=438. So the claim is true, and this is the width it is true at.

   Scroll events do not bubble. A capture listener on window still sees them, because the capture
   path runs from window down to the target even for a non-bubbling event. That asymmetry is the
   whole reason the option is there, and these assertions are the only ones that can prove it. */
const INNER = [
  { surf: "receipts.html#models", sel: ".p-table-wrap" },
  { surf: "cfb.html#teams",       sel: ".cfbwrap" },
];
for (const { surf, sel } of INNER) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/${surf}`, { waitUntil: "load" });
  let there = true;
  await p.waitForSelector("#ddbLaunch", { timeout: 6000 }).catch(() => { there = false; });
  if (!there) { ok(`${surf} launcher mounts (inner)`, false); await ctx.close(); continue; }
  await p.waitForTimeout(700);   // the sheet has to render before its table can overflow

  /* ⚠️ ASSERT THE PRECONDITION FIRST. A no-op assertion is worthless unless the op is DUE: if a
     future layout change stops this container overflowing, the two assertions below would pass
     by never having anything to react to. This one fails loudly instead. */
  const over = await p.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find(e => e.scrollWidth - e.clientWidth > 12);
    if (!el) return null;
    el.dataset.ddInner = "1";
    return { dx: el.scrollWidth - el.clientWidth };
  }, sel);
  ok(`${surf} ${sel} really scrolls inside itself at 390`, over !== null,
     over === null ? "no element overflows its own box — the capture claim has no witness here" : "");
  if (!over) { await ctx.close(); continue; }

  ok(`${surf} chip is present before the inner scroll`, (await p.evaluate(PROBE)).away === false);
  const beforeY = await p.evaluate(() => window.scrollY);
  await p.evaluate(() => { document.querySelector("[data-dd-inner]").scrollLeft += 240; });
  await p.waitForTimeout(90);
  /* THE ASSERTION M3 TURNS RED. With capture:false the window listener never hears this. */
  ok(`${surf} chip leaves on an INNER container scroll (capture:true is load-bearing)`,
     (await p.evaluate(PROBE)).away === true,
     "the launcher did not react to a scroll that never reached the window by bubbling");
  /* ⚠️ And prove it was the CONTAINER that moved, not the document — otherwise this is just the
     window-scroll assertion again under a different name. */
  ok(`${surf} the document itself did not scroll`,
     (await p.evaluate(() => window.scrollY)) === beforeY);
  await p.waitForTimeout(900);
  ok(`${surf} chip returns after the inner scroll stops`, (await p.evaluate(PROBE)).away === false);
  await ctx.close();
}

/* ---- the launcher still does its job ---- */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await p.waitForSelector("#ddbLaunch", { timeout: 6000 });
  await p.waitForTimeout(250);
  ok("first-visit nudge still applies", await p.evaluate(() => document.getElementById("ddbLaunch").classList.contains("nudge")));
  await p.click("#ddbLaunch");
  await p.waitForTimeout(350);
  ok("clicking still opens the dock", await p.evaluate(() => {
    const d = document.getElementById("ddbDock");
    return !!d && getComputedStyle(d).display !== "none";
  }));
  ok("nudge clears once opened", await p.evaluate(() => !document.getElementById("ddbLaunch").classList.contains("nudge")));
  ok("no script errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}

if (unreachable.length) {
  console.log("\nUNREACHABLE (asserted, must be empty):");
  for (const u of unreachable) console.log(`  ${u.tag}  ${u.total} px2  ${u.hits.map(h => h.what).join(", ")}`);
}
if (REPORT && transient.length) {
  console.log("\nTRANSIENT at mid scroll (reported, not asserted — guard B covers it):");
  for (const t of transient.sort((a, c) => c.total - a.total).slice(0, 12)) {
    console.log(`  ${t.tag}  ${t.total} px2  ${t.hits.map(h => `${h.what} "${h.text}"`).join(" | ")}`);
  }
}
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
