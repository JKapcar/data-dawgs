"""
Add the projection-vs-rarity frontier to the DFS engine, and keep dfs.html's inlined
copy of the engine byte-identical to it.

    python3 work/patch-dfs-frontier.py          (from the repo root)

⚠️ THE ENGINE LIVES TWICE. work/dfs-engine.js is the editable copy; dfs.html carries the
same bytes inside <script type="text/plain" id="ddfsEngine">, because a flattened page IS
the source here and the Blob-URL Worker is built from that text. Editing one and not the
other produces a page whose Worker and main thread disagree — which shows up as "works
until the browser blocks the Worker". So this script edits the file, then RESTAMPS the
inline block from it and asserts the two match.

⚠️ RE-RUNNABLE, THE assemble.mjs WAY: strip the marked block first, then insert. Editing
FRONTIER below and re-running replaces it rather than appending a second copy.
"""
import hashlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENGINE = ROOT / "work" / "dfs-engine.js"
PAGE = ROOT / "dfs.html"

START = "/* ===== DD-FRONTIER START — generated from work/patch-dfs-frontier.py ===== */"
END = "/* ===== DD-FRONTIER END ===== */"

# --------------------------------------------------------------------------- engine

FRONTIER = r'''
/* ============================================================================
   PROJECTION vs RARITY — the exact convex frontier

   The tournament question this answers: to make a lineup rarer, how much projection do
   you have to give up? "Rarer" here is CUMULATIVE OWNERSHIP, the sum of the projected
   ownership of the players in it — the number this page already reports per lineup, and
   the one a field is measured in.

   The method is a Lagrangian sweep. For a weight L, solve the ordinary exact problem on
   proj[i] - L*own[i]. Whatever comes back is EXACTLY optimal for that weight, and it is
   a vertex of the upper convex hull of the achievable (own, proj) set. Probing L at the
   chord slope between two known vertices and recursing finds every vertex between them.

   ⚠️ IT IS THE HULL, NOT THE FRONTIER. A lineup sitting in a dent — beaten by the
   straight line between two hull vertices, but the best there is at its own ownership —
   is optimal for no weight L at all and cannot be found this way. No sweep of this kind
   can find one. `hull: true` rides on the result so the page has to say so.

   ⚠️ ONLY PROVED POINTS ARE PLOTTED. A solve that hits its slice of the clock returns
   the best lineup found so far, which is not the optimum and therefore not a vertex.
   Those are DISCARDED and `capped` goes true, rather than drawing an unproved point on
   a curve whose whole claim is exactness.

   ⚠️ THE RARE END IS THE EXPENSIVE END, and that is structural. Low ownership correlates
   with low salary, so "cheapest ownership while still spending the salary floor" sets
   the objective against the constraint and the salary-knapsack bound goes slack. On a
   full 13-game slate the max-projection solve is ~70ms and a large-L solve does not
   finish in 15s. So the sweep walks L UP only while probes keep succeeding, and stops.
   The curve then covers what was proved and says where it stopped.

   ⚠️ THE SHIFT IS NOT A FUDGE, BUT IT IS NOT FREE. proj[i] - L*own[i] goes negative for
   large L, and a non-positive projection means "no projection" everywhere else in this
   engine, which would silently empty the pool. A constant added to every eligible
   projection cannot change the winner, because every classic lineup holds exactly
   site.size players. (That is also why showdown is refused rather than answered wrong:
   the captain multiplier makes the constant non-uniform.) What the constant DOES cost is
   pruning — it compresses the relative spread the bound works on — which is the other
   half of why large L is slow.
   ========================================================================== */

var FRONTIER_MAX_SOLVES = 24;
var FRONTIER_WALK = 6;      // probes spent finding the rare end before refinement starts

/**
 * players/cfg: exactly as solveLineups takes them, plus `own` (percent) per player.
 * Returns { points, segments, solves, capped, hull, unavailable }.
 *   points[]   {ids, proj, own, sal, lam}  hull vertices, ascending ownership
 *   segments[] {from, to, rate}            rate = projection points per ownership point
 *   capped     the search stopped on its budget or the clock, not on convergence
 *   unavailable a reason string when no frontier can honestly be drawn at all
 */
function frontier(players, cfg, onProgress) {
  cfg = cfg || {};
  var site = SITES[cfg.site] || SITES.dk_classic;
  var out = { points: [], segments: [], solves: 0, capped: false, hull: true, unavailable: null };
  if (site.showdown) { out.unavailable = "showdown"; return out; }

  var own = [], anyOwn = false, i;
  for (i = 0; i < players.length; i++) {
    var v = +players[i].own || 0;
    own.push(v > 0 ? v : 0);
    if (v > 0) anyOwn = true;
  }
  if (!anyOwn) { out.unavailable = "no-ownership"; return out; }

  var budget = cfg.maxSolves > 0 ? Math.min(FRONTIER_MAX_SOLVES, cfg.maxSolves | 0) : FRONTIER_MAX_SOLVES;
  var deadline = Date.now() + (cfg.timeLimitMs || 30000);
  var seen = {}, points = [];

  function at(lam) {
    if (out.solves >= budget || Date.now() > deadline) { out.capped = true; return null; }
    out.solves++;
    if (onProgress) onProgress(out.solves, budget);

    var lo = 0, j;
    for (j = 0; j < players.length; j++) {
      if (!(players[j].proj > 0) && !players[j].lock) continue;
      var w = (players[j].proj || 0) - lam * own[j];
      if (w < lo) lo = w;
    }
    var shift = -lo + 1e-6;

    var shadow = [];
    for (j = 0; j < players.length; j++) {
      var p = players[j], q = {};
      for (var k in p) q[k] = p[k];
      // A player with no projection stays absent, exactly as everywhere else.
      q.proj = (p.proj > 0 || p.lock) ? (p.proj || 0) - lam * own[j] + shift : 0;
      shadow.push(q);
    }

    // A slice of what is left, not all of it: one hard weight must not starve the rest.
    var c = {}; for (var kk in cfg) c[kk] = cfg[kk];
    c.count = 1; c.randomness = 0; c.uniques = 0; c.seed = 1;
    c.timeLimitMs = Math.max(600, Math.floor((deadline - Date.now()) / Math.max(1, budget - out.solves + 1)));

    var res = solveLineups(shadow, c);
    if (!res || res.timedOut || !res.lineups.length) { out.capped = true; return null; }

    var ids = res.lineups[0].ids.slice();
    var key = ids.slice().sort(function (a, b) { return a - b; }).join(",");
    if (seen[key]) return seen[key];

    var pr = 0, ow = 0;
    for (j = 0; j < ids.length; j++) { pr += players[ids[j]].proj || 0; ow += own[ids[j]]; }
    var pt = { ids: ids, proj: pr, own: ow, sal: res.lineups[0].sal, lam: lam };
    seen[key] = pt; points.push(pt);
    return pt;
  }

  var top = at(0);                       // the plain max-projection lineup
  if (!top) { out.unavailable = "infeasible"; return out; }

  // Walk the weight up while probes keep succeeding, keeping the rarest lineup seen.
  // ⚠️ DO NOT stop because a probe returned the same lineup as the last one. Small
  // weights often do — the max-projection lineup stays optimal until the weight is big
  // enough to dislodge it — and an early stop there leaves the frontier a single point.
  var lam = 0.05, bot = top, walk = 0;
  while (walk++ < FRONTIER_WALK) {
    var nxt = at(lam);
    if (!nxt) break;                     // timed out, or the budget ran out
    if (nxt.own < bot.own - 1e-9) bot = nxt;
    lam *= 4;
  }
  // The rare end is "the rarest lineup this search reached", not provably the rarest
  // lineup on the slate — see the note above about why large weights do not finish.

  function refine(a, b, depth) {         // a = richer and more owned, b = leaner and rarer
    if (depth > 12) return;
    var dOwn = a.own - b.own;
    if (dOwn <= 1e-9) return;
    var slope = (a.proj - b.proj) / dOwn;
    var p = at(slope);
    if (!p) return;
    if (p.proj <= b.proj + (p.own - b.own) * slope + 1e-7) return;   // sits on the chord
    refine(a, p, depth + 1); refine(p, b, depth + 1);
  }
  refine(top, bot, 0);

  points.sort(function (a, b) { return a.own - b.own || b.proj - a.proj; });

  // Pareto filter first: a point beaten on BOTH axes by a rarer one is on no frontier,
  // hull or otherwise. This can only bite when the search was cut off mid-recursion.
  var pareto = [], bestProj = -Infinity;
  for (i = 0; i < points.length; i++) {
    if (points[i].proj > bestProj + 1e-9) { pareto.push(points[i]); bestProj = points[i].proj; }
  }
  // Then the upper hull: slopes must strictly decrease as ownership rises.
  var hull = [];
  for (i = 0; i < pareto.length; i++) {
    var c2 = pareto[i];
    while (hull.length >= 2) {
      var x = hull[hull.length - 2], y = hull[hull.length - 1];
      if ((y.proj - x.proj) * (c2.own - y.own) <= (c2.proj - y.proj) * (y.own - x.own) + 1e-9) hull.pop();
      else break;
    }
    hull.push(c2);
  }
  out.points = hull;
  for (i = 1; i < hull.length; i++) {
    out.segments.push({
      from: hull[i - 1], to: hull[i],
      rate: (hull[i].proj - hull[i - 1].proj) / (hull[i].own - hull[i - 1].own)
    });
  }
  return out;
}

root.DDFS.frontier = frontier;
root.DDFS.FRONTIER_MAX_SOLVES = FRONTIER_MAX_SOLVES;
root.DDFS.FRONTIER_WALK = FRONTIER_WALK;
'''

