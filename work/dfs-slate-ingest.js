/**
 * DFS slate ingest — DK salary CSV + ETR-shaped projection paste.
 * Source of truth for parsers used by dfs.html (keep page copy in sync via
 * work/patch-dfs-slate-ingest.py). Never fetch or commit paid ETR content (I1).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSIngest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CLASSIC_POS = { QB: 1, RB: 1, WR: 1, TE: 1, DST: 1 };
  var SHOWDOWN_POS = { QB: 1, RB: 1, WR: 1, TE: 1, DST: 1, K: 1 };

  function parseCSV(text) {
    text = String(text || "").replace(/^\uFEFF/, "");
    var rows = [], row = [], cell = "", i = 0, q = false;
    while (i < text.length) {
      var ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { q = true; i++; continue; }
      if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = ""; i++; continue;
      }
      cell += ch; i++;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
  }

  function team(raw) {
    return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  }

  function normName(name) {
    return String(name || "").toLowerCase().replace(/\./g, "").replace(/'/g, "")
      .replace(/\s+(jr|sr|ii|iii|iv)$/i, "").replace(/\s+/g, " ").trim();
  }

  function nameKeys(name, tm) {
    var n = normName(name);
    var parts = n.split(" ");
    var first = parts[0] || "", last = parts[parts.length - 1] || "";
    var keys = [n];
    if (tm) keys.unshift(n + "|" + tm);
    if (parts.length > 1) keys.push(first.slice(0, 1) + " " + last + (tm ? "|" + tm : ""));
    return keys;
  }

  function findCol(cells, names) {
    var i, j, c;
    for (i = 0; i < names.length; i++) {
      j = cells.indexOf(names[i]);
      if (j >= 0) return j;
    }
    for (i = 0; i < names.length; i++) {
      for (j = 0; j < cells.length; j++) {
        c = cells[j];
        if (c === names[i] || c.indexOf(names[i]) >= 0) return j;
      }
    }
    return -1;
  }

  function parseMoney(raw) {
    var n = parseFloat(String(raw || "").replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? Math.round(n) : 0;
  }

  function parseOwn(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var pct = /%$/.test(s);
    var n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
    if (!isFinite(n)) return null;
    if (pct) return n;
    if (n > 0 && n <= 1) return n * 100;
    return n;
  }

  function classifyHeader(cells) {
    var low = cells.map(function (c) { return String(c).trim().toLowerCase(); });
    var hasCptSal = findCol(low, ["cpt salary", "captain salary"]) >= 0;
    var hasCptOwn = findCol(low, ["cpt own", "captain own", "cpt ownership"]) >= 0;
    var hasRp = findCol(low, ["roster position"]) >= 0;
    var hasDkSal = findCol(low, ["dk salary"]) >= 0;
    var hasSal = findCol(low, ["salary", "dk salary"]) >= 0;
    var hasPos = findCol(low, ["position", "dk pos"]) >= 0;
    var hasName = findCol(low, ["name", "player", "name + id", "player name"]) >= 0;
    var hasProj = findCol(low, ["dk proj", "projection", "proj", "fpts", "points"]) >= 0;
    var hasFieldOwn = findCol(low, ["small field", "large field", "total own", "own", "ownership"]) >= 0;
    var hasGi = findCol(low, ["game info", "gameinfo"]) >= 0;

    if (hasRp && hasSal && hasPos && hasName) return "dk-salary";
    if (hasCptSal || hasCptOwn) return "etr-showdown";
    if (hasDkSal && hasProj) return "etr-classic";
    if (hasSal && hasPos && hasName && hasProj && !hasGi) return hasFieldOwn ? "etr-classic" : "etr-or-proj";
    if (hasSal && hasPos && hasName && hasGi) return "dk-salary";
    if (hasSal && hasPos && hasName) return "dk-salary-loose";
    if (hasProj && hasName) return "proj-paste";
    return "unknown";
  }

  function readSalaries(text) {
    var rows = parseCSV(text);
    if (!rows.length) return { error: "That file was empty." };

    var hdr = -1, idx = null, headerKind = "unknown";
    for (var i = 0; i < Math.min(rows.length, 16); i++) {
      var cells = rows[i].map(function (c) { return String(c).trim().toLowerCase(); });
      var cSal = findCol(cells, ["salary", "dk salary"]);
      var cPos = findCol(cells, ["position", "dk pos"]);
      var cName = findCol(cells, ["name", "player", "name + id", "player name"]);
      if (cSal < 0 || cPos < 0 || cName < 0) continue;
      hdr = i;
      headerKind = classifyHeader(cells);
      idx = {
        pos: cPos, name: cName, sal: cSal,
        id: findCol(cells, ["id"]),
        rp: findCol(cells, ["roster position"]),
        gi: findCol(cells, ["game info", "gameinfo"]),
        tm: findCol(cells, ["teamabbrev", "team"]),
        avg: findCol(cells, ["avgpointspergame"]),
        cptSal: findCol(cells, ["cpt salary", "captain salary"])
      };
      break;
    }
    if (hdr < 0) {
      return { error: "This does not look like a DraftKings salary export — no row with Position/Name/Salary (or DK Pos/Player/DK Salary) was found." };
    }
    if (headerKind === "etr-showdown" || (idx.cptSal >= 0 && idx.rp < 0)) {
      return {
        error: "This looks like an ETR Showdown projection board (CPT Salary / CPT Own columns), not a DraftKings salary export. Paste it into the projections box, or export DKSalaries.csv from the contest lineup page (desktop).",
        format: "etr-showdown",
        hint: "proj-paste"
      };
    }

    var warnings = [];
    if (headerKind === "etr-classic") {
      warnings.push("File looks like an ETR classic board. Salaries may load, but prefer DK Export to CSV for official IDs; paste projections separately.");
    }

    // Scan for showdown signal first (any CPT roster position)
    var anyCpt = false;
    if (idx.rp >= 0) {
      for (var s = hdr + 1; s < rows.length; s++) {
        var rp0 = String(rows[s][idx.rp] || "").trim().toUpperCase();
        if (rp0 === "CPT" || rp0 === "CAPTAIN") { anyCpt = true; break; }
      }
    }
    var allowPos = anyCpt ? SHOWDOWN_POS : CLASSIC_POS;
    var bySlot = {};
    var dropped = {};

    for (var r = hdr + 1; r < rows.length; r++) {
      var row = rows[r];
      var name = String(row[idx.name] || "").trim();
      var idFromName = "";
      var mId = name.match(/^(.*)\s*\((\d+)\)\s*$/);
      if (mId) { name = mId[1].trim(); idFromName = mId[2]; }
      var sal = parseMoney(row[idx.sal]);
      if (!name || sal <= 0) continue;
      var pos = String(row[idx.pos] || "").trim().toUpperCase();
      if (pos === "D" || pos === "DEF" || pos === "D/ST") pos = "DST";
      if (!allowPos[pos]) {
        dropped[pos || "(blank)"] = (dropped[pos || "(blank)"] || 0) + 1;
        continue;
      }
      var tm = team(idx.tm >= 0 ? row[idx.tm] : "");
      var gi = idx.gi >= 0 ? String(row[idx.gi] || "") : "";
      var m = gi.match(/([A-Za-z]{2,4})\s*@\s*([A-Za-z]{2,4})/);
      var away = m ? team(m[1]) : "", home = m ? team(m[2]) : "";
      var rp = idx.rp >= 0 ? String(row[idx.rp] || "").trim().toUpperCase() : "";
      var id = idx.id >= 0 ? String(row[idx.id] || "").trim() : (idFromName || "");
      var key = normName(name) + "|" + tm + "|" + pos;
      var rec = bySlot[key] || (bySlot[key] = {
        name: name, pos: pos, team: tm,
        gid: m ? away + "@" + home : (tm || "?"),
        opp: tm === away ? home : (tm === home ? away : ""),
        sal: 0, dkId: "", cptId: "", cptSal: 0,
        avg: idx.avg >= 0 ? parseFloat(row[idx.avg]) || 0 : 0,
        proj: null, own: 0, status: ""
      });
      if (rp === "CPT" || rp === "CAPTAIN") { rec.cptId = id; rec.cptSal = sal; }
      else { rec.sal = sal; rec.dkId = id; }
      if (!rec.sal && sal) {
        rec.sal = (rp === "CPT" || rp === "CAPTAIN") ? Math.round(sal / 1.5 / 100) * 100 : sal;
        rec.dkId = rec.dkId || id;
      }
    }

    var players = Object.keys(bySlot).map(function (k) { return bySlot[k]; }).filter(function (p) { return p.sal > 0; });
    if (!players.length) return { error: "Found the header but no player rows underneath it.", dropped: dropped };
    var showdown = players.some(function (p) { return p.cptId; });
    var games = {};
    players.forEach(function (p) { games[p.gid] = 1; });
    return {
      players: players,
      showdown: showdown,
      games: Object.keys(games).length,
      format: showdown ? "dk-showdown" : "dk-classic",
      warnings: warnings,
      dropped: dropped
    };
  }

  /**
   * Apply projection/ownership paste onto an existing player pool.
   * opts.ownTier: "large" | "small" | "auto" (default auto: Large Field > Total Own > Small Field > own)
   */
  function applyProjections(text, players, map, opts) {
    opts = opts || {};
    var rows = parseCSV(text);
    if (rows.length < 2) return { error: "Paste a header row and at least one player." };
    var head = rows[0].map(function (c) { return String(c).trim(); });
    var low = head.map(function (h) { return h.toLowerCase(); });

    function guess(cands, exclude) {
      var c, j;
      for (c = 0; c < cands.length; c++) {
        j = low.indexOf(cands[c]);
        if (j >= 0 && j !== exclude) return j;
      }
      for (c = 0; c < cands.length; c++) {
        for (j = 0; j < low.length; j++) {
          if (j !== exclude && low[j].indexOf(cands[c]) >= 0) return j;
        }
      }
      return -1;
    }

    var iName = map && map.name >= 0 ? map.name : guess(["player", "name", "playername", "player name"]);
    var iProj = map && map.proj >= 0 ? map.proj : guess(["dk proj", "proj", "projection", "fpts", "points", "median", "dk points", "proj points"]);
    var iTeam = map && map.team >= -1 ? map.team : guess(["team", "tm", "teamabbrev"]);
    var iOwn = -1;
    if (map && map.own >= 0) iOwn = map.own;
    else {
      var tier = opts.ownTier || "auto";
      if (tier === "large") iOwn = guess(["large field", "own", "ownership", "total own", "own%", "proj own", "roster%", "pown"]);
      else if (tier === "small") iOwn = guess(["small field", "own", "ownership", "total own", "own%", "proj own", "roster%", "pown"]);
      else {
        iOwn = guess(["large field"]);
        if (iOwn < 0) iOwn = guess(["total own"]);
        if (iOwn < 0) iOwn = guess(["small field"]);
        if (iOwn < 0) iOwn = guess(["own", "ownership", "own%", "proj own", "roster%", "pown"]);
      }
    }
    var iCptOwn = guess(["cpt own", "captain own", "cpt ownership"]);
    var iCptProj = guess(["cpt projection", "captain projection", "cpt proj"]);
    var iId = guess(["id"]);

    if (iName < 0 || iProj < 0) {
      return { error: "Could not tell which column is the player name and which is the projection. Pick them below.", head: head };
    }

    var index = {};
    players.forEach(function (p, i) {
      nameKeys(p.name, p.team).forEach(function (k) {
        if (!(k in index)) index[k] = i;
      });
      if (p.dkId) index["id:" + p.dkId] = i;
    });

    var matched = 0, missed = [], seen = {};
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var nm = String(row[iName] || "").trim();
      if (!nm) continue;
      var pv = parseFloat(String(row[iProj]).replace(/[^0-9.\-]/g, ""));
      if (!isFinite(pv)) continue;
      var tm = iTeam >= 0 ? team(row[iTeam]) : "";
      var hit = -1;
      if (iId >= 0) {
        var rid = String(row[iId] || "").trim();
        if (rid && ("id:" + rid) in index) hit = index["id:" + rid];
      }
      if (hit < 0) {
        nameKeys(nm, tm).forEach(function (k) {
          if (hit < 0 && k in index) hit = index[k];
        });
      }
      if (hit < 0) { missed.push(nm); continue; }
      if (seen[hit]) continue;
      seen[hit] = 1;
      players[hit].proj = pv;
      if (iOwn >= 0) {
        var ov = parseOwn(row[iOwn]);
        if (ov != null) players[hit].own = ov;
      }
      if (iCptOwn >= 0) {
        var cov = parseOwn(row[iCptOwn]);
        if (cov != null) players[hit].cptOwn = cov;
      }
      if (iCptProj >= 0) {
        var cpv = parseFloat(String(row[iCptProj]).replace(/[^0-9.\-]/g, ""));
        if (isFinite(cpv)) players[hit].cptProj = cpv;
      }
      matched++;
    }
    return {
      matched: matched,
      missed: missed,
      head: head,
      cols: { name: iName, proj: iProj, own: iOwn, team: iTeam, cptOwn: iCptOwn, cptProj: iCptProj, id: iId },
      format: classifyHeader(low)
    };
  }

  function detectFormat(text) {
    var rows = parseCSV(text);
    if (!rows.length) return { format: "empty" };
    for (var i = 0; i < Math.min(rows.length, 16); i++) {
      var cells = rows[i].map(function (c) { return String(c).trim().toLowerCase(); });
      var cSal = findCol(cells, ["salary", "dk salary"]);
      var cPos = findCol(cells, ["position", "dk pos"]);
      var cName = findCol(cells, ["name", "player", "name + id"]);
      if (cSal >= 0 && cPos >= 0 && cName >= 0) {
        return { format: classifyHeader(cells), headerRow: i };
      }
      if (findCol(cells, ["dk proj", "projection", "proj"]) >= 0 && cName >= 0) {
        return { format: classifyHeader(cells), headerRow: i };
      }
    }
    return { format: "unknown" };
  }

  return {
    parseCSV: parseCSV,
    team: team,
    normName: normName,
    nameKeys: nameKeys,
    parseOwn: parseOwn,
    detectFormat: detectFormat,
    readSalaries: readSalaries,
    applyProjections: applyProjections,
    CLASSIC_POS: CLASSIC_POS,
    SHOWDOWN_POS: SHOWDOWN_POS
  };
});
