/**
 * DFS week object — Phase 0.5 T6.
 * Derived aggregates only (I3): lineup hashes, never player lists / projections / ownership.
 * Receipts gates: lockedSha256 before kickoff; realized:null until Monday ingest; null stays null.
 */
(function (root, factory) {
  var api = factory(
    typeof globalThis !== "undefined" ? globalThis : root,
    typeof require === "function" ? require : null
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSWeek = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global, req) {
  "use strict";

  function receiptsApi() {
    if (global && global.DDFSReceipts) return global.DDFSReceipts;
    if (req) {
      try { return req("./dfs-receipts.js"); } catch (e) {}
    }
    return null;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function seasonWeek(S) {
    var season = (S && S.season) || 2026;
    var week = (S && S.week != null) ? +S.week : null;
    if (week == null && S && S.slate && S.slate.week != null) week = +S.slate.week;
    if (week == null || !isFinite(week)) week = 1;
    return { season: season, week: week };
  }

  function slateMeta(S) {
    S = S || {};
    var site = S.site || "dk_classic";
    var showdown = !!(S.site && String(S.site).indexOf("showdown") >= 0);
    var games = 0;
    if (S.players && S.players.length) {
      var seen = {};
      S.players.forEach(function (p) {
        var g = p.gid || p.game || ((p.team || "") + "@" + (p.opp || ""));
        if (g) seen[g] = 1;
      });
      games = Object.keys(seen).length;
    }
    return {
      site: site,
      showdown: showdown,
      draftGroupId: (S.slate && S.slate.draftGroupId) || null,
      games: games,
      demo: !!S.demo,
      source: (S.slate && S.slate.source) || (S.demo ? "demo" : "upload")
    };
  }

  function contestRows(contests) {
    contests = contests || [];
    return contests.map(function (c) {
      return {
        id: String(c.id || c.contestKey || c.contestId || ""),
        name: c.name || c.contestName || "",
        buyIn: c.buyIn != null ? +c.buyIn : (c.fee != null ? +c.fee : null),
        entryCap: c.entryCap != null ? +c.entryCap : null,
        fieldCap: c.fieldCap != null ? +c.fieldCap : null,
        preset: c.preset || c.presetKey || null
      };
    }).filter(function (c) { return c.id; });
  }

  function sourceLabel(S, kind) {
    if (!S) return "none";
    if (S.demo) return "demo";
    if (kind === "proj") {
      if (S.projSource) return String(S.projSource);
      var priced = (S.players || []).filter(function (p) { return p && p.proj != null && isFinite(p.proj); }).length;
      return priced ? "paste" : "none";
    }
    if (S.ownSource) return String(S.ownSource);
    var owned = (S.players || []).filter(function (p) { return p && +p.own > 0; }).length;
    return owned ? "paste" : "none";
  }

  function simExpectations(SIM, lineups, players) {
    var n = (lineups || []).length || 1;
    var expCash = null, expTop10 = null, expTop1 = null, eDupes = null;
    if (SIM && Array.isArray(SIM.perLineup) && SIM.perLineup.length) {
      var cash = 0, t10 = 0, t1 = 0;
      SIM.perLineup.forEach(function (r) {
        cash += +r.cash || 0;
        t10 += +r.top10 || +r.t10 || 0;
        t1 += +r.top1 || +r.win || 0;
      });
      expCash = cash / SIM.perLineup.length;
      expTop10 = t10 / SIM.perLineup.length;
      expTop1 = t1 / SIM.perLineup.length;
    }
    var R = receiptsApi();
    var Dupe = (global && global.DDFSDupe) || null;
    if (!Dupe && req) {
      try { Dupe = req("./dfs-dupe-model.js"); } catch (e) {}
    }
    if (Dupe && typeof Dupe.expectedDupes === "function" && lineups && lineups.length && players) {
      var sum = 0, m = 0;
      lineups.forEach(function (L) {
        try {
          var ed = Dupe.expectedDupes(L, players, { entries: (SIM && SIM.meta && SIM.meta.fieldSize) || 20000 });
          if (ed != null && isFinite(ed)) { sum += ed; m++; }
        } catch (e) {}
      });
      if (m) eDupes = sum / m;
    } else if (lineups && lineups.length) {
      var s2 = 0, m2 = 0;
      lineups.forEach(function (L) {
        if (L && L.eDupes != null && isFinite(L.eDupes)) { s2 += +L.eDupes; m2++; }
      });
      if (m2) eDupes = s2 / m2;
    }
    return { expCash: expCash, expTop10: expTop10, expTop1: expTop1, eDupes: eDupes, n: n };
  }

  /**
   * Build the week object (realized always null at lock).
   * lineups field = SHA-256 hashes only (via DDFSReceipts.hashEntries).
   */
  function build(S, SIM, contests) {
    S = S || {};
    var sw = seasonWeek(S);
    var R = receiptsApi();
    if (!R || typeof R.hashEntries !== "function") {
      throw new Error("DDFSReceipts.hashEntries required for week-object lineup hashes");
    }
    var hashed = R.hashEntries({
      players: S.players || [],
      lineups: S.lineups || []
    });
    var lineupHashes = (hashed && hashed.lineupHashes) || [];
    var exp = simExpectations(SIM, S.lineups || [], S.players || []);
    var lockAt = (S.lockAt) || isoNow();
    var obj = {
      season: sw.season,
      week: sw.week,
      lockAt: lockAt,
      slate: slateMeta(S),
      contests: contestRows(contests || S.contests || S.screener || []),
      lineups: lineupHashes,
      expCash: exp.expCash,
      expTop10: exp.expTop10,
      expTop1: exp.expTop1,
      eDupes: exp.eDupes,
      dupePrior: true,
      projSource: sourceLabel(S, "proj"),
      ownSource: sourceLabel(S, "own"),
      lockedSha256: null,
      realized: null
    };
    return obj;
  }

  /** Canonical JSON for hashing: stable key order, realized forced null, lockedSha256 omitted. */
  function canonicalPayload(weekObj) {
    var o = weekObj || {};
    return {
      season: o.season,
      week: o.week,
      lockAt: o.lockAt,
      slate: o.slate || null,
      contests: o.contests || [],
      lineups: o.lineups || [],
      expCash: o.expCash,
      expTop10: o.expTop10,
      expTop1: o.expTop1,
      eDupes: o.eDupes,
      dupePrior: o.dupePrior !== false,
      projSource: o.projSource || "none",
      ownSource: o.ownSource || "none",
      realized: null
    };
  }

  function canonicalString(weekObj) {
    return JSON.stringify(canonicalPayload(weekObj));
  }

  function sha256HexSync(text) {
    var R = receiptsApi();
    if (R && typeof R.sha256HexSync === "function") return R.sha256HexSync(text);
    if (typeof require === "function") {
      try {
        return require("crypto").createHash("sha256").update(String(text), "utf8").digest("hex");
      } catch (e) {}
    }
    throw new Error("sha256HexSync unavailable");
  }

  function stampLockedSha256(weekObj) {
    var s = canonicalString(weekObj);
    var hex = sha256HexSync(s);
    weekObj.lockedSha256 = hex;
    weekObj.realized = null;
    return weekObj;
  }

  async function stampLockedSha256Async(weekObj) {
    var R = receiptsApi();
    var s = canonicalString(weekObj);
    var hex;
    if (R && typeof R.sha256Hex === "function") hex = await R.sha256Hex(s);
    else hex = sha256HexSync(s);
    weekObj.lockedSha256 = hex;
    weekObj.realized = null;
    return weekObj;
  }

  /**
   * Fill realized from a standings record when contest id matches a week-object contest.
   * Match by lineup hash only — never store player lists. null stays null if no match.
   */
  function fillRealized(weekObj, standingsRecord) {
    if (!weekObj) return weekObj;
    if (weekObj.realized != null) return weekObj; // already filled — do not clobber? Spec: fill when ingest matches
    var contests = weekObj.contests || [];
    var rec = standingsRecord || {};
    var cid = String(rec.contestKey || rec.contestId || rec.id || "");
    var match = contests.some(function (c) { return String(c.id) === cid; });
    if (!match) return weekObj;

    var R = receiptsApi();
    var hashes = weekObj.lineups || [];
    var byHash = {};
    var entries = rec.entries || [];
    // Standings entries may carry lineupHash from hashEntries, or we hash lineup field ids if present
    entries.forEach(function (e) {
      var h = e.lineupHash || e.hash || null;
      if (!h && e.lineupDkIds && R && R.hashLineupIds) {
        h = R.hashLineupIds(e.lineupDkIds, e.cptId);
      }
      if (!h) return;
      if (hashes.indexOf(h) < 0) return;
      byHash[h] = {
        rank: e.rank != null ? e.rank : null,
        points: e.points != null ? e.points : null,
        entryHash: e.entryHash || null
      };
    });

    var n = hashes.length || 1;
    var cashed = 0, top10 = 0, top1 = 0, found = 0;
    var field = rec.n || entries.length || 0;
    hashes.forEach(function (h) {
      var r = byHash[h];
      if (!r) return;
      found++;
      if (r.rank != null) {
        // cash ≈ top 20% when paidFrac unknown — use rank vs field
        if (field > 0 && r.rank <= Math.max(1, Math.floor(field * 0.2))) cashed++;
        if (r.rank <= 10) top10++;
        if (r.rank === 1) top1++;
      }
    });

    weekObj.realized = {
      contestKey: cid,
      ingestedAt: isoNow(),
      matchedLineups: found,
      cashRate: found ? cashed / n : null,
      top10Rate: found ? top10 / n : null,
      top1Rate: found ? top1 / n : null,
      byHash: byHash
    };
    return weekObj;
  }

  /** Aggregate cash/ROI buckets over week objects that have realized filled. */
  function calibrationFromWeeks(weeks) {
    var R = receiptsApi();
    var samples = [];
    (weeks || []).forEach(function (w) {
      if (!w || w.realized == null) return;
      samples.push({
        cash: w.realized.cashRate,
        expCash: w.expCash,
        roi: w.realized.roi != null ? w.realized.roi : null,
        expRoi: w.expRoi != null ? w.expRoi : null,
        top1: w.realized.top1Rate,
        week: w.week
      });
    });
    if (R && typeof R.simCalibrationTables === "function") {
      return R.simCalibrationTables(samples);
    }
    return { ready: !!samples.length, prior: !samples.length, n: samples.length, samples: samples };
  }

  function weekKey(weekObj) {
    return String((weekObj && weekObj.season) || 2026) + "-W" + String((weekObj && weekObj.week) || 1);
  }

  /** Store under S.weeks[week] (and return downloadable JSON). */
  function storeInState(S, weekObj) {
    S = S || {};
    if (!S.weeks || typeof S.weeks !== "object") S.weeks = {};
    S.weeks[weekObj.week] = weekObj;
    S.weeksCurrent = weekObj.week;
    return S;
  }

  function totoReport(S) {
    S = S || {};
    var cur = S.weeksCurrent != null ? S.weeksCurrent : (S.week != null ? S.week : null);
    var w = (S.weeks && cur != null) ? S.weeks[cur] : null;
    if (!w && S.weeks) {
      var keys = Object.keys(S.weeks).map(Number).filter(isFinite).sort(function (a, b) { return b - a; });
      if (keys.length) w = S.weeks[keys[0]];
    }
    if (!w) return "WEEK OBJECT: none locked yet.";
    var sha = (w.lockedSha256 || "").slice(0, 8);
    var L = [];
    L.push("WEEK OBJECT: season " + w.season + " week " + w.week + " locked at " + w.lockAt + ".");
    L.push("Contests: " + ((w.contests && w.contests.length) || 0) +
      "; lineups (hashes): " + ((w.lineups && w.lineups.length) || 0) + ".");
    L.push("Expected — cash: " + fmtRate(w.expCash) +
      ", top10: " + fmtRate(w.expTop10) +
      ", top1: " + fmtRate(w.expTop1) +
      ", E[dupes]: " + (w.eDupes == null ? "—" : Number(w.eDupes).toFixed(3)) +
      (w.dupePrior ? " (prior)" : "") + ".");
    if (w.realized == null) {
      L.push("Realized: null (Monday ingest pending).");
    } else {
      L.push("Realized — cash: " + fmtRate(w.realized.cashRate) +
        ", top10: " + fmtRate(w.realized.top10Rate) +
        ", top1: " + fmtRate(w.realized.top1Rate) +
        ", matched: " + (w.realized.matchedLineups || 0) + ".");
    }
    L.push("Expectations were pre-registered at " + w.lockAt + "; sha " + sha + ".");
    return L.join("\n");
  }

  function fmtRate(v) {
    if (v == null || !isFinite(v)) return "—";
    return (v * 100).toFixed(1) + "%";
  }

  /** Assert week JSON has no player-identifying / projection / ownership payload. */
  function assertAggregateOnly(weekObj) {
    var raw = JSON.stringify(weekObj);
    var banned = ["proj", "ownership", "own%", "playerName", "\"name\":"];
    // Allow contest name / slate fields; ban player projection keys in lineups
    if (weekObj.lineups && weekObj.lineups.some(function (h) { return typeof h !== "string"; })) {
      return { ok: false, reason: "lineups must be hash strings only" };
    }
    if (raw.indexOf("\"players\"") >= 0) return { ok: false, reason: "players list leaked" };
    if (/\bprojections?\b/i.test(raw) && raw.indexOf("projSource") < 0) {
      return { ok: false, reason: "projections leaked" };
    }
    // ownership numbers as player owns
    if (/\"own\"\s*:/.test(raw)) return { ok: false, reason: "ownership field leaked" };
    return { ok: true };
  }

  return {
    build: build,
    canonicalPayload: canonicalPayload,
    canonicalString: canonicalString,
    stampLockedSha256: stampLockedSha256,
    stampLockedSha256Async: stampLockedSha256Async,
    fillRealized: fillRealized,
    calibrationFromWeeks: calibrationFromWeeks,
    weekKey: weekKey,
    storeInState: storeInState,
    totoReport: totoReport,
    assertAggregateOnly: assertAggregateOnly,
    contestRows: contestRows,
    slateMeta: slateMeta
  };
});
