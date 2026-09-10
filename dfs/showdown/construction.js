/**
 * Showdown construction helpers — build shape, stack profile, max-projection baseline.
 *
 * DK Showdown only (C3): 6 spots, 1 CPT at 1.5x salary and 1.5x points, $50,000 cap,
 * players from exactly two teams.
 *
 * Pure and deterministic (C5): no randomness, no network, no clock.
 *
 * Module format matches the other DFS modules in work/ (UMD, global + CommonJS) so the
 * source can be pasted into dfs.html under a `source:` comment the way dfs-engine.js and
 * dfs-validators.js already are, and still be require()d headless by the tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDSDBuild = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SALARY_CAP = 50000;
  var ROSTER_SIZE = 6;
  var CPT_MULT = 1.5;

  function indexPlayers(slate) {
    var by = {};
    (slate.players || []).forEach(function (p) { if (p && p.id != null) by[String(p.id)] = p; });
    return by;
  }

  /** Resolve a lineup's ids to Player objects. Returns null for any id not in the slate. */
  function resolve(lineup, slate) {
    var by = indexPlayers(slate);
    var cpt = by[String(lineup.cpt)] || null;
    var flex = (lineup.flex || []).map(function (id) { return by[String(id)] || null; });
    return { cpt: cpt, flex: flex, all: [cpt].concat(flex) };
  }

  function salaryOf(p, isCpt) {
    var base = +p.salary || 0;
    return isCpt ? base * CPT_MULT : base;
  }

  function lineupSalary(res) {
    var t = res.cpt ? salaryOf(res.cpt, true) : 0;
    res.flex.forEach(function (p) { if (p) t += salaryOf(p, false); });
    return t;
  }

  function lineupProj(res) {
    var t = res.cpt ? (+res.cpt.proj || 0) * CPT_MULT : 0;
    res.flex.forEach(function (p) { if (p) t += (+p.proj || 0); });
    return t;
  }

  /** The two teams the slate is played between. Order is [away, home] when both are given. */
  function slateTeams(slate) {
    if (slate.away && slate.home) return [slate.away, slate.home];
    var seen = [];
    (slate.players || []).forEach(function (p) {
      if (p && p.team && seen.indexOf(p.team) < 0) seen.push(p.team);
    });
    return seen;
  }

  /**
   * The favored team, plus a note when we had to infer it.
   * A pick'em (spread 0) is scored as home-favored so the build type still has a stable
   * orientation; the note travels with the result so the UI never presents that as read.
   */
  function favoriteOf(slate) {
    var notes = [];
    var fav = slate.favorite;
    if (+slate.spread === 0) {
      fav = slate.home;
      notes.push({ code: "pickem_favorite", message: "Spread is 0; the home team is treated as the favorite for build orientation." });
    }
    if (!fav) {
      fav = slate.home || slateTeams(slate)[0] || null;
      notes.push({ code: "favorite_missing", message: "No favorite on the slate; build orientation is a guess." });
    }
    return { favorite: fav, notes: notes };
  }

  /**
   * Build shape, always written favorite-first: "5-1" is 5 favorite / 1 dog, "1-5" the
   * reverse. heavySide is the team with more players (the CPT counts as a player) and is
   * null for a 3-3, which has no heavy side by definition.
   */
  function classifyBuild(lineup, slate) {
    var res = resolve(lineup, slate);
    var fav = favoriteOf(slate);
    var favSide = 0, dogSide = 0;
    var count = {};
    res.all.forEach(function (p) {
      if (!p) return;
      count[p.team] = (count[p.team] || 0) + 1;
      if (p.team === fav.favorite) favSide++; else dogSide++;
    });
    var heavySide = null;
    var teams = Object.keys(count);
    if (teams.length === 1) heavySide = teams[0];
    else if (favSide > dogSide) heavySide = fav.favorite;
    else if (dogSide > favSide) heavySide = teams.filter(function (t) { return t !== fav.favorite; })[0] || null;
    return {
      type: favSide + "-" + dogSide,
      heavySide: heavySide,
      favSide: favSide,
      dogSide: dogSide,
      favorite: fav.favorite,
      notes: fav.notes
    };
  }

  function isWRTE(p) { return p.pos === "WR" || p.pos === "TE"; }

  /**
   * Stack profile, all counts taken relative to the CAPTAIN's team.
   * WR/TE counts are FLEX-only — the captain is excluded from his own stack count, so a
   * CPT WR with one teammate WR reads as sameTeamWRTE:1.
   */
  function stackProfile(lineup, slate) {
    var res = resolve(lineup, slate);
    var cpt = res.cpt;
    var out = {
      sameTeamWRTE: 0, oppWRTE: 0, sameTeamRB: 0,
      hasOwnQB: false, hasOppQB: false,
      ownK: false, oppK: false,
      dstTeammates: 0
    };
    if (!cpt) return out;
    var own = cpt.team;

    res.flex.forEach(function (p) {
      if (!p) return;
      var same = p.team === own;
      if (isWRTE(p)) { if (same) out.sameTeamWRTE++; else out.oppWRTE++; }
      if (p.pos === "RB" && same) out.sameTeamRB++;
    });

    res.all.forEach(function (p) {
      if (!p) return;
      var same = p.team === own;
      if (p.pos === "QB") { if (same) out.hasOwnQB = true; else out.hasOppQB = true; }
      if (p.pos === "K") { if (same) out.ownK = true; else out.oppK = true; }
    });

    // Teammates behind the defense, counting the captain. The D/ST itself is not its own
    // teammate, so a 5-man onslaught with the D/ST reads as 4.
    var dst = res.all.filter(function (p) { return p && p.pos === "DST"; })[0];
    if (dst) {
      out.dstTeammates = res.all.filter(function (p) {
        return p && p !== dst && p.team === dst.team;
      }).length;
    }
    return out;
  }

  /**
   * Projection total of the best legal lineup on the slate, with the captain at 1.5x.
   *
   * Brute force over every captain, then a greedy-with-backtracking fill of the five FLEX
   * spots. The pool is one game — at most ~40 players — so the exhaustive captain loop is
   * cheap, and within a captain the five best-projecting affordable players are optimal
   * unless the cap binds, which the salary-aware pass handles.
   *
   * Cached per slate id. A slate object without an id is computed every call rather than
   * risk serving a stale number for a changed pool.
   */
  var maxProjCache = {};
  function computeSlateMaxProj(slate) {
    var key = slate && slate.id;
    if (key && Object.prototype.hasOwnProperty.call(maxProjCache, key)) return maxProjCache[key];

    var pool = (slate.players || []).filter(function (p) { return p && +p.salary > 0; });
    var best = 0;
    for (var c = 0; c < pool.length; c++) {
      var cpt = pool[c];
      var budget = SALARY_CAP - salaryOf(cpt, true);
      if (budget < 0) continue;
      var rest = pool.filter(function (p) { return p !== cpt; })
        .sort(function (a, b) { return (+b.proj || 0) - (+a.proj || 0); });
      var total = bestFive(rest, budget);
      if (total == null) continue;
      var score = (+cpt.proj || 0) * CPT_MULT + total;
      if (score > best) best = score;
    }
    if (key) maxProjCache[key] = best;
    return best;
  }

  /**
   * Highest projection reachable with exactly five of `rest` under `budget`.
   * Depth-first over a projection-sorted pool with two prunes: a remaining-best bound and
   * a cheapest-tail feasibility bound. Returns null when five cannot be afforded.
   */
  function bestFive(rest, budget) {
    var n = rest.length;
    if (n < 5) return null;
    // Suffix maxima of projection and minima of salary, for the two prunes.
    var cheapestTail = new Array(n + 1).fill(0);
    var salSorted = rest.map(function (p) { return +p.salary || 0; }).slice().sort(function (a, b) { return a - b; });
    var cheapestFive = salSorted.slice(0, 5).reduce(function (a, b) { return a + b; }, 0);
    if (cheapestFive > budget) return null;

    var bestProjFrom = new Array(n + 1).fill(0);
    for (var i = n - 1; i >= 0; i--) bestProjFrom[i] = Math.max(bestProjFrom[i + 1], +rest[i].proj || 0);
    var minSalFrom = new Array(n + 1).fill(Infinity);
    for (var j = n - 1; j >= 0; j--) minSalFrom[j] = Math.min(minSalFrom[j + 1], +rest[j].salary || 0);
    cheapestTail = minSalFrom;

    var best = null;
    (function walk(start, picked, spent, proj) {
      if (picked === 5) { if (best == null || proj > best) best = proj; return; }
      var need = 5 - picked;
      if (start + need > n) return;
      if (spent + cheapestTail[start] * need > budget) return;
      if (best != null && proj + bestProjFrom[start] * need <= best) return;
      for (var k = start; k <= n - need; k++) {
        var p = rest[k];
        var s = spent + (+p.salary || 0);
        if (s > budget) continue;
        walk(k + 1, picked + 1, s, proj + (+p.proj || 0));
      }
    })(0, 0, 0, 0);
    return best;
  }

  function clearCache() { maxProjCache = {}; }

  return {
    SALARY_CAP: SALARY_CAP,
    ROSTER_SIZE: ROSTER_SIZE,
    CPT_MULT: CPT_MULT,
    resolve: resolve,
    salaryOf: salaryOf,
    lineupSalary: lineupSalary,
    lineupProj: lineupProj,
    slateTeams: slateTeams,
    favoriteOf: favoriteOf,
    classifyBuild: classifyBuild,
    stackProfile: stackProfile,
    computeSlateMaxProj: computeSlateMaxProj,
    clearCache: clearCache
  };
});
