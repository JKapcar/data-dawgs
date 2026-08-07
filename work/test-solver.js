/* Correctness tests: the branch-and-bound must agree with exhaustive enumeration.
   A fast solver that returns the second-best lineup is worse than no solver. */
const { solveLineups, SITES } = require("./dfs-engine.js").DDFS;
const mk = require("./mkslate.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  " + extra : "")); }
}

/* ---- exhaustive reference for DK classic ---- */
function brute(players, opt) {
  opt = opt || {};
  const cap = opt.cap || 50000, floor = opt.floor || 0;
  const byPos = { QB: [], RB: [], WR: [], TE: [], DST: [] };
  players.forEach((p, i) => { if (!p.excl && p.proj > 0) byPos[p.pos].push(i); });
  let best = null;
  const combos = (arr, k) => {
    const out = [];
    (function rec(start, cur) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
    })(0, []);
    return out;
  };
  for (const pat of SITES.dk_classic.patterns) {
    const qb = combos(byPos.QB, pat.QB), rb = combos(byPos.RB, pat.RB),
          wr = combos(byPos.WR, pat.WR), te = combos(byPos.TE, pat.TE), ds = combos(byPos.DST, pat.DST);
    for (const a of qb) for (const b of rb) for (const c of wr) for (const d of te) for (const e of ds) {
      const ids = [].concat(a, b, c, d, e);
      let sal = 0, prj = 0;
      for (const id of ids) { sal += players[id].sal; prj += players[id].proj; }
      if (sal > cap || sal < floor) continue;
      const games = new Set(ids.map(id => players[id].gid));
      if (games.size < 2) continue;
      if (opt.maxPerTeam) {
        const tc = {}; let bad = false;
        for (const id of ids) if (players[id].pos !== "DST") { tc[players[id].team] = (tc[players[id].team] || 0) + 1; if (tc[players[id].team] > opt.maxPerTeam) bad = true; }
        if (bad) continue;
      }
      if (opt.locks) { let miss = false; for (const l of opt.locks) if (ids.indexOf(l) < 0) miss = true; if (miss) continue; }
      if (opt.qbMin) {
        const q = ids.find(id => players[id].pos === "QB");
        let n = 0; for (const id of ids) if (id !== q && players[id].team === players[q].team && (players[id].pos === "WR" || players[id].pos === "TE")) n++;
        if (n < opt.qbMin) continue;
        if (opt.bringBack) {
          let bb = 0; for (const id of ids) if (players[id].team === players[q].opp && players[id].pos !== "DST") bb++;
          if (bb < opt.bringBack) continue;
        }
      }
      if (!best || prj > best.proj) best = { proj: prj, sal, ids };
    }
  }
  return best;
}

// small slate: 3 games, tiny pool, so brute force finishes.
// ⚠️ Salaries are scaled down 18%. At full price only 478 of the enumerated lineups fit
// under the cap and NONE of them contain the priciest WR — which made the first lock test
// look like a solver bug when the solver was right and the fixture had no legal answer.
function tiny(seed) {
  const all = mk(3, seed);
  const keep = { QB: 6, RB: 10, WR: 12, TE: 6, DST: 6 }, ct = {};
  return all.filter(p => { ct[p.pos] = (ct[p.pos] || 0) + 1; return ct[p.pos] <= keep[p.pos]; })
            .map(p => ({ ...p, sal: Math.round(p.sal * 0.82 / 100) * 100 }));
}

