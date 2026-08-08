/* The projection-vs-rarity frontier, checked against exhaustive enumeration.

   ⚠️ WHAT THIS SUITE IS REALLY FOR. The chart's whole claim is that each plotted point is
   an EXACTLY optimal lineup, not a good one. A sweep that quietly returned near-optima
   would look identical on screen and be a lie. So the tests below do not check that the
   frontier is plausible — they enumerate every legal lineup on a small slate, compute the
   true upper convex hull of the achievable (ownership, projection) set from that, and
   demand the frontier return exactly its vertices.

   The second thing it guards is the engine living twice: work/dfs-engine.js and the copy
   inlined in dfs.html, which is what the Blob-URL Worker is built from. They must be the
   same bytes or the page computes one answer on the main thread and another in a Worker.

   Run: node work/test-frontier.js       (from the repo root)
*/
const fs = require("fs");
const path = require("path");
const { frontier, solveLineups, SITES } = require("./dfs-engine.js").DDFS;
const mk = require("./mkslate.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  " + extra : "")); }
}

/* Small slate, same shape test-solver.js brute-forces against, plus ownership.
   ⚠️ Ownership is deliberately NOT a clean function of projection. If own rose with proj
   the hull would be a straight line and every ordering test would pass by accident. */
function tiny(seed) {
  const all = mk(3, seed);
  const keep = { QB: 6, RB: 10, WR: 12, TE: 6, DST: 6 }, ct = {};
  return all.filter(p => { ct[p.pos] = (ct[p.pos] || 0) + 1; return ct[p.pos] <= keep[p.pos]; })
    .map((p, i) => ({
      ...p,
      sal: Math.round(p.sal * 0.82 / 100) * 100,
      own: +(2 + (p.proj * 0.7) + ((i * 37) % 23) * 0.6).toFixed(1)
    }));
}

/* ---- every legal lineup, so the hull below is fact rather than another opinion ---- */
function achievable(players, opt) {
  opt = opt || {};
  const cap = opt.cap || 50000, floor = opt.floor || 0;
  const byPos = { QB: [], RB: [], WR: [], TE: [], DST: [] };
  players.forEach((p, i) => { if (!p.excl && p.proj > 0) byPos[p.pos].push(i); });
  if (opt.locks) for (const id of opt.locks) if (byPos[players[id].pos].indexOf(id) < 0) byPos[players[id].pos].push(id);
  const combos = (arr, k) => {
    const out = [];
    (function rec(start, cur) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
    })(0, []);
    return out;
  };
  const best = new Map();                     // own (4dp) -> max proj at that ownership
  for (const pat of SITES.dk_classic.patterns) {
    const qb = combos(byPos.QB, pat.QB), rb = combos(byPos.RB, pat.RB),
      wr = combos(byPos.WR, pat.WR), te = combos(byPos.TE, pat.TE), ds = combos(byPos.DST, pat.DST);
    for (const a of qb) for (const b of rb) for (const c of wr) for (const d of te) for (const e of ds) {
      const ids = [].concat(a, b, c, d, e);
      let sal = 0, prj = 0, own = 0;
      for (const id of ids) { sal += players[id].sal; prj += players[id].proj; own += players[id].own || 0; }
      if (sal > cap || sal < floor) continue;
      if (new Set(ids.map(id => players[id].gid)).size < 2) continue;
      if (opt.locks && opt.locks.some(l => ids.indexOf(l) < 0)) continue;
      const k = own.toFixed(4);
      const cur = best.get(k);
      if (cur === undefined || prj > cur) best.set(k, prj);
    }
  }
  return [...best.entries()].map(([own, proj]) => ({ own: +own, proj }))
    .sort((x, y) => x.own - y.own);
}

