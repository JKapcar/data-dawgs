/**
 * Construction validators + lineup-to-contest fit — Bible §4.2 / §4.3.
 * pass | warn | info — never hard-block (override with logged reason).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSValidators = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function issue(level, code, message, extra) {
    var o = { level: level, code: code, message: message };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }

  function playersOf(lineup, pool) {
    return (lineup.ids || []).map(function (i) { return pool[i]; }).filter(Boolean);
  }

  function showdownSplit(lineup, pool) {
    var cpt = lineup.cpt != null ? pool[lineup.cpt] : null;
    if (!cpt) return { label: "unknown", cptSide: 0, other: 0 };
    var cptTeam = cpt.team;
    var cptSide = 0, other = 0;
    playersOf(lineup, pool).forEach(function (p) {
      if (p.team === cptTeam) cptSide++; else other++;
    });
    var label = cptSide + "-" + other;
    if (cptSide === 6) label = "6-0";
    return { label: label, cptSide: cptSide, other: other, cptTeam: cptTeam, cptPos: cpt.pos };
  }

  function validateClassicLineup(lineup, pool, opts) {
    opts = opts || {};
    var issues = [];
    var ps = playersOf(lineup, pool);
    var byTeam = {};
    ps.forEach(function (p) {
      byTeam[p.team] = byTeam[p.team] || [];
      byTeam[p.team].push(p);
    });
    var qb = ps.filter(function (p) { return p.pos === "QB"; })[0];
    if (qb) {
      var mates = byTeam[qb.team] || [];
      var passCatch = mates.filter(function (p) { return p.pos === "WR" || p.pos === "TE"; });
      if (passCatch.length === 0) {
        issues.push(issue("warn", "naked_qb", "Naked QB — no same-team WR/TE (strongest negative field signal)."));
      }
      // double-stack = QB + 2 pass catchers
      if (passCatch.length >= 2) {
        var opp = qb.opp;
        var bring = ps.filter(function (p) { return p.team === opp; });
        if (!bring.length) {
          issues.push(issue("warn", "no_bringback", "Double-stack without a bring-back from the opponent."));
        }
      }
    }
    Object.keys(byTeam).forEach(function (tm) {
      var rbs = byTeam[tm].filter(function (p) { return p.pos === "RB"; });
      if (rbs.length >= 2) {
        issues.push(issue("warn", "rb_double", "Two RBs from " + tm + "."));
      }
      var dst = byTeam[tm].filter(function (p) { return p.pos === "DST"; })[0];
      if (dst && byTeam[tm].some(function (p) { return p.pos !== "DST"; })) {
        // same-team DST vs own stack — DST is on same team as offense pieces
        issues.push(issue("warn", "dst_with_stack", "D/ST stacked with offense on " + tm + "."));
      }
    });

    var ownSum = ps.reduce(function (t, p) { return t + (+p.own || 0); }, 0);
    // ownership may be 0–100
    var thr = opts.ownThreshold;
    if (thr == null) {
      var owns = pool.filter(function (p) { return p && p.proj > 0; }).map(function (p) { return +p.own || 0; });
      if (owns.length >= 8) {
        var mean = owns.reduce(function (a, b) { return a + b; }, 0) / owns.length;
        var sd = Math.sqrt(owns.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / owns.length);
        // slate adaptive: field mean + 1 SD, scaled to 9-man classic (~9 * mean roughly for sum)
        thr = (mean + sd) * Math.min(9, ps.length);
      } else thr = 125; // fallback only when no slate owns — still not a hard block
    }
    if (ownSum > thr) {
      issues.push(issue("warn", "cum_own", "Cumulative ownership " + ownSum.toFixed(0) + "% above slate-adaptive threshold " + thr.toFixed(0) + "%.", { ownSum: ownSum, threshold: thr }));
    }

    if (opts.dupe && opts.dupe.eDupes != null && opts.dupeThreshold != null && opts.dupe.eDupes > opts.dupeThreshold) {
      var drv = (opts.dupe.drivers && opts.dupe.drivers[0]) ? (" Pair: " + opts.dupe.drivers[0].a + " + " + opts.dupe.drivers[0].b + ".") : "";
      issues.push(issue("warn", "edupes", "E[dupes] " + opts.dupe.eDupes.toFixed(2) + " above threshold " + opts.dupeThreshold.toFixed(2) + " (prior)." + drv, { prior: true }));
    }

    var flex = null; // info only — FLEX is not tagged in ids; skip detailed FLEX lean
    var qbSal = qb ? qb.sal : null;
    if (qbSal != null) {
      issues.push(issue("info", "qb_salary", "QB salary tier $" + qbSal + "."));
    }

    return issues;
  }

  function validateShowdownLineup(lineup, pool, opts) {
    opts = opts || {};
    var issues = [];
    var ps = playersOf(lineup, pool);
    var split = showdownSplit(lineup, pool);
    issues.push(issue("info", "split", "Showdown split " + split.label + " (CPT-side " + split.cptSide + ").", { split: split }));

    var cpt = lineup.cpt != null ? pool[lineup.cpt] : null;
    if (cpt && (cpt.pos === "K" || cpt.pos === "DST")) {
      issues.push(issue("warn", "cpt_k_dst", "CPT is " + cpt.pos + "."));
    }
    if (cpt && cpt.pos === "QB") {
      var catchers = ps.filter(function (p) { return p.team === cpt.team && (p.pos === "WR" || p.pos === "TE"); });
      if (catchers.length < 2) {
        issues.push(issue("warn", "cpt_qb_thin", "CPT QB without ≥2 same-team pass-catchers."));
      }
    }
    if (cpt && (cpt.pos === "QB" || cpt.pos === "WR" || cpt.pos === "TE")) {
      var bring = ps.filter(function (p) { return p.team === cpt.opp; });
      if (!bring.length) {
        issues.push(issue("warn", "sd_no_bringback", "No bring-back when CPT is " + cpt.pos + "."));
      }
    }
    if (cpt && cpt.pos === "QB") {
      var badK = ps.filter(function (p) { return p.pos === "K" && p.team === cpt.team; });
      if (badK.length) issues.push(issue("warn", "k_with_cpt_qb", "K rostered with CPT QB of the same team."));
    }
    var kCount = ps.filter(function (p) { return p.pos === "K"; }).length;
    var dstCount = ps.filter(function (p) { return p.pos === "DST"; }).length;
    if (kCount + dstCount >= 3) {
      issues.push(issue("warn", "k_dst_heavy", "K+DST count ≥ 3."));
    }
    var dst = ps.filter(function (p) { return p.pos === "DST"; })[0];
    if (dst) {
      var vs = ps.filter(function (p) { return p.pos !== "DST" && p.team === dst.opp; });
      if (vs.length >= 4) {
        issues.push(issue("warn", "dst_vs_stack", "D/ST with ≥4 opposing players."));
      }
    }

    var site = opts.site || { cap: 50000 };
    var salLeft = (site.cap || 50000) - (lineup.sal || 0);
    if (salLeft >= 0) {
      issues.push(issue("info", "salary_left", "Salary left under cap: $" + salLeft + " (dupe-reduction lever)."));
    }

    if (opts.dupe && opts.dupe.eDupes != null && opts.dupeThreshold != null && opts.dupe.eDupes > opts.dupeThreshold) {
      var drv = (opts.dupe.drivers && opts.dupe.drivers[0]) ? (" Pair: " + opts.dupe.drivers[0].a + " + " + opts.dupe.drivers[0].b + ".") : "";
      issues.push(issue("warn", "edupes", "E[dupes] " + opts.dupe.eDupes.toFixed(2) + " above threshold " + opts.dupeThreshold.toFixed(2) + " (prior)." + drv, { prior: true }));
    }

    return issues;
  }

  function validateLineup(lineup, pool, opts) {
    opts = opts || {};
    if (opts.showdown) return validateShowdownLineup(lineup, pool, opts);
    return validateClassicLineup(lineup, pool, opts);
  }

  function validateSet(lineups, pool, opts) {
    opts = opts || {};
    var Dupe = (typeof globalThis !== "undefined" && globalThis.DDFSDupe) || null;
    try { if (!Dupe && typeof require === "function") Dupe = require("./dfs-dupe-model.js"); } catch (e) {}

    var results = [];
    var entries = +opts.entries || 20000;
    var thr = opts.dupeThreshold;
    if (thr == null && Dupe) thr = Dupe.thresholdForContest(entries, { smallField: entries < 1000 });

    for (var i = 0; i < (lineups || []).length; i++) {
      var lu = lineups[i];
      var dupe = null;
      if (Dupe) {
        dupe = Dupe.expectedDupes(lu, pool, { entries: entries, showdown: !!opts.showdown });
      }
      var issues = validateLineup(lu, pool, {
        showdown: opts.showdown,
        site: opts.site,
        dupe: dupe,
        dupeThreshold: thr,
        ownThreshold: opts.ownThreshold
      });
      var warns = issues.filter(function (x) { return x.level === "warn"; }).length;
      results.push({
        index: i,
        issues: issues,
        eDupes: dupe && dupe.eDupes,
        dupePrior: true,
        status: warns ? "warn" : "pass"
      });
    }
    return {
      results: results,
      summary: {
        n: results.length,
        warns: results.filter(function (r) { return r.status === "warn"; }).length,
        passes: results.filter(function (r) { return r.status === "pass"; }).length,
        meanEDupes: results.length ? results.reduce(function (t, r) { return t + (r.eDupes || 0); }, 0) / results.length : 0,
        prior: true,
        label: "prior (I5)"
      }
    };
  }

  /**
   * §4.3 fit check — single score 0–100 + offending dimension.
   */
  function fitCheck(lineups, pool, preset, contest) {
    contest = contest || {};
    preset = preset || {};
    var entries = +contest.fieldCap || +contest.entries || 20000;
    var report = validateSet(lineups, pool, {
      showdown: !!preset.showdown || /showdown/i.test(String(contest.gameType || "")),
      entries: entries,
      site: { cap: 50000 }
    });
    var dims = [];
    var meanDup = report.summary.meanEDupes;
    var dupThr = (typeof globalThis !== "undefined" && globalThis.DDFSDupe)
      ? globalThis.DDFSDupe.thresholdForContest(entries)
      : entries / 10000;
    if (meanDup > dupThr * 1.5) dims.push({ dim: "edupes", detail: "mean E[dupes] " + meanDup.toFixed(2) + " vs thr " + dupThr.toFixed(2) });

    var needUniq = preset.minUniques || 0;
    if (needUniq > 0 && lineups.length >= 2) {
      var ok = true;
      for (var i = 0; i < lineups.length && ok; i++) {
        for (var j = i + 1; j < lineups.length; j++) {
          var a = {};
          (lineups[i].ids || []).forEach(function (id) { a[id] = 1; });
          var diff = 0;
          (lineups[j].ids || []).forEach(function (id) { if (!a[id]) diff++; });
          (lineups[i].ids || []).forEach(function (id) {
            var inB = (lineups[j].ids || []).indexOf(id) >= 0;
            if (!inB) diff++;
          });
          // unique players = symmetric difference / 2-ish; use count of ids in A not in B
          var onlyA = (lineups[i].ids || []).filter(function (id) { return (lineups[j].ids || []).indexOf(id) < 0; }).length;
          if (onlyA < needUniq) { ok = false; break; }
        }
      }
      if (!ok) dims.push({ dim: "min_uniques", detail: "min-uniques " + needUniq + " not satisfied across the set" });
    }

    var wantN = preset.lineups || 1;
    var entryCap = +contest.entryCap || +contest.maxEntries || wantN;
    if (lineups.length > entryCap) {
      dims.push({ dim: "entry_cap", detail: lineups.length + " lineups > entry cap " + entryCap });
    }

    // variance vs objective heuristic: cash preset with high randomness flagged elsewhere;
    // here: cash objective but many lineups
    if (preset.key === "cash" && lineups.length > 1) {
      dims.push({ dim: "variance", detail: "cash preset usually wants 1 lineup; set has " + lineups.length });
    }
    if ((preset.key === "mme" || preset.key === "milly" || preset.key === "sd_wildcat") && lineups.length < 3) {
      dims.push({ dim: "variance", detail: "top-heavy preset with only " + lineups.length + " lineup(s)" });
    }

    var score = 100;
    dims.forEach(function () { score -= 18; });
    if (score < 0) score = 0;
    var offender = dims.length ? dims[0].dim : null;
    return {
      score: score,
      offender: offender,
      dimensions: dims,
      validation: report.summary,
      prior: true,
      label: "prior (I5) — fit uses prior E[dupes] until standings grade it"
    };
  }

  /**
   * Block export only when DK entries contest type ≠ build preset (§4.3).
   */
  function exportAllowed(buildPresetKey, entriesContestType) {
    if (!buildPresetKey || !entriesContestType) return { ok: true, reason: null };
    var a = String(buildPresetKey);
    var b = String(entriesContestType).toLowerCase();
    var sdBuild = /^sd_/.test(a);
    var sdEntry = /showdown|captain|wildcat|field.?general/.test(b);
    var cashBuild = a === "cash";
    var cashEntry = /cash|double.?up|50.?50|h2h/.test(b);
    if (sdBuild !== sdEntry && (sdBuild || sdEntry)) {
      return { ok: false, reason: "Showdown/classic mismatch between build preset and entries contest type." };
    }
    if (cashBuild && !cashEntry && /gpp|milly|tournament/.test(b)) {
      return { ok: false, reason: "Cash-preset set cannot export into a GPP entries file without override." };
    }
    return { ok: true, reason: null };
  }

  return {
    validateLineup: validateLineup,
    validateSet: validateSet,
    fitCheck: fitCheck,
    exportAllowed: exportAllowed,
    showdownSplit: showdownSplit
  };
});
