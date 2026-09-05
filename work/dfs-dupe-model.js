/**
 * Dupe estimator — Bible §3.1–3.2.
 * E[dupes](L) = entries × Π own_i × Π c_jk
 * All c_jk are PRIORS until ≥3 weeks standings (I5) — every result carries prior:true.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSDupe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PAIR_PRIORS = [
    { id: "cpt_wr_qb", label: "CPT WR + same-team QB (showdown)", c: 1.98 },
    { id: "two_rb_same", label: "Two same-team RBs", c: 1.29 },
    { id: "qb_opp_dst", label: "QB + opposing D/ST", c: 0.36 },
    { id: "qb_same_wrte", label: "QB + same-team WR1/TE1 (classic)", c: 1.5 },
    { id: "rb_same_dst", label: "RB + same-team D/ST", c: 1.2 }
  ];

  function ownFrac(p) {
    var o = +((p && p.own) || 0);
    if (!isFinite(o) || o <= 0) return 0.001; // floor so log/product defined
    if (o > 1) o = o / 100;
    if (o > 1) o = 1;
    if (o < 0.001) o = 0.001;
    return o;
  }

  function isPassCatcher(pos) {
    return pos === "WR" || pos === "TE";
  }

  /**
   * Classify pair (a,b) player objects → prior multiplier.
   * opts.showdown + cptIndex into lineup ids handled by caller via flags on players:
   *   p._isCpt boolean when showdown captain.
   */
  function pairMultiplier(a, b) {
    var pa = a.pos, pb = b.pos;
    var ta = a.team, tb = b.team;
    var ca = !!a._isCpt, cb = !!b._isCpt;

    // CPT WR + same-team QB
    if (ca || cb) {
      var cpt = ca ? a : b, oth = ca ? b : a;
      if (cpt.pos === "WR" && oth.pos === "QB" && cpt.team === oth.team) return { c: 1.98, id: "cpt_wr_qb" };
      if (cpt.pos === "QB" && oth.pos === "WR" && cpt.team === oth.team) return { c: 1.98, id: "cpt_wr_qb" };
    }

    if (pa === "RB" && pb === "RB" && ta && ta === tb) return { c: 1.29, id: "two_rb_same" };

    if ((pa === "QB" && pb === "DST" && a.opp && a.opp === tb) ||
        (pb === "QB" && pa === "DST" && b.opp && b.opp === ta)) {
      return { c: 0.36, id: "qb_opp_dst" };
    }

    if ((pa === "QB" && isPassCatcher(pb) && ta && ta === tb) ||
        (pb === "QB" && isPassCatcher(pa) && ta && ta === tb)) {
      return { c: 1.5, id: "qb_same_wrte" };
    }

    if ((pa === "RB" && pb === "DST" && ta && ta === tb) ||
        (pb === "RB" && pa === "DST" && ta && ta === tb)) {
      return { c: 1.2, id: "rb_same_dst" };
    }

    return { c: 1.0, id: "indep" };
  }

  /**
   * @param {object} lineup { ids: number[], cpt?: number }
   * @param {object[]} players
   * @param {object} opts { entries, showdown }
   */
  function expectedDupes(lineup, players, opts) {
    opts = opts || {};
    var entries = Math.max(1, +opts.entries || 1);
    var ids = (lineup && lineup.ids) || [];
    if (!ids.length) {
      return { error: "empty lineup", prior: true, label: "prior (I5)" };
    }

    var plist = ids.map(function (i) {
      var p = players[i] || {};
      var copy = {
        name: p.name, pos: p.pos, team: p.team, opp: p.opp, own: p.own,
        _isCpt: opts.showdown && lineup.cpt != null && i === lineup.cpt
      };
      return copy;
    });

    var productOwn = 1;
    for (var i = 0; i < plist.length; i++) productOwn *= ownFrac(plist[i]);

    var pairProd = 1;
    var drivers = [];
    for (var a = 0; a < plist.length; a++) {
      for (var b = a + 1; b < plist.length; b++) {
        var m = pairMultiplier(plist[a], plist[b]);
        pairProd *= m.c;
        if (m.c !== 1) {
          drivers.push({
            a: plist[a].name, b: plist[b].name,
            id: m.id, c: m.c
          });
        }
      }
    }
    drivers.sort(function (x, y) { return Math.abs(Math.log(y.c)) - Math.abs(Math.log(x.c)); });

    var J = productOwn * pairProd;
    var eDupes = entries * J;
    var rarity = 0;
    for (var r = 0; r < plist.length; r++) rarity += -Math.log(ownFrac(plist[r]));

    return {
      entries: entries,
      productOwn: productOwn,
      pairProduct: pairProd,
      J: J,
      eDupes: eDupes,
      rarity: rarity,
      drivers: drivers.slice(0, 5),
      prior: true,
      label: "prior (I5) — §3.2 seeds until ≥3 weeks standings"
    };
  }

  function thresholdForContest(entries, opts) {
    opts = opts || {};
    entries = +entries || 0;
    if (opts.smallField || entries > 0 && entries < 1000) return 3;
    if (entries >= 1000) return entries / 10000;
    return 3;
  }

  return {
    PAIR_PRIORS: PAIR_PRIORS,
    ownFrac: ownFrac,
    pairMultiplier: pairMultiplier,
    expectedDupes: expectedDupes,
    thresholdForContest: thresholdForContest
  };
});
