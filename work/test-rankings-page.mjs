/* rankings.html — does it actually render, at the sizes and in the states it will meet?
 *
 * Run: node work/test-rankings-page.mjs   (add SHOT=1 to write screenshots to /tmp)
 *
 * ⚠️ THE SITE LESSON THIS FILE EXISTS FOR: bounds checks miss overlaps. Asserting that an
 * element is "within the viewport" passes happily while two elements sit on top of each
 * other. So this measures REAL geometry — lane count against entrant count, chip columns
 * against entrants, dogs that actually moved off the gate — and writes screenshots so a
 * human can look.
 *
 * ⚠️ SEVEN ENTRANTS, NOT FOUR (trap #13). The mockup ships four and the launch roster is
 * four; the whole point is that a fifth service added on launch day is a paste, not a code
 * change. Every fixture here is seven, and the assertions count them.
 *
 * The page is served from a local file with the network stubbed — no Worker, no Firebase.
 */
import { loadPlaywright } from "./playwright-loader.mjs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { createServer } from "http";

const WORK = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WORK, "..");
/* ⚠️ SERVED OVER HTTP, NOT file://. Chromium refuses a cross-origin fetch from a file://
 * origin before Playwright's router ever sees it, so the page loaded fine and rendered a
 * permanently empty board — which looked exactly like a rendering bug. */
let PAGE = "";
const SHOT = process.env.SHOT === "1";

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) pass++;
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};

/* A sandbox season with SEVEN entrants — the launch four plus three that would arrive
 * mid-season. Colours are registry-assigned and deliberately not in any index order. */
const IDS = ["BLEND", "ETR", "PFF", "ESPN", "FPECR", "KAPRANKS", "LATECOMER"];
const COLORS = ["#2fbf3f", "#ff6a02", "#4aa3d6", "#e05555", "#d19a30", "#9b7ede", "#3fbfb0"];
const SCOPES = ["ALL", "RB", "WR", "QB", "TE"];

function makeDoc(weeks = 6) {
  const entrants = {}, scopes = {}, weekMap = {};
  IDS.forEach((id, i) => {
    entrants[id] = { name: id === "KAPRANKS" ? "Kap's Ranks" : id, type: i === 5 ? "house" : "service",
                     color: COLORS[i], first_week: i === 6 ? 4 : 1, blend_member: i > 0 && i < 4 };
  });
  for (const sc of SCOPES) {
    scopes[sc] = {};
    IDS.forEach((id, i) => {
      const base = 0.72 - i * 0.02;
      const weekly = Array.from({ length: weeks }, (_, w) => base + ((w * 7 + i * 3) % 11 - 5) / 100);
      scopes[sc][id] = {
        rho: base, rho_raw: base + 0.01, ci: [base - 0.06, base + 0.06],
        tau: base - 0.08, capture: 80 + i * 0.4, hygiene: null,
        relative_to_field: i === 0 ? 0 : -0.01 * i,
        weeks_graded: weeks, weekly_rho: weekly,
        provisional: weeks < 4, tied_with_leader: i < 3,
        grade: ["A", "A−", "A−", "B+", "B", "B−", "C+"][i],
      };
    });
  }
  for (let w = 1; w <= weeks; w++) {
    weekMap[String(w)] = {};
    for (const sc of ["ALL", ...SCOPES.slice(1)]) {
      weekMap[String(w)][sc] = {};
      IDS.forEach((id, i) => {
        weekMap[String(w)][sc][id] = { rho: 0.7 - i * 0.02, tau: 0.6 - i * 0.02, capture: 79 + i * 0.5, hygiene: null };
      });
    }
  }
  return { season: 2026, weeks_graded: weeks, scoring: "PPR", updated_at: new Date().toISOString(),
           method_version: "1.0", provisional: true, hygiene_tracked: false, excluded_unmatched: 2,
           entrants, blend: { members: ["ETR", "PFF", "ESPN"], frozen_at_week: 1 }, scopes, weeks: weekMap };
}

