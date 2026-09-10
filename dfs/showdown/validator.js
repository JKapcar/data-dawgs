/**
 * DK Showdown construction validator — the engine.
 *
 * validateLineup(lineup, slate)      -> one lineup's build, stacks, ownership and flags
 * validatePortfolio(lineups, slate)  -> per-lineup results plus portfolio-level findings
 *
 * The engine holds no thresholds. Every judgement lives in rules.js, so a rule can be
 * retuned without touching this file. Pure and deterministic (C5).
 *
 * Hard errors are not rule flags. A lineup that is not a legal DK Showdown entry comes
 * back valid:false with `errors` populated and NO rules evaluated — grading construction
 * on an illegal roster would be advice about a lineup that cannot be entered.
 */
(function (root, factory) {
  var req = typeof require === "function" ? require : null;
  var api = factory(
    req ? req("./construction.js") : null,
    req ? req("./rules.js") : null,
    req ? req("./dupeRisk.js") : null
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDSDValidator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (BuildIn, RulesIn, DupeIn) {
  "use strict";

  var g = typeof globalThis !== "undefined" ? globalThis : {};
  function B() { return BuildIn || g.DDSDBuild; }
  function R() { return RulesIn || g.DDSDRules; }
  function D() { return DupeIn || g.DDSDDupe; }

  var SEVERITY_ORDER = { hard: 0, soft: 1, info: 2 };

  /** Legality, before any judgement. Returns [] for a legal entry. */
  function hardErrors(lineup, slate, res) {
    var Bx = B();
    var errors = [];
    var ids = [lineup.cpt].concat(lineup.flex || []);

    if (ids.length !== Bx.ROSTER_SIZE) {
      errors.push({ code: "roster_size", message: "A Showdown lineup is one captain and five flex players; this has " + ids.length + "." });
    }
    var unresolved = [];
    if (!res.cpt) unresolved.push(String(lineup.cpt));
    res.flex.forEach(function (p, i) { if (!p) unresolved.push(String((lineup.flex || [])[i])); });
    if (unresolved.length) {
      errors.push({ code: "unknown_player", message: "Not on this slate: " + unresolved.join(", ") + "." });
      return errors; // everything below needs resolved players
    }

    var seen = {}, dupes = [];
    res.all.forEach(function (p) {
      if (seen[p.id]) dupes.push(p.name);
      seen[p.id] = true;
    });
    if (dupes.length) {
      errors.push({ code: "duplicate_player", message: "The same player fills more than one slot: " + dupes.join(", ") + "." });
    }

    var salary = Bx.lineupSalary(res);
    if (salary > Bx.SALARY_CAP) {
      errors.push({ code: "over_cap", message: "Salary " + salary.toLocaleString("en-US") + " is over the " + Bx.SALARY_CAP.toLocaleString("en-US") + " cap." });
    }

    var teams = [];
    res.all.forEach(function (p) { if (teams.indexOf(p.team) < 0) teams.push(p.team); });
    var allowed = Bx.slateTeams(slate);
    var foreign = teams.filter(function (t) { return allowed.indexOf(t) < 0; });
    if (foreign.length) {
      errors.push({ code: "foreign_team", message: "Players from outside this game: " + foreign.join(", ") + "." });
    } else if (teams.length > 2) {
      errors.push({ code: "too_many_teams", message: "A Showdown lineup uses exactly two teams; this has " + teams.length + "." });
    }

    return errors;
  }

  function ownBand(v) {
    if (typeof v !== "number") return null;
    if (v < 0.05) return "<5";
    if (v < 0.25) return "5-25";
    if (v < 0.40) return "25-40";
    return "40+";
  }

  function severityOf(rule, ctx) {
    return typeof rule.severity === "function" ? rule.severity(ctx) : rule.severity;
  }

  /**
   * @param {{id?:string, cpt:string, flex:string[]}} lineup
   * @param {object} slate
   * @returns {object} see dfs/showdown/README.md for the full output shape
   */
  function validateLineup(lineup, slate) {
    var Bx = B(), Rx = R(), Dx = D();
    var res = Bx.resolve(lineup, slate);
    var out = {
      lineupId: lineup.id != null ? String(lineup.id) : null,
      valid: true,
      errors: [],
      notes: [],
      flags: [],
      score: { hard: 0, soft: 0, info: 0 }
    };

    var errors = hardErrors(lineup, slate, res);
    if (errors.length) {
      out.valid = false;
      out.errors = errors;
      return out;
    }

    var build = Bx.classifyBuild(lineup, slate);
    var stacks = Bx.stackProfile(lineup, slate);
    var own = Dx.ownershipProfile(lineup, slate, res);
    build.notes.forEach(function (n) { out.notes.push(n); });
    own.notes.forEach(function (n) { out.notes.push(n); });

    var fired = {};
    var ctx = {
      cpt: res.cpt, flex: res.flex, all: res.all,
      build: build, stacks: stacks, own: own,
      slate: slate, pool: slate.players || [],
      fired: fired
    };

    Rx.RULES.forEach(function (rule) {
      if (rule.needs === "ownership" && !own.complete) return;
      var hit;
      try { hit = rule.when(ctx); } catch (e) {
        out.notes.push({ code: "rule_error", message: "Rule " + rule.id + " could not be evaluated." });
        return;
      }
      if (hit === undefined) {
        out.notes.push({ code: "data_missing", rule: rule.id, message: "Rule " + rule.id + " needs data this slate does not carry." });
        return;
      }
      if (!hit) return;
      fired[rule.id] = true;
      var sev = severityOf(rule, ctx);
      var useAlt = typeof rule.altWhen === "function" && rule.altWhen(ctx) && rule.messageAlt;
      var flag = {
        rule: rule.id,
        severity: sev,
        category: rule.category,
        message: useAlt ? rule.messageAlt : rule.message,
        fix: rule.fix
      };
      if (rule.lean) flag.lean = rule.lean;
      out.flags.push(flag);
      out.score[sev]++;
    });

    out.flags.sort(function (a, b) {
      var d = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      return d !== 0 ? d : (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);
    });

    var tier = Dx.riskTier(own, fired);
    out.build = { type: build.type, heavySide: build.heavySide, favSide: build.favSide, dogSide: build.dogSide };
    out.cpt = {
      id: res.cpt.id, name: res.cpt.name, pos: res.cpt.pos, team: res.cpt.team,
      side: res.cpt.team === build.favorite ? "fav" : "dog",
      cptOwn: typeof res.cpt.cptOwn === "number" ? res.cpt.cptOwn : null,
      ownBand: ownBand(typeof res.cpt.cptOwn === "number" ? res.cpt.cptOwn : res.cpt.own)
    };
    out.stacks = stacks;
    out.salary = Bx.lineupSalary(res);
    out.proj = Bx.lineupProj(res);
    out.ownership = { cumulative: own.cumulative, product: own.product, logProduct: own.logProduct, relativeProj: own.relativeProj };
    out.dupeRisk = { tier: tier.tier, note: tier.note };
    return out;
  }

  function round(v, dp) {
    var m = Math.pow(10, dp);
    return Math.round(v * m) / m;
  }

  /**
   * Portfolio findings. Per-lineup results come back in `lineups` in input order; the
   * portfolio flags describe the set, not any one entry.
   */
  function validatePortfolio(lineups, slate) {
    var Rx = R();
    var results = (lineups || []).map(function (l) { return validateLineup(l, slate); });
    var legal = results.filter(function (r) { return r.valid; });
    var n = legal.length;
    var out = {
      lineups: results,
      count: results.length,
      legalCount: n,
      flags: [],
      cptExposure: [],
      buildMix: {},
      leverage: []
    };
    if (!n) return out;

    var byRule = {};
    Rx.PORTFOLIO_RULES.forEach(function (r) { byRule[r.id] = r; });
    function raise(id, extra) {
      var r = byRule[id];
      var f = { rule: id, severity: r.severity, category: r.category, message: r.message, fix: r.fix };
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) f[k] = extra[k];
      out.flags.push(f);
    }

    // --- captain concentration (P21a / P21b) ---
    var cptCount = {};
    legal.forEach(function (r) {
      var key = r.cpt.id;
      cptCount[key] = cptCount[key] || { id: key, name: r.cpt.name, count: 0 };
      cptCount[key].count++;
    });
    out.cptExposure = Object.keys(cptCount).map(function (k) {
      return { id: cptCount[k].id, name: cptCount[k].name, count: cptCount[k].count, exposure: round(cptCount[k].count / n, 4) };
    }).sort(function (a, b) {
      return b.exposure - a.exposure || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });

    var uniqueCpts = out.cptExposure.length;
    if (n >= 10 && uniqueCpts < 6) raise("P21a", { uniqueCaptains: uniqueCpts });
    var over = out.cptExposure.filter(function (e) { return e.exposure > 0.40; });
    if (over.length) raise("P21b", { players: over.map(function (e) { return { name: e.name, exposure: e.exposure }; }) });

    // --- hard-flag share (P22) ---
    var withHard = legal.filter(function (r) { return r.score.hard > 0; }).length;
    var hardShare = round(withHard / n, 4);
    out.hardShare = hardShare;
    if (hardShare > 0.10) raise("P22", { share: hardShare, lineups: withHard });

    // --- build mix (P26) ---
    legal.forEach(function (r) {
      out.buildMix[r.build.type] = (out.buildMix[r.build.type] || 0) + 1;
    });
    Object.keys(out.buildMix).forEach(function (k) { out.buildMix[k] = { count: out.buildMix[k], share: round(out.buildMix[k] / n, 4) }; });
    var balanced = out.buildMix["3-3"] ? out.buildMix["3-3"].share : 0;
    raise("P26", { mix: out.buildMix, balancedShare: balanced, balancedHeavy: balanced > 0.35 });

    // --- leverage (P27): portfolio exposure against projected FLEX ownership ---
    var flexCount = {};
    legal.forEach(function (r) {
      var l = (lineups || [])[results.indexOf(r)];
      (l.flex || []).forEach(function (id) {
        flexCount[String(id)] = (flexCount[String(id)] || 0) + 1;
      });
    });
    var byId = {};
    (slate.players || []).forEach(function (p) { byId[String(p.id)] = p; });
    Object.keys(flexCount).forEach(function (id) {
      var p = byId[id];
      if (!p || typeof p.own !== "number" || p.own <= 0) return;
      var exposure = flexCount[id] / n;
      var ratio = exposure / p.own;
      if (ratio < 0.75 || ratio > 1.25) {
        out.leverage.push({ id: id, name: p.name, exposure: round(exposure, 4), own: p.own, ratio: round(ratio, 3) });
      }
    });
    out.leverage.sort(function (a, b) { return b.ratio - a.ratio || (a.name < b.name ? -1 : 1); });
    if (out.leverage.length) raise("P27", { players: out.leverage });

    return out;
  }

  return {
    validateLineup: validateLineup,
    validatePortfolio: validatePortfolio,
    hardErrors: hardErrors,
    ownBand: ownBand
  };
});
