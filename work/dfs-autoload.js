/**
 * DFS Labs Phase 0.5 T2 — Auto-load on open.
 * Pure picker + projection carry helpers. Source for dfs.html (keep in sync).
 * Never fetches ETR (I1). Never auto-loads demo. Never runs solver/sim.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSAutoload = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CLASSIC_TYPE = 21;
  var SHOWDOWN_TYPE = 96;

  function parseLockMs(raw) {
    if (raw == null || raw === "") return null;
    if (typeof raw === "number" && isFinite(raw)) return raw;
    var s = String(raw).trim();
    // ASP.NET /Date(ms)/
    var m = s.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);
    if (m) return Number(m[1]);
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }

  function groupLockMs(g) {
    if (!g) return null;
    if (g.lockMs != null && isFinite(g.lockMs)) return +g.lockMs;
    return parseLockMs(
      g.startTime != null ? g.startTime
        : (g.StartTime != null ? g.StartTime
          : (g.StartDate != null ? g.StartDate
            : (g.StartDateEst != null ? g.StartDateEst : null)))
    );
  }

  /**
   * True when lock instant is Sunday 1:00 pm America/New_York (±2 minutes).
   */
  function isSundayMainSlotEt(ms) {
    if (ms == null || !isFinite(ms)) return false;
    var d = new Date(ms);
    var parts = {};
    try {
      var fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      });
      fmt.formatToParts(d).forEach(function (p) {
        if (p.type !== "literal") parts[p.type] = p.value;
      });
    } catch (e) {
      // Fallback: treat UTC-4 as ET (EDT) — good enough for unit fixtures.
      var et = new Date(ms - 4 * 3600 * 1000);
      parts.weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][et.getUTCDay()];
      parts.hour = String(et.getUTCHours()).padStart(2, "0");
      parts.minute = String(et.getUTCMinutes()).padStart(2, "0");
    }
    if (String(parts.weekday || "").slice(0, 3) !== "Sun") return false;
    var hour = parseInt(parts.hour, 10);
    var minute = parseInt(parts.minute, 10);
    if (!isFinite(hour) || !isFinite(minute)) return false;
    var mins = hour * 60 + minute;
    // 1:00 pm ET = 13:00 → tolerate ±2 minutes
    return Math.abs(mins - (13 * 60)) <= 2;
  }

  function asGroups(lobbyOrGroups) {
    if (!lobbyOrGroups) return [];
    if (Array.isArray(lobbyOrGroups)) return lobbyOrGroups;
    // Prefer shared ingest when available (Node require or page global).
    var ingest = null;
    try {
      if (typeof module === "object" && module.exports) {
        ingest = require("./dk-draftables-ingest.js");
      }
    } catch (e) { ingest = null; }
    if (!ingest && typeof globalThis !== "undefined" && globalThis.DDFSDkDraftables) {
      ingest = globalThis.DDFSDkDraftables;
    }
    if (ingest && typeof ingest.listNflSalaryDraftGroups === "function") {
      return ingest.listNflSalaryDraftGroups(lobbyOrGroups);
    }
    // Minimal fallback for fixtures that already look like mapped groups.
    var raw = lobbyOrGroups.DraftGroups || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var g = raw[i];
      var ct = Number(g.ContestTypeId);
      var fmt = ct === SHOWDOWN_TYPE ? "showdown" : (ct === CLASSIC_TYPE ? "classic" : null);
      if (!fmt) continue;
      out.push({
        draftGroupId: Number(g.DraftGroupId),
        contestTypeId: ct,
        gameCount: Number(g.GameCount) || 0,
        startTime: g.StartTime || g.StartDate || g.StartDateEst || null,
        draftGroupTag: String(g.DraftGroupTag || ""),
        format: fmt,
        label: fmt + " · DG " + g.DraftGroupId
      });
    }
    return out;
  }

  function nextLockingShowdown(groups, nowMs) {
    nowMs = nowMs == null ? Date.now() : +nowMs;
    var cands = (groups || []).filter(function (g) {
      return g && (g.format === "showdown" || Number(g.contestTypeId) === SHOWDOWN_TYPE);
    });
    var future = [], past = [];
    cands.forEach(function (g) {
      var ms = groupLockMs(g);
      if (ms == null) return;
      var row = Object.assign({}, g, { lockMs: ms });
      if (ms >= nowMs) future.push(row);
      else past.push(row);
    });
    future.sort(function (a, b) { return a.lockMs - b.lockMs || a.draftGroupId - b.draftGroupId; });
    if (future.length) return future[0];
    past.sort(function (a, b) { return b.lockMs - a.lockMs || a.draftGroupId - b.draftGroupId; });
    return past[0] || null;
  }

  /**
   * Classic "main" = among ContestTypeId 21 groups whose lock is the earliest
   * Sunday 1:00 pm ET slot, the one with the largest GameCount.
   */
  function pickClassicMain(groups, nowMs) {
    nowMs = nowMs == null ? Date.now() : +nowMs;
    var classics = (groups || []).filter(function (g) {
      return g && (g.format === "classic" || Number(g.contestTypeId) === CLASSIC_TYPE);
    }).map(function (g) {
      return Object.assign({}, g, { lockMs: groupLockMs(g) });
    }).filter(function (g) {
      return g.lockMs != null && isSundayMainSlotEt(g.lockMs);
    });
    if (!classics.length) return null;

    // Prefer upcoming Sunday mains; else the most recent past Sunday main week.
    var future = classics.filter(function (g) { return g.lockMs >= nowMs; });
    var pool = future.length ? future : classics;
    var earliest = Math.min.apply(null, pool.map(function (g) { return g.lockMs; }));
    var atSlot = pool.filter(function (g) { return g.lockMs === earliest; });
    atSlot.sort(function (a, b) {
      return (b.gameCount || 0) - (a.gameCount || 0) || a.draftGroupId - b.draftGroupId;
    });
    return atSlot[0] || null;
  }

  /**
   * Pick primary (locks first) + alternate (the other of showdown/classic-main).
   * Clean hook for T1 dashboard one-tap switch: return.alternate + return.switchTo().
   */
  function pickAutoloadTargets(lobbyOrGroups, nowMs) {
    var groups = asGroups(lobbyOrGroups);
    var showdown = nextLockingShowdown(groups, nowMs);
    var classicMain = pickClassicMain(groups, nowMs);
    var primary = null;
    var alternate = null;
    if (showdown && classicMain) {
      if (showdown.lockMs <= classicMain.lockMs) {
        primary = showdown; alternate = classicMain;
      } else {
        primary = classicMain; alternate = showdown;
      }
    } else {
      primary = showdown || classicMain;
      alternate = null;
    }
    return {
      groups: groups,
      showdown: showdown,
      classicMain: classicMain,
      primary: primary,
      alternate: alternate,
      /** T1 hook: which target to load when the user one-taps the switch. */
      switchTarget: alternate
    };
  }

  function playerMatchKey(p) {
    if (!p) return "";
    if (p.playerDkId != null && String(p.playerDkId) !== "") return "pid:" + String(p.playerDkId);
    if (p.dkId != null && String(p.dkId) !== "") return "dk:" + String(p.dkId);
    return "";
  }

  /**
   * Carry proj/own from previous pool onto a freshly loaded pool.
   * Same draft group → match by DK player id (playerDkId, else dkId).
   * Different group → drop projections and return a visible notice.
   */
  function carryProjections(prevPlayers, nextPlayers, opts) {
    opts = opts || {};
    var sameGroup = !!opts.sameGroup;
    var next = (nextPlayers || []).map(function (p) {
      var q = Object.assign({}, p);
      return q;
    });
    if (!sameGroup) {
      next.forEach(function (p) {
        p.proj = null;
        p.own = 0;
      });
      return {
        players: next,
        carried: 0,
        dropped: (prevPlayers || []).filter(function (p) {
          return p && p.proj != null && isFinite(p.proj);
        }).length,
        notice: "Projections from the previous draft group were cleared — paste them again for this slate."
      };
    }
    var idx = {};
    (prevPlayers || []).forEach(function (p) {
      var k = playerMatchKey(p);
      if (k) idx[k] = p;
    });
    var carried = 0;
    next.forEach(function (p) {
      var prev = idx[playerMatchKey(p)];
      if (!prev) return;
      if (prev.proj != null && isFinite(prev.proj)) {
        p.proj = prev.proj;
        carried++;
      }
      if (prev.own != null && isFinite(prev.own) && prev.own > 0) p.own = prev.own;
      if (prev.lock) p.lock = true;
      if (prev.excl) p.excl = true;
      if (prev.maxExp != null) p.maxExp = prev.maxExp;
    });
    return {
      players: next,
      carried: carried,
      dropped: 0,
      notice: carried
        ? ("Kept " + carried + " projection" + (carried === 1 ? "" : "s") + " from the previous load of this draft group.")
        : ""
    };
  }

  function slateMeta(opts) {
    opts = opts || {};
    return {
      loadedAt: opts.loadedAt != null ? opts.loadedAt : new Date().toISOString(),
      source: opts.source || null, // "toto" | "csv" | "demo"
      draftGroupId: opts.draftGroupId != null ? opts.draftGroupId : null,
      stale: !!opts.stale
    };
  }

  return {
    CLASSIC_TYPE: CLASSIC_TYPE,
    SHOWDOWN_TYPE: SHOWDOWN_TYPE,
    parseLockMs: parseLockMs,
    groupLockMs: groupLockMs,
    isSundayMainSlotEt: isSundayMainSlotEt,
    nextLockingShowdown: nextLockingShowdown,
    pickClassicMain: pickClassicMain,
    pickAutoloadTargets: pickAutoloadTargets,
    carryProjections: carryProjections,
    playerMatchKey: playerMatchKey,
    slateMeta: slateMeta
  };
});
