/**
 * Duplication risk for a DK Showdown lineup.
 *
 * Three independent readings, then a tier:
 *   cumulative   Σ own(flex) + cptOwn(cpt)  — how much of the field's attention the roster holds
 *   product      Π own(flex) × cptOwn(cpt)  — the naive independent-draw likelihood
 *   relativeProj lineup projection ÷ the slate's max-projection lineup
 *
 * The tier is the only thing the UI shows. Expected dupe COUNTS are deliberately not
 * produced here: they are a function of field size and entry count this module does not
 * take, and publishing them invites reading a modelled number as a measured one.
 * work/dfs-dupe-model.js remains the place for E[dupes] on the classic side.
 *
 * Ownership is a FRACTION (0–1) in this module, matching the Player contract. The older
 * DFS ingest carries ownership on a 0–100 scale; normalise at the boundary, not here.
 */
(function (root, factory) {
  var api = factory(
    typeof require === "function" ? require("./construction.js") : null
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDSDDupe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Build) {
  "use strict";

  function build() {
    return Build || (typeof globalThis !== "undefined" ? globalThis.DDSDBuild : null);
  }

  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  /**
   * Captain ownership, falling back to FLEX ownership when the CPT-specific number is
   * absent. The fallback overstates the captain slot badly, so it is always reported as a
   * data_missing note rather than silently absorbed.
   */
  function cptOwnership(cpt) {
    var c = num(cpt && cpt.cptOwn);
    if (c != null) return { value: c, note: null };
    var f = num(cpt && cpt.own);
    if (f != null) {
      return {
        value: f,
        note: { code: "data_missing", field: "cptOwn", message: "No captain ownership for " + cpt.name + "; FLEX ownership used instead, which overstates the captain slot." }
      };
    }
    return { value: null, note: { code: "data_missing", field: "cptOwn", message: "No ownership for " + (cpt ? cpt.name : "the captain") + "; duplication rules are skipped." } };
  }

  /**
   * @returns {{cumulative:number|null, product:number|null, logProduct:number|null,
   *            relativeProj:number|null, complete:boolean, notes:Array}}
   */
  function ownershipProfile(lineup, slate, res) {
    var B = build();
    res = res || B.resolve(lineup, slate);
    var notes = [];
    var missing = false;

    var cptOwn = cptOwnership(res.cpt);
    if (cptOwn.note) notes.push(cptOwn.note);
    if (cptOwn.value == null) missing = true;

    var cumulative = cptOwn.value == null ? null : cptOwn.value;
    var product = cptOwn.value == null ? null : cptOwn.value;

    res.flex.forEach(function (p) {
      if (!p) return;
      var o = num(p.own);
      if (o == null) {
        missing = true;
        notes.push({ code: "data_missing", field: "own", message: "No ownership for " + p.name + "; duplication rules are skipped." });
        return;
      }
      if (cumulative != null) cumulative += o;
      if (product != null) product *= o;
    });

    if (missing) { cumulative = null; product = null; }

    var maxProj = num(slate.slateMaxProj);
    if (maxProj == null) maxProj = B.computeSlateMaxProj(slate);
    var relativeProj = null;
    if (maxProj > 0) relativeProj = B.lineupProj(res) / maxProj;
    else notes.push({ code: "data_missing", field: "slateMaxProj", message: "No max-projection baseline for this slate; the relative-projection reading is unavailable." });

    return {
      cumulative: cumulative,
      product: product,
      logProduct: product != null && product > 0 ? Math.log10(product) : null,
      relativeProj: relativeProj,
      complete: !missing,
      notes: notes
    };
  }

  /**
   * Tier from the 2-D grid of cumulative ownership against relative projection.
   *
   * severe   both readings are at their worst — the roster is popular AND it is the
   *          lineup the field's optimiser also lands on
   * elevated both readings are near the top of their band
   * moderate one reading alone is high
   * low      neither
   *
   * `fired` is the set of rule ids the engine has already evaluated, so the tier and the
   * flags can never disagree about which band a lineup is in.
   */
  function riskTier(profile, fired) {
    fired = fired || {};
    if (!profile.complete || profile.cumulative == null) {
      return { tier: "unknown", note: "Ownership is incomplete, so duplication cannot be read." };
    }
    if (fired.R17) return { tier: "severe", note: "Popular roster at essentially the maximum-projection build — the shape most likely to be shared." };
    if (fired.R18) return { tier: "elevated", note: "Popular roster close to the maximum-projection build." };
    if ((profile.relativeProj != null && profile.relativeProj > 0.95) || profile.cumulative >= 1.80) {
      return { tier: "moderate", note: "One of the two duplication readings is high; the other is not." };
    }
    return { tier: "low", note: "Neither ownership nor projection puts this roster in a crowded band." };
  }

  return {
    cptOwnership: cptOwnership,
    ownershipProfile: ownershipProfile,
    riskTier: riskTier
  };
});