async function open(browser, { doc, theme = "dark", width = 1440, height = 1000, reduced = false, fail404 = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    colorScheme: theme === "light" ? "light" : "dark",
  });
  await ctx.route("**/rankings/grades*", route => {
    if (fail404) return route.fulfill({ status: 503, body: "down" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(doc) });
  });
  /* ⚠️ NO CATCH-ALL ROUTE HERE. Playwright gives precedence to the most recently
   * registered matching handler, so a broad "**toto**" stub added after the grades stub
   * silently shadows it, the page receives {} and renders the empty state — which reads
   * exactly like a broken renderer. Cost an hour once; do not add one back. */
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  if (theme === "light") await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.waitForTimeout(reduced ? 150 : 500);
  return { ctx, page, errors };
}

const tab = async (page, v) => {
  await page.click(`#dt-tabs button[data-v="${v}"]`);
  await page.waitForTimeout(320);
};

async function main() {
  const server = createServer((req, res) => {
    const name = (req.url || "/").split("?")[0].replace(/^\//, "") || "rankings.html";
    try {
      const body = readFileSync(resolve(ROOT, name));
      res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html" : "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("no"); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  PAGE = `http://127.0.0.1:${server.address().port}/rankings.html`;

  const { chromium } = loadPlaywright();
  /* The image ships Chromium 1194 under PLAYWRIGHT_BROWSERS_PATH while the npm package may
   * pin a newer build. Point at the installed binary rather than downloading a second one —
   * the environment explicitly asks for executablePath over `playwright install`. */
  const EXE = process.env.DD_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const browser = await chromium.launch(existsSync(EXE) ? { executablePath: EXE } : {});
  const doc = makeDoc(6);

  /* ---------- the landing state ---------- */
  {
    const { ctx, page, errors } = await open(browser, { doc });
    ok(errors.length === 0, "the page throws no script errors", errors.join("; "));
    ok(await page.title() === "The Dog Track · Data Dawgs", "title is set");
    ok(await page.getAttribute("html", "data-theme") === "dark", "dark is this page's default (trap #8)");
    ok(await page.$eval("#dt-view-rc", el => el.classList.contains("on")), "Report Card is the LANDING tab (spec §4, not the mockup's Board)");
    ok((await page.$$("#dt-tabs button[data-v]")).length === 5, "five tabs");
    ok(await page.$eval('a.tierchip', el => el.dataset.tier) === "labs", "the Pup tier chip is present for surfaces.json to scan");

    /* trap #13 — every view counts SEVEN */
    const cards = await page.$$("#dt-view-rc .dt-card");
    ok(cards.length === IDS.length, `Report Card renders all ${IDS.length} entrants`, String(cards.length));
    ok(await page.$eval("#dt-view-rc .dt-card .dt-dot", el => getComputedStyle(el).backgroundColor) !== "rgba(0, 0, 0, 0)",
      "entrant colour comes from the doc, not a stylesheet default");
    ok(await page.$$eval("#dt-view-rc .dt-hyg", els => els.every(e => /not tracked yet/.test(e.textContent))),
      "hygiene renders as 'not tracked yet', never as 0 (gap G1)");

    await tab(page, "race");
    const lanes = await page.$$("#dt-view-race .dt-lane");
    ok(lanes.length === IDS.length, `the race has ${IDS.length} lanes`, String(lanes.length));
    const trackH = await page.$eval("#dt-trackbox", el => el.getBoundingClientRect().height);
    ok(trackH > lanes.length * 40, "the track container grew to fit the lanes rather than clipping", String(trackH));
    /* trap #2 — the dogs must actually leave the gate */
    const lefts = await page.$$eval("#dt-view-race .dt-dog", els => els.map(e => parseFloat(e.style.left)));
    ok(lefts.every(l => l > 4.5), "every dog moved off the gate — the double-rAF transition fired", JSON.stringify(lefts));

    await tab(page, "cage");
    const cols = await page.$$("#dt-view-cage .dt-stackcol");
    ok(cols.length === IDS.length, `the cage has ${IDS.length} chip columns`, String(cols.length));
    /* auto-fit lays out as many tracks as the width allows and COLLAPSES the empty ones,
     * so the raw track count is a property of the viewport, not the entrant count. What
     * matters is that all N columns render, on one row, at a usable width. */
    const geo = await page.$$eval("#dt-view-cage .dt-stackcol", els => els.map(e => {
      const r = e.getBoundingClientRect(); return { bottom: Math.round(r.bottom), w: Math.round(r.width) };
    }));
    /* They share a BOTTOM, not a top: the stacks are bottom-aligned and a taller stack
     * legitimately starts higher. Asserting equal tops fails on a correctly drawn chart. */
    ok(geo.length === IDS.length && new Set(geo.map(g => g.bottom)).size === 1,
      "all cage columns render bottom-aligned on one row, whatever N is", JSON.stringify(geo.slice(0, 3)));
    ok(geo.every(g => g.w >= 60), "each cage column keeps a usable width", JSON.stringify(geo.map(g => g.w)));

    await tab(page, "spread");
    const svgH = await page.$eval("#dt-view-spread svg", el => el.getBoundingClientRect().height);
    ok(svgH > 0, "the Wild Weeks SVG has computed height from the entrant count", String(svgH));
    ok((await page.$$("#dt-view-spread circle")).length >= IDS.length * 6, "one chip per week per entrant");

    await tab(page, "board");
    ok((await page.$$("#dt-view-board tbody tr")).length === IDS.length, "the board lists every entrant");
    ok((await page.$$("#dt-view-board .dt-pf")).length >= 1, "a photo finish is called when intervals overlap");
    if (SHOT) writeFileSync("/tmp/dt-board.png", await page.screenshot({ fullPage: true }));
    await ctx.close();
  }

  /* ---------- the week view is NOT the season view (trap #11) ---------- */
  {
    const { ctx, page } = await open(browser, { doc });
    await tab(page, "board");
    await page.click('[data-seg="week"][data-view="board"] button[data-w="3"]');
    await page.waitForTimeout(250);
    const text = await page.$eval("#dt-view-board", el => el.textContent);
    ok(/single week — no interval/.test(text), "the week view shows NO confidence interval");
    ok(!/range \./.test(text), "no range line survives into the week view");
    const badge = await page.$eval('[data-weekbadge="board"]', el => el.textContent);
    ok(/ONE WEEK ≠ SKILL/.test(badge), "the week view carries the 'one week ≠ skill' badge");
    const call = await page.$eval("#dt-view-board tbody", el => el.textContent);
    ok(!/PHOTO FINISH/.test(call), "no photo-finish call on a single week — it is a season construct");
    await ctx.close();
  }

  /* ---------- scope switching ---------- */
  {
    const { ctx, page } = await open(browser, { doc });
    await page.click('[data-seg="scope"][data-view="rc"] button[data-p="TE"]');
    await page.waitForTimeout(250);
    ok(/TE ·/.test(await page.$eval("#dt-view-rc", el => el.textContent)), "the scope toggle re-renders to the chosen position");
    ok((await page.$$("#dt-view-rc .dt-card")).length === IDS.length, "every entrant survives a scope change");
    await ctx.close();
  }

  /* ---------- empty state, before Week 1 ---------- */
  {
    const empty = { season: 2026, weeks_graded: 0, empty: true, entrants: {}, scopes: {}, weeks: {},
                    method_version: "1.0", provisional: true };
    const { ctx, page } = await open(browser, { doc: empty });
    const t = await page.$eval("#dt-view-rc", el => el.textContent);
    ok(/Season opens Sep 10/.test(t), "before Week 1 the page renders an honest empty state");
    ok(/pre-registered/.test(await page.$eval("#method", el => el.textContent)), "the methodology drawer is present with no data at all");
    ok(!/NaN|undefined/.test(t), "the empty state prints no NaN or undefined", t.slice(0, 120));
    await ctx.close();
  }

  /* ---------- the worker being down is a stated failure, not a blank page ---------- */
  {
    const { ctx, page } = await open(browser, { doc, fail404: true });
    ok(/not reachable right now/.test(await page.$eval("#dt-view-rc", el => el.textContent)),
      "a failed fetch says so plainly instead of rendering an empty board");
    await ctx.close();
  }

  /* ---------- both themes, three widths, no horizontal overflow ---------- */
  for (const theme of ["dark", "light"]) {
    for (const width of [360, 390, 1440]) {
      const { ctx, page, errors } = await open(browser, { doc, theme, width, height: 900 });
      /* ⚠️ MEASURES THIS PAGE'S OWN CONTENT, NOT THE SHARED CHROME.
       * The site banner overflows by 22px at 360 and 48px at 390 on EVERY flattened page —
       * verified identical on the donor, nfl.html, so it is a pre-existing sitewide nav
       * bug and not this page's to fix here. Fixing it inside rankings.html would fork the
       * shared chrome, which is worse than the bug. Reported separately; this assertion
       * holds this page to adding NO overflow of its own. */
      const over = await page.$$eval(".dt *", els => {
        const lim = document.documentElement.clientWidth;
        return els.filter(e => e.getBoundingClientRect().right > lim + 1)
                  .map(e => (e.tagName + "." + (e.getAttribute("class") || "")).slice(0, 40));
      });
      ok(over.length === 0, `${theme} @ ${width}px — no Dog Track element overflows the viewport`, over.slice(0, 4).join(", "));
      await tab(page, "race");
      const dogsIn = await page.$$eval("#dt-view-race .dt-dog", els =>
        els.every(e => e.getBoundingClientRect().right <= window.innerWidth + 2));
      ok(dogsIn, `${theme} @ ${width}px — no dog runs off the edge of the track`);
      await tab(page, "cage");
      const chipsIn = await page.$$eval("#dt-view-cage .dt-stackcol", els =>
        els.every(e => e.getBoundingClientRect().right <= window.innerWidth + 2));
      ok(chipsIn, `${theme} @ ${width}px — the cage columns stay inside the viewport`);
      ok(errors.length === 0, `${theme} @ ${width}px — no script errors`, errors.join("; "));

      /* ⚠️ THE SITE LESSON: BOUNDS CHECKS MISS OVERLAPS. Nothing above would notice the
       * fixed Toto launcher sitting on top of the week selector — every control would
       * still be "inside the viewport" while being unclickable. Check real overlap of the
       * chrome's floating widgets against this page's interactive controls, in-viewport. */
      await tab(page, "rc");
      const covered = await page.evaluate(async () => {
        /* ⚠️ A fixed launcher covers whatever scrolls under it — true of every page here —
         * so "covered at initial scroll" is an arbitrary snapshot. The property worth
         * holding is that every control can be brought clear of it: no control is
         * PERMANENTLY unreachable. Each is centred before it is judged. */
        const floats = () => [...document.querySelectorAll("body *")].filter(e => {
          const st = getComputedStyle(e);
          return (st.position === "fixed" || st.position === "sticky") && st.display !== "none"
            && e.getBoundingClientRect().width > 30 && !e.closest(".dt");
        });
        const hits = [];
        const btns = [...document.querySelectorAll(".dt-seg button, #dt-tabs button")];
        for (const btn of btns) {
          btn.scrollIntoView({ block: "center", behavior: "instant" });
          await new Promise(r => requestAnimationFrame(r));
          const b = btn.getBoundingClientRect();
          for (const f of floats()) {
            const r = f.getBoundingClientRect();
            const ov = Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left))
                     * Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top));
            if (ov > b.width * b.height * 0.25) hits.push(btn.textContent.trim() + " under " + (f.className || f.tagName));
          }
        }
        window.scrollTo(0, 0);
        return hits;
      });
      ok(covered.length === 0, `${theme} @ ${width}px — every control is reachable, none permanently under floating chrome`, covered.slice(0, 3).join(", "));
      if (SHOT) writeFileSync(`/tmp/dt-${theme}-${width}.png`, await page.screenshot({ fullPage: true }));
      await ctx.close();
    }
  }

  /* ---------- reduced motion ---------- */
  {
    const { ctx, page } = await open(browser, { doc, reduced: true });
    await tab(page, "race");
    const moved = await page.$$eval("#dt-view-race .dt-dog", els => els.every(e => parseFloat(e.style.left) > 4.5));
    ok(moved, "with reduced motion the dogs are placed at their final position immediately, not left at the gate");
    const anim = await page.$eval("#dt-view-rc .dt-card", el => getComputedStyle(el).animationName);
    ok(anim === "none", "animations are disabled under prefers-reduced-motion");
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
