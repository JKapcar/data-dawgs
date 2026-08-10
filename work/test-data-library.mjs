/* data.html — the Library (CEP-5A Stage 5).

   What this suite is actually defending:

   1. THE SHELF IS THE MANIFEST. Book count equals /data/index.json (files + markdown),
      every spine's path resolves to a file that exists, and each book is shelved by the
      domain of the surface that owns it. A hand-written shelf drifts within a month and
      then advertises a dataset validate-data has never heard of.
   2. THE RIGHT-HAND PAGE SHOWS REAL DATA OR NOTHING. It renders the envelope and shape
      read from the file itself. There is no canvas, no chart and no number that did not
      come out of the file — a picture of numbers is not something a reader can check.
   3. REFERENCE BOOKS LINK OUT AND NOTHING ELSE. Every source the provenance file records
      as not integrated appears, links to its own host, and NO REQUEST LEAVES THE PAGE FOR
      THAT HOST. ETR above all: their content is a paid subscription and is not ours to
      mirror, proxy or cache.
   4. NOTHING LOADS UNTIL A BOOK IS OPENED. A hidden element's rect is 0x0 at the document
      origin, so any "near the viewport" test fires on load; this page has none, and the
      suite proves the file requests happen on click and not before.
   5. THE UNDER-CONSTRUCTION COMPONENT IS ARENA'S, BYTE FOR BYTE. Stage 4 built it once. A
      second hand-written copy is a fork waiting to happen.
   6. Both themes, no overflow at 320/390/1280 WITH A BOOK OPEN AS WELL AS CLOSED, and the
      deep link works on a hash-only navigation (which does not reload the document).

   Run:  cd work && node test-data-library.mjs
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
const errs = [];

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data/index.json"), "utf8")).data;
const sur = JSON.parse(fs.readFileSync(path.join(ROOT, "data/surfaces.json"), "utf8")).data;
const up = JSON.parse(fs.readFileSync(path.join(ROOT, "data/upstream-models.json"), "utf8")).data;
const html = fs.readFileSync(path.join(ROOT, "data.html"), "utf8");
const arena = fs.readFileSync(path.join(ROOT, "arena.html"), "utf8");

const MANIFEST = [].concat(idx.files, idx.markdown || []);
const REF = up.filter(r => r.integration_mode === "pending" || r.integration_mode === "reference-only");
const PLAN = sur.flatMap(r => (r.planned || []).filter(p => /^(json|rest):/.test(p)).map(p => [r.id, p]));
const OWNER = {};                       // url -> EVERY surface that claims it, in map order
for (const r of sur) for (const m of (r.machine || [])) if (m.url) (OWNER[m.url] = OWNER[m.url] || []).push(r);
const bookId = p => p.replace(/^\/data\//, "").replace(/\./g, "-");

/* ------------------------------------------------------- source-level ---- */
{
  ok("the manifest has books to shelve", MANIFEST.length > 10, String(MANIFEST.length));
  ok("the hub claims no surface of its own",
    !sur.some(r => r.id === "data-hub" || r.page === "/data.html"));
  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  ok("the page's own tier chip is Pup", !!chip && chip[1].trim() === "Pup", chip && chip[1]);
  ok("no book list is typed into the page",
    !/data-book="(pool|receipts|nfelo|cfb-teams)"/.test(html) && /idx\.data\.files\.map/.test(html));

  /* the component is arena's, not a second copy that will drift */
  const cut = s => {
    const i = s.indexOf("/* CEP-5A Stage 4 — THE REUSABLE UNDER-CONSTRUCTION TREATMENT.");
    const j = s.indexOf("\n/* Tier chips rendered FROM surfaces.json", i);
    return i < 0 ? null : (j < 0 ? s.slice(i, i + 1400) : s.slice(i, j));
  };
  const a = cut(arena), d = html.indexOf("/* CEP-5A Stage 4 — THE REUSABLE UNDER-CONSTRUCTION TREATMENT.");
  ok("data.html carries arena's under-construction component", d >= 0 && !!a && html.includes(a),
    "the two copies have diverged");

  ok("the library paints nothing: no canvas anywhere in the page body",
    !/<canvas/i.test(html.slice(html.indexOf("<main>"))));
  /* ⚠️ a reference host must come out of the data, never out of the markup */
  ok("no reference host is hardcoded in the page", !/establishtherun|greerreNFL\/wepa/.test(html));
  ok("outbound reference links are marked external",
    /rel="noopener noreferrer external"/.test(html));

  ok("ETR is recorded in the provenance file as reference-only",
    up.some(r => r.id === "etr" && r.integration_mode === "reference-only" && !r.repository));
  ok("every source we do not integrate is a reference book",
    REF.length >= 8 && REF.some(r => r.id === "etr") && REF.some(r => r.id === "wepa")
    && REF.some(r => r.id === "nfeloqb") && REF.some(r => r.id === "nfelosrs"), String(REF.length));

  ok("data.html is cached for draft night",
    fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes('"/data.html"'));
  ok("data.html is findable by crawlers",
    fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8").includes("/data.html"));
}

/* ------------------------------------------------------------- render ---- */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("render: " + e.message));
  /* every request the page makes, so "nothing loads until a book is opened" and "no
     reference host is contacted" are measured, not asserted from the source */
  const reqs = [];
  p.on("request", r => reqs.push(r.url()));
  await p.goto("http://127.0.0.1:8923/data.html", { waitUntil: "load" });
  await p.waitForFunction(() => document.querySelectorAll("#libShelves .spine").length > 0, null, { timeout: 15000 });
  await p.waitForTimeout(400);

  const got = await p.evaluate(() => ({
    spines: [...document.querySelectorAll("#libShelves .spine")].map(s => ({
      id: s.dataset.book, shelf: s.closest(".lib-shelf").dataset.shelf,
      text: s.textContent, tag: s.tagName, expanded: s.getAttribute("aria-expanded"),
    })),
    shelves: [...document.querySelectorAll(".lib-shelf")].map(s => s.dataset.shelf),
    count: document.getElementById("libCount").textContent,
    ref: [...document.querySelectorAll("#refBooks article")].map(a => ({
      id: a.dataset.ref, mode: a.dataset.integration,
      hrefs: [...a.querySelectorAll("a")].map(x => x.href), rels: [...a.querySelectorAll("a")].map(x => x.rel),
    })),
    refCount: document.getElementById("refCount").textContent,
    plan: [...document.querySelectorAll("#planBooks article")].map(a => ({
      status: a.dataset.status, planned: a.dataset.planned,
      controls: a.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex],[onclick],form').length,
      chip: !!a.querySelector(".uc-chip"), art: !!a.querySelector(".uc-art"),
      heading: a.querySelector("h3").textContent.trim(),
    })),
    spreadEmpty: document.getElementById("libSpread").innerHTML.trim() === "",
    liveRegions: document.querySelectorAll("[aria-live]").length,
  }));

  ok("one spine per manifest entry", got.spines.length === MANIFEST.length,
    `page ${got.spines.length} vs manifest ${MANIFEST.length}`);
  ok("spines are real buttons, so they tab and take Enter for free",
    got.spines.every(s => s.tag === "BUTTON"));
  ok("every spine carries real text, not a painted label",
    got.spines.every(s => s.text.trim().length > 4));
  ok("the printed count is the manifest's, not a typed number",
    got.count.includes(String(MANIFEST.length)) && got.count.includes("index.json"), got.count);

  /* ⚠️ THE ID MUST BE UNIQUE. bozo-rules.json and bozo-rules.md are two books; a stem-only
     id gave them the same one, which is a duplicate DOM id and a deep link that opens
     whichever the browser found first. Found by looking at the rendered page, not by a
     test — so here is the test. */
  const ids = got.spines.map(s => s.id);
  ok("every book id is unique", new Set(ids).size === ids.length,
    ids.filter((x, i) => ids.indexOf(x) !== i).join(","));

  for (const f of MANIFEST) {
    const id = bookId(f.path);
    const s = got.spines.find(x => x.id === id);
    ok(`${id}: has a spine`, !!s);
    ok(`${id}: the file it names exists`, fs.existsSync(path.join(ROOT, f.path.replace(/^\//, ""))));
    const want = OWNER[f.path] ? OWNER[f.path][0].domain : "__unclaimed";
    ok(`${id}: shelved under the surface that owns it`, !!s && s.shelf === want, s && s.shelf);
    ok(`${id}: the spine names the file, extension and all`, !!s && s.text.includes(f.path.replace("/data/", "")));
  }
  /* the map cannot contain itself; anything ELSE unclaimed is a real gap */
  const unclaimed = got.spines.filter(s => s.shelf === "__unclaimed").map(s => s.id);
  ok("only the map itself is unclaimed", unclaimed.join(",") === "surfaces-json", unclaimed.join(","));

  /* ⚠️ nothing is fetched until a book is opened */
  const dataReqs = reqs.filter(u => /\/data\//.test(u));
  const bootOnly = ["/data/index.json", "/data/surfaces.json", "/data/upstream-models.json"];
  ok("only the three catalogue files are read at load",
    dataReqs.every(u => bootOnly.some(x => u.endsWith(x))),
    dataReqs.filter(u => !bootOnly.some(x => u.endsWith(x))).join(" "));
  ok("no book is open before one is clicked", got.spreadEmpty);

  /* reference books */
  ok("one reference book per unintegrated source", got.ref.length === REF.length,
    `page ${got.ref.length} vs file ${REF.length}`);
  ok("reference books name the file's ids", got.ref.every(r => REF.some(x => x.id === r.id)));
  ok("every reference link is external and rel-guarded",
    got.ref.every(r => r.hrefs.length > 0 && r.rels.every(x => /external/.test(x) && /noopener/.test(x))));
  ok("no request left the page for a reference host",
    !reqs.some(u => /establishtherun|github\.com/i.test(u)),
    reqs.filter(u => /establishtherun|github\.com/i.test(u)).join(" "));
  ok("the reference count says what it means", /none republished/.test(got.refCount), got.refCount);

  /* planned data surfaces */
  ok("one under-construction card per planned data surface", got.plan.length === PLAN.length,
    `page ${got.plan.length} vs file ${PLAN.length}`);
  ok("every planned card is machine-readable as under construction",
    got.plan.length > 0 && got.plan.every(x => x.status === "under-construction" && x.chip && x.art));
  ok("no planned card exposes a control that looks like it works",
    got.plan.every(x => x.controls === 0),
    got.plan.filter(x => x.controls).map(x => x.planned).join(" "));
  ok("a planned card is headed by the surface that does not exist",
    got.plan.every(x => x.heading === x.planned), got.plan.map(x => x.heading).join(" | "));
  ok("the page keeps live regions for the counts", got.liveRegions >= 4, String(got.liveRegions));

  /* ---- open a book: the right-hand page must be the real file ---- */
  const target = "nfelo-json";
  const before = reqs.length;
  await p.click(`#sp-${target}`);
  await p.waitForFunction(() => document.querySelector("#libSpread pre"), null, { timeout: 10000 });
  const opened = await p.evaluate(() => ({
    heading: document.querySelector("#libSpread h3").textContent.trim(),
    left: document.querySelector("#libSpread .lib-page").textContent,
    right: document.querySelectorAll("#libSpread .lib-page")[1].textContent,
    pre: document.querySelector("#libSpread pre").textContent,
    expanded: document.querySelector(`#sp-nfelo-json`).getAttribute("aria-expanded"),
    hash: location.hash,
    canvases: document.querySelectorAll("canvas").length,
  }));
  const nfeloEnv = JSON.parse(fs.readFileSync(path.join(ROOT, "data/nfelo.json"), "utf8"));
  const nfeloEntry = idx.files.find(f => f.path === "/data/nfelo.json");
  ok("opening a book fetches that exact file",
    reqs.slice(before).some(u => u.endsWith("/data/nfelo.json")),
    reqs.slice(before).join(" "));
  ok("the right page reports the file's real as_of", opened.right.includes(nfeloEnv.as_of));
  ok("the right page reports the file's real source", opened.right.includes(nfeloEnv.source.slice(0, 30)));
  ok("the shape comes from the file, naming its real top-level keys",
    Object.keys(nfeloEnv.data).slice(0, 3).every(k => opened.pre.includes(k)),
    opened.pre.slice(0, 120));
  ok("the left page reports the manifest's real sha256",
    opened.left.includes(nfeloEntry.sha256.slice(0, 32)));
  ok("the left page links the surface that owns the file",
    opened.left.includes(OWNER["/data/nfelo.json"][0].name));
  ok("the open spine is marked expanded for assistive tech", opened.expanded === "true");
  ok("opening a book deep-links it", opened.hash === "#book-nfelo-json", opened.hash);
  ok("nothing was painted", opened.canvases === 0);

  /* ⚠️ A FILE CAN BE CLAIMED BY MORE THAN ONE SURFACE. /data/pound-tools.json is claimed by
     both the DawgHouse shelf and the CFB lab. Last-wins shelved it under whichever row came
     later in the map and then named that one as if it were the only owner — quietly wrong,
     which is the exact failure this page exists to remove. */
  {
    const multi = Object.entries(OWNER).filter(([, v]) => v.length > 1);
    ok("the map really does double-claim at least one file", multi.length > 0);
    for (const [url, rows] of multi) {
      await p.click(`#sp-${bookId(url)}`);
      await p.waitForFunction(() => document.querySelector("#libSpread .lib-page"), null, { timeout: 8000 });
      const left = await p.evaluate(() => document.querySelector("#libSpread .lib-page").textContent);
      ok(`${bookId(url)}: the book names every surface that claims it`,
        rows.every(r => left.includes(r.name)), rows.map(r => r.name).join(" / "));
      ok(`${bookId(url)}: and says "surfaces", plural`, /SURFACES/i.test(left));
    }
  }

  /* a file too large to open says so instead of showing less quietly */
  const bigEntry = idx.files.find(f => f.bytes > 250000);
  const bigId = bookId(bigEntry.path);
  const beforeBig = reqs.length;
  await p.click(`#sp-${bigId}`);
  await p.waitForFunction(id => /Not opened here/.test(document.getElementById("libSpread").textContent), null, { timeout: 8000 }).catch(() => { });
  const bigOpen = await p.evaluate(() => document.getElementById("libSpread").textContent);
  ok("a file too large to open refuses out loud", /Not opened here/.test(bigOpen));
  ok("and is not fetched anyway", !reqs.slice(beforeBig).some(u => u.endsWith(bigEntry.path)),
    bigEntry.path);

  /* closing */
  await p.click("#libClose");
  await p.waitForTimeout(200);
  const closed = await p.evaluate(() => ({
    empty: document.getElementById("libSpread").innerHTML.trim() === "",
    anyExpanded: document.querySelectorAll('.spine[aria-expanded="true"]').length,
    focused: document.activeElement.dataset ? document.activeElement.dataset.book : null,
  }));
  ok("closing a book empties the spread", closed.empty);
  ok("closing a book un-expands every spine", closed.anyExpanded === 0);
  ok("closing a book returns focus to its spine", closed.focused === bigId, closed.focused);

  /* ⚠️ a hash-only navigation does NOT reload the document. This is the same-document
     case that broke every 1b forward; goto with a new hash on a loaded page is exactly it. */
  await p.goto("http://127.0.0.1:8923/data.html#book-receipts-json", { waitUntil: "commit" });
  await p.waitForFunction(() => document.querySelector("#libSpread h3"), null, { timeout: 8000 }).catch(() => { });
  const viaHash = await p.evaluate(() => ({
    heading: document.querySelector("#libSpread h3") ? document.querySelector("#libSpread h3").textContent.trim() : null,
    expanded: document.querySelector("#sp-receipts-json") ? document.querySelector("#sp-receipts-json").getAttribute("aria-expanded") : null,
  }));
  ok("a hash-only navigation opens the book it names", viaHash.heading === "receipts.json", viaHash.heading);
  ok("and marks that spine expanded", viaHash.expanded === "true");

  await ctx.close();
}

/* ------------------------- degraded: the manifest cannot be read ---------- */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("degraded: " + e.message));
  await p.route("**/data/index.json", r => r.fulfill({ status: 500, contentType: "text/plain", body: "no" }));
  await p.goto("http://127.0.0.1:8923/data.html", { waitUntil: "load" });
  await p.waitForFunction(() => !document.querySelector("#libShelves .p-loading"), null, { timeout: 8000 }).catch(() => { });
  const d = await p.evaluate(() => ({
    err: !!document.querySelector("#libShelves .p-error"),
    spines: document.querySelectorAll(".spine").length,
    count: document.getElementById("libCount").textContent,
    refErr: !!document.querySelector("#refBooks .p-error"),
  }));
  ok("an unreadable manifest produces a stated failure", d.err && d.spines === 0);
  ok("the count says unavailable rather than zero", /unavailable/i.test(d.count), d.count);
  ok("the reference shelf fails with it rather than looking complete", d.refErr);
  await ctx.close();
}

/* ------------------------------------------- themes, widths, overflow ---- */
for (const W of [1280, 390, 320]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(`${theme}@${W}: ${e.message}`));
    await p.addInitScript(t => { try { localStorage.setItem("dd-theme2", t); localStorage.setItem("dd-theme", t); } catch (e) { } }, theme);
    await p.goto("http://127.0.0.1:8923/data.html", { waitUntil: "load" });
    await p.waitForFunction(() => document.querySelectorAll("#libShelves .spine").length > 0, null, { timeout: 15000 });
    await p.waitForTimeout(150);
    const tag = `library@${W} ${theme}`;
    const shut = await p.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      hoverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      page: getComputedStyle(document.documentElement).getPropertyValue("--page").trim(),
      surface: getComputedStyle(document.documentElement).getPropertyValue("--surface-1").trim(),
    }));
    ok(tag + " theme applied", shut.theme === theme, shut.theme);
    ok(tag + " ramp tokens travel as a pair",
      theme === "dark" ? (shut.page === "#161009" && shut.surface === "#241c12")
        : (shut.page === "#f2ecdf" && shut.surface === "#fffdf7"), `${shut.page}/${shut.surface}`);
    ok(tag + " no sideways scroll with the shelves closed", shut.hoverflow === false);

    /* ⚠️ A CLOSED panel cannot overflow the document, so measuring only the closed state
       passes vacuously. Open the widest book — the one with the longest note — and measure
       again. That is what caught .cfbt-grid on Stage 3. */
    await p.click("#sp-pool-json");
    await p.waitForFunction(() => document.querySelector("#libSpread pre"), null, { timeout: 10000 }).catch(() => { });
    const open = await p.evaluate(() => ({
      hoverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      spreadWide: (() => { const s = document.querySelector(".spread"); return s ? s.getBoundingClientRect().width > document.documentElement.clientWidth + 1 : false; })(),
    }));
    ok(tag + " no sideways scroll with a book OPEN", open.hoverflow === false);
    ok(tag + " the open spread fits the column", open.spreadWide === false);
    await ctx.close();
  }
}

ok("no script errors anywhere", errs.length === 0, errs.join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
