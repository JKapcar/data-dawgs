/* CEP-5A 1b — Receipts absorbs the DawgHouse evidence. Run from the REPO ROOT.
   Grades the boundary this stage exists to enforce: the MODEL scoreboard (#models,
   "what the models believe") is a different sheet from the FORECAST GRADING scoreboard
   (#scoreboard, "how our calls graded"), and the method sheet keeps living at the END
   under its new #receipts hash with #method forwarded.
   Needs playwright: npm install playwright --no-save (Chromium is already on disk). */
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path"; import vm from "vm";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const { chromium } = loadPlaywright();
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

/* ---------- static: the copies cannot drift silently ---------- */
const rc = read("receipts.html");
const dh = read("dawghouse.html");

// mdlBeliefs (receipts) must agree with beliefSummary (work/pound-core.js, the source)
{
  const m = rc.match(/function mdlBeliefs\(values\)\{[\s\S]*?\n\}/);
  ok("receipts.html carries mdlBeliefs", !!m);
  if (m) {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(m[0] + "; this.mdlBeliefs = mdlBeliefs;", ctx);
    const P = require("./pound-core.js");
    const samples = [[0.4, 0.6, 0.8], [0.53, 0.59, 0.66], [0.5], [0.01, 0.99], [0.497, 0.503]];
    let agree = true;
    for (const s of samples) {
      const a = ctx.mdlBeliefs(s), b = P.beliefSummary(s);
      for (const k of Object.keys(b)) if (Math.abs((a[k] === true ? 1 : a[k] === false ? 0 : a[k]) - (b[k] === true ? 1 : b[k] === false ? 0 : b[k])) > 1e-12) agree = false;
    }
    ok("mdlBeliefs agrees with pound-core beliefSummary on sample inputs", agree);
    let throws = 0;
    for (const bad of [[], [1.2], ["x"]]) { try { ctx.mdlBeliefs(bad); } catch (e) { throws++; } }
    ok("mdlBeliefs fails closed like the source", throws === 3, String(throws));
  }
}
ok("the models sheet is not the grading sheet", rc.includes('{id:"models",label:"Models",panel:"#sheetModels"}')
  && rc.includes('{id:"scoreboard",label:"Scoreboard",panel:"#sheetScore"}'));
ok("the method sheet is renamed receipts, hint kept, and stays LAST",
  /\{id:"receipts",label:"Receipts & Method",panel:"#sheetMethod",hint:"pre-registered"\}\]/.test(rc));
ok("#method deep links forward", rc.includes('if(location.hash==="#method")history.replaceState(null,"","#receipts")'));
ok("dawghouse.html no longer holds the scoreboard section", !dh.includes('id="scoreboard"'));
ok("dawghouse.html no longer holds the provenance section", !dh.includes('id="provGrid"'));
ok("dawghouse.html forwards its old deep links",
  dh.includes('if(h==="#scoreboard")location.replace("receipts.html#models")')
  && dh.includes('else if(h==="#provenance")location.replace("receipts.html#provenance")'));
{
  const pages = fs.readdirSync(ROOT).filter(x => x.endsWith(".html"));
  let covered = 0, badNav = [];
  for (const page of pages) {
    const html = read(page);
    if (!html.includes("const NAV = [")) continue;
    covered++;
    if (!html.includes('["receipts.html#provenance","Provenance","pound-provenance"],')) badNav.push(page);
    if (html.includes('"Tools & Scoreboard"')) badNav.push(page + " (stale label)");
  }
  ok("nav on every shared-nav page follows the provenance move", covered >= 19 && badNav.length === 0, badNav.join(","));
}
{
  const surfaces = JSON.parse(read("data/surfaces.json"));
  const pound = surfaces.data.find(s => s.id === "pound");
  const receipts = surfaces.data.find(s => s.id === "receipts");
  ok("surfaces: model-receipts.json moved to the receipts row",
    receipts.machine.some(m => m.url === "/data/model-receipts.json")
    && !pound.machine.some(m => m.url === "/data/model-receipts.json"));
  ok("surfaces: upstream-models.json moved to the receipts row",
    receipts.machine.some(m => m.url === "/data/upstream-models.json")
    && !pound.machine.some(m => m.url === "/data/upstream-models.json"));
  ok("surfaces: dd_model_scoreboard rides with the models sheet",
    receipts.machine.some(m => m.tool === "dd_model_scoreboard")
    && !pound.machine.some(m => m.tool === "dd_model_scoreboard"));
  /* CEP-5A Stage 2: the calculators moved from the pound surface to their own
     /calculators.html surface. The invariant that matters here is unchanged — the
     machine tier value stays "pound" — and the tools must live somewhere, exactly once. */
  const calcs = surfaces.data.find(s => s.id === "calculators");
  ok("surfaces: the pound row keeps its tier; the calculators moved to their own surface",
    pound.tier === "pound" && !!calcs
    && calcs.machine.some(m => m.tool === "dd_convert_odds")
    && !pound.machine.some(m => m.tool === "dd_convert_odds"));
}

