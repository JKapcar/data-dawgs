/* markets.html and ai.html — the two empty section hubs.

   ⚠️ WHAT THIS SUITE IS ACTUALLY DEFENDING. These two pages ship with nothing on them, in
   a nav that now points at them. That is only honest while three separate things hold:
   the page says it is unbuilt above the fold, the live grid reports the FILE's count
   rather than a typed one, and "nothing is built yet" never gets confused with "the file
   could not be read". The last one is the subtle one and it is why this file exists —
   an empty grid that looks like a failed fetch teaches the reader to distrust the grid,
   and a failed fetch that looks like emptiness is a false claim about the site.

   So all THREE states are exercised against the same page: real file (zero rows), a
   forced 500 (read failure), and a stub with rows (populated). Two of the three cannot
   occur naturally today, which is exactly why they are routed rather than waited for.

   ⚠️ THE ZERO-ROW ASSERTION CHECKS ITS OWN PRECONDITION FIRST. If someone later adds a
   markets or ai row to surfaces.json, the "shows the empty state" assertion would start
   passing for the wrong reason — or failing mysteriously. It reads the committed file and
   asserts the domain really is empty before believing anything the page says about it.

   Run:  cd work && node test-section-hubs.mjs
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
  res.writeHead(200, { "Content-Type": f.endsWith(".json") ? "application/json" : f.endsWith(".txt") || f.endsWith(".md") ? "text/plain" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8936, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const errs = [];

const SURFACES = JSON.parse(fs.readFileSync(path.join(ROOT, "data/surfaces.json"), "utf8"));
const PAGES = [
  { file: "markets.html", domain: "markets", label: "Prediction Markets", h1: "prediction-markets work" },
  { file: "ai.html", domain: "ai", label: "A.I.", h1: "A.I. work" },
];

/* ---------- 0. the precondition, read from the committed file ---------- */
for (const p of PAGES) {
  const rows = SURFACES.data.filter(r => r.domain === p.domain);
  ok(`${p.file}: surfaces.json really has no "${p.domain}" rows (precondition)`, rows.length === 0,
     `found ${rows.length} — the empty-state assertions below would be meaningless`);
}

async function open(file, { route, width = 900, theme = null } = {}) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(`${file}: ${e.message}`));
  if (route) await route(p);
  if (theme) await p.addInitScript(t => { try { localStorage.setItem("dd-theme2-mode", t); } catch (e) {} }, theme);
  await p.goto(`http://127.0.0.1:8936/${file}`, { waitUntil: "load" });
  await p.waitForFunction(() => {
    const el = document.getElementById("secCards");
    return el && !/Reading the surfaces map/.test(el.textContent);
  }, null, { timeout: 15000 });
  return { ctx, p };
}

