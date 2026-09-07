/**
 * Receipts grades — Bible §9.1–9.3 (Phase 1: run on whatever exists).
 * On-device only (I3). Fits that need ≥3 weeks stay stubbed with prior labels (I5).
 *
 * Phase 0.5 T6: hashEntries also produces salt-less SHA-256 lineup hashes
 * (sorted DK ids + CPT) for the week-object path. PoC C1–C5 already hashed;
 * this enables week-object receipts.
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

  function sha256HexSync(text) {
    if (typeof require === "function") {
      try {
        return require("crypto").createHash("sha256").update(String(text), "utf8").digest("hex");
      } catch (e) {}
    }
    // Browser sync fallback via Subtle is unavailable; callers should prefer sha256Hex.
    throw new Error("sha256HexSync requires Node crypto (or await sha256Hex in browser)");
  }

  function sha256Hex(text) {
    text = String(text || "");
    if (typeof require === "function") {
      try {
        return Promise.resolve(
          require("crypto").createHash("sha256").update(text, "utf8").digest("hex")
        );
      } catch (e) {}
    }
    if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
      var buf = new TextEncoder().encode(text);
      return crypto.subtle.digest("SHA-256", buf).then(function (dig) {
        var bytes = new Uint8Array(dig);
        var out = "";
        for (var i = 0; i < bytes.length; i++) {
          out += ("0" + bytes[i].toString(16)).slice(-2);
        }
        return out;
      });
    }
    return Promise.reject(new Error("SHA-256 unavailable"));
  }

  /**
   * Salt-less SHA-256 of sorted DK ids + CPT.
   * tokens: ["12345:CPT", "67890:FLEX", ...] sorted, joined by "|".
   */
  function hashLineupIds(dkIds, cptId) {
    dkIds = (dkIds || []).map(function (id) { return String(id); }).filter(Boolean);
    cptId = cptId != null && cptId !== "" ? String(cptId) : null;
    var tokens = dkIds.map(function (id) {
      return id + ":" + (cptId && id === cptId ? "CPT" : "FLEX");
    });
    // If CPT id is not in dkIds (showdown sometimes separates), append it.
    if (cptId && dkIds.indexOf(cptId) < 0) tokens.push(cptId + ":CPT");
    tokens.sort();
    return sha256HexSync(tokens.join("|"));
  }

  function lineupDkIds(lineup, players) {
    players = players || [];
    lineup = lineup || {};
    var ids = [];
    var cptId = null;
    var slots = lineup.ids || [];
    var cptIdx = lineup.cpt;
    for (var i = 0; i < slots.length; i++) {
      var pi = slots[i];
      var p = players[pi];
      if (!p) continue;
      var isCpt = (cptIdx != null && pi === cptIdx) || (lineup.cptId && (p.cptId === lineup.cptId || p.dkId === lineup.cptId));
      var dk = isCpt ? (p.cptId || p.dkId) : p.dkId;
      if (dk == null || dk === "") continue;
      ids.push(String(dk));
      if (isCpt) cptId = String(dk);
    }
    if (lineup.cptDkId) cptId = String(lineup.cptDkId);
    if (lineup.dkIds && lineup.dkIds.length) {
      ids = lineup.dkIds.map(String);
      cptId = lineup.cptId != null ? String(lineup.cptId) : cptId;
    }
    return { dkIds: ids, cptId: cptId };
  }

  /**
   * hashEntries(record):
   * - Standings path (legacy): attach entryHash via fnv1a(entryName).
   * - Week-object path: when record.lineups (+ optional players) present, attach
   *   lineupHashes via salt-less SHA-256 of sorted DK ids + CPT.
   */
  function hashEntries(record) {
    if (!record) return record;
    if (record.entries) {
      record.entries.forEach(function (e) {
        if (e.entryName && !e.entryHash) e.entryHash = fnv1a(e.entryName);
      });
    }
    if (record.lineups && Array.isArray(record.lineups)) {
      var players = record.players || [];
      record.lineupHashes = record.lineups.map(function (L) {
        if (typeof L === "string" && /^[a-f0-9]{64}$/i.test(L)) return L.toLowerCase();
        var pair = lineupDkIds(L, players);
        return hashLineupIds(pair.dkIds, pair.cptId);
      });
    }
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
    var modes = { stack_piece: [], chalk_combo: [], differentiator: [] };
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
    function cashBucket(rate) {
      if (rate == null || !isFinite(rate)) return null;
      var p = rate <= 1 ? rate * 100 : rate;
      if (p < 15) return "0-15";
      if (p < 18) return "15-18";
      if (p < 21) return "18-21";
      if (p < 24) return "21-24";
      if (p < 27) return "24-27";
      if (p < 30) return "27-30";
      return "30+";
    }
    function roiBucket(roi) {
      if (roi == null || !isFinite(roi)) return null;
      var p = roi <= 1 && roi >= -1 ? roi * 100 : roi;
      if (p <= -40) return "≤-40";
      if (p <= -25) return "-40–-25";
      if (p <= -10) return "-25–-10";
      if (p < 0) return "-10–0";
      if (p < 10) return "0–10";
      if (p < 25) return "10–25";
      if (p < 40) return "25–40";
      return "≥40";
    }
    var cashCounts = {}, roiCounts = {};
    cashBuckets.forEach(function (b) { cashCounts[b] = 0; });
    roiBuckets.forEach(function (b) { roiCounts[b] = 0; });
    samples.forEach(function (s) {
      var cb = cashBucket(s.cash != null ? s.cash : s.realizedCash);
      if (cb) cashCounts[cb]++;
      var rb = roiBucket(s.roi != null ? s.roi : s.realizedRoi);
      if (rb) roiCounts[rb]++;
    });
    return {
      ready: true,
      prior: false,
      label: "sim calibration over weeks with realized (monotonicity is the pass condition)",
      cashBuckets: cashBuckets,
      roiBuckets: roiBuckets,
      top1Buckets: top1Buckets,
      counts: { cash: cashCounts, roi: roiCounts },
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
    var cal = simCalibrationTables(bundle.simSamples);
    if (bundle.weeksWithRealized && bundle.weeksWithRealized.length) {
      cal = simCalibrationTables(bundle.weeksWithRealized.map(function (w) {
        return {
          cash: w.realized && w.realized.cashRate,
          roi: w.realized && w.realized.roi,
          week: w.week
        };
      }));
    }
    return {
      week: bundle.week || null,
      ownershipMiss: ownershipMissModes(bundle.projectedOwns, bundle.realizedOwns),
      dupes: realizedVsProjectedDupes(bundle.dupeRows),
      simCalibration: cal,
      contestChoice: contestChoiceGrade(bundle.contestEntries),
      process: processGrade(bundle.submissions),
      generatedAt: new Date().toISOString(),
      note: "Phase 1 receipts run on whatever exists; empty sections stay labelled prior (I5). Week-object path fills cashBuckets/roiBuckets only over weeks with realized."
    };
  }

  return {
    fnv1a: fnv1a,
    sha256HexSync: sha256HexSync,
    sha256Hex: sha256Hex,
    hashLineupIds: hashLineupIds,
    lineupDkIds: lineupDkIds,
    hashEntries: hashEntries,
    ownershipMissModes: ownershipMissModes,
    realizedVsProjectedDupes: realizedVsProjectedDupes,
    simCalibrationTables: simCalibrationTables,
    contestChoiceGrade: contestChoiceGrade,
    processGrade: processGrade,
    gradeWeek: gradeWeek
  };
});
