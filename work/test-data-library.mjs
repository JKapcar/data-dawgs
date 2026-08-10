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
  await p.waitForFunction(() => document.querySelectorAll("#libShelves .book[data-book]").length > 0, null, { timeout: 15000 });
  await p.waitForTimeout(400);

  const got = await p.evaluate(() => ({
    /* Stage LS: every book renders OPEN as a two-page spread, so there is no spine to
       click and no single shared open container. What used to be asserted about the spine
       is now asserted about the book itself. */
    books: [...document.querySelectorAll("#libShelves .book[data-book]")].map(s => ({
      id: s.dataset.book, shelf: s.closest(".lib-shelf").dataset.shelf,
      text: s.textContent, pages: s.children.length,
      /* two pages must be SIDE BY SIDE above the collapse width. Count distinct rounded
         tops, never getClientRects().length — a Range yields one rect per text run and that
         mistake stayed green under mutation once already (see stage-ms-spec). */
      pageTops: [...new Set([...s.children].map(c => Math.round(c.getBoundingClientRect().top)))].length,
      readBtn: !!s.querySelector(".lib-read"),
      readTag: (s.querySelector(".lib-read")||{}).tagName,
      readExpanded: (s.querySelector(".lib-read")||{}).getAttribute
        ? s.querySelector(".lib-read").getAttribute("aria-expanded") : null,
      contentsEmpty: (s.querySelector(".lib-contents")||{}).innerHTML === "",
    })),
    volumes: [...document.querySelectorAll("#libShelves .book[data-reading]")].map(s => ({
      id: s.dataset.reading, text: s.textContent,
      hasReadBtn: !!s.querySelector(".lib-read"),
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
    noSpines: document.querySelectorAll(".spine").length,
    liveRegions: document.querySelectorAll("[aria-live]").length,
  }));

  ok("one open book per manifest entry", got.books.length === MANIFEST.length,
    `page ${got.books.length} vs manifest ${MANIFEST.length}`);
  ok("the spines are gone — every book renders open", got.noSpines === 0, String(got.noSpines));
  ok("every book is a two-page spread", got.books.every(s => s.pages === 2));
  ok("the two pages sit side by side above the collapse width",
    got.books.every(s => s.pageTops === 1),
    String(got.books.filter(s => s.pageTops !== 1).length) + " books stacked at 1280");
  ok("every book carries real text, not a painted label",
    got.books.every(s => s.text.trim().length > 4));
  ok("every book offers a real button to read the file itself",
    got.books.every(s => s.readBtn && s.readTag === "BUTTON" && s.readExpanded === "false"));
  ok("the printed count is the manifest's, not a typed number",
    got.count.includes(String(MANIFEST.length)) && got.count.includes("index.json"), got.count);

  /* ⚠️ THE ID MUST BE UNIQUE. bozo-rules.json and bozo-rules.md are two books; a stem-only
     id gave them the same one, which is a duplicate DOM id and a deep link that opens
     whichever the browser found first. Found by looking at the rendered page, not by a
     test — so here is the test. */
  const ids = got.books.map(s => s.id);
  ok("every book id is unique", new Set(ids).size === ids.length,
    ids.filter((x, i) => ids.indexOf(x) !== i).join(","));

  for (const f of MANIFEST) {
    const id = bookId(f.path);
    const s = got.books.find(x => x.id === id);
    ok(`${id}: has an open book`, !!s);
    ok(`${id}: the file it names exists`, fs.existsSync(path.join(ROOT, f.path.replace(/^\//, ""))));
    const want = OWNER[f.path] ? OWNER[f.path][0].domain : "__unclaimed";
    ok(`${id}: shelved under the surface that owns it`, !!s && s.shelf === want, s && s.shelf);
    ok(`${id}: the book names the file, extension and all`, !!s && s.text.includes(f.path.replace("/data/", "")));
  }
  /* the map cannot contain itself; anything ELSE unclaimed is a real gap */
  const unclaimed = got.books.filter(s => s.shelf === "__unclaimed").map(s => s.id);
  ok("only the map itself is unclaimed", unclaimed.join(",") === "surfaces-json", unclaimed.join(","));

  /* ⚠️ NOTHING IS FETCHED UNTIL "READ THE FILE" IS PRESSED. This is the assertion that
     makes 42 simultaneously-open books affordable: the right-hand page is built from the
     manifest the page already holds, and no payload is requested at load. The property is
     unchanged from the spine era; only its trigger moved. */
  const dataReqs = reqs.filter(u => /\/data\//.test(u));
  const bootOnly = ["/data/index.json", "/data/surfaces.json", "/data/upstream-models.json"];
  ok("only the three catalogue files are read at load",
    dataReqs.every(u => bootOnly.some(x => u.endsWith(x))),
    dataReqs.filter(u => !bootOnly.some(x => u.endsWith(x))).join(" "));
  ok("no book has read its file before the button is pressed",
    got.books.every(s => s.contentsEmpty), 
    String(got.books.filter(s => !s.contentsEmpty).length) + " books pre-read");

  /* ---- Stage LS: the volumes shelf, derived from surfaces.json's `reading` key ----
     ⚠️ Asserted against the REGISTRY, never against a name. If a surface gains a `reading`
     entry the page must grow a volume with no edit here, which is the whole reason the key
     exists rather than a typed list of two pages. */
  const READING = sur.flatMap(s => (s.reading || []).map(r => ({ ...r, sid: s.id })));
  ok("one volume per `reading` entry in the registry", got.volumes.length === READING.length,
    `page ${got.volumes.length} vs registry ${READING.length}`);
  ok("the registry actually carries reading entries (guards the assertion above)",
    READING.length > 0, String(READING.length));
  for (const r of READING) {
    const v = got.volumes.find(x => x.id.startsWith(r.sid));
    ok(`volume ${r.sid}: is on the shelf`, !!v);
    ok(`volume ${r.sid}: names the page it points at`, !!v && v.text.includes(r.url));
    /* A page has no envelope to read, so offering "Read the file" would be a lie. */
    ok(`volume ${r.sid}: offers no file to read, because it is not a file`, !!v && !v.hasReadBtn);
  }
  ok("a `reading` url is a page, never a /data/ payload",
    READING.every(r => !r.url.startsWith("/data/")), READING.map(r => r.url).join(" "));
  /* ⚠️ THE REGISTRY BOUNDARY. `reading` was added as a THIRD key precisely so an HTML page
     would never land in a `machine` array, which llms.txt and test-machine-surfaces grade as
     machine-readable. If that ever leaks, this fails. */
  ok("no html page leaked into a `machine` array",
    sur.every(s => (s.machine || []).every(m => !/\.html(\?|#|$)/.test(m.url || ""))),
    sur.flatMap(s => (s.machine || []).filter(m => /\.html/.test(m.url || "")).map(m => m.url)).join(" "));

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
  /* ⚠️ Stage LS dropped this from 4 to 3, and that is a REAL reduction, not a relaxation
     to make a suite pass. The fourth region was #libSpread, the single shared container the
     one-open-book model announced into. Books render open now, so there is nothing to
     announce and no container to announce it from. The three that remain are the three
     counts, and they are still the point: a count that changes silently is the failure this
     assertion exists to catch. Mutation-proved (M6/M7 in work/ls_mutations.py). */
  ok("the page keeps a live region for every count it prints", got.liveRegions === 3, String(got.liveRegions));

  /* ---- read a book: the contents must come from the real file ---- */
  const target = "nfelo-json";
  const before = reqs.length;
  await p.click(`[data-read="${target}"]`);
  await p.waitForFunction(() => document.querySelector("#rd-nfelo-json pre"), null, { timeout: 10000 });
  const opened = await p.evaluate(() => {
    const bk = document.getElementById("book-nfelo-json");
    return {
      left: bk.children[0].textContent,
      right: bk.children[1].textContent,
      pre: bk.querySelector("#rd-nfelo-json pre").textContent,
      expanded: bk.querySelector(".lib-read").getAttribute("aria-expanded"),
      btnLabel: bk.querySelector(".lib-read").textContent.trim(),
      canvases: document.querySelectorAll("canvas").length,
    };
  });
  const nfeloEnv = JSON.parse(fs.readFileSync(path.join(ROOT, "data/nfelo.json"), "utf8"));
  const nfeloEntry = idx.files.find(f => f.path === "/data/nfelo.json");
  ok("reading a book fetches that exact file",
    reqs.slice(before).some(u => u.endsWith("/data/nfelo.json")),
    reqs.slice(before).join(" "));
  ok("the right page reports the file's real as_of", opened.right.includes(nfeloEnv.as_of));
  ok("the right page reports the file's real source", opened.right.includes(nfeloEnv.source.slice(0, 30)));
  ok("the shape comes from the file, naming its real top-level keys",
    Object.keys(nfeloEnv.data).slice(0, 3).every(k => opened.pre.includes(k)),
    opened.pre.slice(0, 120));
  ok("the record page reports the manifest's real sha256",
    opened.right.includes(nfeloEntry.sha256.slice(0, 16)));
  ok("the record page links the surface that owns the file",
    opened.right.includes(OWNER["/data/nfelo.json"][0].name));
  ok("the read control is marked expanded for assistive tech", opened.expanded === "true");
  ok("and it offers the way back", /collapse/i.test(opened.btnLabel), opened.btnLabel);
  ok("nothing was painted", opened.canvases === 0);

  /* ⚠️ A FILE CAN BE CLAIMED BY MORE THAN ONE SURFACE. /data/pound-tools.json is claimed by
     both the DawgHouse shelf and the CFB lab. Last-wins shelved it under whichever row came
     later in the map and then named that one as if it were the only owner — quietly wrong,
     which is the exact failure this page exists to remove. */
  {
    const multi = Object.entries(OWNER).filter(([, v]) => v.length > 1);
    ok("the map really does double-claim at least one file", multi.length > 0);
    for (const [url, rows] of multi) {
      const rec = await p.evaluate(id => {
        const bk = document.getElementById("book-" + id);
        return bk ? bk.children[1].textContent : null;
      }, bookId(url));
      ok(`${bookId(url)}: the book names every surface that claims it`,
        !!rec && rows.every(r => rec.includes(r.name)), rows.map(r => r.name).join(" / "));
      ok(`${bookId(url)}: and says "surfaces", plural`, !!rec && /SURFACES/i.test(rec));
    }
  }

  /* a file too large to open says so instead of showing less quietly */
  const bigEntry = idx.files.find(f => f.bytes > 250000);
  const bigId = bookId(bigEntry.path);
  const beforeBig = reqs.length;
  await p.click(`[data-read="${bigId}"]`);
  await p.waitForFunction(id => /Not opened here/.test(document.getElementById("rd-" + id).textContent), bigId, { timeout: 8000 }).catch(() => { });
  const bigOpen = await p.evaluate(id => document.getElementById("rd-" + id).textContent, bigId);
  ok("a file too large to open refuses out loud", /Not opened here/.test(bigOpen));
  ok("and is not fetched anyway", !reqs.slice(beforeBig).some(u => u.endsWith(bigEntry.path)),
    bigEntry.path);

  /* collapsing. ⚠️ Stage LS: there is no "close the book" any more, because the book never
     shut. What collapses is the fetched contents, and focus must come back to the control
     that was pressed — the same accessibility property the old close button carried. */
  /* ⚠️ VACUITY. Clicking a button focuses it, so asserting "focus returned to the button"
     after a CLICK passes whether or not the page manages focus at all — removing the
     focus() call left this green. Move focus away first and trigger the collapse
     programmatically, which is also the real path for an assistive-tech or scripted
     activation. Now the assertion can fail, and the mutation proves it does. */
  await p.evaluate(id => {
    document.getElementById("libCount").setAttribute("tabindex", "-1");
    document.getElementById("libCount").focus();
    document.querySelector(`[data-read="${id}"]`).click();
  }, bigId);
  await p.waitForTimeout(200);
  const closed = await p.evaluate(id => ({
    empty: document.getElementById("rd-" + id).innerHTML.trim() === "",
    anyExpanded: document.querySelectorAll('.lib-read[aria-expanded="true"]').length,
    focused: document.activeElement.dataset ? document.activeElement.dataset.read : null,
    stillOpen: !!document.getElementById("book-" + id),
    label: document.querySelector(`[data-read="${id}"]`).textContent.trim(),
  }), bigId);
  ok("collapsing empties the contents", closed.empty);
  ok("the BOOK stays open when its contents collapse", closed.stillOpen);
  ok("collapsing returns focus to the control that was pressed", closed.focused === bigId, String(closed.focused));
  ok("and the control offers to read it again", /read the file/i.test(closed.label), closed.label);
  ok("only the books actually read are marked expanded",
    closed.anyExpanded === 1, String(closed.anyExpanded));

  /* ⚠️ a hash-only navigation does NOT reload the document. This is the same-document
     case that broke every 1b forward; goto with a new hash on a loaded page is exactly it. */
  await p.goto("http://127.0.0.1:8923/data.html#book-receipts-json", { waitUntil: "commit" });
  await p.waitForFunction(() => document.querySelector("#libSpread h3"), null, { timeout: 8000 }).catch(() => { });
  const viaHash = await p.evaluate(() => ({
    /* ⚠️ Stage LS: #book-<id> no longer OPENS anything, because every book is already open.
       An old deep link must still land the reader on the right book, so it now scrolls to it
       and marks it. A link that silently does nothing is worse than one that 404s. */
    heading: document.querySelector("#book-receipts-json h4")
      ? document.querySelector("#book-receipts-json h4").textContent.trim() : null,
    marked: !!document.querySelector("#book-receipts-json.lib-hit"),
    onlyOne: document.querySelectorAll(".book.lib-hit").length,
  }));
  ok("a hash-only navigation still finds the book it names", viaHash.heading === "receipts.json", viaHash.heading);
  ok("and marks it so the reader can see where they landed", viaHash.marked);
  ok("and marks exactly one", viaHash.onlyOne === 1, String(viaHash.onlyOne));

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
    books: document.querySelectorAll(".book").length,
    count: document.getElementById("libCount").textContent,
    refErr: !!document.querySelector("#refBooks .p-error"),
  }));
  ok("an unreadable manifest produces a stated failure", d.err && d.books === 0);
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
    await p.waitForFunction(() => document.querySelectorAll("#libShelves .book[data-book]").length > 0, null, { timeout: 15000 });
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
    await p.click('[data-read="pool-json"]');
    await p.waitForFunction(() => document.querySelector("#rd-pool-json pre"), null, { timeout: 10000 }).catch(() => { });
    const open = await p.evaluate(() => ({
      hoverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      wide: (() => { const s = document.querySelector(".book"); return s ? s.getBoundingClientRect().width > document.documentElement.clientWidth + 1 : false; })(),
      /* ⚠️ Kap asked for one page below ~480px. Count DISTINCT ROUNDED TOPS of the two
         pages, never getClientRects().length — that mistake stayed green under mutation on
         Stage MS-A. Two tops means stacked; one means side by side. */
      pageTops: (() => { const s = document.querySelector(".book"); return s
        ? [...new Set([...s.children].map(c => Math.round(c.getBoundingClientRect().top)))].length : 0; })(),
    }));
    ok(tag + " no sideways scroll with a book READ", open.hoverflow === false);
    ok(tag + " the book fits the column", open.wide === false);
    ok(tag + (W <= 480 ? " the spread collapses to one page" : " the spread keeps two pages side by side"),
      W <= 480 ? open.pageTops === 2 : open.pageTops === 1, `${open.pageTops} row(s) at ${W}`);
    await ctx.close();
  }
}

ok("no script errors anywhere", errs.length === 0, errs.join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
