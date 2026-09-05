/**
 * Receipts grades — Bible §9.1–9.3 (Phase 1: run on whatever exists).
 * On-device only (I3). Fits that need ≥3 weeks stay stubbed with prior labels (I5).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSReceipts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function fnv1a(str) {
    var h = 0x811c9dc5;
    str = String(str || "");
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function hashEntries(record) {
    if (!record || !record.entries) return record;
    record.entries.forEach(function (e) {
      if (e.entryName && !e.entryHash) e.entryHash = fnv1a(e.entryName);
    });
    return record;
  }

  /** Ownership-miss modes (Leone) — stub until projected vs realized owns exist */
  function ownershipMissModes(projected, realized) {
    projected = projected || [];
    realized = realized || [];
    if (!projected.length || !realized.length) {
      return {
        ready: false,
        prior: true,
        label: "prior (I5) — need projected + realized ownership columns",
        modes: []
      };
    }
    // best-effort: match by name
    var modes = { stack_piece: [], chalk_combo: [], differentiator: [] };
    // without lineup-level data we only flag large individual misses
    var byName = {};
    realized.forEach(function (r) { byName[String(r.name || "").toLowerCase()] = r; });
    projected.forEach(function (p) {
      var r = byName[String(p.name || "").toLowerCase()];
      if (!r) return;
      var d = (+r.own || 0) - (+p.own || 0);
      if (Math.abs(d) < 3) return;
      var bucket = Math.abs(d) >= 8 ? "differentiator" : "stack_piece";
      modes[bucket].push({ name: p.name, projected: +p.own, realized: +r.own, delta: d });
    });
    return { ready: true, prior: false, modes: modes, label: "graded from standings owns" };
  }

  function realizedVsProjectedDupes(rows) {
    rows = rows || [];
    if (!rows.length) {
      return { ready: false, prior: true, label: "prior (I5) — paste lineups with E[dupes] + realized copies", rows: [] };
    }
    return {
      ready: true,
      prior: false,
      rows: rows.map(function (r) {
        return {
          lineupId: r.lineupId,
          projected: r.projected,
          realized: r.realized,
          miss: (r.realized != null && r.projected != null) ? r.realized - r.projected : null,
          driverPair: r.driverPair || null
        };
      }),
      label: "realized vs projected dupes"
    };
  }

  /** ETR-style sim calibration buckets — empty until sim receipts stored */
  function simCalibrationTables(samples) {
    samples = samples || [];
    var cashBuckets = ["0-15", "15-18", "18-21", "21-24", "24-27", "27-30", "30+"];
    var roiBuckets = ["≤-40", "-40–-25", "-25–-10", "-10–0", "0–10", "10–25", "25–40", "≥40"];
    var top1Buckets = ["0-0.5", "0.5-1", "1-2", "2-4", "4+"];
    if (!samples.length) {
      return {
        ready: false,
        prior: true,
        label: "prior (I5) — need weekly sim vs realized ROI samples",
        cashBuckets: cashBuckets,
        roiBuckets: roiBuckets,
        top1Buckets: top1Buckets,
        counts: {}
      };
    }
    // placeholder counts
    return {
      ready: true,
      prior: false,
      label: "sim calibration (monotonicity is the pass condition)",
      cashBuckets: cashBuckets,
      roiBuckets: roiBuckets,
      top1Buckets: top1Buckets,
      n: samples.length
    };
  }

  function contestChoiceGrade(entries) {
    entries = entries || [];
    if (!entries.length) {
      return { ready: false, prior: true, label: "prior (I5) — log contests with screener rank + realized ROI", byType: {} };
    }
    var byType = {};
    entries.forEach(function (e) {
      var t = e.contestType || e.preset || "unknown";
      byType[t] = byType[t] || { n: 0, roiSum: 0 };
      byType[t].n++;
      byType[t].roiSum += (+e.roi || 0);
    });
    Object.keys(byType).forEach(function (t) {
      byType[t].meanRoi = byType[t].roiSum / byType[t].n;
    });
    return { ready: true, prior: false, byType: byType, label: "contest-choice grade" };
  }

  function processGrade(submissions) {
    submissions = submissions || [];
    if (!submissions.length) {
      return { ready: false, prior: true, label: "prior (I5) — track whether submit contest matched build preset (§4.3)", matched: 0, n: 0 };
    }
    var matched = submissions.filter(function (s) { return s.buildPreset && s.submitContestType && s.buildPreset === s.submitContestType; }).length;
    return {
      ready: true,
      prior: false,
      matched: matched,
      n: submissions.length,
      rate: matched / submissions.length,
      label: "process grade — submit-to-build match"
    };
  }

  function gradeWeek(bundle) {
    bundle = bundle || {};
    return {
      week: bundle.week || null,
      ownershipMiss: ownershipMissModes(bundle.projectedOwns, bundle.realizedOwns),
      dupes: realizedVsProjectedDupes(bundle.dupeRows),
      simCalibration: simCalibrationTables(bundle.simSamples),
      contestChoice: contestChoiceGrade(bundle.contestEntries),
      process: processGrade(bundle.submissions),
      generatedAt: new Date().toISOString(),
      note: "Phase 1 receipts run on whatever exists; empty sections stay labelled prior (I5)."
    };
  }

  return {
    fnv1a: fnv1a,
    hashEntries: hashEntries,
    ownershipMissModes: ownershipMissModes,
    realizedVsProjectedDupes: realizedVsProjectedDupes,
    simCalibrationTables: simCalibrationTables,
    contestChoiceGrade: contestChoiceGrade,
    processGrade: processGrade,
    gradeWeek: gradeWeek
  };
});