/* upper convex hull of that set: rising ownership, rising projection, falling slope */
function trueHull(pts) {
  const pareto = []; let bestProj = -Infinity;
  for (const p of pts) if (p.proj > bestProj + 1e-9) { pareto.push(p); bestProj = p.proj; }
  const h = [];
  for (const c of pareto) {
    while (h.length >= 2) {
      const x = h[h.length - 2], y = h[h.length - 1];
      if ((y.proj - x.proj) * (c.own - y.own) <= (c.proj - y.proj) * (y.own - x.own) + 1e-9) h.pop();
      else break;
    }
    h.push(c);
  }
  return h;
}

const CFG = { site: "dk_classic", maxSalary: 50000, timeLimitMs: 60000, maxSolves: 24 };

console.log("\nfrontier vs exhaustive enumeration");
for (const seed of [3, 17]) {
  const P = tiny(seed);
  const truth = trueHull(achievable(P));
  const f = frontier(P, { ...CFG });

  ok(`seed ${seed}: the sweep returned points at all`, f.points.length >= 2 && !f.unavailable,
    `${f.points.length} points, unavailable=${f.unavailable}`);

  // ⚠️ the load-bearing one: every plotted point IS a vertex of the real hull
  const key = p => p.own.toFixed(4) + "/" + p.proj.toFixed(6);
  const truthSet = new Set(truth.map(key));
  const strays = f.points.filter(p => !truthSet.has(key(p)));
  ok(`seed ${seed}: every returned point is a vertex of the true hull`, strays.length === 0,
    strays.map(p => `own ${p.own.toFixed(1)} proj ${p.proj.toFixed(3)}`).join("; "));

  // and with a budget this generous relative to the slate, it finds ALL of them
  const gotSet = new Set(f.points.map(key));
  const missed = truth.filter(p => !gotSet.has(key(p)));
  ok(`seed ${seed}: no hull vertex is missed (${truth.length} in the hull, ${f.solves} solves)`,
    missed.length === 0 || f.capped,
    missed.map(p => `own ${p.own.toFixed(1)} proj ${p.proj.toFixed(3)}`).slice(0, 4).join("; "));

  ok(`seed ${seed}: the extremes are the real extremes`,
    Math.abs(f.points[f.points.length - 1].proj - Math.max(...truth.map(t => t.proj))) < 1e-9 &&
    Math.abs(f.points[0].own - Math.min(...truth.map(t => t.own))) < 1e-9);

  ok(`seed ${seed}: ownership rises and projection rises with it`,
    f.points.every((p, i) => i === 0 || (p.own > f.points[i - 1].own + 1e-9 && p.proj > f.points[i - 1].proj + 1e-9)));

  ok(`seed ${seed}: the exchange rate falls monotonically — the curve is concave`,
    f.segments.every((s, i) => i === 0 || s.rate < f.segments[i - 1].rate + 1e-9),
    f.segments.map(s => s.rate.toFixed(4)).join(" "));

  ok(`seed ${seed}: every segment rate is the chord slope it claims to be`,
    f.segments.every(s => Math.abs(s.rate - (s.to.proj - s.from.proj) / (s.to.own - s.from.own)) < 1e-9));

  // the numbers on the point are the TRUE ones, not the shifted objective the solve used
  ok(`seed ${seed}: reported proj and own recompute from the lineup itself`,
    f.points.every(p => {
      let pr = 0, ow = 0;
      for (const id of p.ids) { pr += P[id].proj; ow += P[id].own; }
      return Math.abs(pr - p.proj) < 1e-9 && Math.abs(ow - p.own) < 1e-9;
    }));

  ok(`seed ${seed}: every point is a legal 9-man lineup inside the cap`,
    f.points.every(p => p.ids.length === 9 && new Set(p.ids).size === 9 &&
      p.ids.reduce((t, i) => t + P[i].sal, 0) === p.sal && p.sal <= 50000));
}

