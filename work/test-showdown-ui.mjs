/* Showdown validator sheet in dfs.html — renders, wires up, and holds at 380px.
   The engine itself is covered headless by tests/showdown-validator.test.js; this is
   the page-level check that the pasted copy actually reached the browser. */
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
const { chromium } = loadPlaywright();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? " — " + x : "")));
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8917, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 380, height: 820 } });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://127.0.0.1:8917/dfs.html#showdown", { waitUntil: "load" });
await p.waitForTimeout(700);

ok("page loads with no script errors", errs.length === 0, errs.join(" | "));
ok("the Showdown tab exists", await p.locator('#fsTabs button[data-s="showdown"]').count() === 1);
ok("the Showdown sheet is shown from the hash", await p.locator("#sh-showdown").isVisible());

// The engine modules reached the page.
ok("engine globals are present", await p.evaluate(() =>
  !!(window.DDSDValidator && window.DDSDRules && window.DDSDDupe && window.DDSDBuild)));

// ---- acceptance 2 / 3 / 4, driven through the page's own copy of the engine ----
const real = await p.evaluate(() => {
  // A realistic NE@SEA pool in the shape DK's export produces after DDFSIngest.
  const mk = (id, team, pos, salary, proj, own, cptOwn) => ({ id, name: id, team, pos, salary, proj, own, cptOwn });
  const players = [
    mk("SEA-QB", "SEA", "QB", 8000, 20, 0.30, 0.12), mk("SEA-RB", "SEA", "RB", 7400, 16, 0.28, 0.08),
    mk("SEA-WR1", "SEA", "WR", 7200, 15, 0.30, 0.09), mk("SEA-WR2", "SEA", "WR", 6100, 12, 0.20, 0.05),
    mk("SEA-TE", "SEA", "TE", 5200, 11, 0.18, 0.04), mk("SEA-K", "SEA", "K", 3800, 8.5, 0.15, 0.02),
    mk("SEA-DST", "SEA", "DST", 4100, 9, 0.20, 0.03),
    mk("NE-QB", "NE", "QB", 7600, 18, 0.26, 0.10), mk("NE-RB", "NE", "RB", 7000, 14, 0.24, 0.07),
    mk("NE-WR1", "NE", "WR", 6800, 13.5, 0.25, 0.08), mk("NE-WR2", "NE", "WR", 5600, 11, 0.16, 0.04),
    mk("NE-TE", "NE", "TE", 4900, 10, 0.14, 0.03), mk("NE-DST", "NE", "DST", 3900, 8.5, 0.18, 0.03)
  ];
  const slate = { id: "NE-SEA", home: "SEA", away: "NE", favorite: "SEA", spread: -3.5, total: 44.5, players };
  const V = window.DDSDValidator;

  // #2 — 5-1 SEA with the captain on the NE side
  const a = V.validateLineup({ id: "a", cpt: "NE-WR1", flex: ["SEA-QB", "SEA-RB", "SEA-WR1", "SEA-WR2", "SEA-TE"] }, slate);
  // #3 — captain WR plus two same-team pass catchers
  const c = V.validateLineup({ id: "c", cpt: "SEA-WR1", flex: ["SEA-WR2", "SEA-TE", "NE-WR1", "NE-RB", "NE-QB"] }, slate);
  // #4 — 12 lineups, one captain at 50%
  const set = [];
  const alt = ["SEA-RB", "SEA-WR1", "NE-QB", "NE-WR1", "NE-RB", "SEA-TE"];
  for (let i = 0; i < 12; i++) {
    const cpt = i < 6 ? "SEA-QB" : alt[(i - 6) % alt.length];
    const flex = ["SEA-QB", "SEA-RB", "SEA-WR1", "NE-QB", "NE-WR1", "NE-RB"].filter(x => x !== cpt).slice(0, 5);
    set.push({ id: "p" + i, cpt, flex });
  }
  const port = V.validatePortfolio(set, slate);
  return {
    aBuild: a.build.type,
    aFlags: a.flags.map(f => f.rule + ":" + f.severity),
    cFlag: (c.flags.find(f => f.rule === "R05") || {}),
    p21b: port.flags.find(f => f.rule === "P21b") || null,
    topExposure: port.cptExposure[0]
  };
});

ok("acceptance 2: build reads 5-1", real.aBuild === "5-1", real.aBuild);
ok("acceptance 2: R09 fires as hard", real.aFlags.includes("R09:hard"), real.aFlags.join(","));
ok("acceptance 3: R05 fires", real.cFlag.rule === "R05", JSON.stringify(real.cFlag));
ok("acceptance 3: fix text says move the captain to the QB",
   /Move the captain to this team's QB/.test(real.cFlag.fix || ""), real.cFlag.fix);
ok("acceptance 4: P21b fires on a 50% captain", !!real.p21b);
ok("acceptance 4: the heavy captain is reported at 0.5", real.topExposure && real.topExposure.exposure === 0.5,
   JSON.stringify(real.topExposure));

// ---- 380px: nothing in this sheet may push the page sideways ----
// The page as a whole already overflows to 438px at this width because of the sitewide
// nav (the theme button and the auth chip), identically on untouched main and on every
// other sheet. That is not this sheet's to fix, so the assertion is scoped to the
// showdown sheet's own subtree, which is the part this work is responsible for.
const scroll = await p.evaluate(() => {
  const w = window.innerWidth;
  const over = [];
  document.querySelectorAll("#sh-showdown *").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && el.offsetParent !== null && r.right > w + 1) {
      over.push(el.tagName + "." + String(el.className).slice(0, 30) + " right=" + Math.round(r.right));
    }
  });
  const meter = document.querySelector("#sdMeter");
  return { over, meter: !!meter, sticky: meter && getComputedStyle(meter).position === "sticky" };
});
ok("no element of the showdown sheet exceeds 380px", scroll.over.length === 0, scroll.over.slice(0, 3).join(" | "));
ok("the salary meter renders and is sticky", scroll.meter && scroll.sticky);

// the six slots render and the meter reacts
ok("six lineup slots render", await p.locator("#sdSlots select[data-sd]").count() === 6);
ok("the empty-pool state is explained, not blank",
   /No pool loaded/.test(await p.locator("#sdPoolMsg").textContent()));

await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
