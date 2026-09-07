/**
 * Screener lobby pull — map Worker /dk/contests + /dk/contest into
 * DDFSScreener.scoreContest inputs. Source for dfs.html (keep in sync).
 * Never fetches ETR (I1). Page must degrade if Worker routes 404 (H4).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDFSScreenerLobby = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FALLBACK_404 =
    "Live lobby contests need the toto update — type contests by hand for now";

  /** Mirror of Worker mapDkLobbyContestRow for fixture unit tests. */
  function mapDkLobbyContestRow(row) {
    row = row || {};
    var attr = row.attr || row.attributes || {};
    var guaranteedRaw = attr.IsGuaranteed != null ? attr.IsGuaranteed
      : (attr.IsGuranteed != null ? attr.IsGuranteed : row.isGuaranteed);
    var entries = Number(row.nt != null ? row.nt : (row.ec != null ? row.ec : (row.entries != null ? row.entries : 0)));
    var out = {
      id: row.id != null ? Number(row.id) : null,
      name: row.n != null ? String(row.n) : (row.name != null ? String(row.name) : ""),
      entryFee: Number(row.a != null ? row.a : (row.entryFee != null ? row.entryFee : 0)) || 0,
      prizePool: Number(row.po != null ? row.po : (row.prizePool != null ? row.prizePool : (row.totalPayouts != null ? row.totalPayouts : 0))) || 0,
      maxEntries: Number(row.m != null ? row.m : (row.maxEntries != null ? row.maxEntries : (row.maximumEntries != null ? row.maximumEntries : 0))) || 0,
      entries: Number.isFinite(entries) ? entries : 0,
      maxEntriesPerUser: Number(row.mec != null ? row.mec : (row.maxEntriesPerUser != null ? row.maxEntriesPerUser : (row.maximumEntriesPerUser != null ? row.maximumEntriesPerUser : 1))) || 1,
      draftGroupId: Number(row.dg != null ? row.dg : (row.draftGroupId != null ? row.draftGroupId : 0)) || null,
      gameTypeId: row.gameTypeId != null ? Number(row.gameTypeId) : null,
      gameType: row.gameType != null ? String(row.gameType) : "",
      startsAt: null,
      isGuaranteed: guaranteedRaw === true || String(guaranteedRaw).toLowerCase() === "true"
    };
    if (row.payoutSummary != null) out.payoutSummary = row.payoutSummary;
    return out;
  }

  function mapDkContestPayoutTiers(detail) {
    var tiers = (detail && detail.payoutSummary) || [];
    var out = [];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i] || {};
      var fromPlace = Number(t.minPosition != null ? t.minPosition : t.fromPlace);
      var toPlace = Number(t.maxPosition != null ? t.maxPosition : t.toPlace);
      var prize = 0;
      var descs = t.payoutDescriptions || [];
      if (descs.length && descs[0] && descs[0].value != null) prize = Number(descs[0].value) || 0;
      else if (t.tierPayoutDescriptions && t.tierPayoutDescriptions.Cash) {
        prize = Number(String(t.tierPayoutDescriptions.Cash).replace(/[^0-9.]/g, "")) || 0;
      } else if (t.prize != null) prize = Number(t.prize) || 0;
      if (!isFinite(fromPlace) || !isFinite(toPlace)) continue;
      out.push({ fromPlace: fromPlace, toPlace: toPlace, prize: prize });
    }
    return out;
  }

  function computeRake(entryFee, maxEntries, prizePool) {
    var fee = +entryFee || 0;
    var cap = +maxEntries || 0;
    var pool = +prizePool || 0;
    if (!(fee > 0 && cap > 0)) return null;
    return 1 - pool / (fee * cap);
  }

  function prizeAtPlace(tiers, place) {
    tiers = tiers || [];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      if (place >= +t.fromPlace && place <= +t.toPlace) return +t.prize || 0;
    }
    return null;
  }

  function minCashFromTiers(tiers) {
    tiers = tiers || [];
    var min = null;
    for (var i = 0; i < tiers.length; i++) {
      var p = +tiers[i].prize || 0;
      if (p > 0 && (min == null || p < min)) min = p;
    }
    return min == null ? 0 : min;
  }

  /**
   * Build the object DDFSScreener.scoreContest expects.
   * first = tier fromPlace==1; tenth = tier covering place 10 (0 if none → Avoid);
   * minCash = lowest paid; rake = 1 − prizePool/(entryFee·maxEntries).
   */
  function toScoreContestInput(summary, detailOrTiers) {
    summary = summary || {};
    var tiers = Array.isArray(detailOrTiers) ? detailOrTiers
      : (detailOrTiers && detailOrTiers.payout) ? detailOrTiers.payout
      : mapDkContestPayoutTiers(detailOrTiers && detailOrTiers.contestDetail ? detailOrTiers.contestDetail : detailOrTiers);

    var entryFee = Number(summary.entryFee != null ? summary.entryFee
      : (detailOrTiers && detailOrTiers.entryFee != null ? detailOrTiers.entryFee : 0)) || 0;
    var prizePool = Number(summary.prizePool != null ? summary.prizePool
      : (detailOrTiers && detailOrTiers.prizePool != null ? detailOrTiers.prizePool : 0)) || 0;
    var fieldCap = Number(summary.maxEntries != null ? summary.maxEntries
      : (detailOrTiers && detailOrTiers.maxEntries != null ? detailOrTiers.maxEntries : 0)) || 0;
    var entryCap = Number(summary.maxEntriesPerUser != null ? summary.maxEntriesPerUser
      : (detailOrTiers && detailOrTiers.maxEntriesPerUser != null ? detailOrTiers.maxEntriesPerUser : 1)) || 1;

    var first = prizeAtPlace(tiers, 1);
    if (first == null) first = 0;
    var tenthRaw = prizeAtPlace(tiers, 10);
    var tenth = tenthRaw == null ? 0 : tenthRaw;
    var minCash = minCashFromTiers(tiers);
    var rake = computeRake(entryFee, fieldCap, prizePool);

    var gameType = String(summary.gameType || "");
    if (!gameType && /showdown|captain|single.?game/i.test(String(summary.name || ""))) gameType = "Showdown";
    if (!gameType) gameType = "Classic";

    return {
      id: summary.id != null ? summary.id : null,
      name: String(summary.name || ""),
      gameType: gameType,
      buyIn: entryFee,
      entryCap: entryCap,
      fieldCap: fieldCap,
      prizePool: prizePool,
      first: first,
      tenth: tenth,
      firstPrize: first,
      tenthPrize: tenth,
      minCash: minCash,
      rake: rake,
      entries: Number(summary.entries) || 0,
      filledPct: fieldCap > 0 ? (Number(summary.entries) || 0) / fieldCap : null
    };
  }

  function topByPrizePool(contests, n) {
    n = Math.max(1, Math.min(200, +n || 25));
    return (contests || []).slice().sort(function (a, b) {
      return (+b.prizePool || 0) - (+a.prizePool || 0);
    }).slice(0, n);
  }

  function fallback404Message() {
    return FALLBACK_404;
  }

  function isRouteMissing(status, body) {
    if (status === 404) return true;
    var err = body && body.error;
    if (status === 404 || err === "not_found") return true;
    // Worker without the additive routes typically returns HTML/JSON 404 from CF
    return false;
  }

  return {
    FALLBACK_404: FALLBACK_404,
    mapDkLobbyContestRow: mapDkLobbyContestRow,
    mapDkContestPayoutTiers: mapDkContestPayoutTiers,
    computeRake: computeRake,
    prizeAtPlace: prizeAtPlace,
    minCashFromTiers: minCashFromTiers,
    toScoreContestInput: toScoreContestInput,
    topByPrizePool: topByPrizePool,
    fallback404Message: fallback404Message,
    isRouteMissing: isRouteMissing
  };
});
