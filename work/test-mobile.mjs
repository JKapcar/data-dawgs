/* The phone pass: the draft board as cards, and the cliff chart fitting the screen.

   The bug this suite exists to catch is not "it looks bad" — it is that the board
   rendered 895px wide inside a 390px phone AND the dashboard embeds it in an iframe
   with scrolling="no", so the other nine columns were not awkward, they were
   unreachable. A screenshot of the top of the page looked fine. So: measure the row,
   measure it INSIDE the iframe, and assert the desktop table is untouched.

   Run:  cd work && node test-mobile.mjs      (serves ../ on :8913)
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTABLE = chromiumExecutable(chromium);
const SHOTS = process.env.DD_TEST_ARTIFACTS || path.join(ROOT, "work");
fs.mkdirSync(SHOTS, {recursive:true});
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8913, r));

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
const errors = [];
const U = "http://127.0.0.1:8913/";

/* ---------------------------------------------- the board as cards, 390 and 360 */
for (const W of [390, 360]) {
  console.log(`\nboard at ${W}px`);
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(W + ": " + e.message));
  await p.goto(U + "board.html?embed=1", { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1200);

  const m = await p.evaluate(() => {
    const rows = [...document.querySelectorAll("#board tbody tr")];
    const r0 = rows[0].getBoundingClientRect();
    const cell = c => {
      const td = rows[0].querySelector(`td[data-c=${c}]`);
      const b = td.getBoundingClientRect();
      return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1), vis: b.width > 0 || b.height > 0 };
    };
    return {
      docW: document.documentElement.clientWidth,
      scrollW: document.documentElement.scrollWidth,
      tableW: +document.getElementById("board").getBoundingClientRect().width.toFixed(0),
      rowW: +r0.width.toFixed(0),
      // ⚠️ every row the same height is the whole point — ragged heights were the symptom
      heights: [...new Set(rows.slice(0, 60).map(r => Math.round(r.getBoundingClientRect().height)))],
      theadShown: getComputedStyle(document.querySelector("#board thead")).display !== "none",
      cells: Object.fromEntries(["rk", "name", "pos", "team", "half", "silva", "tags", "act", "full", "sf", "note"].map(c => [c, cell(c)])),
      nRows: rows.length,
    };
  });

  ok(`${W}: the page does not scroll sideways`, m.scrollW <= m.docW + 1, `scrollW ${m.scrollW} vs ${m.docW}`);
  ok(`${W}: the table is no wider than the screen`, m.tableW <= m.docW + 1, `table ${m.tableW}`);
  ok(`${W}: every row is the same height`, m.heights.length === 1, "heights seen: " + m.heights.join(", "));
  ok(`${W}: the column headers are gone`, !m.theadShown);
  /* ⚠️ Compare by LINE, not by exact top. The row is align-items:baseline, so a 15px
     name and an 11px team legitimately differ by a couple of pixels while sitting on
     the same line. An equality test here fails on correct layout — which it did, and
     the bug was in this file. "Same line" = tops within half a line-height. */
  const sameLine = (a, b) => Math.abs(a.top - b.top) < 12;
  const below = (a, b) => a.top - b.top >= 12;
  ok(`${W}: rank, name, tags, pos and team share line one`,
    [m.cells.name, m.cells.tags, m.cells.pos, m.cells.team].every(c => sameLine(c, m.cells.rk)),
    JSON.stringify(Object.fromEntries(["rk","name","tags","pos","team"].map(k => [k, m.cells[k].top]))));
  ok(`${W}: the price and Silva rank are on line two`,
    below(m.cells.half, m.cells.rk) && sameLine(m.cells.silva, m.cells.half));
  ok(`${W}: Taken/Target stayed on line two rather than wrapping to a third`,
    sameLine(m.cells.act, m.cells.half), `act ${m.cells.act.top} vs half ${m.cells.half.top}`);
  ok(`${W}: full, SF and the note are hidden until asked for`,
    !m.cells.full.vis && !m.cells.sf.vis && !m.cells.note.vis);
  ok(`${W}: all 459 players are still rendered`, m.nRows === 459, String(m.nRows));

  console.log(`\nthe chevron at ${W}px`);
  const before = await p.evaluate(() => document.querySelector("#board tbody tr").getBoundingClientRect().height);
  await p.evaluate(() => document.querySelector("#board tbody tr .rowexp").click());
  await p.waitForTimeout(150);
  const after = await p.evaluate(() => {
    const tr = document.querySelector("#board tbody tr");
    const t = c => { const b = tr.querySelector(`td[data-c=${c}]`).getBoundingClientRect(); return b.width > 0 || b.height > 0; };
    return { h: tr.getBoundingClientRect().height, open: tr.classList.contains("open"),
             full: t("full"), sf: t("sf"), note: t("note"),
             label: tr.querySelector(".rowexp").textContent };
  });
  ok(`${W}: tapping it opens the row`, after.open && after.h > before);
  ok(`${W}: and reveals the other two prices and the note`, after.full && after.sf && after.note);
  ok(`${W}: the chevron flips`, after.label === "▴");
  // ⚠️ the row must NOT re-render — a render() here would drop the open state and, during
  // a live draft, fight the sync repaint
  await p.evaluate(() => document.querySelector("#board tbody tr .rowexp").click());
  await p.waitForTimeout(120);
  ok(`${W}: tapping again closes it`, await p.evaluate(() => !document.querySelector("#board tbody tr").classList.contains("open")));
  ok(`${W}: only that row was ever open`, await p.evaluate(() => document.querySelectorAll("#board tr.open").length === 0));

  console.log(`\nthe controls still work at ${W}px`);
  ok(`${W}: the phone sort control is visible`,
    await p.evaluate(() => getComputedStyle(document.querySelector(".msort")).display !== "none"));
  await p.selectOption("#msortKey", "half");
  await p.waitForTimeout(300);
  const sorted = await p.evaluate(() => [...document.querySelectorAll("#board tbody tr")].slice(0, 5)
    .map(r => +r.querySelector("td[data-c=half]").textContent.replace(/[^0-9]/g, "")));
  ok(`${W}: sorting by price puts the most expensive first`,
    sorted.every((v, i) => i === 0 || v <= sorted[i - 1]), sorted.join(","));
  await p.click("#msortDir");
  await p.waitForTimeout(300);
  const rev = await p.evaluate(() => [...document.querySelectorAll("#board tbody tr")].slice(0, 5)
    .map(r => +r.querySelector("td[data-c=half]").textContent.replace(/[^0-9]/g, "")));
  ok(`${W}: the reverse button reverses it`, rev.every((v, i) => i === 0 || v >= rev[i - 1]), rev.join(","));
  ok(`${W}: the control shows the direction it is actually sorting`,
    (await p.locator("#msortDir").innerText()).trim() === "▲");
  await p.selectOption("#msortKey", "rank");
  await p.waitForTimeout(250);

  await p.fill("#search", "chase");
  await p.waitForTimeout(350);
  const filtered = await p.evaluate(() => document.querySelectorAll("#board tbody tr").length);
  ok(`${W}: search still filters`, filtered > 0 && filtered < 40, String(filtered));
  await p.fill("#search", "");
  await p.waitForTimeout(300);

  await p.click('.chip[data-v="QB"]');
  await p.waitForTimeout(350);
  ok(`${W}: the position filter still filters`,
    await p.evaluate(() => { const r = [...document.querySelectorAll("#board tbody tr")];
      return r.length > 0 && r.every(x => x.querySelector("td[data-c=pos]").textContent.trim() === "QB"); }));
  await p.click('.chip[data-v="ALL"]').catch(async () => { await p.click(".chip"); });
  await p.waitForTimeout(300);

  const mk = await p.evaluate(() => {
    const tr = [...document.querySelectorAll("#board tbody tr")].find(row=>row.querySelector(".rowbtn"));
    if(!tr) return false;
    tr.querySelector(".rowbtn").click();
    return !!document.querySelector("#board tbody tr .rowbtn.on-taken");
  });
  ok(`${W}: marking a player taken still works`, mk);
  await p.evaluate(() => document.querySelector("#board tbody tr .rowbtn.on-taken").click());
  await p.waitForTimeout(200);

  await p.screenshot({ path: path.join(SHOTS, `mob-board-${W}.png`) });
  await ctx.close();
}

