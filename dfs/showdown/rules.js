// Rule thresholds derived from proprietary research. Do not add source statistics here.
//
// Every rule is a condition, a severity and a GENERIC sentence. No percentages, no
// frequencies, no counts of how often a shape wins, no provider names, no article
// references. If a future rule cannot be explained without a statistic, it does not go in
// this file — the explanation belongs in the private research notes, not the public repo.
//
// Severity:
//   hard  likely a construction error
//   soft  deviates from what tends to win
//   info  context only, no judgement implied
//
// Adding a rule: append an object with a stable id, keep ids monotonic, and give it at
// least one firing and one non-firing test in tests/showdown-validator.test.js. Ids R21
// and R22 are permanently reserved for the portfolio rules P21/P22 so cross-references in
// the research notes stay valid; do not reuse them for lineup rules.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDSDRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MOBILE_QB_RUSH_SHARE = 0.20;

  function isMobileQB(p) {
    return !!p && p.pos === "QB" && typeof p.rushShare === "number" && p.rushShare >= MOBILE_QB_RUSH_SHARE;
  }

  /**
   * Rule objects.
   *   when(ctx)     -> truthy to fire. Return undefined to SKIP (missing data), which is
   *                    different from returning false (evaluated, did not fire).
   *   severity      -> string, or fn(ctx) for the rules whose weight depends on the roster
   *   needs         -> optional guard: "ownership" rules are skipped when ownership is
   *                    incomplete, so a missing column never produces a confident flag
   *
   * ctx = { cpt, flex, all, build, stacks, own, slate, pool, fired }
   */
  var RULES = [
    {
      id: "R01", category: "cpt_stack",
      severity: function (ctx) { return isMobileQB(ctx.cpt) ? "info" : "soft"; },
      when: function (ctx) { return ctx.cpt.pos === "QB" && ctx.stacks.sameTeamWRTE === 0; },
      message: "Captain quarterback with none of his own pass catchers.",
      fix: "Add at least one same-team pass catcher.",
      // A rushing quarterback carries his own ceiling, so the same shape is context
      // rather than a deviation.
      messageAlt: "Captain quarterback with none of his own pass catchers, which a rushing quarterback can carry on his own.",
      altWhen: function (ctx) { return isMobileQB(ctx.cpt); }
    },
    {
      id: "R02", category: "bringback", severity: "soft",
      when: function (ctx) { return ctx.cpt.pos === "QB" && ctx.stacks.oppWRTE === 0; },
      message: "Captain quarterback with no pass catcher from the other side.",
      fix: "Consider one opposing pass catcher."
    },
    {
      id: "R03", category: "kicker", severity: "soft",
      when: function (ctx) {
        if (ctx.cpt.pos !== "QB") return false;
        if (!ctx.stacks.oppK) return false;
        var ownKAvailable = ctx.pool.some(function (p) { return p.pos === "K" && p.team === ctx.cpt.team; });
        if (!ownKAvailable) return undefined;
        return !ctx.stacks.ownK;
      },
      message: "The opposing kicker is rostered while the captain's own kicker is available and is not.",
      fix: "Prefer the captain's own kicker."
    },
    {
      id: "R04", category: "cpt_stack", severity: "hard",
      when: function (ctx) { return ctx.cpt.pos === "RB" && ctx.stacks.sameTeamWRTE >= 3; },
      message: "Captain running back behind a full stack of his own pass catchers.",
      fix: "Drop to two or fewer same-team pass catchers."
    },
    {
      id: "R05", category: "cpt_stack", severity: "hard",
      when: function (ctx) { return ctx.cpt.pos === "WR" && ctx.stacks.sameTeamWRTE >= 2; },
      message: "Captain receiver alongside two or more of his own pass catchers, which splits one passing game too many ways.",
      fix: "Move the captain to this team's QB, or cut to one teammate pass catcher."
    },
    {
      id: "R06", category: "bringback", severity: "soft",
      when: function (ctx) { return ctx.cpt.pos === "WR" && ctx.stacks.oppWRTE === 0; },
      message: "Captain receiver with no pass catcher from the other side.",
      fix: "Consider one opposing pass catcher."
    },
    {
      id: "R07", category: "qb_presence", severity: "soft",
      when: function (ctx) { return ctx.cpt.pos === "WR" && !ctx.stacks.hasOwnQB && !ctx.stacks.hasOppQB; },
      message: "Captain receiver with no quarterback in the lineup at all.",
      fix: "Naked-receiver builds usually carry the opposing quarterback."
    },
    {
      id: "R08", category: "cpt_stack", severity: "hard",
      when: function (ctx) { return ctx.cpt.pos === "TE" && !ctx.stacks.hasOwnQB; },
      message: "Captain tight end without the quarterback throwing to him.",
      fix: "Pair the captain tight end with his QB."
    },
    {
      id: "R09", category: "build_cpt", severity: "hard",
      when: function (ctx) { return ctx.build.type === "5-1" && ctx.cpt.team !== ctx.build.favorite; },
      message: "Captain from the light side of an unbalanced build is a low-frequency winner.",
      fix: "Captain should come from the heavy side."
    },
    {
      id: "R10", category: "build_qb", severity: "hard",
      when: function (ctx) {
        if (ctx.build.type !== "5-1") return false;
        return !ctx.all.some(function (p) { return p.pos === "QB" && p.team === ctx.build.heavySide; });
      },
      message: "An unbalanced build stacked on one side without that side's quarterback.",
      fix: "The heavy side of an onslaught almost always includes its QB."
    },
    {
      id: "R11", category: "bringback", severity: "hard",
      when: function (ctx) {
        if (ctx.build.type !== "5-1") return false;
        var lone = ctx.all.filter(function (p) { return p.team !== ctx.build.heavySide; });
        return lone.length === 1 && lone[0].pos === "DST";
      },
      message: "The single player from the other side is the defense, which cannot score with the side it is bringing back from.",
      fix: "Use a skill player as the single bring-back."
    },
    {
      id: "R12", category: "build_cpt", severity: "soft",
      when: function (ctx) { return ctx.build.type === "4-2" && ctx.cpt.team !== ctx.build.favorite; },
      message: "Captain from the lighter side of the build.",
      fix: "Captain usually comes from the heavy side."
    },
    {
      id: "R13", category: "bringback", severity: "soft",
      when: function (ctx) {
        if (ctx.build.type !== "4-2") return false;
        return ctx.all.some(function (p) {
          return p.team !== ctx.build.heavySide && (p.pos === "DST" || p.pos === "K");
        });
      },
      message: "A bring-back slot spent on a kicker or a defense rather than a skill player.",
      fix: "Bring-back pieces are usually skill players."
    },
    {
      id: "R14", category: "dst", severity: "soft",
      when: function (ctx) {
        if (!ctx.all.some(function (p) { return p.pos === "DST"; })) return false;
        return ctx.stacks.dstTeammates < 3;
      },
      message: "A defense without much of its own offense alongside it.",
      fix: "Defenses win with three or more teammates."
    },
    {
      id: "R15", category: "dst_k", severity: "soft",
      when: function (ctx) {
        return !ctx.all.some(function (p) { return p.pos === "DST" || p.pos === "K"; });
      },
      message: "Six skill players, no kicker and no defense.",
      fix: "Six skill players should be a deliberate choice."
    },
    {
      id: "R16", category: "build", severity: "info",
      when: function (ctx) { return ctx.build.type === "3-3"; },
      message: "Balanced builds are the lowest-conviction script.",
      fix: "Pick a side if you have a read on one."
    },
    {
      id: "R17", category: "dupe", severity: "hard", needs: "ownership",
      when: function (ctx) {
        if (ctx.own.relativeProj == null) return undefined;
        return ctx.own.cumulative >= 2.00 && ctx.own.relativeProj >= 0.99;
      },
      message: "Very high duplication risk: a popular roster at essentially the maximum-projection build.",
      fix: "Change the captain or swap one popular piece for a similar-projection alternative."
    },
    {
      id: "R18", category: "dupe", severity: "soft", needs: "ownership",
      when: function (ctx) {
        if (ctx.own.relativeProj == null) return undefined;
        return ctx.own.cumulative >= 1.80 && ctx.own.cumulative < 2.00 &&
               ctx.own.relativeProj >= 0.95 && ctx.own.relativeProj < 0.99;
      },
      message: "Elevated duplication risk: a popular roster close to the maximum-projection build.",
      fix: "One swap off the chalk usually clears this band."
    },
    {
      id: "R19", category: "dupe", severity: "soft", needs: "ownership",
      when: function (ctx) {
        if (ctx.own.relativeProj == null) return undefined;
        if (ctx.fired.R17 || ctx.fired.R18) return false;
        return ctx.own.relativeProj > 0.95;
      },
      message: "This roster sits in the maximum-projection band.",
      fix: "Sharp portfolios sit just below the max-projection band."
    },
    {
      id: "R20", category: "cpt_own", severity: "info",
      when: function (ctx) {
        if (typeof ctx.cpt.cptOwn !== "number") return undefined;
        return ctx.cpt.cptOwn < 0.05;
      },
      message: "A captain the field is largely ignoring.",
      fix: "Low-owned captains need a projection reason, not just leverage."
    },
    {
      id: "R23", category: "kicker", severity: "info",
      when: function (ctx) {
        if (ctx.build.type !== "5-1") return false;
        if (typeof ctx.slate.favKickerFieldUsage51 !== "number") return undefined;
        var favK = ctx.all.some(function (p) { return p.pos === "K" && p.team === ctx.build.favorite; });
        return favK && ctx.slate.favKickerFieldUsage51 > 0.40;
      },
      message: "The favoured kicker in an onslaught is no longer a quiet piece.",
      fix: "Favoured kicker in onslaughts is now well-used by the field."
    },
    {
      id: "R24", category: "kicker", severity: "info", lean: "positive",
      when: function (ctx) {
        if (typeof ctx.slate.spread !== "number") return undefined;
        var dog = ctx.all.some(function (p) { return p.pos === "K" && p.team !== ctx.build.favorite; });
        return dog && Math.abs(ctx.slate.spread) <= 7;
      },
      message: "Underdog kicker in a close game.",
      fix: "Underdog kickers in tight spreads are a reasonable lean."
    },
    {
      id: "R25", category: "cpt_own", severity: "info",
      when: function (ctx) { return ctx.cpt.pos === "K"; },
      message: "Kicker at captain.",
      fix: "Kicker captains are viable but rare; make sure there is a ceiling case."
    }
  ];

  /** Portfolio-level rules. Evaluated by validatePortfolio, never by validateLineup. */
  var PORTFOLIO_RULES = [
    { id: "P21a", category: "cpt_diversity", severity: "soft", minLineups: 10,
      message: "The portfolio leans on very few captains.",
      fix: "Spread captains across at least six players once you are past ten lineups." },
    { id: "P21b", category: "cpt_diversity", severity: "soft",
      message: "One captain carries too much of the portfolio.",
      fix: "Trim the heaviest captain's exposure." },
    { id: "P22", category: "hygiene", severity: "soft",
      message: "Too many lineups in the portfolio carry a hard construction flag.",
      fix: "Fix or drop the flagged lineups before uploading." },
    { id: "P26", category: "build", severity: "info",
      message: "Build-type distribution across the portfolio.",
      fix: "A portfolio weighted toward balanced builds is a portfolio without a script." },
    { id: "P27", category: "leverage", severity: "info",
      message: "Players whose portfolio exposure is far from their projected ownership.",
      fix: "Deliberate leverage is fine; accidental leverage is worth a second look." }
  ];

  return {
    MOBILE_QB_RUSH_SHARE: MOBILE_QB_RUSH_SHARE,
    isMobileQB: isMobileQB,
    RULES: RULES,
    PORTFOLIO_RULES: PORTFOLIO_RULES
  };
});
