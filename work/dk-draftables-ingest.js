/**
 * DraftKings draftables → DFS Labs player pool.
 * CORS proxy via toto (/dk/lobby, /dk/draftables); never stores DK data (I2).
 * Never fetches ETR (I1).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSDkDraftables = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CLASSIC_POS = { QB: 1, RB: 1, WR: 1, TE: 1, DST: 1 };
  var SHOWDOWN_POS = { QB: 1, RB: 1, WR: 1, TE: 1, DST: 1, K: 1 };
  /** ContestTypeId → salary formats we care about */
  var SALARY_TYPES = { 21: "classic", 96: "showdown" };
  /** Showdown Captain Mode rosterSlotIds (verified live 2026-09) */
  var SD_CPT = 511;
  var SD_FLEX = 512;

  function team(raw) {
    return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  }

  function normPos(pos) {
    pos = String(pos || "").trim().toUpperCase();
    if (pos === "D" || pos === "DEF" || pos === "D/ST") return "DST";
    return pos;
  }

  function normStatus(raw) {
    var s = String(raw || "").trim().toUpperCase();
    if (!s || s === "NONE" || s === "NULL") return "";
    if (s === "O") return "OUT";
    return s;
  }

  function parseGame(name, tm) {
    var gi = String(name || "");
    var m = gi.match(/([A-Za-z]{2,4})\s*@\s*([A-Za-z]{2,4})/);
    var away = m ? team(m[1]) : "";
    var home = m ? team(m[2]) : "";
    tm = team(tm);
    return {
      gid: m ? away + "@" + home : (tm || "?"),
      opp: tm === away ? home : (tm === home ? away : ""),
      away: away,
      home: home
    };
  }

  function fppgFromDraftable(d) {
    var attrs = d && d.draftStatAttributes;
    if (!attrs || !attrs.length) return 0;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].id === 90) {
        var n = parseFloat(attrs[i].value);
        return isFinite(n) ? n : 0;
      }
    }
    return 0;
  }

  /**
   * Filter lobby JSON to Classic (21) and Showdown Captain (96) draft groups.
   */
  function listNflSalaryDraftGroups(lobbyJson) {
    var groups = (lobbyJson && lobbyJson.DraftGroups) || [];
    var out = [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var ct = Number(g.ContestTypeId);
      var fmt = SALARY_TYPES[ct];
      if (!fmt) continue;
      var id = Number(g.DraftGroupId);
      if (!id) continue;
      var games = Number(g.GameCount) || 0;
      var tag = String(g.DraftGroupTag || "").trim();
      var suffix = String(g.StartTimeSuffix || "").trim();
      var labelParts = [
        fmt === "showdown" ? "Showdown" : "Classic",
        games ? (games + (games === 1 ? " game" : " games")) : null,
        tag || null,
        suffix || null,
        "DG " + id
      ].filter(Boolean);
      out.push({
        draftGroupId: id,
        contestTypeId: ct,
        gameCount: games,
        startTime: g.StartTime || null,
        draftGroupTag: tag,
        format: fmt,
        label: labelParts.join(" · ")
      });
    }
    out.sort(function (a, b) {
      if (a.format !== b.format) return a.format === "classic" ? -1 : 1;
      return b.gameCount - a.gameCount || a.draftGroupId - b.draftGroupId;
    });
    return out;
  }

  function detectFormat(draftables, opts) {
    opts = opts || {};
    if (opts.format === "classic" || opts.format === "showdown") return opts.format;
    var list = (draftables && draftables.draftables) || draftables || [];
    if (!Array.isArray(list)) list = [];
    for (var i = 0; i < list.length; i++) {
      var rs = Number(list[i].rosterSlotId);
      if (rs === SD_CPT || rs === SD_FLEX) return "showdown";
    }
    return "classic";
  }

  /**
   * Map draftables JSON → { players, showdown, games, format, statusCounts, dropped }.
   * Player shape matches DDFSIngest.readSalaries.
   */
  function playersFromDraftables(draftablesJson, opts) {
    opts = opts || {};
    var list = (draftablesJson && draftablesJson.draftables) || draftablesJson;
    if (!Array.isArray(list) || !list.length) {
      return { error: "No draftables in that response." };
    }
    var format = detectFormat(draftablesJson, opts);
    var allow = format === "showdown" ? SHOWDOWN_POS : CLASSIC_POS;
    var dropped = {};
    var statusCounts = {};

    if (format === "showdown") {
      var byPid = {};
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        var pos = normPos(d.position);
        if (!allow[pos]) {
          dropped[pos || "(blank)"] = (dropped[pos || "(blank)"] || 0) + 1;
          continue;
        }
        var sal = Number(d.salary) || 0;
        if (sal <= 0) continue;
        var pid = d.playerDkId != null ? String(d.playerDkId) : "";
        var name = String(d.displayName || ((d.firstName || "") + " " + (d.lastName || ""))).trim();
        if (!name) continue;
        var tm = team(d.teamAbbreviation);
        var g = parseGame(d.competition && d.competition.name, tm);
        var st = normStatus(d.status);
        statusCounts[st || "OK"] = (statusCounts[st || "OK"] || 0) + 1;
        var key = pid || (name.toLowerCase() + "|" + tm + "|" + pos);
        var rec = byPid[key] || (byPid[key] = {
          name: name, pos: pos, team: tm,
          gid: g.gid, opp: g.opp,
          sal: 0, dkId: "", cptId: "", cptSal: 0,
          avg: fppgFromDraftable(d),
          proj: null, own: 0, status: st
        });
        if (st && (!rec.status || rec.status === "Q")) rec.status = st;
        var rs = Number(d.rosterSlotId);
        var did = d.draftableId != null ? String(d.draftableId) : "";
        if (rs === SD_CPT) {
          rec.cptId = did || pid;
          rec.cptSal = sal;
        } else {
          // FLEX or unknown → FLEX salary/id
          rec.sal = sal;
          rec.dkId = did || pid;
          if (!rec.avg) rec.avg = fppgFromDraftable(d);
        }
      }
      var players = Object.keys(byPid).map(function (k) { return byPid[k]; })
        .filter(function (p) { return p.sal > 0; });
      // fill missing FLEX from CPT if needed
      players.forEach(function (p) {
        if (!p.sal && p.cptSal) {
          p.sal = Math.round(p.cptSal / 1.5 / 100) * 100;
        }
      });
      var games = {};
      players.forEach(function (p) { games[p.gid] = 1; });
      return {
        players: players,
        showdown: true,
        games: Object.keys(games).length,
        format: "dk-showdown",
        statusCounts: statusCounts,
        dropped: dropped
      };
    }

    // Classic: one row per playerDkId; prefer non-UTIL-looking primary slot
    // DK often emits FLEX (rosterSlotId 70) duplicates — keep highest "position purity"
    var byPidC = {};
    for (var j = 0; j < list.length; j++) {
      var c = list[j];
      var cpos = normPos(c.position);
      if (!allow[cpos]) {
        dropped[cpos || "(blank)"] = (dropped[cpos || "(blank)"] || 0) + 1;
        continue;
      }
      var csal = Number(c.salary) || 0;
      if (csal <= 0) continue;
      var cpid = c.playerDkId != null ? String(c.playerDkId) : "";
      var cname = String(c.displayName || ((c.firstName || "") + " " + (c.lastName || ""))).trim();
      if (!cname) continue;
      var ctm = team(c.teamAbbreviation);
      var cg = parseGame(c.competition && c.competition.name, ctm);
      var cst = normStatus(c.status);
      statusCounts[cst || "OK"] = (statusCounts[cst || "OK"] || 0) + 1;
      var ckey = cpid || (cname.toLowerCase() + "|" + ctm + "|" + cpos);
      var prev = byPidC[ckey];
      var cand = {
        name: cname, pos: cpos, team: ctm,
        gid: cg.gid, opp: cg.opp,
        sal: csal,
        dkId: c.draftableId != null ? String(c.draftableId) : cpid,
        cptId: "", cptSal: 0,
        avg: fppgFromDraftable(c),
        proj: null, own: 0, status: cst,
        _rs: Number(c.rosterSlotId) || 0
      };
      if (!prev) {
        byPidC[ckey] = cand;
        continue;
      }
      // Prefer lower rosterSlotId when duplicate (FLEX often higher id like 70)
      // Also prefer matching position slot over UTIL duplicates with same salary
      if (cand._rs && prev._rs && cand._rs < prev._rs) byPidC[ckey] = cand;
      else if (cst && !prev.status) prev.status = cst;
    }
    var classicPlayers = Object.keys(byPidC).map(function (k) {
      var p = byPidC[k];
      delete p._rs;
      return p;
    });
    var cgames = {};
    classicPlayers.forEach(function (p) { cgames[p.gid] = 1; });
    return {
      players: classicPlayers,
      showdown: false,
      games: Object.keys(cgames).length,
      format: "dk-classic",
      statusCounts: statusCounts,
      dropped: dropped
    };
  }

  function statusSummary(counts) {
    counts = counts || {};
    var parts = [];
    ["OUT", "Q", "IR"].forEach(function (k) {
      if (counts[k]) parts.push(counts[k] + " " + k);
    });
    return parts.join(", ");
  }

  return {
    SALARY_TYPES: SALARY_TYPES,
    listNflSalaryDraftGroups: listNflSalaryDraftGroups,
    playersFromDraftables: playersFromDraftables,
    detectFormat: detectFormat,
    statusSummary: statusSummary,
    normStatus: normStatus
  };
});
