/**
 * DFS Labs Phase 0.5 T9 — toto · DK proxy health chip.
 * Pure state updater + chip view. Source for dfs.html (keep in sync).
 * Persisted as dd-dfs-v1.toto = { lastOk, lastErr }. No ETR (I1 / H5).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSTotoHealth = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LABEL = "toto · DK proxy";
  var RED_HINT = "— paste a salary file on the Slate sheet.";

  function normalize(prev) {
    prev = prev || {};
    return {
      lastOk: prev.lastOk != null && prev.lastOk !== "" ? String(prev.lastOk) : null,
      lastErr: prev.lastErr != null && prev.lastErr !== "" ? String(prev.lastErr) : null
    };
  }

  /** Success path: clear error, stamp lastOk (ISO or provided). */
  function recordOk(prev, at) {
    var when = at != null && at !== "" ? String(at) : new Date().toISOString();
    return { lastOk: when, lastErr: null };
  }

  /** Failure path: set lastErr; keep prior lastOk for history. One call flips chip to red. */
  function recordErr(prev, msg, at) {
    var cur = normalize(prev);
    var err = msg == null || msg === "" ? "request failed" : String(msg);
    // at reserved for future clock injection; lastErr message is what the chip shows
    void at;
    return { lastOk: cur.lastOk, lastErr: err };
  }

  function formatOkTime(iso) {
    if (!iso) return "";
    var t = Date.parse(iso);
    if (!isFinite(t)) return String(iso).slice(0, 19);
    try {
      return new Date(t).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (e) {
      return String(iso).slice(0, 19);
    }
  }

  /**
   * Chip view from stored toto state.
   * { ok, label, text, title } — ok=true green, ok=false red, ok=null idle.
   */
  function chipView(state) {
    var s = normalize(state);
    if (s.lastErr) {
      var errText = s.lastErr;
      // Always end with the paste hint (do not duplicate if already present).
      if (errText.indexOf(RED_HINT) === -1) errText = errText + " " + RED_HINT;
      return {
        ok: false,
        label: LABEL,
        text: LABEL + " · " + errText,
        title: errText,
        lastOk: s.lastOk,
        lastErr: s.lastErr
      };
    }
    if (s.lastOk) {
      var when = formatOkTime(s.lastOk);
      return {
        ok: true,
        label: LABEL,
        text: LABEL + " · ok " + when,
        title: "Last success " + s.lastOk,
        lastOk: s.lastOk,
        lastErr: null
      };
    }
    return {
      ok: null,
      label: LABEL,
      text: LABEL + " · idle",
      title: "No /dk/* call yet this session",
      lastOk: null,
      lastErr: null
    };
  }

  return {
    LABEL: LABEL,
    RED_HINT: RED_HINT,
    normalize: normalize,
    recordOk: recordOk,
    recordErr: recordErr,
    formatOkTime: formatOkTime,
    chipView: chipView
  };
});
