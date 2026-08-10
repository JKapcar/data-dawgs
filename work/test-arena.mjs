/* arena.html — the competition hub (CEP-5A Stage 4).

   What this suite is actually defending:

   1. THE CARD SET IS COMPUTED, NOT TYPED. Every card corresponds to a
      /data/surfaces.json row with domain "arena", and the count the page prints is the
      file's. A hub with a hand-written list drifts within a month and then claims a
      surface the validator has never heard of — the same failure test-pound-contracts.js
      defends against on the CFB cards.
   2. THE HUB CLAIMS NOTHING OF ITS OWN. arena.html is a directory over surfaces that
      already exist, so surfaces.json must have NO arena row, and the page's own chip is
      Pup — a hub is not a graded tool and must never pick up a collar.
   3. UNDER-CONSTRUCTION CARDS HAVE NO WORKING-LOOKING CONTROL. Kap's line, 2026-08-09:
      a card that SAYS it is not built is honest; a live-looking control that silently
      fails is not. Zero interactive elements inside a .uc card, enforced by query.
   4. IT FAILS LOUD. Serve a surfaces map with the arena rows removed and the page must
      say so where the cards would be. An empty grid reads as "there are no games",
      which is a different and false claim.
   5. THE COLLAR IS BACKED. tier "dawg" renders as a glyph with an accessible name, and
      the criteria it stands for are written into /data/receipts-method.md. A symbol
      with no published criteria is an unbacked claim.
   6. No sideways overflow at 320/390/1280, both themes, no script errors.

   Run:  cd work && node test-arena.mjs
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
await new Promise(r => server.listen(8921, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const errs = [];

/* the truth the page must agree with, read from the file rather than from the page */
const surfaces = JSON.parse(fs.readFileSync(path.join(ROOT, "data/surfaces.json"), "utf8"));
const ARENA = surfaces.data.filter(r => r.domain === "arena");
const PLANNED = ARENA.flatMap(r => (r.planned || []).map(p => [r.id, p]));
const html = fs.readFileSync(path.join(ROOT, "arena.html"), "utf8");