/* ---------- live: the sheets actually work, in both themes ---------- */
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0].split("#")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".json") ? "application/json" : "text/html" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8921, r));
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium), args: ["--no-sandbox"] });

for (const theme of ["dark", "light"]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addInitScript(t => { localStorage.setItem("dd-theme2", t); localStorage.setItem("dd-theme", t); }, theme);
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));

  // #models deep link opens the models sheet and renders real rows
  await p.goto("http://127.0.0.1:8921/receipts.html#models", { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  const models = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll(".sheet-tab")].map(t => t.dataset.id),
    selected: document.querySelector('.sheet-tab[aria-selected="true"]')?.dataset.id,
    rows: document.querySelectorAll("#scoreTable tbody tr").length,
    tableVisible: !document.getElementById("scoreTable").hidden,
    gradingHidden: document.getElementById("sheetScore").hidden,
  }));
  ok(`[${theme}] five sheets in order, receipts last`,
    JSON.stringify(models.tabs) === JSON.stringify(["scoreboard", "models", "calls", "provenance", "receipts"]),
    JSON.stringify(models.tabs));
  ok(`[${theme}] #models opens the models sheet, not grading`, models.selected === "models" && models.gradingHidden);
  ok(`[${theme}] the model scoreboard renders 16 games`, models.rows === 16 && models.tableVisible, String(models.rows));

  // #provenance renders the grid
  await p.goto("http://127.0.0.1:8921/receipts.html#provenance", { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  const prov = await p.evaluate(() => ({
    selected: document.querySelector('.sheet-tab[aria-selected="true"]')?.dataset.id,
    cards: document.querySelectorAll("#provGrid article.prov").length,
  }));
  ok(`[${theme}] #provenance opens its sheet`, prov.selected === "provenance");
  ok(`[${theme}] provenance renders upstream cards`, prov.cards >= 5, String(prov.cards));

  // #method forwards to #receipts and the method panel opens.
  // ⚠️ Fresh page on purpose: hopping #provenance -> #method on the same page object is a
  // same-document navigation, the page script never re-runs, and the forward (which lives
  // in page load) cannot fire. The real stale-link case is a fresh load of the old URL.
  const p2 = await ctx.newPage();
  p2.on("pageerror", e => errs.push(e.message));
  await p2.goto("http://127.0.0.1:8921/receipts.html#method", { waitUntil: "load" });
  await p2.waitForTimeout(500);
  const fwd = await p2.evaluate(() => ({
    hash: location.hash,
    selected: document.querySelector('.sheet-tab[aria-selected="true"]')?.dataset.id,
    methodShown: !document.getElementById("sheetMethod").hidden,
  }));
  ok(`[${theme}] #method forwards to #receipts`, fwd.hash === "#receipts" && fwd.selected === "receipts" && fwd.methodShown,
    JSON.stringify(fwd));
  await p2.close();

  // dawghouse old deep link chain follows the content
  await p.goto("http://127.0.0.1:8921/dawghouse.html#scoreboard", { waitUntil: "load" });
  await p.waitForTimeout(900);
  ok(`[${theme}] dawghouse.html#scoreboard lands on receipts.html#models`,
    await p.evaluate(() => location.pathname.endsWith("/receipts.html") && location.hash === "#models"));

  ok(`[${theme}] no script errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