/* ---------------------------------------------- the price follows the league */
console.log("\nthe phone price is the LEAGUE's price, not a hardcoded column");
for (const [scoring, label, col, width=390] of [["half", "half", "half"], ["full", "full", "full"], ["sf", "SF", "sf"], ["ppr", "half", "half"], ["custom", "half\\*", "half", 360]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true });
  const leagueId = "dd_" + ("test" + scoring).padEnd(32, "0").slice(0, 32);
  await ctx.addInitScript(({id,sc})=>{
    const settings={teams:[{name:"Data Dawgs"}],budget:200,spots:15,scoring:sc};
    if(sc==="custom") settings.scoringConfig={mode:"custom"};
    localStorage.setItem("dd-league-v2:"+id,JSON.stringify({
      v:1,id,name:"Mobile scoring test",season:2026,
      provider:{name:"manual",syncMode:"manual",status:"ready",diagnostics:{}},
      config:{draftType:"auction",teamCount:1,budget:200,rosterSlots:[{slot:"QB",count:1}],
        scoring:{mode:["half","full","sf","custom"].includes(sc)?sc:"half"},teams:[{name:"Data Dawgs"}]}
    }));
    localStorage.setItem("dd-auction-v1:"+id,JSON.stringify({settings,picks:[]}));
  },{id:leagueId,sc:scoring});
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push("scoring " + scoring + ": " + e.message));
  await p.goto(U + "board.html?embed=1&league=" + leagueId, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const tr = document.querySelector("#board tbody tr");
    const lg = tr.querySelector("td.lgprice");
    const shown = [...tr.querySelectorAll("td[data-c=half],td[data-c=full],td[data-c=sf]")]
      .filter(td => td.getBoundingClientRect().width > 0).map(td => td.dataset.c);
    return {
      lgCol: lg ? lg.dataset.c : null,
      lgCount: tr.querySelectorAll("td.lgprice").length,
      value: lg ? lg.textContent : "",
      suffix: lg ? getComputedStyle(lg, "::after").content : "",
      shown,
      rowHeight: tr.getBoundingClientRect().height,
      actionTop: tr.querySelector("td[data-c=act]").getBoundingClientRect().top,
      priceTop: lg ? lg.getBoundingClientRect().top : 0,
      customNote: document.getElementById("customScoringNote").textContent,
      customNoteVisible: !document.getElementById("customScoringNote").hidden,
      onLineTwo: lg && Math.abs(lg.getBoundingClientRect().top - tr.querySelector("td[data-c=silva]").getBoundingClientRect().top) < 12,
    };
  });
  const note = scoring === "ppr" ? " (an unknown scoring value falls back to half)" : "";
  ok(`scoring="${scoring}": the ${col} column is the one promoted${note}`, r.lgCol === col, String(r.lgCol));
  ok(`scoring="${scoring}": exactly one cell is the league price`, r.lgCount === 1, String(r.lgCount));
  ok(`scoring="${scoring}": it is the only price visible`, r.shown.length === 1 && r.shown[0] === col, r.shown.join(","));
  ok(`scoring="${scoring}": it sits on line two next to Silva`, r.onLineTwo);
  // ⚠️ the number must SAY which currency it is, or a superflex reader silently
  // misreads half-PPR dollars as their own
  ok(`scoring="${scoring}": the suffix reads "${label}"`, new RegExp(label).test(r.suffix), r.suffix);
  if(scoring === "custom"){
    ok('scoring="custom": the 360px card remains a two-line 68px row', r.rowHeight <= 70 && Math.abs(r.actionTop-r.priceTop) < 12, String(r.rowHeight));
    ok('scoring="custom": the board carries the honest fallback note once', r.customNoteVisible && /custom; these are half-PPR market values/.test(r.customNote), r.customNote);
  }
  // the other two are one tap away, not gone
  await p.evaluate(() => document.querySelector("#board tbody tr .rowexp").click());
  await p.waitForTimeout(150);
  /* ⚠️ Scope to the ROW that was opened. Querying the document picks up every other
     row's league price too, so the list came back with 459 entries and the assertion
     failed against perfectly correct markup. */
  const open = await p.evaluate(() => [...document.querySelector("#board tbody tr")
    .querySelectorAll("td[data-c=half],td[data-c=full],td[data-c=sf]")]
    .filter(td => td.getBoundingClientRect().width > 0).map(td => td.dataset.c));
  ok(`scoring="${scoring}": expanding reveals the other two prices`, open.length === 3, open.join(","));
  if(scoring === "custom"){
    const expandedNote = await p.evaluate(() => document.querySelector("#board tbody tr td[data-c=note]").textContent);
    ok('scoring="custom": the expanded row explains the fallback', /custom; these are half-PPR market values/.test(expandedNote), expandedNote);
  }
  await ctx.close();
}