console.log("\nsolver vs exhaustive enumeration");
for (const seed of [3, 17, 42]) {
  const P = tiny(seed);
  for (const floor of [0, 47000]) {
    const b = brute(P, { floor });
    const s = solveLineups(P, { site: "dk_classic", count: 1, minSalary: floor });
    const got = s.lineups[0];
    ok(`seed ${seed} floor ${floor}: optimum matches`,
       !!b === !!got && (!b || Math.abs(b.proj - got.proj) < 1e-6),
       b && got ? `brute ${b.proj.toFixed(3)} vs solver ${got.proj.toFixed(3)}` : "one side empty");
  }
  // team cap
  const b2 = brute(P, { maxPerTeam: 3 }), s2 = solveLineups(P, { site: "dk_classic", count: 1, maxPerTeam: 3 });
  ok(`seed ${seed} maxPerTeam 3: optimum matches`,
     Math.abs(b2.proj - s2.lineups[0].proj) < 1e-6, `brute ${b2.proj.toFixed(3)} vs ${s2.lineups[0].proj.toFixed(3)}`);
  // stack
  const b3 = brute(P, { qbMin: 2, bringBack: 1 });
  const s3 = solveLineups(P, { site: "dk_classic", count: 1, stack: { qbMin: 2, qbPos: ["WR", "TE"], bringBack: 1 } });
  ok(`seed ${seed} QB+2 + bring-back: optimum matches`,
     (!b3 && !s3.lineups.length) || (b3 && s3.lineups[0] && Math.abs(b3.proj - s3.lineups[0].proj) < 1e-6),
     b3 && s3.lineups[0] ? `brute ${b3.proj.toFixed(3)} vs ${s3.lineups[0].proj.toFixed(3)}` : "");
  // locks — lock a mid-priced WR so a legal answer definitely exists
  const wrs = P.map((p, i) => [p, i]).filter(([p]) => p.pos === "WR").sort((a, b) => a[0].sal - b[0].sal);
  const lockId = wrs[Math.floor(wrs.length / 2)][1];
  const Pl = P.map((p, i) => i === lockId ? { ...p, lock: true } : p);
  const b4 = brute(Pl, { locks: [lockId] }), s4 = solveLineups(Pl, { site: "dk_classic", count: 1 });
  ok(`seed ${seed} lock respected + optimal`,
     !!b4 && !!s4.lineups[0] && s4.lineups[0].ids.indexOf(lockId) >= 0 &&
     Math.abs(b4.proj - s4.lineups[0].proj) < 1e-6,
     b4 && s4.lineups[0] ? `brute ${b4.proj.toFixed(3)} vs ${s4.lineups[0].proj.toFixed(3)}` : "one side empty");
  // excludes
  const exId = P.map((p, i) => [p, i]).filter(([p]) => p.pos === "RB").sort((a, b) => b[0].proj - a[0].proj)[0][1];
  const Px = P.map((p, i) => i === exId ? { ...p, excl: true } : p);
  const b5 = brute(Px), s5 = solveLineups(Px, { site: "dk_classic", count: 1 });
  ok(`seed ${seed} exclude respected + optimal`,
     s5.lineups[0].ids.indexOf(exId) < 0 && Math.abs(b5.proj - s5.lineups[0].proj) < 1e-6);
}

