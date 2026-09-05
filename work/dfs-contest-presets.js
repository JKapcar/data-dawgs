/**
 * Contest-aware generation presets — Bible §4.1.
 * Screener mapPreset keys share these definitions. applyPreset fills solver cfg.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSPresets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // leverage: 0 | low | medium | high | highest → ownership penalty / stack weight scale
  var LEVERAGE_SCALE = { "0": 0, low: 0.35, medium: 0.7, high: 1.0, highest: 1.35 };

  var PRESETS = {
    cash: {
      key: "cash",
      label: "Cash / DU / 50-50 / H2H",
      objective: "mean points",
      variance: "low",
      exposure: "none",
      minUniques: 0,
      lineups: 1,
      leverage: "0",
      randomness: 0,
      qbStackMin: 0,
      bringBack: 0,
      maxExp: 100,
      showdown: false
    },
    single_gpp: {
      key: "single_gpp",
      label: "Single-entry GPP",
      objective: "top-10 rate, dupe-adjusted",
      variance: "medium",
      exposure: "none",
      minUniques: 0,
      lineups: 1,
      leverage: "low",
      randomness: 8,
      qbStackMin: 1,
      bringBack: 1,
      maxExp: 100,
      showdown: false
    },
    three_max: {
      key: "three_max",
      label: "3-max GPP",
      objective: "greedy P(≥1 top-10)",
      variance: "medium-high",
      exposure: "after_each",
      minUniques: 2,
      lineups: 3,
      leverage: "medium",
      randomness: 12,
      qbStackMin: 1,
      bringBack: 1,
      maxExp: 67,
      showdown: false
    },
    mme: {
      key: "mme",
      label: "20-max / 150-max MME",
      objective: "greedy P(≥1 top-1%)",
      variance: "high",
      exposure: "after_each",
      minUniques: 3,
      lineups: 20,
      leverage: "high",
      randomness: 20,
      qbStackMin: 1,
      bringBack: 1,
      maxExp: 40,
      showdown: false
    },
    milly: {
      key: "milly",
      label: "Milly Maker",
      objective: "greedy P(≥1 top-1%), % to first ≈ 30%",
      variance: "high",
      exposure: "after_each",
      minUniques: 3,
      lineups: 150,
      leverage: "highest",
      randomness: 25,
      qbStackMin: 1,
      bringBack: 1,
      maxExp: 30,
      showdown: false
    },
    sd_wildcat: {
      key: "sd_wildcat",
      label: "Showdown Wildcat (150-max)",
      objective: "greedy P(≥1 top-1%), product-own dupe control",
      variance: "high",
      exposure: "after_each",
      minUniques: 2,
      lineups: 150,
      leverage: "high",
      randomness: 22,
      qbStackMin: 0,
      bringBack: 0,
      maxExp: 35,
      showdown: true
    },
    sd_single: {
      key: "sd_single",
      label: "Showdown single-entry / Field General",
      objective: "top-1% rate, dupe-adjusted",
      variance: "high",
      exposure: "none",
      minUniques: 0,
      lineups: 1,
      leverage: "medium",
      randomness: 15,
      qbStackMin: 0,
      bringBack: 0,
      maxExp: 100,
      showdown: true
    }
  };

  function listPresets() {
    return Object.keys(PRESETS).map(function (k) { return PRESETS[k]; });
  }

  function getPreset(key) {
    return PRESETS[key] || null;
  }

  function leverageScale(lev) {
    return LEVERAGE_SCALE[String(lev)] != null ? LEVERAGE_SCALE[String(lev)] : 0.7;
  }

  /**
   * Map preset → solver cfg fields used by dfs.html (count, uniq, rand, maxExp, qbMin, bring).
   * Caps milly/wildcat lineups at `opts.lineupCap` (default 150) for browser sanity.
   */
  function solverCfgFromPreset(preset, opts) {
    opts = opts || {};
    var p = typeof preset === "string" ? PRESETS[preset] : preset;
    if (!p) return null;
    var cap = opts.lineupCap != null ? opts.lineupCap : 150;
    var n = Math.min(p.lineups, cap);
    if (opts.entryCap != null && p.exposure === "after_each") {
      n = Math.min(n, Math.max(1, +opts.entryCap));
    }
    return {
      count: n,
      uniq: p.minUniques,
      rand: p.randomness,
      maxExp: p.maxExp,
      qbMin: p.qbStackMin,
      bring: p.bringBack,
      leverage: p.leverage,
      leverageScale: leverageScale(p.leverage),
      variance: p.variance,
      exposure: p.exposure,
      presetKey: p.key,
      objective: p.objective,
      label: p.label,
      showdown: !!p.showdown
    };
  }

  return {
    PRESETS: PRESETS,
    LEVERAGE_SCALE: LEVERAGE_SCALE,
    listPresets: listPresets,
    getPreset: getPreset,
    leverageScale: leverageScale,
    solverCfgFromPreset: solverCfgFromPreset
  };
});
