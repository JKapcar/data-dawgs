/* Data Dawgs Confidence Calibration V1 — pure, presentation-free logic.
   This CommonJS/Browser wrapper is deliberately dependency-free so the same rules can be
   unit-tested in Node and reused by the static page without adding a build system. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DDCCCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DOMAINS = Object.freeze([
    ["sports", "Sports"],
    ["us_history", "United States History"],
    ["world_history", "World History"],
    ["geography", "Geography"],
    ["government_civics_law", "Government, Civics & Law"],
    ["world_affairs", "World Affairs"],
    ["biology", "Biology"],
    ["medicine_human_body", "Medicine & the Human Body"],
    ["animals_nature", "Animals & Nature"],
    ["physics_chemistry", "Physics & Chemistry"],
    ["earth_environment", "Earth & Environment"],
    ["space_astronomy", "Space & Astronomy"],
    ["math_statistics_logic", "Mathematics, Statistics & Logic"],
    ["economics_finance", "Economics & Finance"],
    ["business_industry", "Business & Industry"],
    ["technology_computing_engineering", "Technology, Computing & Engineering"],
    ["psychology_human_behavior", "Psychology & Human Behavior"],
    ["arts_literature_language", "Arts, Literature & Language"],
    ["film_tv_music_pop_culture", "Film, Television, Music & Popular Culture"],
    ["food_everyday_life", "Food & Everyday Life"],
  ].map(function (d) { return Object.freeze({ key: d[0], label: d[1] }); }));
  const DOMAIN_KEYS = Object.freeze(DOMAINS.map(function (d) { return d.key; }));
  const DOMAIN_LABELS = Object.freeze(DOMAINS.reduce(function (out, d) {
    out[d.key] = d.label; return out;
  }, {}));
  const BINS = Object.freeze([
    Object.freeze({ min: 0, max: 20, label: "0–20" }),
    Object.freeze({ min: 21, max: 40, label: "21–40" }),
    Object.freeze({ min: 41, max: 60, label: "41–60" }),
    Object.freeze({ min: 61, max: 80, label: "61–80" }),
    Object.freeze({ min: 81, max: 100, label: "81–100" }),
  ]);

  function shuffle(values, random) {
    const out = values.slice();
    const rng = typeof random === "function" ? random : Math.random;
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  function selectQuestionSet(questions, completedIds, random) {
    const seen = completedIds instanceof Set ? completedIds : new Set(completedIds || []);
    const active = (questions || []).filter(function (q) {
      return q && q.status === "active" && q.verified === true && !seen.has(q.id);
    });
    const selected = [];
    const shortages = [];
    DOMAIN_KEYS.forEach(function (domain) {
      const available = active.filter(function (q) { return q.domain === domain; });
      if (available.length < 2) shortages.push({ domain: domain, available: available.length, needed: 2 });
      else selected.push.apply(selected, shuffle(available, random).slice(0, 2));
    });
    if (shortages.length) {
      const err = new Error("The verified question library does not have two unseen active questions in every domain.");
      err.code = "DDCC_EXHAUSTED";
      err.shortages = shortages;
      throw err;
    }
    return shuffle(selected, random);
  }

  function brierLoss(probability, truthValue) {
    if (!Number.isInteger(probability) || probability < 0 || probability > 100)
      throw new RangeError("probability must be an integer from 0 through 100");
    const q = probability / 100;
    return Math.pow(q - (truthValue ? 1 : 0), 2);
  }

  function binFor(probability) {
    if (!Number.isInteger(probability) || probability < 0 || probability > 100) return null;
    for (let i = 0; i < BINS.length; i++) {
      if (probability >= BINS[i].min && probability <= BINS[i].max) return i;
    }
    return null;
  }

  function aggregate(responses, domain) {
    const rows = (responses || []).filter(function (r) {
      return r && (!domain || r.domainSnapshot === domain) &&
        Number.isInteger(r.probability) && r.probability >= 0 && r.probability <= 100 &&
        typeof r.truthValueSnapshot === "boolean";
    });
    const bins = BINS.map(function (b) {
      return { min: b.min, max: b.max, label: b.label, responseCount: 0,
        meanForecast: null, truthRate: null };
    });
    let forecast = 0, truths = 0, brier = 0, directionalCorrect = 0, directionalCount = 0;
    rows.forEach(function (r) {
      const truth = r.truthValueSnapshot ? 1 : 0;
      forecast += r.probability / 100;
      truths += truth;
      brier += brierLoss(r.probability, r.truthValueSnapshot);
      if (r.probability !== 50) {
        directionalCount++;
        if ((r.probability > 50) === r.truthValueSnapshot) directionalCorrect++;
      }
      const idx = binFor(r.probability);
      const b = bins[idx];
      b.responseCount++;
      b._forecast = (b._forecast || 0) + r.probability / 100;
      b._truths = (b._truths || 0) + truth;
    });
    bins.forEach(function (b) {
      if (b.responseCount) {
        b.meanForecast = b._forecast / b.responseCount;
        b.truthRate = b._truths / b.responseCount;
      }
      delete b._forecast; delete b._truths;
    });
    const n = rows.length;
    const meanForecast = n ? forecast / n : null;
    const truthRate = n ? truths / n : null;
    return {
      responseCount: n,
      meanForecast: meanForecast,
      truthRate: truthRate,
      calibrationBias: n ? meanForecast - truthRate : null,
      meanBrierLoss: n ? brier / n : null,
      accuracy: directionalCount ? directionalCorrect / directionalCount : null,
      accuracyDenominator: directionalCount,
      bins: bins,
    };
  }

  function milestone(responseCount) {
    const n = Math.max(0, Number(responseCount) || 0);
    if (n >= 216) return { label: "Established DDCC Profile", threshold: 216, next: null, remaining: 0 };
    if (n >= 100) return { label: "Developing DDCC Profile", threshold: 100, next: 216, remaining: 216 - n };
    if (n >= 40) return { label: "Initial DDCC Profile", threshold: 40, next: 100, remaining: 100 - n };
    return { label: "Profile in progress", threshold: 0, next: 40, remaining: 40 - n };
  }

  function validateAttempt(questionIds, questions) {
    if (!Array.isArray(questionIds) || questionIds.length !== 40 || new Set(questionIds).size !== 40) return false;
    const byId = new Map((questions || []).map(function (q) { return [q.id, q]; }));
    const counts = DOMAIN_KEYS.reduce(function (out, k) { out[k] = 0; return out; }, {});
    for (let i = 0; i < questionIds.length; i++) {
      const q = byId.get(questionIds[i]);
      if (!q || !Object.prototype.hasOwnProperty.call(counts, q.domain)) return false;
      counts[q.domain]++;
    }
    return DOMAIN_KEYS.every(function (k) { return counts[k] === 2; });
  }

  return Object.freeze({ DOMAINS: DOMAINS, DOMAIN_KEYS: DOMAIN_KEYS, DOMAIN_LABELS: DOMAIN_LABELS,
    BINS: BINS, shuffle: shuffle, selectQuestionSet: selectQuestionSet, brierLoss: brierLoss,
    binFor: binFor, aggregate: aggregate, milestone: milestone, validateAttempt: validateAttempt });
});