/* ------------------------------------------------------- source-level ---- */
{
  ok("the map actually has arena rows to render", ARENA.length > 0, `${ARENA.length}`);
  ok("the hub claims no surface of its own",
    !surfaces.data.some(r => r.id === "arena" || r.page === "/arena.html"));
  /* A hub is a directory, not a graded tool. tierOf() reads this chip, so a stray
     "Dawg" here would promote a page that has never been graded. */
  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  ok("the page's own tier chip is Pup", !!chip && chip[1].trim() === "Pup", chip && chip[1]);
  ok("no card list is typed into the page",
    !/data-surface="(bozo|dfs|guillotine|survivor|live-draft)"/.test(html.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("the under-construction component is defined once and only here",
    (html.match(/\.uc-chip\{/g) || []).length === 1 && (html.match(/\.uc-art\{/g) || []).length === 1);
  ok("the artwork costs no request: no <img>, no canvas, no url() in the component",
    !/\.uc-art\{[^}]*url\(/.test(html) && !/<canvas/i.test(html.slice(html.indexOf("<main>"))));
  /* the collar is a claim; the criteria for it have to be published somewhere */
  const method = fs.readFileSync(path.join(ROOT, "data/receipts-method.md"), "utf8");
  ok("the collar's criteria are written into receipts-method.md",
    /collar/i.test(method) && /## Tiers and the collar/.test(method));
  ok("the collar is recorded as a material change",
    /Material changes/.test(method) && /2026-08-09 — .*collar/i.test(method));
  ok("arena.html is cached for draft night",
    fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes('"/arena.html"'));
  ok("arena.html is findable by crawlers",
    fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8").includes("/arena.html"));
}

/* ------------------------------------------------------------- render ---- */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("render: " + e.message));
  await p.goto("http://127.0.0.1:8921/arena.html", { waitUntil: "load" });
  await p.waitForFunction(() => document.querySelectorAll("#arenaCards .tool").length > 0, null, { timeout: 15000 });

  const got = await p.evaluate(() => ({
    cards: [...document.querySelectorAll("#arenaCards .tool")].map(a => ({
      id: a.dataset.surface,
      tier: a.dataset.tier,
      href: a.querySelector("h3 a") ? a.querySelector("h3 a").getAttribute("href") : null,
      collar: !!a.querySelector(".collar[aria-label]"),
      collarName: a.querySelector(".collar[aria-label]") ? a.querySelector(".collar[aria-label]").getAttribute("aria-label") : null,
      chipText: a.querySelector(".status") ? a.querySelector(".status").textContent.trim() : null,
      text: a.textContent,
    })),
    count: document.getElementById("arenaCount").textContent,
    countLive: document.getElementById("arenaCount").getAttribute("aria-live"),
    uc: [...document.querySelectorAll("#ucCards article")].map(a => ({
      status: a.dataset.status,
      surface: a.dataset.surface,
      planned: a.dataset.planned,
      chip: !!a.querySelector(".uc-chip"),
      art: !!a.querySelector(".uc-art"),
      controls: a.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex],[onclick],form,summary').length,
      classed: a.classList.contains("uc"),
      heading: a.querySelector("h3") ? a.querySelector("h3").textContent.trim() : null,
      text: a.textContent,
    })),
    ucCount: document.getElementById("ucCards").querySelectorAll("article").length,
    ucLabel: document.getElementById("ucCount").textContent,
    liveRegions: document.querySelectorAll("[aria-live]").length,
  }));

  ok("one card per arena row in the map", got.cards.length === ARENA.length,
    `page ${got.cards.length} vs file ${ARENA.length}`);
  ok("card ids are exactly the map's arena ids, in the map's order",
    got.cards.map(c => c.id).join(",") === ARENA.map(r => r.id).join(","),
    got.cards.map(c => c.id).join(","));
  ok("the printed count is the file's count, not a typed number",
    got.count.includes(String(ARENA.length)) && got.count.includes("surfaces.json"), got.count);
  ok("the count announces itself", got.countLive === "polite");

  for (const row of ARENA) {
    const c = got.cards.find(x => x.id === row.id);
    ok(`${row.id}: card links its real page`, !!c && c.href === row.page, c && c.href);
    const file = path.join(ROOT, (c && c.href || "").replace(/^\//, "").split("#")[0]);
    ok(`${row.id}: that page exists in the repo`, fs.existsSync(file));
    ok(`${row.id}: card carries the map's tier`, !!c && c.tier === row.tier, c && c.tier);
    if (row.tier === "dawg") {
      ok(`${row.id}: tier dawg renders as a collar, not the word`,
        !!c && c.collar && /collar/i.test(c.collarName || "") && c.chipText === null, c && c.chipText);
    } else {
      ok(`${row.id}: tier ${row.tier} stays a text chip`, !!c && !c.collar && !!c.chipText, c && c.chipText);
    }
    if (row.gap) ok(`${row.id}: the known gap travels with the card`, c.text.includes(row.gap.slice(0, 40)));
  }

  /* the surfaces the map calls planned, and no others */
  ok("one under-construction card per planned surface", got.ucCount === PLANNED.length,
    `page ${got.ucCount} vs file ${PLANNED.length}`);
  ok("each under-construction card names a real planned entry",
    got.uc.every(u => PLANNED.some(([id, pl]) => id === u.surface && pl === u.planned)));
  ok("every under-construction card is machine-readable as such",
    got.uc.length > 0 && got.uc.every(u => u.status === "under-construction" && u.classed));
  ok("every under-construction card shows the chip and the artwork",
    got.uc.every(u => u.chip && u.art));
  /* ⚠️ Understating is a defect too. Headed by the row name, the card for
     rest:/api/draft reads as "the live auction is under construction" — the page is
     live and only the extra surface is not. The heading must name the missing thing. */
  ok("an under-construction card is headed by the surface that does not exist",
    got.uc.every(u => u.heading === u.planned),
    got.uc.map(u => u.heading).join(" | "));
  ok("a card whose page is already live says so",
    got.uc.filter(u => ARENA.find(r => r.id === u.surface).machine.some(m => m.status === "live"))
      .every(u => /already live/.test(u.text)));
  /* the load-bearing one */
  ok("no under-construction card exposes a control that looks like it works",
    got.uc.every(u => u.controls === 0),
    got.uc.filter(u => u.controls).map(u => u.planned + ":" + u.controls).join(" "));
  ok("the planned count is stated too", got.ucLabel.includes(String(PLANNED.length)), got.ucLabel);
  /* dawghouse.html lost its last live region when the calculators moved out; assert a
     count here so the same extraction cannot silence this page later */
  ok("the page keeps at least two live regions", got.liveRegions >= 2, String(got.liveRegions));

  await ctx.close();
}

/* --------------------------------------------------------- fails loud ---- */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("degraded: " + e.message));
  /* the map is served with every arena row removed — the page must SAY the directory is
     unavailable, not render an empty grid that reads as "there are no games" */
  await p.route("**/data/surfaces.json", route => {
    const env = JSON.parse(fs.readFileSync(path.join(ROOT, "data/surfaces.json"), "utf8"));
    env.data = env.data.filter(r => r.domain !== "arena");
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(env) });
  });
  await p.goto("http://127.0.0.1:8921/arena.html", { waitUntil: "load" });
  /* ⚠️ Do NOT let a hang be the failure. A page that renders an EMPTY grid here never
     satisfies a waitForFunction, and the suite dies with a TimeoutError instead of
     naming the defect. Settle, then assert on what is actually on the page. */
  await p.waitForFunction(() => document.getElementById("arenaCards").innerHTML !== "" &&
    !document.querySelector("#arenaCards .p-loading"), null, { timeout: 8000 }).catch(() => { });
  const degraded = await p.evaluate(() => ({
    err: !!document.querySelector("#arenaCards .p-error"),
    cards: document.querySelectorAll("#arenaCards .tool").length,
    ucErr: !!document.querySelector("#ucCards .p-error"),
    count: document.getElementById("arenaCount").textContent,
  }));
  ok("a map with no arena rows produces a stated failure", degraded.err && degraded.cards === 0);
  ok("the planned section fails with it rather than looking complete", degraded.ucErr);
  ok("the count says unavailable rather than zero", /unavailable/i.test(degraded.count), degraded.count);
  await ctx.close();
}

/* ------------------------------------------- themes, widths, overflow ---- */
for (const W of [1280, 390, 320]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(`${theme}@${W}: ${e.message}`));
    /* ⚠️ Force the theme through the persistent controller, the way the real button
       does. Setting data-theme directly is not a user-reachable state and the stored
       preference wins on the next render. */
    await p.addInitScript(t => { try { localStorage.setItem("dd-theme2", t); localStorage.setItem("dd-theme", t); } catch (e) { } }, theme);
    await p.goto("http://127.0.0.1:8921/arena.html", { waitUntil: "load" });
    await p.waitForFunction(() => document.querySelectorAll("#arenaCards .tool").length > 0, null, { timeout: 15000 });
    await p.waitForTimeout(120);
    const r = await p.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      hoverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      page: getComputedStyle(document.documentElement).getPropertyValue("--page").trim(),
      surface: getComputedStyle(document.documentElement).getPropertyValue("--surface-1").trim(),
      chipVisible: (() => { const c = document.querySelector(".uc-chip"); if (!c) return false; const b = c.getBoundingClientRect(); return b.width > 0 && b.height > 0; })(),
      artVisible: (() => { const a = document.querySelector(".uc-art"); if (!a) return false; const b = a.getBoundingClientRect(); return b.width > 0 && b.height > 0; })(),
    }));
    const tag = `arena@${W} ${theme}`;
    ok(tag + " theme applied", r.theme === theme, r.theme);
    ok(tag + " ramp tokens travel as a pair",
      theme === "dark" ? (r.page === "#161009" && r.surface === "#241c12")
        : (r.page === "#f2ecdf" && r.surface === "#fffdf7"), `${r.page}/${r.surface}`);
    ok(tag + " no sideways scroll", r.hoverflow === false);
    ok(tag + " the under-construction chip and artwork render", r.chipVisible && r.artVisible);
    await ctx.close();
  }
}

ok("no script errors anywhere", errs.length === 0, errs.join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
