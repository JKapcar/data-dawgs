/**
 * Contest screener stub — Bible §5 / §4.1 preset mapping.
 * Lobby fields are expected from toto CORS later; for now accept a manual object.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSScreener = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PRESETS = {
    cash: { key: "cash", label: "Cash / DU / 50-50 / H2H", objective: "mean points" },
    single_gpp: { key: "single_gpp", label: "Single-entry GPP", objective: "top-10 rate, dupe-adjusted" },
    three_max: { key: "three_max", label: "3-max GPP", objective: "greedy P(≥1 top-10)" },
    mme: { key: "mme", label: "20-max / 150-max MME", objective: "greedy P(≥1 top-1%)" },
    milly: { key: "milly", label: "Milly Maker", objective: "greedy P(≥1 top-1%)" },
    sd_wildcat: { key: "sd_wildcat", label: "Showdown Wildcat (150-max)", objective: "greedy P(≥1 top-1%)" },
    sd_single: { key: "sd_single", label: "Showdown single-entry / Field General", objective: "top-1% rate, dupe-adjusted" }
  };

  function rakeBand(rake) {
    if (rake == null || !isFinite(rake)) return "unknown";
    if (rake < 0.13) return "play";
    if (rake <= 0.16) return "tolerate";
    return "avoid";
  }

  function tenthBand(tenthOverFirst) {
    if (tenthOverFirst == null || !isFinite(tenthOverFirst)) return "unknown";
    if (tenthOverFirst >= 0.10) return "play";
    if (tenthOverFirst >= 0.05) return "tolerate";
    return "avoid";
  }

  function minCashBand(minCashOverBuyin) {
    if (minCashOverBuyin == null || !isFinite(minCashOverBuyin)) return "unknown";
    if (minCashOverBuyin >= 2) return "play";
    if (minCashOverBuyin >= 1.5) return "tolerate";
    return "avoid";
  }

  function mapPreset(c) {
    c = c || {};
    var isSd = /showdown|captain|single.?game/i.test(String(c.gameType || c.name || ""));
    var cap = +c.entryCap || +c.maxEntries || 1;
    if (isSd) {
      if (cap >= 150) return PRESETS.sd_wildcat;
      return PRESETS.sd_single;
    }
    var name = String(c.name || "");
    if (/milly|millionaire/i.test(name)) return PRESETS.milly;
    if (/double.?up|50.?50|h2h|cash/i.test(name + " " + (c.gameType || ""))) return PRESETS.cash;
    if (cap <= 1) return PRESETS.single_gpp;
    if (cap <= 3) return PRESETS.three_max;
    return PRESETS.mme;
  }

  /**
   * @param {object} c buyIn, entryCap, fieldCap, prizePool, placesPaid, tenthPrize, firstPrize, minCash, gameType, name
   */
  function scoreContest(c) {
    c = c || {};
    var buyIn = +c.buyIn || 0;
    var rake = c.rake;
    if (rake == null && c.prizePool && buyIn && c.fieldCap) {
      rake = 1 - (+c.prizePool / (buyIn * +c.fieldCap));
    }
    var tenthOverFirst = (c.tenthPrize != null && c.firstPrize) ? (+c.tenthPrize / +c.firstPrize) : null;
    var minCashOver = (c.minCash != null && buyIn) ? (+c.minCash / buyIn) : null;
    var bands = {
      rake: rakeBand(rake),
      tenth: tenthBand(tenthOverFirst),
      minCash: minCashBand(minCashOver)
    };
    var preset = mapPreset(c);
    var rank = 0;
    if (bands.rake === "play") rank += 3; else if (bands.rake === "tolerate") rank += 1;
    if (bands.tenth === "play") rank += 3; else if (bands.tenth === "tolerate") rank += 1;
    if (bands.minCash === "play") rank += 2; else if (bands.minCash === "tolerate") rank += 1;
    return {
      contest: c,
      preset: preset,
      rake: rake,
      bands: bands,
      rank: rank,
      verdict: bands.rake === "avoid" || bands.tenth === "avoid" ? "avoid" : (rank >= 6 ? "play" : "tolerate")
    };
  }

  function rankContests(list) {
    return (list || []).map(scoreContest).sort(function (a, b) { return b.rank - a.rank; });
  }

  return { PRESETS: PRESETS, mapPreset: mapPreset, scoreContest: scoreContest, rankContests: rankContests };
});