ENGINE_ANCHOR = "root.DDFS = { SITES, POS, solveLineups, rng, gauss };\n"

src = ENGINE.read_text()
s, e = src.find(START), src.find(END)
if s >= 0 and e > s:
    tail = src[e + len(END):]
    # ⚠️ eat the newline this script itself appended, or every re-run adds one more.
    src = src[:s] + (tail[1:] if tail[:1] == "\n" else tail)
assert src.count(ENGINE_ANCHOR) == 1, "engine export anchor is not unique"
src = src.replace(ENGINE_ANCHOR, ENGINE_ANCHOR + START + FRONTIER + END + "\n", 1)
ENGINE.write_text(src)
assert src.count(START) == 1 and src.count(END) == 1
print("engine: frontier block written (%d B)" % len(FRONTIER))

# --------------------------------------------------------------------------- page

page = PAGE.read_text()

OPEN = '<script type="text/plain" id="ddfsEngine">'
CLOSE = "</script>"
a = page.index(OPEN) + len(OPEN)
b = page.index(CLOSE, a)
old_block = page[a:b]
new_block = "\n" + ENGINE.read_text().rstrip("\n") + "\n"
if old_block != new_block:
    page = page[:a] + new_block + page[b:]
    print("page: engine block restamped (%d -> %d B)" % (len(old_block), len(new_block)))