console.log("\nconstraints the sweep must not quietly drop");
{
  const P = tiny(3);
  const floor = 47000;
  const f = frontier(P, { ...CFG, minSalary: floor });
  ok("a salary floor is honoured by every point", f.points.every(p => p.sal >= floor && p.sal <= 50000));
  const truth = trueHull(achievable(P, { floor }));
  const truthSet = new Set(truth.map(p => p.own.toFixed(4) + "/" + p.proj.toFixed(6)));
  ok("and the points are still true hull vertices under that floor",
    f.points.every(p => truthSet.has(p.own.toFixed(4) + "/" + p.proj.toFixed(6))),
    `${f.points.length} points vs ${truth.length} true`);

  // a locked player has to be in all of them
  const wrs = P.map((p, i) => [p, i]).filter(([p]) => p.pos === "WR").sort((a, b) => a[0].sal - b[0].sal);
  const lockId = wrs[Math.floor(wrs.length / 2)][1];
  const Pl = P.map((p, i) => i === lockId ? { ...p, lock: true } : p);
  const fl = frontier(Pl, { ...CFG });
  ok("a lock appears in every frontier lineup", fl.points.length > 0 && fl.points.every(p => p.ids.indexOf(lockId) >= 0));

  // ⚠️ "a missing projection is a missing player, not a zero" — the engine's own rule.
  // The shift makes every shadow projection positive, so this is exactly where it could break.
  const noProj = P.map((p, i) => i === 5 ? { ...p, proj: 0, own: 0.1 } : p);
  const fz = frontier(noProj, { ...CFG });
  ok("a player with no projection never enters a lineup, however cheap his ownership",
    fz.points.every(p => p.ids.indexOf(5) < 0));

  const ex = P.map((p, i) => [p, i]).filter(([p]) => p.pos === "RB").sort((a, b) => b[0].proj - a[0].proj)[0][1];
  const fx = frontier(P.map((p, i) => i === ex ? { ...p, excl: true } : p), { ...CFG });
  ok("an excluded player never enters a lineup", fx.points.every(p => p.ids.indexOf(ex) < 0));
}

console.log("\nrefusals, and what a cut-off search is allowed to claim");
{
  const P = tiny(3);
  const noOwn = P.map(p => ({ ...p, own: 0 }));
  const f0 = frontier(noOwn, { ...CFG });
  ok("no ownership anywhere: refuses, and does not burn a single solve",
    f0.unavailable === "no-ownership" && f0.points.length === 0 && f0.solves === 0);

  const fs_ = frontier(P, { ...CFG, site: "dk_showdown" });
  ok("showdown: refuses rather than answering with the wrong rarity metric",
    fs_.unavailable === "showdown" && fs_.points.length === 0 && fs_.solves === 0);

  const tight = frontier(P, { ...CFG, maxSolves: 3 });
  ok("a tiny budget says so", tight.capped === true && tight.solves <= 3);
  const truthSet = new Set(trueHull(achievable(P)).map(p => p.own.toFixed(4) + "/" + p.proj.toFixed(6)));
  ok("and what it did return is still exact — fewer points, never wrong ones",
    tight.points.every(p => truthSet.has(p.own.toFixed(4) + "/" + p.proj.toFixed(6))));

  ok("the result never claims to be more than the hull", frontier(P, { ...CFG, maxSolves: 4 }).hull === true);
}

console.log("\nthe engine lives twice and the copies must match");
{
  const enginePath = path.join("work", "dfs-engine.js");
  const engine = fs.readFileSync(enginePath, "utf8");
  const page = fs.readFileSync("dfs.html", "utf8");
  const OPEN = '<script type="text/plain" id="ddfsEngine">';
  const a = page.indexOf(OPEN);
  const b = page.indexOf("</script>", a);
  ok("dfs.html carries the engine block", a >= 0 && b > a);
  const inline = page.slice(a + OPEN.length, b);
  ok("the inlined engine is byte-identical to work/dfs-engine.js (bar the wrapping newlines)",
    inline.trim() === engine.trim(),
    `inline ${inline.trim().length} B vs file ${engine.trim().length} B`);
  ok("the inlined copy exports the frontier", inline.indexOf("root.DDFS.frontier = frontier;") > 0);
  ok("the Worker knows how to run it", (page.match(/d\.op === "frontier"/g) || []).length === 1);
}

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
