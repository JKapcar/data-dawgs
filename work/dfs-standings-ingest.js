/**
 * Contest standings ingest skeleton (Bible §9.1 / Phase 0/1 — hash entry names; receipts in dfs-receipts.js).
 * Client-side only — IndexedDB/localStorage. Never upload standings (I3).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSStandings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DB_NAME = "dd-dfs-standings-v1";
  var STORE = "contests";

  function parseCSV(text) {
    // minimal; prefer DDFSIngest.parseCSV when available
    if (typeof globalThis !== "undefined" && globalThis.DDFSIngest) {
      return globalThis.DDFSIngest.parseCSV(text);
    }
    text = String(text || "").replace(/^\uFEFF/, "");
    return text.trim().split(/\r?\n/).map(function (line) {
      var out = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
          if (ch === '"') { q = false; continue; }
          cur += ch; continue;
        }
        if (ch === '"') { q = true; continue; }
        if (ch === ",") { out.push(cur); cur = ""; continue; }
        cur += ch;
      }
      out.push(cur);
      return out;
    });
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: "contestKey" });
          os.createIndex("byWeek", "week", { unique: false });
          os.createIndex("byImportedAt", "importedAt", { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /**
   * Parse a GameCenter / standings-style CSV into a normalized record.
   * Columns vary; we keep raw rows and a best-effort mapping.
   */
  function parseStandingsCsv(text, meta) {
    meta = meta || {};
    var rows = parseCSV(text);
    if (rows.length < 2) return { error: "Standings CSV needs a header and at least one row." };
    var head = rows[0].map(function (c) { return String(c).trim(); });
    var low = head.map(function (h) { return h.toLowerCase(); });
    function col() {
      var names = [].slice.call(arguments);
      for (var n = 0; n < names.length; n++) {
        var j = low.indexOf(names[n]);
        if (j >= 0) return j;
      }
      for (var n2 = 0; n2 < names.length; n2++) {
        for (var j2 = 0; j2 < low.length; j2++) {
          if (low[j2].indexOf(names[n2]) >= 0) return j2;
        }
      }
      return -1;
    }
    var iRank = col("rank", "place");
    var iPts = col("points", "fpts", "score");
    var iEntry = col("entry", "entry name", "username", "entry_name");
    var iLineup = col("lineup", "roster");
    var entries = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.some(function (c) { return String(c).trim(); })) continue;
      entries.push({
        rank: iRank >= 0 ? parseInt(row[iRank], 10) || null : null,
        points: iPts >= 0 ? parseFloat(row[iPts]) || null : null,
        entryName: iEntry >= 0 ? String(row[iEntry] || "") : "",
        lineup: iLineup >= 0 ? String(row[iLineup] || "") : "",
        raw: row
      });
    }
    // Hash entry names for on-device privacy (Bible §9.1)
    function fnv1a(str) {
      var h = 0x811c9dc5;
      str = String(str || "");
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return ("0000000" + h.toString(16)).slice(-8);
    }
    entries.forEach(function (e) {
      if (e.entryName) e.entryHash = fnv1a(e.entryName);
    });
    return {
      contestKey: meta.contestKey || ("local-" + Date.now()),
      week: meta.week || null,
      contestName: meta.contestName || "",
      importedAt: new Date().toISOString(),
      headers: head,
      entries: entries,
      n: entries.length,
      schema: "dfs-standings-v1-phase1"
    };
  }

  function saveLocal(record) {
    // Node / no-IDB fallback: memory only via caller
    if (typeof indexedDB === "undefined") {
      return Promise.resolve({ ok: true, storage: "none", record: record });
    }
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function () { resolve({ ok: true, storage: "indexeddb", contestKey: record.contestKey }); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function listLocal() {
    if (typeof indexedDB === "undefined") return Promise.resolve([]);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  return {
    DB_NAME: DB_NAME,
    parseStandingsCsv: parseStandingsCsv,
    saveLocal: saveLocal,
    listLocal: listLocal,
    openDb: openDb
  };
});
