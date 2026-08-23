/* Survivor — Stage D: heatmap sorting, spent-team cells, note chips.
 *
 * Run: node work/test-survivor-grid.mjs   (needs playwright; serves the repo on :8820)
 *
 * ⚠️ WHAT THIS IS ACTUALLY GUARDING.
 * Chips are the risky part of this stage. A chip that says "heavy chalk" is a threshold
 * someone picked, printed next to numbers that are computed — and the danger is that a
 * reader reads the chip as a finding. Two things keep that honest and both are tested:
 * the thresholds are PRINTED FROM the constant the code branches on (so the copy cannot
 * drift from the behaviour), and every chip is derived from a number already on the row
 * rather than from a second calculation that could disagree with the column beside it.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { chromiumExecutable } from "./playwright-loader.mjs";

const WORK = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WORK, "..");
const PORT = 8820;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};

const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "content-type": p.endsWith(".html") ? "text/html" : "text/plain" });
    res.end(b);
  });
});
await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || chromiumExecutable(chromium),
});

async function open(rawCfg = {}, { theme = "light", width = 1280 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await ctx.addInitScript(([t, c]) => {
    try {
      localStorage.setItem("dd-theme3", t);
      localStorage.setItem("dd-theme3-survivor", t);
      localStorage.setItem("dd-survivor-v1", JSON.stringify(c));
    } catch (e) {}
  }, [theme, rawCfg]);
  await page.goto(`http://localhost:${PORT}/survivor.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.SVBoard && window.SVBoard.ensure());
  await page.waitForFunction(() => document.querySelectorAll("#svHeat .sv-cell").length > 0,
                             null, { timeout: 30000 });
  return { ctx, page, errors };
}

const teamOrder = page => page.$$eval("#svHeat tr td:first-child", ns => ns.map(n => n.textContent.trim()));

/* ---------- 1. the grid sorts by a week's column, and back ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1 });
  ok(errors.length === 0, "grid renders", errors[0]);

  const alpha = await teamOrder(page);
  ok(JSON.stringify(alpha) === JSON.stringify(alpha.slice().sort()),
     "the default order is alphabetical — the only order you can find a team in");

  await page.click('#svHeat [data-sort="1"]');
  await page.waitForTimeout(200);
  const desc = await page.$$eval("#svHeat tr", ns => ns.slice(1).map(tr => ({
    team: tr.children[0].textContent.trim(),
    p: tr.children[1].classList.contains("sv-bye") ? null : Number(tr.children[1].textContent.trim()),
  })));
  const played = desc.filter(r => r.p !== null);
  ok(played.every((r, i) => i === 0 || played[i - 1].p >= r.p),
     "descending sort really orders week 1 best-first",
     played.slice(0, 4).map(r => r.team + ":" + r.p).join(" "));
  /* ⚠️ Byes last in BOTH directions. A team with no game has no win probability, and
     placing it below a 22% underdog one way and above an 85% favourite the other would
     both be statements the data does not make. */
  const firstBye = desc.findIndex(r => r.p === null);
  ok(firstBye === -1 || desc.slice(firstBye).every(r => r.p === null),
     "byes sort to the bottom, not as zero", String(firstBye));

  await page.click('#svHeat [data-sort="1"]');
  await page.waitForTimeout(200);
  const asc = await page.$$eval("#svHeat tr", ns => ns.slice(1).map(tr =>
    tr.children[1].classList.contains("sv-bye") ? null : Number(tr.children[1].textContent.trim())));
  const ascPlayed = asc.filter(p => p !== null);
  ok(ascPlayed.every((p, i) => i === 0 || ascPlayed[i - 1] <= p),
     "clicking the same column again flips to ascending", ascPlayed.slice(0, 4).join(","));
  const ascBye = asc.findIndex(p => p === null);
  ok(ascBye === -1 || asc.slice(ascBye).every(p => p === null),
     "byes are still last when ascending");

  await page.click('#svHeat [data-sort="team"]');
  await page.waitForTimeout(200);
  const back = await teamOrder(page);
  ok(JSON.stringify(back) === JSON.stringify(alpha), "the Team header restores alphabetical");

  // a different column starts fresh at best-first rather than inheriting the flip
  await page.click('#svHeat [data-sort="1"]');
  await page.click('#svHeat [data-sort="1"]');
  await page.click('#svHeat [data-sort="3"]');
  await page.waitForTimeout(200);
  const w3 = await page.$$eval("#svHeat tr", ns => ns.slice(1).map(tr =>
    tr.children[3].classList.contains("sv-bye") ? null : Number(tr.children[3].textContent.trim())).filter(p => p !== null));
  ok(w3.every((p, i) => i === 0 || w3[i - 1] >= p),
     "a new column starts descending, not carrying the previous flip", w3.slice(0, 4).join(","));
  const marked = await page.$$eval("#svHeat th.sv-sorted .sv-sort", ns => ns.map(n => n.textContent.trim()));
  ok(marked.length === 1 && marked[0].startsWith("3"), "only the sorted column is marked", marked.join(","));
  ok(errors.length === 0, "no page error through sorting", errors[0]);
  await ctx.close();
}

