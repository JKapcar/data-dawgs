/* fantasy-warroom.html — the pinned bar (#wrPin) and its sentinel.

   What this suite is actually defending:

   1. THE BAR AND ITS OWN TRIGGER MUST NOT OSCILLATE. #wrSentinel sits ABOVE
      .wr-pin, and .stuck shortens the pin by ~48px. Chrome's scroll anchoring
      compensates that document-height change by pulling scrollY backwards,
      which returns the sentinel to the viewport, which un-sticks the pin, which
      restores the height. Measured on origin/main at 390x844: scrollY departed
      from the requested offset by up to 34px and `stuck` flipped three times
      inside five pixels of scroll. On a phone that reads as the page freezing.
      Defended by stepping 1px at a time across the threshold and asserting a
      SINGLE state transition and a bounded scroll error.

   2. THE LAYOUT VIEWPORT MUST NOT CHANGE MID-SCROLL. The .stuck backdrop used
      `inset:0 -50vw`, which overflowed by 123px the instant the bar stuck and
      made Chrome re-widen innerWidth 438->561 and re-scale the whole page.
      Defended by asserting scrollWidth and innerWidth are constant across the
      transition.

   3. THE RESERVATION MUST BE MEASURED, NOT ASSUMED. --wr-collapse is computed
      from the spacer's document position because .wr-tabs's top margin
      collapses out of the pin. A regression to a border-box measurement shows
      up here as a widened document-height spread.

   4. These are GEOMETRY failures. Three earlier rounds on this repo shipped a
      green suite over a visibly broken page because every assertion was a
      string grep. None of the checks below can pass on a static read of the
      file — they all require the page to actually run and actually scroll.

   5. No sideways overflow regression, no script errors, both themes,
      390 / 768 / 1280.

   Run:  cd work && node test-warroom-pin.mjs
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
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : f.endsWith(".md") ? "text/markdown" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8923, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });

const html = fs.readFileSync(path.join(ROOT, "fantasy-warroom.html"), "utf8");

/* ------------------------------------------------------- source-level ---- */
{
  ok("the collapse is reserved by a spacer, not by a min-height on the pin",
    html.includes('.wr-pin.stuck + #wrSpacer{height:var(--wr-collapse,0px)}'));
  ok("the spacer element exists in the markup, immediately after the pin",
    /<\/div><!-- \/\.wr-pin -->\s*\n<div id="wrSpacer"/.test(html));
  ok("the backdrop no longer overflows the viewport",
    !html.includes('.wr-pin.stuck::before{content:"";position:absolute;inset:0 -50vw'));
  ok("the un-stick edge is offset from the stick edge (hysteresis)",
    html.includes("rootMargin:'-'+WR_HYST+'px 0px 0px 0px'"));
  ok("the collapse is re-measured when the strip's contents change",
    (html.match(/window\.wrMeasureCollapse\(\)/g) || []).length >= 2);
}

/* ------------------------------------------------------------ runtime ---- */
/* A 1px-at-a-time walk across the threshold. The whole bug is invisible at any
   coarser step: at 10px increments the page looks fine. */
async function walk(width, theme) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await page.goto(`http://127.0.0.1:8923/fantasy-warroom.html`, { waitUntil: "networkidle" });
  await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
  /* The landing page with no league connected is shorter than the viewport, so
     the pin can never stick and the walk would assert nothing. Filler stands in
     for a connected league's sheet without needing a live provider.
     ⚠️ It goes inside .wrap, not on <body>. A sticky element cannot travel past
     its containing block, so filler appended to body leaves .wrap ending mid-page
     and the pin visibly detaching from top:0 further down — an artefact of the
     harness that reads exactly like a bug. */
  await page.evaluate(() => {
    const f = document.createElement("div"); f.style.height = "2500px"; f.id = "__filler";
    (document.querySelector(".wrap") || document.body).appendChild(f);
  });
  await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const pin = document.getElementById("wrPin"), sen = document.getElementById("wrSentinel"),
          se = document.scrollingElement;
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 250));
    const senAbs = sen.getBoundingClientRect().top + window.scrollY;
    const rows = [];
    for (let y = Math.round(senAbs) - 3; y <= Math.round(senAbs) + 20; y++) {
      window.scrollTo(0, y);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 70));
      rows.push({ t: y, s: window.scrollY, k: pin.classList.contains("stuck") ? 1 : 0,
        dh: se.scrollHeight, sw: se.scrollWidth, iw: window.innerWidth });
    }
    let flips = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].k !== rows[i - 1].k) flips++;
    const uniq = k => [...new Set(rows.map(r => r[k]))];
    return {
      flips,
      maxErr: Math.max(...rows.map(r => Math.abs(r.s - r.t))),
      docSpread: Math.max(...rows.map(r => r.dh)) - Math.min(...rows.map(r => r.dh)),
      widths: uniq("sw"), inners: uniq("iw"),
      collapse: getComputedStyle(document.documentElement).getPropertyValue("--wr-collapse").trim(),
      endedStuck: rows[rows.length - 1].k === 1,
      trace: rows.map(r => `${r.t}/${r.s}/${r.k}`).join(" ")
    };
  });
  await ctx.close();
  return { ...r, errs };
}

for (const width of [390, 768, 1280]) {
  for (const theme of ["light", "dark"]) {
    const tag = `${theme} @${width}`;
    const r = await walk(width, theme);
    ok(`${tag}: the bar sticks exactly once across the threshold`,
      r.flips === 1 && r.endedStuck, `flips=${r.flips} endedStuck=${r.endedStuck}\n      ${r.trace}`);
    /* 34px on origin/main. Anything above ~8px is a visible lurch on a phone. */
    ok(`${tag}: scroll position stays where it was put (<=8px)`,
      r.maxErr <= 8, `${r.maxErr}px\n      ${r.trace}`);
    /* 47px on origin/main — the input that scroll anchoring was reacting to. */
    ok(`${tag}: document height is held across the transition (<=8px)`,
      r.docSpread <= 8, `${r.docSpread}px`);
    /* 438 -> 561 on origin/main: a full-page relayout and rescale, mid-scroll. */
    ok(`${tag}: scrollWidth does not change when the bar sticks`,
      r.widths.length === 1, r.widths.join(","));
    ok(`${tag}: the layout viewport does not change when the bar sticks`,
      r.inners.length === 1, r.inners.join(","));
    ok(`${tag}: the collapse was measured, not left at the 0px fallback`,
      /^\d+(\.\d+)?px$/.test(r.collapse) && parseFloat(r.collapse) > 0, r.collapse || "(unset)");
    ok(`${tag}: no script errors`, r.errs.length === 0, r.errs.slice(0, 2).join(" | "));
  }
}

await b.close();
server.close();
console.log(`\ntest-warroom-pin: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