console.log("\ncustom scoring stays explicit on desktop too");
{
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});
  const id="dd_customdesktop00000000000000000";
  await ctx.addInitScript(id=>{
    localStorage.setItem("dd-league-v2:"+id,JSON.stringify({v:1,id,name:"Custom desktop",season:2026,
      provider:{name:"manual",syncMode:"manual",status:"ready",diagnostics:{}},
      config:{draftType:"auction",teamCount:1,budget:200,rosterSlots:[{slot:"QB",count:1}],scoring:{mode:"custom"},teams:[{name:"Data Dawgs"}]}}));
    localStorage.setItem("dd-auction-v1:"+id,JSON.stringify({settings:{teams:[{name:"Data Dawgs"}],budget:200,spots:15,scoring:"half",scoringConfig:{mode:"custom"}},picks:[]}));
  },id);
  const p=await ctx.newPage();
  p.on("pageerror",e=>errors.push("custom desktop: "+e.message));
  await p.goto(U+"board.html?league="+id,{waitUntil:"networkidle"}).catch(()=>{});
  const customDesktop=await p.evaluate(()=>({
    headers:[...document.querySelectorAll("#board th")].map(x=>x.textContent),
    note:document.getElementById("customScoringNote").textContent,
    noteVisible:!document.getElementById("customScoringNote").hidden,
  }));
  ok("desktop custom: the full fallback label is in the header",customDesktop.headers.some(x=>/Custom · Half-PPR MV fallback/.test(x)),customDesktop.headers.join(" | "));
  ok("desktop custom: the board-level explanation is visible",customDesktop.noteVisible&&/custom; these are half-PPR market values/.test(customDesktop.note),customDesktop.note);
  await ctx.close();
}

