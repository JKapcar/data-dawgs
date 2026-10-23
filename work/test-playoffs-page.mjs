/* playoffs.html — Playoff Leverage (Pup). The page, not the engine (work/test-playoff-leverage.mjs).

   What this suite defends:
   1. THE PAGE OWNS NO NUMBERS. Everything is read at runtime from the published file, so the
      daily data commit can never leave the page stale; the script's ?v= key matches its bytes.
   2. EVERY MARK SITS WHERE THE FILE SAYS: dots, tick, labels and swing, row by row.
   3. HONEST ENDS: no endpoint prints a bare 0 or 100; "kicked off" and "stale" states appear
      exactly when the clock says they should.
   4. ONE GAME AT A TIME: flipping a second game resets the first, and the ripple names the
      winner. The root-for guide reads the 32-team arrays and its Show button flips the right
      side. Keyboard reaches all of it.
   5. FAILS LOUD on a missing or malformed file; fits 320/390/1280 in both themes; Toto's
      state block carries the caveats and stays inside the request budget.

   Run:  cd work && node test-playoffs-page.mjs
         PLAYOFFS_SHOTS=<dir> also saves a full-page screenshot per width and theme, for the
         human screenshot review a merge still needs.
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import crypto from "crypto"; import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x !== undefined ? "  — " + x : ""))); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".md": "text/markdown" };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8926, r));
const URL_ = "http://127.0.0.1:8926/playoffs.html";
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const env = JSON.parse(read("data/nfl-playoff-leverage.json"));
const D = env.data;
const html = read("playoffs.html"), js = read("playoffs.js");
const pctText = v => { const x = v * 100; return x < 0.5 ? "<1" : x >= 99.5 ? ">99" : String(Math.round(x)); };
const signed = v => { const x = v * 100; return Math.abs(x) < 0.05 ? "<0.1" : (x > 0 ? "+" : "−") + Math.abs(x).toFixed(1); };
const NICK = Object.fromEntries(D.teams.map(t => [t.team, t.name]));

/* ------------------------------------------------------- source-level ---- */
{
  const v = crypto.createHash("md5").update(fs.readFileSync(path.join(ROOT, "playoffs.js")).toString().replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
  ok("the page loads playoffs.js under its own content hash", html.includes(`playoffs.js?v=${v}`), "re-run work/build_playoffs.py");
  ok("tier chip is Pup, by data-tier", /class="tierchip"[^>]*data-tier="labs"|data-tier="labs"[^>]*class="tierchip"/.test(html) || /<a class="tierchip" data-tier="labs"/.test(html));
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  ok("the page body carries no simulation numbers of its own", !/if_home_win"\s*:|"playoffs"\s*:\s*0\.\d/.test(main));
  ok("the script reads the published file at runtime", js.includes('"/data/nfl-playoff-leverage.json"'));
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).map(f => [f, read(f)]).filter(([, s]) => s.includes("const NAV = ["));
  const missing = pages.filter(([, s]) => !s.includes('["playoffs.html","Playoff Leverage","playoffs"]') || !s.includes("playoffs.html — Playoff Leverage (Pup)"));
  ok(`every page with the shared nav lists the page in NFL and in Toto's MAP (${pages.length} pages)`, pages.length > 30 && missing.length === 0, missing.map(([f]) => f).join(","));
  const row = JSON.parse(read("data/surfaces.json")).data.find(r => r.page === "/playoffs.html");
  ok("surfaces.json maps the page to its live file as a Pup", !!row && row.tier === "labs" && row.domain === "nfl" &&
    row.machine.some(m => m.url === "/data/nfl-playoff-leverage.json" && m.status === "live"));
  ok("sitemap and llms.txt both point at the page", read("sitemap.xml").includes("/playoffs.html") && read("llms.txt").includes("(/playoffs.html)"));
}

async function open(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: opts.w || 1280, height: opts.h || 900 }, reducedMotion: opts.reduce ? "reduce" : "no-preference" });
  await ctx.addInitScript(([theme]) => { try { localStorage.setItem("dd-theme3", theme); localStorage.setItem("dd-theme3-playoffs", theme); } catch (e) {} }, [opts.theme || "dark"]);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  if (opts.clock) await p.clock.setFixedTime(new Date(opts.clock));
  if (opts.route) await p.route("**/data/nfl-playoff-leverage.json", opts.route);
  await p.goto(URL_, { waitUntil: "load" });
  await p.waitForFunction(() => document.querySelector(".pl-game,.pl-error,.pl-empty"), null, { timeout: 15000 });
  return { ctx, p, errs };
}
const beforeKick = Date.parse(env.as_of + "T12:00:00Z");