for (const P of PAGES) {
  /* ---------- 1. the page exists, is chipped, and admits it is unbuilt ---------- */
  {
    const { ctx, p } = await open(P.file);
    const banner = await p.$(".notbuilt");
    ok(`${P.file}: carries a .notbuilt banner`, !!banner);
    if (banner) {
      const t = await banner.innerText();
      ok(`${P.file}: the banner says it is not built, in those words`,
         /Nothing here is built yet/i.test(t), t.slice(0, 60));
      ok(`${P.file}: the banner calls the plan intent, not shipped work`,
         /stated intent, not shipped work/i.test(t));
      /* above the fold at a desktop height — a banner you have to scroll to is the
         failure -lab-pages.md already recorded: someone screenshots the hero and the
         warning is gone. */
      const box = await banner.boundingBox();
      ok(`${P.file}: the banner is above the fold`, box && box.y + box.height < 900,
         box ? `bottom ${Math.round(box.y + box.height)}` : "no box");
    }
    const chip = await p.$(".tierchip");
    ok(`${P.file}: carries a tier chip`, !!chip);
    if (chip) ok(`${P.file}: the chip declares its tier as an attribute`,
                 (await chip.getAttribute("data-tier")) === "labs");

    /* the nav change travelled here too */
    const groups = await p.$$eval(".sitenav .links .navgrp", n => n.length);
    ok(`${P.file}: the bar carries all eight groups`, groups === 8, String(groups));
    /* ⚠️ innerText, never textContent. An entry with a `short:` label has BOTH spans in
       the DOM and CSS hides one, so textContent reports "Prediction MarketsMkts" — the
       same trap -nav.md records, hit again here on the first run of this suite. */
    const on = await p.$$eval(".sitenav .links .grpbtn.on", n => n.map(x => x.innerText.trim().replace(/\s*▾$/, "")));
    ok(`${P.file}: its own nav group is the active one`, on.length === 1 && on[0] === P.label,
       JSON.stringify(on));

    /* ⚠️ an empty section must not advertise a tool. Any mcp tool id on the page would be
       a capability claim, and there are none. */
    const body = await p.$eval("main", el => el.textContent);
    ok(`${P.file}: names no MCP tool`, !/\bdd_[a-z_]+/.test(body),
       (body.match(/\bdd_[a-z_]+/g) || []).join(","));
    await ctx.close();
  }

  /* ---------- 2. zero rows: the empty state, and it is not the error state ---------- */
  {
    const { ctx, p } = await open(P.file);
    const cards = await p.$eval("#secCards", el => el.textContent);
    const count = await p.$eval("#secCount", el => el.textContent);
    ok(`${P.file}: zero rows says nothing is built yet`, /Nothing is built yet/i.test(cards), cards.slice(0, 80));
    ok(`${P.file}: zero rows does NOT read as a failed request`,
       !/could not be read/i.test(cards), cards.slice(0, 80));
    ok(`${P.file}: zero rows names the file as the source of the zero`,
       /surfaces\.json/.test(cards) || /surfaces\.json/.test(count));
    ok(`${P.file}: the count line states 0 surfaces`, /\b0 surfaces\b/.test(count), count);
    ok(`${P.file}: the count line carries the file's date`,
       count.includes(SURFACES.as_of), `${count} (as_of ${SURFACES.as_of})`);
    ok(`${P.file}: no card was rendered`, (await p.$$("#secCards .tool")).length === 0);
    await ctx.close();
  }

  /* ---------- 3. read failure: loud, and distinguishable from empty ---------- */
  {
    const route = async (p) => p.route("**/data/surfaces.json", r => r.fulfill({ status: 500, body: "nope" }));
    const { ctx, p } = await open(P.file, { route });
    const cards = await p.$eval("#secCards", el => el.textContent);
    const count = await p.$eval("#secCount", el => el.textContent);
    ok(`${P.file}: a failed read says the file could not be read`, /could not be read/i.test(cards), cards.slice(0, 90));
    ok(`${P.file}: a failed read does NOT claim nothing is built`,
       !/Nothing is built yet/i.test(cards), cards.slice(0, 90));
    ok(`${P.file}: a failed read reports the status it got`, /500/.test(cards), cards.slice(0, 120));
    ok(`${P.file}: the count line says the directory is unavailable`, /unavailable/i.test(count), count);
    await ctx.close();
  }

  /* ---------- 4. rows: the grid renders the file, with no page edit ---------- */
  {
    const stub = JSON.stringify({
      ...SURFACES,
      data: [{
        id: `${P.domain}-probe`, domain: P.domain, name: `${P.label} probe surface`,
        page: `/${P.file}`, tier: "labs",
        machine: [{ kind: "json", url: `/data/${P.domain}-probe.json`, status: "live" },
                  { kind: "mcp", tool: `dd_${P.domain}_probe`, status: "planned" }],
        gap: "a deliberately stated gap",
      }],
    });
    const route = async (p) => p.route("**/data/surfaces.json", r =>
      r.fulfill({ status: 200, contentType: "application/json", body: stub }));
    const { ctx, p } = await open(P.file, { route });
    const cards = await p.$$("#secCards .tool");
    ok(`${P.file}: one row renders one card`, cards.length === 1, String(cards.length));
    if (cards.length) {
      const t = await cards[0].innerText();
      ok(`${P.file}: the card carries the row's name`, t.includes(`${P.label} probe surface`), t.slice(0, 60));
      ok(`${P.file}: the card lists only the LIVE machine surface`,
         t.includes(`${P.domain}-probe.json`) && !t.includes(`dd_${P.domain}_probe`), t.slice(0, 160));
      ok(`${P.file}: the card keeps the row's stated gap`, /deliberately stated gap/.test(t));
    }
    const count = await p.$eval("#secCount", el => el.textContent);
    ok(`${P.file}: the count is the file's, singular`, /\b1 surface\b/.test(count), count);
    ok(`${P.file}: a populated grid drops both empty-state strings`,
       !/Nothing is built yet|could not be read/i.test(await p.$eval("#secCards", el => el.textContent)));
    await ctx.close();
  }

  /* ---------- 5. both themes, phone width, nothing throws ---------- */
  for (const theme of ["dark", "light"]) {
    const { ctx, p } = await open(P.file, { width: 390, theme });
    const h1 = await p.$eval("h1", el => el.innerText);
    ok(`${P.file}@390 ${theme}: the hero renders`, h1.includes(P.h1), h1.slice(0, 60));
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok(`${P.file}@390 ${theme}: the page does not scroll sideways`, overflow === false);
    await ctx.close();
  }
}

ok("no script errors on either page in any state", errs.length === 0, errs.join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