/* ---------------------------------------------- desktop must be untouched */
console.log("\nthe desktop table is unchanged");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push("desktop: " + e.message));
  await p.goto(U + "board.html", { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1200);
  const d = await p.evaluate(() => {
    const rows = [...document.querySelectorAll("#board tbody tr")];
    const tds = [...rows[0].children];
    return {
      thead: getComputedStyle(document.querySelector("#board thead")).display,
      nCols: tds.length,
      allOneLine: tds.every(td => Math.round(td.getBoundingClientRect().top) === Math.round(tds[0].getBoundingClientRect().top)),
      chev: getComputedStyle(document.querySelector(".rowexp")).display,
      msort: getComputedStyle(document.querySelector(".msort")).display,
      noteVisible: document.querySelector("td[data-c=note]").getBoundingClientRect().width > 0,
    };
  });
  ok("the header row is still a table header", d.thead === "table-header-group");
  ok("all eleven columns are present", d.nCols === 11, String(d.nCols));
  ok("and all on one line", d.allOneLine);
  ok("the phone chevron is hidden", d.chev === "none");
  ok("the phone sort control is hidden", d.msort === "none");
  ok("the note column is visible again", d.noteVisible);
  await ctx.close();
}

/* ---------------------------------------------- the cliff chart */
console.log("\nthe cliff chart");
for (const [W, label] of [[390, "phone"], [1280, "desktop"]]) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 1000 }, isMobile: W < 600, hasTouch: W < 600 });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push("cliff " + label + ": " + e.message));
  await p.goto(U + "dataviz.html?embed=1", { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(2000);
  const c = await p.evaluate(() => {
    const el = document.getElementById("chartCliff");
    const svg = el.querySelector("svg");
    return {
      svgW: +svg.getBoundingClientRect().width.toFixed(0),
      contW: +el.getBoundingClientRect().width.toFixed(0),
      bars: svg.querySelectorAll("rect").length,
      labels: svg.querySelectorAll("text").length,
      hint: (el.querySelector(".note") || {}).textContent || "",
      pageScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    };
  });
  if (W < 600) {
    ok("phone: the whole cliff fits the container", c.svgW <= c.contW + 1, `${c.svgW} in ${c.contW}`);
    ok("phone: it says so, so a label-less chart doesn't read as broken", /tap any bar/.test(c.hint), c.hint);
    ok("phone: the per-bar name labels are gone", c.labels < 12, String(c.labels));
    // ⚠️ 155 overlapping hit rects would make the tooltip name the WRONG player
    ok("phone: there is one hit band, not one rect per bar", c.bars < 200, String(c.bars));
  } else {
    ok("desktop: the chart is still the wide scrolling one", c.svgW > c.contW);
    ok("desktop: it still offers the scroll", /Scroll right/.test(c.hint), c.hint);
    ok("desktop: every bar still carries a name", c.labels > 100, String(c.labels));
  }
  ok(`${label}: the page itself never scrolls sideways`, c.pageScroll);
  await ctx.close();
}

/* ---------------------------------------------- inside the dashboard, which is the ask */
console.log("\ninside the dashboard on a phone");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push("dash: " + e.message));
  await p.goto(U + "dashboard.html", { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(3000);
  // ⚠️ "dashboard.html" CONTAINS "board.html". Matching the url on /board\.html/ picks
  // the parent frame and every assertion below silently passes against the wrong document.
  const fr = p.frames().find(f => f !== p.mainFrame() && /\/board\.html/.test(f.url()));
  ok("the Cheat Sheet iframe is there", !!fr);
  if (fr) {
    const r = await fr.evaluate(() => {
      const tr = document.querySelector("#board tbody tr");
      return {
        docW: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
        rowW: +tr.getBoundingClientRect().width.toFixed(0),
        cards: getComputedStyle(document.querySelector("#board thead")).display === "none",
        act: Math.abs(tr.querySelector("td[data-c=act]").getBoundingClientRect().top - tr.querySelector("td[data-c=half]").getBoundingClientRect().top) < 12,
        msort: getComputedStyle(document.querySelector(".msort")).display !== "none",
      };
    });
    ok("it renders as cards, not a table", r.cards);
    // this is the one that matters: scrolling="no" means an overflow here is unreachable
    ok("nothing overflows inside a frame that cannot scroll", r.scrollW <= r.docW + 1, `${r.scrollW} vs ${r.docW}`);
    ok("the row fits the frame", r.rowW <= r.docW + 1);
    ok("Taken/Target are on line two here too", r.act);
    ok("the phone sort control came along", r.msort);
  }
  const outer = await p.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    docW: document.documentElement.clientWidth,
  }));
  ok("the dashboard shell does not scroll sideways either", outer.scrollW <= outer.docW + 1,
    `${outer.scrollW} vs ${outer.docW}`);
  await p.screenshot({ path: path.join(SHOTS, "mob-dash.png") });
  await ctx.close();
}

ok("no script errors anywhere in the run", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
