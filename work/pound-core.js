/* Data Dawgs Pound calculators — pure deterministic functions.
 * This file is the testable source; work/build-pound.py inlines it into pound.html.
 * No network calls, no hidden state, no betting or model claim beyond the named maths.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDPound = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const finite = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error((name || "value") + " must be a finite number");
    return n;
  };
  const probability = (v, name) => {
    const n = finite(v, name || "probability");
    if (n < 0 || n > 1) throw new Error((name || "probability") + " must be between 0 and 1");
    return n;
  };
  const american = v => {
    const n = finite(v, "American odds");
    if (n === 0 || Math.abs(n) < 100) throw new Error("American odds must be <= -100 or >= +100");
    return n;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function americanToDecimal(v) {
    const a = american(v);
    return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
  }
  function decimalToAmerican(v) {
    const d = finite(v, "decimal odds");
    if (d <= 1) throw new Error("decimal odds must be greater than 1");
    return d >= 2 ? (d - 1) * 100 : -100 / (d - 1);
  }
  function impliedFromAmerican(v) { return 1 / americanToDecimal(v); }
  function oddsConverter(v) {
    const decimal = americanToDecimal(v);
    return { american: american(v), decimal, implied_probability: 1 / decimal };
  }
  function parlay(values) {
    if (!Array.isArray(values) || !values.length) throw new Error("enter at least one leg");
    const legs = values.map(american);
    const decimal = legs.reduce((p, v) => p * americanToDecimal(v), 1);
    return { legs, decimal, american: decimalToAmerican(decimal), implied_probability: 1 / decimal };
  }
  function holdVig(a, b) {
    const raw = [impliedFromAmerican(a), impliedFromAmerican(b)];
    const sum = raw[0] + raw[1];
    return { raw_implied: raw, hold: sum - 1, devig_probability: raw.map(p => p / sum) };
  }
  function betEV(winProbability, price) {
    const p = probability(winProbability, "win probability");
    const decimal = americanToDecimal(price);
    const breakEven = 1 / decimal;
    const expected = p * (decimal - 1) - (1 - p);
    return { break_even_probability: breakEven, expected_profit_per_unit: expected, roi: expected };
  }
  function hedge(originalStake, originalPrice, hedgePrice) {
    const stake = finite(originalStake, "original stake");
    if (stake <= 0) throw new Error("original stake must be greater than zero");
    const d1 = americanToDecimal(originalPrice), d2 = americanToDecimal(hedgePrice);
    const hedgeStake = stake * d1 / d2;
    const profit = stake * (d1 - 1) - hedgeStake;
    return { hedge_stake: hedgeStake, locked_profit: profit, original_decimal: d1, hedge_decimal: d2 };
  }
  function passerRating(attempts, completions, yards, touchdowns, interceptions) {
    const att = finite(attempts, "attempts"), cmp = finite(completions, "completions");
    const yds = finite(yards, "yards"), td = finite(touchdowns, "touchdowns"), int = finite(interceptions, "interceptions");
    if (att <= 0) throw new Error("attempts must be greater than zero");
    if (![att, cmp, yds, td, int].every(Number.isInteger)) throw new Error("passing statistics must be whole numbers");
    if ([cmp, td, int].some(v => v < 0) || cmp > att || td > att || int > att) throw new Error("enter a valid passing line");
    const parts = [
      clamp((cmp / att - 0.3) * 5, 0, 2.375),
      clamp((yds / att - 3) * 0.25, 0, 2.375),
      clamp((td / att) * 20, 0, 2.375),
      clamp(2.375 - (int / att) * 25, 0, 2.375),
    ];
    return { rating: parts.reduce((s, v) => s + v, 0) / 6 * 100, components: parts };
  }
  function eloGame(homeElo, awayElo, homeFieldElo) {
    const h = finite(homeElo, "home Elo"), a = finite(awayElo, "away Elo"), f = finite(homeFieldElo, "home-field Elo");
    const home = 1 / (1 + Math.pow(10, -(h + f - a) / 400));
    return { home_win_probability: home, away_win_probability: 1 - home, adjusted_elo_difference: h + f - a };
  }

  // Peter J. Acklam's inverse-normal rational approximation.
  function normalInv(v) {
    const p = probability(v);
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
      -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
      66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425, hi = 1 - lo;
    if (p < lo) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > hi) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  function normalCdf(x) {
    const z = finite(x, "z");
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const density = 0.3989422804014327 * Math.exp(-z * z / 2);
    const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const cdf = 1 - density * poly;
    return z >= 0 ? cdf : 1 - cdf;
  }
  function normalTranslation(homeWinProbability, residualSdPoints, homeLine) {
    const p = probability(homeWinProbability, "home win probability");
    if (p <= 0 || p >= 1) throw new Error("translation probability must be strictly between 0 and 1");
    const sd = finite(residualSdPoints, "residual SD");
    if (sd <= 0) throw new Error("residual SD must be greater than zero");
    // Invert the site's published win model:
    // P(home win) = 1 - Phi((0.5 - expected_margin_home) / residual_sd_points).
    const margin = 0.5 + sd * normalInv(p);
    const out = { expected_margin_home: margin, model_spread_home: margin, residual_sd_points: sd };
    if (homeLine !== undefined && homeLine !== null && homeLine !== "") {
      const l = finite(homeLine, "home line");
      const threshold = -l;
      out.home_line = l;
      out.cover_threshold_home_margin = threshold;
      out.home_cover_probability = 1 - normalCdf((threshold - margin) / sd);
      out.push_probability = 0;
    }
    return out;
  }
  function forecastGrade(forecastProbability, outcome) {
    const p = probability(forecastProbability, "forecast probability");
    const y = finite(outcome, "outcome");
    if (y !== 0 && y !== 1) throw new Error("outcome must be 0 or 1");
    const safe = clamp(p, 1e-15, 1 - 1e-15);
    return { brier: (p - y) ** 2, log_loss: -(y * Math.log(safe) + (1 - y) * Math.log(1 - safe)), sample_size: 1 };
  }
  function beliefSummary(values) {
    if (!Array.isArray(values) || !values.length) throw new Error("enter at least one probability");
    const xs = values.map((v, i) => probability(v, "probability " + (i + 1))).sort((a, b) => a - b);
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const median = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
    const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
    return { count: xs.length, mean, median, min: xs[0], max: xs[xs.length - 1], range: xs[xs.length - 1] - xs[0],
      standard_deviation: Math.sqrt(variance), crosses_50: xs[0] < 0.5 && xs[xs.length - 1] > 0.5 };
  }

  return { americanToDecimal, decimalToAmerican, impliedFromAmerican, oddsConverter, parlay, holdVig,
    betEV, hedge, passerRating, eloGame, normalInv, normalCdf, normalTranslation, forecastGrade, beliefSummary };
});
