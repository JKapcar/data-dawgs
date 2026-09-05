const fs = require("fs");
const path = require("path");
const I = require("./dfs-slate-ingest.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  " + extra : "")); }
}

const fix = (name) => fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", name), "utf8");

const sd = I.readSalaries(fix("dk-showdown-salaries-synthetic.csv"));
ok("showdown salary loads", !sd.error, sd.error);
ok("showdown detected", sd.showdown === true);
ok("kickers kept", sd.players.some(p => p.pos === "K"));
ok("cpt+flex merge", sd.players.filter(p => p.cptId && p.dkId).length >= 8, String(sd.players.length));
ok("cpt salary ~1.5x", sd.players.some(p => p.cptSal && Math.abs(p.cptSal - Math.round(p.sal * 1.5 / 100) * 100) <= 100));
ok("format dk-showdown", sd.format === "dk-showdown");

const etrSd = I.readSalaries(fix("etr-showdown-proj-synthetic.csv"));
ok("ETR showdown rejected as salary", !!etrSd.error && etrSd.format === "etr-showdown");
ok("ETR showdown hints proj-paste", etrSd.hint === "proj-paste");

const pool = sd.players.map(p => Object.assign({}, p));
const proj = I.applyProjections(fix("etr-classic-proj-synthetic.csv"), pool);
ok("proj paste matches some", proj.matched >= 3, String(proj.matched));
ok("large field ownership used", proj.cols.own >= 0);
const chris = pool.find(p => p.name === "Chris Vale");
ok("fractional own -> percent", chris && chris.own > 1 && chris.own <= 100, chris && String(chris.own));
const jess = pool.find(p => p.name === "Jess Marlow");
ok("kicker got proj", jess && +jess.proj === 8);

const det = I.detectFormat(fix("dk-showdown-salaries-synthetic.csv"));
ok("detect dk-salary", det.format === "dk-salary");

const det2 = I.detectFormat(fix("etr-classic-proj-synthetic.csv"));
ok("detect etr-classic", det2.format === "etr-classic");

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