/* ---------- 2. spent teams read as unavailable, not merely dim ---------- */
{
  const { ctx, page } = await open({ startWeek: 1, used: ["KC", "PHI"] });
  // show them: the default hides spent teams
  await page.uncheck("#svHideUsed");
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#svHeat .sv-cell[data-team="KC"]')];
    const other = document.querySelector('#svHeat .sv-cell[data-team="BUF"]');
    return {
      n: cells.length,
      allSpent: cells.every(c => c.classList.contains("sv-spent")),
      struck: cells.length ? getComputedStyle(cells[0]).textDecorationLine : "",
      otherStruck: other ? getComputedStyle(other).textDecorationLine : "",
      title: cells.length ? cells[0].getAttribute("title") : "",
      stillReadable: cells.length ? cells[0].textContent.trim() : "",
    };
  });
  ok(r.n > 0 && r.allSpent, "every cell of a spent team is marked spent", `${r.n} cells`);
  ok(r.struck.includes("line-through"), "…and struck through, not only dimmed", r.struck);
  ok(!r.otherStruck.includes("line-through"), "an available team is not struck", r.otherStruck);
  ok(/already spent/i.test(r.title), "the cell says why", r.title);
  ok(/^\d+$/.test(r.stillReadable), "the probability is still shown — it is real, just unavailable",
     r.stillReadable);
  await ctx.close();
}
{
  // ⚠️ with reuse on, a "spent" team is not spent at all and must NOT be struck
  const { ctx, page } = await open({ startWeek: 1, used: ["KC"], reuse: true });
  await page.uncheck("#svHideUsed");
  await page.waitForTimeout(300);
  const struck = await page.$$eval('#svHeat .sv-cell[data-team="KC"].sv-spent', ns => ns.length);
  ok(struck === 0, "reuse=true: a used team is still available and is not struck out", String(struck));
  await ctx.close();
}

/* ---------- 3. chips are derived, not invented ---------- */
{
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 200 });
  ok(errors.length === 0, "board renders with chips", errors[0]);
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const rank = S.rankWeek(1, cfg, D);
    const E = Math.max(1, cfg.entries - 1);
    const bad = [];
    rank.rows.forEach(row => {
      const has = k => (row.chips || []).some(c => c.k === k);
      const share = row.survivorsIfWin > 0 ? (E * row.pop) / row.survivorsIfWin : 0;
      if (has("chalk") !== (row.pop > S.CHIP.chalk)) bad.push(row.team + ":chalk");
      if (has("drag") !== (share > S.CHIP.drag)) bad.push(row.team + ":drag");
      if (has("cost") !== (row.futureCost > S.CHIP.cost)) bad.push(row.team + ":cost");
      // clean is the else-branch of cost, so it can never appear alongside it
      if (has("clean") && has("cost")) bad.push(row.team + ":both");
      if (has("clean") !== (row.futureCost <= S.CHIP.cost && row.futureCost < S.CHIP.clean))
        bad.push(row.team + ":clean");
    });
    return { bad, thresholds: S.CHIP, anyChips: rank.rows.some(r2 => (r2.chips || []).length) };
  });
  ok(r.anyChips, "at least one row earns a chip on the shipped snapshot");
  ok(r.bad.length === 0, "every chip matches the threshold it claims to apply", r.bad.join(","));

  /* ⚠️ The copy is PRINTED FROM the constant the code branches on. Typed thresholds
     drift from the behaviour the first time someone tunes one, and the drift is
     invisible because both halves look right on their own. */
  const printed = await page.evaluate(() => ({
    chalk: document.getElementById("mChalk").textContent,
    drag: document.getElementById("mDrag").textContent,
    cost: document.getElementById("mCost").textContent,
    clean: document.getElementById("mClean").textContent,
  }));
  ok(printed.chalk === Math.round(r.thresholds.chalk * 100) + "%",
     "the chalk threshold in the copy is the one in the code", `${printed.chalk} vs ${r.thresholds.chalk}`);
  ok(printed.cost === Math.round(r.thresholds.cost * 100) + "%",
     "…and the future-cost one", `${printed.cost} vs ${r.thresholds.cost}`);
  ok(printed.clean === (r.thresholds.clean * 100).toFixed(1) + "%",
     "…and the clean-use one, at the precision it needs", printed.clean);

  // the chips are on the board, addressable, and the team name is not polluted
  const firstRow = await page.evaluate(() => {
    const tr = document.querySelectorAll("#svBoard tr")[1];
    return {
      name: tr.querySelector(".tmname").textContent.trim(),
      chips: [...tr.querySelectorAll(".sv-chip")].map(c => c.textContent.trim()),
      titles: [...tr.querySelectorAll(".sv-chip")].map(c => c.getAttribute("title")),
    };
  });
  ok(/^[A-Z]{2,3}$/.test(firstRow.name), "the team name cell reads as just a team", firstRow.name);
  ok(firstRow.titles.every(t => t && t.length > 8), "every chip explains itself on hover",
     JSON.stringify(firstRow.titles));
  await ctx.close();
}