else:
    print("page: engine block already current")

WORKER_OLD = """    } else if (d.op === "sim") {"""
WORKER_NEW = """    } else if (d.op === "frontier") {
      var f = R.frontier(d.players, d.cfg, function (n, t) { self.postMessage({ type: "progress", n: n, t: t }); });
      self.postMessage({ type: "done", result: f });
    } else if (d.op === "sim") {"""
if 'd.op === "frontier"' not in page:
    assert page.count(WORKER_OLD) == 1, "worker sim branch is not unique"
    page = page.replace(WORKER_OLD, WORKER_NEW, 1)
    print("page: worker frontier op added")
else:
    print("page: worker frontier op already present")

PAGE.write_text(page)

# --------------------------------------------------------------------------- prove

page = PAGE.read_text()
a = page.index(OPEN) + len(OPEN)
b = page.index(CLOSE, a)
assert page[a:b].strip() == ENGINE.read_text().strip(), \
    "inlined engine does not match work/dfs-engine.js"
assert "root.DDFS.frontier = frontier;" in page[a:b], "frontier missing from the inlined engine"
assert page.count('d.op === "frontier"') == 1, "worker op is not present exactly once"
print("ok: dfs.html engine block == work/dfs-engine.js  (%s)"
      % hashlib.sha256(ENGINE.read_bytes()).hexdigest()[:12])