/* --------------------------------------------------------- the chart ---- */
{
  const { ctx, p, errs } = await open({ clock: beforeKick });
  const got = await p.evaluate(() => [...document.querySelectorAll(".pl-game")].map(c => ({
    id: c.dataset.game,
    kicked: !!c.querySelector(".pl-kicked"),
    rows: [...c.querySelectorAll(".pl-row")].map(r => ({
      team: r.dataset.team,
      tick: parseFloat(r.querySelector(".pl-tick").style.left), loss: parseFloat(r.querySelector(".pl-loss").style.left),
      win: parseFloat(r.querySelector(".pl-win").style.left), lo: r.querySelector(".pl-lab-lo").textContent,
      hi: r.querySelector(".pl-lab-hi").textContent, swing: r.querySelector(".pl-swing-v").textContent,
    })),
  })));
  ok("one card per unplayed game of the week", got.length === D.games.length && D.games.length > 0, `${got.length} vs ${D.games.length}`);
  ok("cards in the file's order, largest leverage first", got.map(g => g.id).join() === D.games.map(g => g.game_id).join());
  let marks = 0, bad = [];
  D.games.forEach((g, k) => g.teams.forEach((t, j) => {
    const r = got[k] && got[k].rows[j];
    const near = (a, x) => Math.abs(a - x * 100) < 0.01;
    if (r && r.team === t.team && near(r.tick, t.now) && near(r.loss, t.if_loss) && near(r.win, t.if_win) &&
      r.lo === pctText(Math.min(t.if_loss, t.if_win)) && r.hi === pctText(Math.max(t.if_loss, t.if_win)) && r.swing === signed(t.swing)) marks++;
    else bad.push(`${g.game_id}/${t.team}`);
  }));
  ok("every dot, tick, label and swing sits where the file says", marks === 2 * D.games.length, bad.slice(0, 4).join(","));
  ok("no endpoint label prints a bare 0 or 100", got.every(g => g.rows.every(r => r.lo !== "0" && r.hi !== "100" && r.lo !== "100" && r.hi !== "0")));
  const kickedExpected = D.games.filter(g => Date.parse(g.kickoff_at) < beforeKick).map(g => g.game_id).sort().join();
  ok("'kicked off' appears exactly on games past kickoff at the snapshot hour", got.filter(g => g.kicked).map(g => g.id).sort().join() === kickedExpected);
  const status = await p.textContent("#pl-status");
  ok("status line carries seasons, date and inputs", status.includes(D.sims.toLocaleString("en-US") + " seasons") && /as of \w{3}, \w{3} \d+/.test(status) && status.includes("nfelo"), status);
  ok("not stale on the snapshot day", await p.isHidden("#pl-stale"));
  const odds = await p.evaluate(() => [...document.querySelectorAll(".pl-odds tbody")].map(tb => tb.rows.length));
  ok("two conference tables of sixteen", odds.join() === "16,16", odds.join());

  /* the flip */
  const g0 = D.games[0], g1 = D.games[1];
  await p.locator(`#g-${g0.game_id} .pl-opt`).nth(2).click();
  await p.waitForTimeout(450);
  const f0 = await p.evaluate(id => {
    const c = document.getElementById("g-" + id);
    return { flipped: c.classList.contains("pl-flipped"), pos: c.querySelector(".pl-switch").dataset.pos,
      ticks: [...c.querySelectorAll(".pl-row")].map(r => [r.dataset.team, parseFloat(r.querySelector(".pl-tick").style.left), r.querySelector(".pl-read").textContent]),
      ripple: c.querySelector(".pl-ripple").hidden ? null : c.querySelector(".pl-ripple").textContent };
  }, g0.game_id);
  const homeT = g0.teams.find(t => t.side === "home"), awayT = g0.teams.find(t => t.side === "away");
  const tickOf = code => (f0.ticks.find(x => x[0] === code) || [])[1];
  ok("flipping a home win slides the home tick to its win end", f0.flipped && f0.pos === "home" && Math.abs(tickOf(homeT.team) - homeT.if_win * 100) < 0.01);
  ok("and the away tick to its loss end", Math.abs(tickOf(awayT.team) - awayT.if_loss * 100) < 0.01);
  ok("readouts say where each team lands", f0.ticks.every(x => /→/.test(x[2])), f0.ticks.map(x => x[2]).join("|"));
  ok("the ripple names the winner and other clubs", !!f0.ripple && f0.ripple.startsWith(`If the ${NICK[g0.home]} win:`), f0.ripple);
  await p.locator(`#g-${g1.game_id} .pl-opt`).nth(0).click();
  await p.waitForTimeout(450);
  const f1 = await p.evaluate(([a, b2]) => {
    const A = document.getElementById("g-" + a), B = document.getElementById("g-" + b2);
    return { aPos: A.querySelector(".pl-switch").dataset.pos, aFlipped: A.classList.contains("pl-flipped"),
      aRead: [...A.querySelectorAll(".pl-read")].map(r => r.textContent).join(""), aChecked: A.querySelector('input[value="now"]').checked,
      aTicks: [...A.querySelectorAll(".pl-tick")].map(t => parseFloat(t.style.left)), bPos: B.querySelector(".pl-switch").dataset.pos };
  }, [g0.game_id, g1.game_id]);
  ok("one game at a time: flipping a second game resets the first",
    f1.aPos === "now" && !f1.aFlipped && f1.aRead === "" && f1.aChecked && f1.bPos === "away" &&
    f1.aTicks.every((v, j) => Math.abs(v - g0.teams[j].now * 100) < 0.01));
  await p.locator(`#g-${g1.game_id} .pl-opt`).nth(1).click();
  ok("Now resets everything", await p.evaluate(() => document.querySelectorAll(".pl-flipped").length === 0 && window.DDPlayoffState.flipped === null));

  /* the root-for guide */
  const playing = g0.home;
  await p.selectOption("#pl-team", playing);
  const items = await p.evaluate(() => [...document.querySelectorAll(".pl-root-list li")].map(li => li.querySelector(".pl-root-text").textContent));
  ok("the root-for guide leads with the team's own game", items.length > 0 && items[0].startsWith("Win their own game"), items[0]);
  const i = D.team_order.indexOf(playing);
  const gains = D.games.filter(g => g.home !== playing && g.away !== playing).map(g => Math.abs(g.if_home_win[i] - g.if_away_win[i])).filter(x => x >= 0.002).length;
  ok("and lists every other game worth 0.2 points or more", items.length === 1 + gains, `${items.length} vs ${1 + gains}`);
  ok("the team's rows are highlighted", await p.evaluate(t => document.querySelectorAll(`.pl-row.pl-yours[data-team="${t}"]`).length === 1, playing));
  if (items.length > 1) {
    await p.locator(".pl-root-list li").nth(1).locator("button").click();
    await p.waitForTimeout(100);
    const st = await p.evaluate(() => window.DDPlayoffState.flipped);
    const other = D.games.filter(g => g.home !== playing && g.away !== playing)
      .map(g => ({ g, gain: Math.abs(g.if_home_win[i] - g.if_away_win[i]), side: g.if_home_win[i] >= g.if_away_win[i] ? "home" : "away" }))
      .sort((a, c) => c.gain - a.gain)[0];
    ok("Show flips the game the team should root for, to the right side", st && st.game_id === other.g.game_id && st.winner === other.side, JSON.stringify(st));
  }
  if ((D.byes || []).length) {
    await p.selectOption("#pl-team", D.byes[0]);
    const txt = await p.textContent("#pl-root");
    ok("a bye team is told it is on bye and has no own game", txt.includes("on bye") && !txt.includes("Win their own game"));
  }
  ok("the choice persists for the next visit", await p.evaluate(t => localStorage.getItem("dd-playoffs-team") === t, D.byes[0] || playing));

  /* table view */
  await p.click('[data-view="table"]');
  const tv = await p.evaluate(() => ({ chart: document.getElementById("pl-chart").hidden, rows: document.querySelectorAll("#pl-chart-table tbody tr").length, pressed: document.querySelector('[data-view="table"]').getAttribute("aria-pressed") }));
  ok("Table swaps the chart for its table twin", tv.chart && tv.rows === 2 * D.games.length && tv.pressed === "true");
  await p.click('[data-view="chart"]');

  /* Toto */
  const toto = await p.evaluate(() => ({ sys: window.DD_BOTCTX.sys, ctx: window.DD_BOTCTX.ctx(), chips: window.DD_BOTCTX.chrome.chips.length }));
  ok("Toto's system block carries the caveats", /SIMULATION OUTPUT/.test(toto.sys) && /ONE GAME AT A TIME/.test(toto.sys) && /overconfident/.test(toto.sys) && /coin toss/.test(toto.sys));
  ok("Toto's state block is compact and dated", toto.ctx.length < 4000 && toto.ctx.includes(`as_of ${env.as_of}`) && toto.ctx.includes("SWITCH SET"), toto.ctx.length);
  ok("no script errors in the main pass", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

/* ----------------------------------------------------- keyboard + motion ---- */
{
  const { ctx, p, errs } = await open({ clock: beforeKick, reduce: true });
  const g0 = D.games[0];
  await p.focus(`#g-${g0.game_id} .pl-row`);
  ok("focusing a row shows its numbers", await p.evaluate(() => !document.getElementById("pl-tip").hidden && document.getElementById("pl-tip").textContent.includes("if they win")));
  await p.focus(`#g-${g0.game_id} input[value="now"]`);
  await p.keyboard.press("ArrowRight");
  const st = await p.evaluate(() => window.DDPlayoffState.flipped);
  ok("arrow keys move the result switch", st && st.game_id === g0.game_id && st.winner === "home", JSON.stringify(st));
  const homeT = g0.teams.find(t => t.side === "home");
  const read = await p.evaluate(([id, t]) => document.querySelector(`#g-${id} .pl-row[data-team="${t}"] .pl-read b`).textContent, [g0.game_id, homeT.team]);
  ok("reduced motion lands the readout at once, no count-up", read === pctText(homeT.if_win), read);
  ok("no script errors with reduced motion", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

/* --------------------------------------------------------- stale + late ---- */
{
  const { ctx, p } = await open({ clock: Date.parse(env.as_of + "T12:00:00Z") + 4 * 86400000 });
  const s = await p.evaluate(() => ({ stale: !document.getElementById("pl-stale").hidden && document.getElementById("pl-stale").textContent,
    kicked: document.querySelectorAll(".pl-kicked").length }));
  ok("four days on, the page says the snapshot is stale", !!s.stale && /days old/.test(s.stale), s.stale);
  ok("and every game shows it kicked off after the snapshot", s.kicked === D.games.length, s.kicked);
  await ctx.close();
}

/* ---------------------------------------------------------- fails loud ---- */
for (const [name, route] of [
  ["a missing file", r => r.fulfill({ status: 404, body: "no" })],
  ["a malformed file", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...env, data: { ...D, teams: D.teams.slice(1) } }) })],
]) {
  const { ctx, p } = await open({ route });
  const s = await p.evaluate(() => ({ err: document.querySelector(".pl-error") && document.querySelector(".pl-error").textContent, games: document.querySelectorAll(".pl-game").length, status: document.getElementById("pl-status").textContent }));
  ok(`${name} shows an error where the chart would be, and no cards`, !!s.err && s.games === 0 && /Could not load/.test(s.status), JSON.stringify(s));
  await ctx.close();
}

/* -------------------------------------------------------------- widths ---- */
for (const theme of ["dark", "light"]) for (const w of [320, 390, 1280]) {
  const { ctx, p, errs } = await open({ w, theme, clock: beforeKick });
  const over = await p.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("main.pl *")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > cw + 1; })
      .map(e => e.className || e.tagName).slice(0, 5);
  });
  ok(`${w}px ${theme}: nothing on the page runs off the right edge`, over.length === 0, over.join(","));
  ok(`${w}px ${theme}: theme applied`, await p.evaluate(t => (document.documentElement.dataset.theme || "dark") === t, theme));
  ok(`${w}px ${theme}: no script errors`, errs.length === 0, errs.join(" | "));
  if (process.env.PLAYOFFS_SHOTS) {
    const dir = path.resolve(process.env.PLAYOFFS_SHOTS);
    fs.mkdirSync(dir, { recursive: true });
    await p.screenshot({ path: path.join(dir, `playoffs-${w}-${theme}.png`), fullPage: true });
  }
  await ctx.close();
}

await b.close(); server.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
