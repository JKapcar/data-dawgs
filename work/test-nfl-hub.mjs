/* nfl.html — the NFL analysis hub (CEP-5A Stage 6).

   What this suite is actually defending:

   1. BOTH CARD SETS ARE COMPUTED. Live cards are the surfaces map's domain "nfl" rows;
      under-construction cards are pound-tools.json's blocked NFL rows. Neither list is
      typed, and the counts the page prints are the files'.
   2. THE BLOCKER TRAVELS. An under-construction card here carries the row's exact_blocker
      and minimum_path_to_completion verbatim. "Coming soon" is not information; a named
      blocker with a way out is, and it is the reason the DawgHouse shelf exists at all.
      Both pages render the same rows from the same file, so they cannot disagree.
   3. THE HUB CLAIMS NOTHING. No surfaces row, chip is Labs, no collar of its own.
   4. NO WORKING-LOOKING CONTROL on a card that is not built.
   5. THE COMPONENT IS ARENA'S, BYTE FOR BYTE — three copies now, one source.
   6. THE BELIEF SCOREBOARD IS NOT HERE. What models believe and how pre-registered calls
      grade are kept apart on purpose; both live on Receipts. A card for it on this page
      would re-create the exact conflation CEP-5A exists to prevent.
   7. It fails loud, both themes, no overflow at 320/390/1280, no script errors.

   Run:  cd work && node test-nfl-hub.mjs
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
  res.writeHead(200, { "Content-Type": f.endsWith(".json") ? "application/json" : f.endsWith(".md") ? "text/markdown" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8925, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const errs = [];

const sur = JSON.parse(fs.readFileSync(path.join(ROOT, "data/surfaces.json"), "utf8")).data;
const tools = JSON.parse(fs.readFileSync(path.join(ROOT, "data/pound-tools.json"), "utf8")).data;
const html = fs.readFileSync(path.join(ROOT, "nfl.html"), "utf8");
const arena = fs.readFileSync(path.join(ROOT, "arena.html"), "utf8");
const dawghouse = fs.readFileSync(path.join(ROOT, "dawghouse.html"), "utf8");

const NFL = sur.filter(r => r.domain === "nfl");
const BLOCKED = tools.filter(t => (t.kind || "tool") === "tool" && t.domain === "NFL" && t.status !== "complete");

/* ------------------------------------------------------- source-level ---- */
{
  ok("the map has NFL rows to render", NFL.length > 0, String(NFL.length));
  ok("the inventory has blocked NFL work to render", BLOCKED.length > 0, String(BLOCKED.length));
  ok("the hub claims no surface of its own",
    !sur.some(r => r.id === "nfl-hub" || r.page === "/nfl.html"));
  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  ok("the page's own tier chip is Labs", !!chip && chip[1].trim() === "Labs", chip && chip[1]);
  ok("no card list is typed into the page",
    !/data-surface="(epa|nfelo|calculators)"/.test(html) && !/data-tool="(nfeloml|wepa)"/.test(html)
    && /r\.domain===DOMAIN/.test(html) && /t\.domain===SHELF_DOMAIN/.test(html));

  /* one component, three pages */
  const cut = s => {
    const i = s.indexOf("/* CEP-5A Stage 4 — THE REUSABLE UNDER-CONSTRUCTION TREATMENT.");
    const j = s.indexOf("\n/* Tier chips rendered FROM surfaces.json", i);
    return i < 0 || j < 0 ? null : s.slice(i, j);
  };
  const a = cut(arena);
  ok("nfl.html carries arena's under-construction component byte for byte", !!a && html.includes(a));
  ok("and arena's collar rules too",
    html.includes(".collar{display:inline-flex;align-items:center;color:var(--good);vertical-align:middle}"));

  /* ⚠️ MODELS (belief) AND SCOREBOARD (grading) STAY APART — the point of Receipts, and the
     exact conflation CEP-5A exists to prevent. A weak version of this assertion (does the
     string "receipts.html#models" appear anywhere) passes even if the page ALSO re-hosts
     the thing, so assert the negative: this page must never read the receipt files. */
  ok("the belief scoreboard is linked", /receipts\.html#models/.test(html));
  ok("the page says why the scoreboard is elsewhere", /kept\s*\n?\s*apart/.test(html));
  /* ⚠️ Scope this to the page's OWN body. The shared nav script carries the Upside Down
     map, which names /data/receipts.json for the receipts page — that is sitewide furniture,
     not this page reading a receipt file, and asserting over the whole document flags it. */
  const body = html.slice(html.indexOf("<main>"));
  ok("this page does not read the receipt or model-receipt files",
    !/model-receipts\.json/.test(body) && !/receipts\.json/.test(body),
    "a receipt file is referenced in the page body");

  ok("nfl.html is cached for draft night",
    fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes('"/nfl.html"'));
  ok("nfl.html is findable by crawlers",
    fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8").includes("/nfl.html"));
  /* the shelf keeps rendering the same rows — neither page is the copy */
  ok("the DawgHouse shelf still renders the inventory from the same file",
    /pound-tools\.json/.test(dawghouse) && /toolInventory/.test(dawghouse));
}

/* ------------------------------------------------------------- render ---- */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("render: " + e.message));
  const reqs = [];
  p.on("request", r => reqs.push(r.url()));
  await p.goto("http://127.0.0.1:8925/nfl.html", { waitUntil: "load" });
  await p.waitForFunction(() => document.querySelectorAll("#nflCards .tool").length > 0
    && document.querySelectorAll("#nflUcCards article").length > 0, null, { timeout: 15000 });

  const got = await p.evaluate(() => ({
    cards: [...document.querySelectorAll("#nflCards .tool")].map(a => ({
      id: a.dataset.surface, tier: a.dataset.tier,
      href: a.querySelector("h3 a") ? a.querySelector("h3 a").getAttribute("href") : null,
      collar: !!a.querySelector(".collar[aria-label]"),
      chipText: a.querySelector(".status") ? a.querySelector(".status").textContent.trim() : null,
      text: a.textContent,
    })),
    count: document.getElementById("nflCount").textContent,
    uc: [...document.querySelectorAll("#nflUcCards article")].map(a => ({
      id: a.dataset.tool, status: a.dataset.blocked, text: a.textContent,
      chip: !!a.querySelector(".uc-chip"), art: !!a.querySelector(".uc-art"),
      controls: a.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex],[onclick],form').length,
      classed: a.classList.contains("uc"),
      heading: a.querySelector("h3").textContent.trim(),
    })),
    ucCount: document.getElementById("nflUcCount").textContent,
    liveRegions: document.querySelectorAll("[aria-live]").length,
    canvases: document.querySelectorAll("canvas").length,
  }));

  ok("one card per NFL row in the map", got.cards.length === NFL.length,
    `page ${got.cards.length} vs file ${NFL.length}`);
  ok("card ids are the map's NFL ids, in the map's order",
    got.cards.map(c => c.id).join(",") === NFL.map(r => r.id).join(","), got.cards.map(c => c.id).join(","));
  ok("the printed count is the file's", got.count.includes(String(NFL.length)) && got.count.includes("surfaces.json"), got.count);

  for (const row of NFL) {
    const c = got.cards.find(x => x.id === row.id);
    ok(`${row.id}: card links its real page`, !!c && c.href === row.page, c && c.href);
    ok(`${row.id}: that page exists`, !!c && fs.existsSync(path.join(ROOT, c.href.replace(/^\//, "").split("#")[0])));
    ok(`${row.id}: card carries the map's tier`, !!c && c.tier === row.tier, c && c.tier);
    if (row.tier === "dawg") ok(`${row.id}: dawg renders as a collar, not the word`, c.collar && c.chipText === null);
    else ok(`${row.id}: ${row.tier} stays a text chip`, !c.collar && !!c.chipText, c.chipText);
    if (row.gap) ok(`${row.id}: the known gap travels`, c.text.includes(row.gap.slice(0, 40)));
  }

  ok("one under-construction card per blocked NFL row", got.uc.length === BLOCKED.length,
    `page ${got.uc.length} vs file ${BLOCKED.length}`);
  ok("every under-construction card is machine-readable as such",
    got.uc.every(u => u.classed && u.chip && u.art));
  ok("no under-construction card exposes a control that looks like it works",
    got.uc.every(u => u.controls === 0),
    got.uc.filter(u => u.controls).map(u => u.id).join(" "));

  /* ⚠️ the load-bearing one: the reason travels, verbatim, from the file */
  for (const t of BLOCKED) {
    const u = got.uc.find(x => x.id === t.id);
    ok(`${t.id}: has a card`, !!u);
    ok(`${t.id}: card is headed by the tool's real name`, !!u && u.heading === t.name, u && u.heading);
    ok(`${t.id}: the exact blocker travels verbatim`, !!u && u.text.includes(t.exact_blocker),
      t.exact_blocker.slice(0, 50));
    ok(`${t.id}: the minimum path travels verbatim`, !!u && u.text.includes(t.minimum_path_to_completion),
      t.minimum_path_to_completion.slice(0, 50));
    ok(`${t.id}: the card carries the file's status`, !!u && u.status === t.status, u && u.status);
  }
  ok("the blocked count is stated", got.ucCount.includes(String(BLOCKED.length)), got.ucCount);
  ok("the page keeps live regions for the counts", got.liveRegions >= 2, String(got.liveRegions));
  ok("nothing is painted", got.canvases === 0);
  ok("and no request went out for a receipt payload",
    !reqs.some(u => /receipts\.json|model-receipts\.json/.test(u)),
    reqs.filter(u => /receipts/.test(u)).join(" "));
  await ctx.close();
}

/* --------------------------------------------------------- fails loud ---- */
for (const [file, cardSel, countId, label] of [
  ["**/data/surfaces.json", "#nflCards", "nflCount", "the map"],
  ["**/data/pound-tools.json", "#nflUcCards", "nflUcCount", "the inventory"],
]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("degraded: " + e.message));
  await p.route(file, r => r.fulfill({ status: 500, contentType: "text/plain", body: "no" }));
  await p.goto("http://127.0.0.1:8925/nfl.html", { waitUntil: "load" });
  await p.waitForFunction(sel => !document.querySelector(sel + " .p-loading"), cardSel, { timeout: 8000 }).catch(() => { });
  const d = await p.evaluate(([sel, cid]) => ({
    err: !!document.querySelector(sel + " .p-error"),
    cards: document.querySelectorAll(sel + " article").length,
    count: document.getElementById(cid).textContent,
  }), [cardSel, countId]);
  ok(`${label} unreadable produces a stated failure`, d.err && d.cards === 0);
  ok(`${label} count says unavailable rather than zero`, /unavailable/i.test(d.count), d.count);
  /* the other half of the page must still work — one dead file is not a dead page */
  const other = await p.evaluate(sel => document.querySelectorAll(sel + " article").length,
    cardSel === "#nflCards" ? "#nflUcCards" : "#nflCards");
  ok(`${label} failing does not take the rest of the page with it`, other > 0, String(other));
  await ctx.close();
}

/* ------------------------------------------- themes, widths, overflow ---- */
for (const W of [1280, 390, 320]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(`${theme}@${W}: ${e.message}`));
    await p.addInitScript(t => { try { localStorage.setItem("dd-theme2", t); localStorage.setItem("dd-theme", t); } catch (e) { } }, theme);
    await p.goto("http://127.0.0.1:8925/nfl.html", { waitUntil: "load" });
    await p.waitForFunction(() => document.querySelectorAll("#nflUcCards article").length > 0, null, { timeout: 15000 });
    await p.waitForTimeout(120);
    const r = await p.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      hoverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      page: getComputedStyle(document.documentElement).getPropertyValue("--page").trim(),
      surface: getComputedStyle(document.documentElement).getPropertyValue("--surface-1").trim(),
      chip: (() => { const c = document.querySelector(".uc-chip"); const b = c && c.getBoundingClientRect(); return !!b && b.width > 0 && b.height > 0; })(),
      collar: (() => { const c = document.querySelector(".collar svg"); const b = c && c.getBoundingClientRect(); return !!b && b.width > 0; })(),
    }));
    const tag = `nfl@${W} ${theme}`;
    ok(tag + " theme applied", r.theme === theme, r.theme);
    ok(tag + " ramp tokens travel as a pair",
      theme === "dark" ? (r.page === "#161009" && r.surface === "#241c12")
        : (r.page === "#f2ecdf" && r.surface === "#fffdf7"), `${r.page}/${r.surface}`);
    ok(tag + " no sideways scroll", r.hoverflow === false);
    ok(tag + " the under-construction chip renders", r.chip);
    ok(tag + " the collar renders", r.collar);
    await ctx.close();
  }
}

ok("no script errors anywhere", errs.length === 0, errs.join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