console.log("\nconstraint invariants on a full slate");
const P = mk(13);
{
  const r = solveLineups(P, { site: "dk_classic", count: 60, uniques: 3, randomness: 0.15,
    minSalary: 49500, maxPerTeam: 4, stack: { qbMin: 2, qbPos: ["WR", "TE"], bringBack: 1, noRbVsDst: true }, timeLimitMs: 60000 });
  const L = r.lineups;
  ok("60 lineups produced", L.length === 60, `got ${L.length}`);
  ok("every lineup has 9 players, all distinct", L.every(l => l.ids.length === 9 && new Set(l.ids).size === 9));
  ok("salary window honoured", L.every(l => l.sal >= 49500 && l.sal <= 50000));
  ok("position counts legal", L.every(l => {
    const c = {}; l.ids.forEach(i => c[P[i].pos] = (c[P[i].pos] || 0) + 1);
    return c.QB === 1 && c.DST === 1 && c.RB >= 2 && c.RB <= 3 && c.WR >= 3 && c.WR <= 4 && c.TE >= 1 && c.TE <= 2
      && (c.RB + c.WR + c.TE) === 7;
  }));
  ok("max 4 per team (skill positions)", L.every(l => {
    const t = {}; l.ids.forEach(i => { if (P[i].pos !== "DST") t[P[i].team] = (t[P[i].team] || 0) + 1; });
    return Object.values(t).every(v => v <= 4);
  }));
  ok("QB+2 stack present in all", L.every(l => {
    const q = l.ids.find(i => P[i].pos === "QB");
    return l.ids.filter(i => i !== q && P[i].team === P[q].team && (P[i].pos === "WR" || P[i].pos === "TE")).length >= 2;
  }));
  ok("bring-back present in all", L.every(l => {
    const q = l.ids.find(i => P[i].pos === "QB");
    return l.ids.filter(i => P[i].team === P[q].opp && P[i].pos !== "DST").length >= 1;
  }));
  ok("no RB against our own DST", L.every(l => {
    const d = l.ids.find(i => P[i].pos === "DST");
    return !l.ids.some(i => P[i].pos === "RB" && P[i].team === P[d].opp);
  }));
  ok("uniques: every pair differs by >= 3", (() => {
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const s = new Set(L[i].ids); let ov = 0; for (const x of L[j].ids) if (s.has(x)) ov++;
      if (ov > 6) return false;
    }
    return true;
  })());
  ok("lineups are strictly distinct", new Set(L.map(l => l.ids.slice().sort((a, b) => a - b).join(","))).size === L.length);
  ok("reported proj equals sum of TRUE projections, not the perturbed draw",
     L.every(l => Math.abs(l.proj - l.ids.reduce((t, i) => t + P[i].proj, 0)) < 1e-6));
}
{
  // exposure caps are hard
  const Pe = P.map(p => ({ ...p, maxExp: 0.30 }));
  const r = solveLineups(Pe, { site: "dk_classic", count: 100, uniques: 2, randomness: 0.2, minSalary: 49000, timeLimitMs: 60000 });
  const ct = {}; r.lineups.forEach(l => l.ids.forEach(i => ct[i] = (ct[i] || 0) + 1));
  const worst = Math.max(...Object.values(ct)) / r.lineups.length;
  // ⚠️ the cap is enforced BEFORE each solve, so a player can reach the cap on the
  // lineup that crosses it — the guarantee is "never exceeds cap by more than one lineup"
  ok("30% exposure cap holds (within one lineup)", worst <= 0.30 + 1.5 / r.lineups.length,
     `worst ${(worst * 100).toFixed(1)}%`);
}
{
  // showdown
  const S = mk(1, 5);
  const r = solveLineups(S, { site: "dk_showdown", count: 20, uniques: 1, randomness: 0.1, timeLimitMs: 30000 });
  ok("showdown: 20 lineups", r.lineups.length === 20, `got ${r.lineups.length} ${r.infeasible || ""}`);
  ok("showdown: 6 players, cpt included, under cap",
     r.lineups.every(l => l.ids.length === 6 && l.ids.indexOf(l.cpt) >= 0 && l.sal <= 50000));
  ok("showdown: captain salary is 1.5x", r.lineups.every(l => {
    let s = Math.round(S[l.cpt].sal * 1.5);
    for (const id of l.ids) if (id !== l.cpt) s += S[id].sal;
    return s === l.sal;
  }));
  ok("showdown: both teams represented", r.lineups.every(l => new Set(l.ids.map(i => S[i].team)).size >= 2));
  ok("showdown: captain gets 1.5x points", r.lineups.every(l => {
    let p = S[l.cpt].proj * 1.5;
    for (const id of l.ids) if (id !== l.cpt) p += S[id].proj;
    return Math.abs(p - l.proj) < 1e-6;
  }));
}
{
  // infeasible should be reported, not thrown or silently short
  // ⚠️ Salaries are multiples of $100, so this window is unreachable — and an unreachable
  // window is the worst case for the solver: there is no incumbent to prune against, so it
  // enumerates everything. The time limit is what makes that a message instead of a hang.
  const t = Date.now();
  const r = solveLineups(P, { site: "dk_classic", count: 5, minSalary: 49999, maxSalary: 49999, timeLimitMs: 3000 });
  ok("impossible salary window stops at the deadline instead of hanging",
     r.lineups.length === 0 && (!!r.infeasible || r.timedOut) && Date.now() - t < 6000,
     `${Date.now() - t}ms ${r.infeasible || ""}${r.timedOut ? " timedOut" : ""}`);
  const t2 = Date.now();
  const r2 = solveLineups(P, { site: "dk_classic", count: 150, uniques: 2, randomness: 0.15,
                               minSalary: 49000, timeLimitMs: 400 });
  ok("a tight deadline truncates cleanly and says so",
     r2.timedOut && r2.lineups.length > 0 && r2.lineups.length < 150 && Date.now() - t2 < 1500,
     `${r2.lineups.length} lineups in ${Date.now() - t2}ms`);
  ok("every lineup returned before a timeout is still valid",
     r2.lineups.every(l => l.ids.length === 9 && l.sal <= 50000 && l.sal >= 49000));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