/* ---------- 4. the methodology block calls them conventions ---------- */
{
  const { ctx, page } = await open({ startWeek: 1 });
  const closed = await page.$eval(".sv-method", n => n.open);
  ok(closed === false, "the methodology drawer is closed by default");
  const txt = await page.$eval(".sv-method", n => n.textContent.replace(/\s+/g, " "));
  ok(/display conventions, not findings/i.test(txt),
     "it says in words that the thresholds are conventions", txt.slice(0, 120));
  ok(/equity denominator/i.test(txt),
     "…and that duplication drag comes out of the equity denominator rather than a second calc");
  await ctx.close();
}

/* ---------- 5. modelled ownership taints the chalk chip, and says so ---------- */
{
  const { ctx, page } = await open({ startWeek: 1, entries: 200 });
  const r = await page.evaluate(() => {
    const S = window.DDSurvivor, D = window.SV, cfg = S.load();
    const rows = S.rankWeek(1, cfg, D).rows;
    const chalk = rows.map(x => (x.chips || []).find(c => c.k === "chalk")).filter(Boolean);
    return { any: chalk.length, allFlagged: chalk.every(c => /modelled/.test(c.d)), popReal: rows[0].popReal };
  });
  if (r.any === 0) {
    // modelled chalk-softmax spreads ownership thin; no row clearing 25% is a real outcome
    ok(r.popReal === false, "no chalk chip on modelled ownership is a legitimate state");
  } else {
    ok(r.allFlagged, "a chalk chip built on modelled ownership says modelled in its tooltip");
  }
  await ctx.close();
}

/* ---------- 6. dark theme and a phone width ---------- */
for (const [theme, width] of [["dark", 1280], ["light", 390]]) {
  const { ctx, page, errors } = await open({ startWeek: 1, entries: 200 }, { theme, width });
  ok(errors.length === 0, `renders at ${theme}/${width}`, errors[0]);
  const applied = await page.getAttribute("html", "data-theme");
  ok(applied === theme, `the ${theme} theme is actually applied`, String(applied));
  const chipColor = await page.evaluate(() => {
    const c = document.querySelector("#svBoard .sv-chip");
    return c ? getComputedStyle(c).color : null;
  });
  ok(chipColor === null || (/^rgba?\(/.test(chipColor) && chipColor !== "rgba(0, 0, 0, 0)"),
     `chip colour resolves at ${theme}`, String(chipColor));
  // the grid still scrolls rather than bursting the viewport
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("#svHeat").closest(".nf-scroll");
    return el ? getComputedStyle(el).overflowX : null;
  });
  ok(overflow === "auto" || overflow === "scroll", `the grid scrolls at ${width}px`, String(overflow));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`survivor grid/chips: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
