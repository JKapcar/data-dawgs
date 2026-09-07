/**
 * DFS Labs Phase 0.5 T1 — dashboard helpers (countdown, survivor join, pipeline chips).
 * Source of truth for unit tests; inlined into dfs.html. No ETR (I1 / H5).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSDashboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** DK / nflverse abbrev aliases → survivor.json canonical. */
  var ABBREV_CANON = {
    JAC: "JAX",
    JAX: "JAX",
    LA: "LAR",
    LAR: "LAR",
    WSH: "WAS",
    WAS: "WAS"
  };

  function normAbbrev(raw) {
    var t = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!t) return "";
    return ABBREV_CANON[t] || t;
  }

  /**
   * Format a remaining-ms countdown for the Next-lock card.
   * Device clock vs StartTime — pure; no Date.now() inside.
   */
  function formatCountdown(msRemaining) {
    if (msRemaining == null || !isFinite(msRemaining)) return "—";
    if (msRemaining <= 0) return "LOCKED";
    var sec = Math.floor(msRemaining / 1000);
    var days = Math.floor(sec / 86400);
    sec -= days * 86400;
    var hours = Math.floor(sec / 3600);
    sec -= hours * 3600;
    var mins = Math.floor(sec / 60);
    sec -= mins * 60;
    if (days >= 1) return days + "d " + hours + "h";
    if (hours >= 1) return hours + "h " + mins + "m";
    if (mins >= 1) return mins + "m " + sec + "s";
    return sec + "s";
  }

  function lockMsFromStart(startTime) {
    if (startTime == null || startTime === "") return null;
    var t = Date.parse(startTime);
    return isFinite(t) ? t : null;
  }

  /**
   * Join slate games (away/home/kickoff) to survivor.json rows.
   * Matches team codes with JAC/JAX, LA/LAR, WSH/WAS normalized.
   * Returns { rows, as_of, unmatched }.
   */
  function joinSurvivorSlate(games, survivorPayload, opts) {
    opts = opts || {};
    var envelope = survivorPayload || {};
    var data = envelope.data || envelope;
    var list = (data && data.games) || (Array.isArray(data) ? data : []) || [];
    var week = opts.week != null ? +opts.week : null;
    var byPair = {};
    for (var i = 0; i < list.length; i++) {
      var g = list[i] || {};
      if (week != null && isFinite(week) && +g.wk !== week) continue;
      var a = normAbbrev(g.a);
      var h = normAbbrev(g.h);
      if (!a || !h) continue;
      byPair[a + "@" + h] = g;
    }
    var rows = [];
    var unmatched = [];
    var asOf = envelope.as_of || (data && data.meta && data.meta.as_of) || null;
    (games || []).forEach(function (sg) {
      var away = normAbbrev(sg.away || (String(sg.gid || "").split("@")[0]));
      var home = normAbbrev(sg.home || (String(sg.gid || "").split("@")[1]));
      var key = away + "@" + home;
      var hit = byPair[key];
      if (!hit) {
        unmatched.push(key);
        rows.push({
          away: away,
          home: home,
          gid: sg.gid || key,
          kickoff: sg.kickoff || sg.startTime || null,
          p: null,
          mm: null,
          src: null,
          matched: false
        });
        return;
      }
      var src = hit.src === "market" || hit.src === "model" ? hit.src : (hit.src ? String(hit.src) : null);
      rows.push({
        away: away,
        home: home,
        gid: sg.gid || key,
        kickoff: sg.kickoff || sg.startTime || hit.d || null,
        p: hit.p != null ? +hit.p : null,
        mm: hit.mm != null ? +hit.mm : null,
        src: src,
        matched: true,
        d: hit.d || null
      });
    });
    return { rows: rows, as_of: asOf, unmatched: unmatched };
  }

  /**
   * Pipeline chip states from fixture-like S / session flags.
   * chips: Slate · Projections · Lineups · Sim · Exported · Graded
   * Each: { id, label, ready, detail, sheet }
   */
  function pipelineChips(S, session) {
    S = S || {};
    session = session || {};
    var players = S.players || [];
    var priced = players.filter(function (p) {
      return p && p.proj != null && isFinite(p.proj) && p.proj > 0 && !p.excl;
    }).length;
    var slateReady = players.length > 0;
    var projReady = priced > 0;
    var luReady = (S.lineups || []).length > 0;
    var simReady = !!(session.sim || S.simDone);
    var exported = !!(S.exportedAt || session.exportedAt);
    var graded = false;
    var gradeDetail = "";
    if (S.weeks && typeof S.weeks === "object") {
      var keys = Object.keys(S.weeks);
      for (var i = 0; i < keys.length; i++) {
        var w = S.weeks[keys[i]];
        if (w && (w.graded === true || w.grade)) {
          graded = true;
          gradeDetail = "week " + keys[i];
          break;
        }
      }
    }
    function chip(id, label, ready, detail, sheet) {
      return { id: id, label: label, ready: !!ready, detail: detail || "", sheet: sheet };
    }
    var slateDetail = slateReady
      ? (players.length + " players" + (S.slate && S.slate.source ? " · " + S.slate.source : ""))
      : "not loaded";
    if (S.slate && S.slate.loadedAt) slateDetail += " · " + String(S.slate.loadedAt).slice(0, 16);
    return [
      chip("slate", "Slate", slateReady, slateDetail, "slate"),
      chip("projections", "Projections", projReady, projReady ? priced + " priced" : "none", "slate"),
      chip("lineups", "Lineups", luReady, luReady ? S.lineups.length + " built" : "none", "solver"),
      chip("sim", "Sim", simReady, simReady ? "ran" : "not run", "sim"),
      chip("exported", "Exported", exported, exported ? String(S.exportedAt || session.exportedAt).slice(0, 16) : "no", "solver"),
      chip("graded", "Graded", graded, graded ? gradeDetail : "not yet", "standings")
    ];
  }

  /** Top Play-band contests from screener list (verdict === "play"). */
  function playBandList(screener, scoreFn, limit) {
    limit = limit == null ? 5 : limit;
    var list = screener || [];
    var scored = typeof scoreFn === "function"
      ? list.map(scoreFn)
      : list.map(function (c) {
          return c && c.verdict ? c : { contest: c, verdict: (c && c.verdict) || "tolerate", rank: c && c.rank };
        });
    return scored
      .filter(function (r) { return r && String(r.verdict).toLowerCase() === "play"; })
      .sort(function (a, b) { return (b.rank || 0) - (a.rank || 0); })
      .slice(0, limit);
  }

  /** Unique games from player pool for the Slate card. */
  function gamesFromPlayers(players) {
    var seen = {};
    var out = [];
    (players || []).forEach(function (p) {
      if (!p) return;
      var gid = p.gid || "";
      var away = p.away, home = p.home;
      if ((!away || !home) && gid.indexOf("@") >= 0) {
        var parts = gid.split("@");
        away = away || parts[0];
        home = home || parts[1];
      }
      away = normAbbrev(away);
      home = normAbbrev(home);
      if (!away || !home) return;
      var key = away + "@" + home;
      if (seen[key]) {
        if (!seen[key].kickoff && (p.kickoff || p.startTime)) {
          seen[key].kickoff = p.kickoff || p.startTime;
        }
        return;
      }
      var row = {
        away: away,
        home: home,
        gid: key,
        kickoff: p.kickoff || p.startTime || null
      };
      seen[key] = row;
      out.push(row);
    });
    return out;
  }

  function lastWeekCard(S, currentWeek) {
    S = S || {};
    var wk = currentWeek != null ? +currentWeek : null;
    if (S.weeks && typeof S.weeks === "object") {
      var keys = Object.keys(S.weeks).map(Number).filter(isFinite).sort(function (a, b) { return b - a; });
      if (keys.length) {
        var last = keys[0];
        var rec = S.weeks[last] || S.weeks[String(last)];
        return {
          week: last,
          graded: !!(rec && (rec.graded || rec.grade)),
          record: rec,
          empty: false,
          message: null
        };
      }
    }
    var n = wk != null && isFinite(wk) ? wk : null;
    return {
      week: n,
      graded: false,
      record: null,
      empty: true,
      message: n != null
        ? ("Week " + n + " not graded — ingest standings on the Standings sheet.")
        : "Week N not graded — ingest standings on the Standings sheet."
    };
  }

  return {
    ABBREV_CANON: ABBREV_CANON,
    normAbbrev: normAbbrev,
    formatCountdown: formatCountdown,
    lockMsFromStart: lockMsFromStart,
    joinSurvivorSlate: joinSurvivorSlate,
    pipelineChips: pipelineChips,
    playBandList: playBandList,
    gamesFromPlayers: gamesFromPlayers,
    lastWeekCard: lastWeekCard
  };
});
