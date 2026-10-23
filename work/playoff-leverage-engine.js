/* work/playoff-leverage-engine.js — NFL season simulation, seeding rules, and paired
 * single-game playoff leverage.
 *
 * Source for tools/build-playoff-leverage.js (which writes /data/nfl-playoff-leverage.json)
 * and for work/test-playoff-leverage.mjs / work/validate-playoff-history.mjs. No page loads
 * this file: playoffs.js only renders the precomputed JSON.
 *
 * WHAT IT DOES
 *   1. Plays every unplayed regular-season game once per simulated season, each game an
 *      independent draw at its supplied home-win probability. Finished games keep their
 *      real result, ties included (a tie counts half a win, as the league counts it).
 *   2. Seeds each conference the league's way: four division winners, then the best
 *      non-winners as wild cards, with the official tie-breaking procedures through
 *      strength of schedule. Steps past SOS (points rankings, net points, net TDs) need
 *      simulated scores, which this does not produce — a tie that survives SOS goes to a
 *      per-season lottery, i.e. the coin toss. That limit is disclosed in the data note.
 *   3. Leverage, PAIRED: for each game of the target week, every simulated season is also
 *      played with that game's result flipped while every other game keeps its simulated
 *      result (common random numbers). "If X wins" and "if X loses" are therefore computed
 *      on the same 32-team seasons, so their difference isolates what that one result does.
 *
 * ⚠️ WHAT IT DOES NOT DO
 *   - Team strength is FIXED inside a season: the supplied probabilities are treated as
 *     known and independent. Real uncertainty about how good teams are is wider, so
 *     probabilities near 0% and 100% are overconfident. Say so wherever these numbers go.
 *   - No simulated ties, no injuries or QB changes beyond what the input probabilities
 *     already carry, no postseason.
 *
 * ⚠️ RULE SOURCE: NFL Record & Fact Book tie-breaking procedures (division, wild card,
 * "other procedures"). Multi-club steps eliminate the clubs that are not best; when exactly
 * two remain the procedure reverts to step 1 of the two-club format; when one club is
 * selected the rest restart from step 1. Each division's order is computed once and reused
 * for every wild-card pass ("the original seeding within a division ... remains the same").
 * work/validate-playoff-history.mjs replays real seasons through this code and checks the
 * fields and seeds the league actually produced.
 */
'use strict';

/* ⚠️ Divisions are a hard-coded fact table, not inferred. The builder checks it against
   the schedule's own `divisional` flag on every game, so a realignment fails loudly. */
const DIVISIONS = Object.freeze([
  ['AFC East', 'AFC', ['BUF', 'MIA', 'NE', 'NYJ']],
  ['AFC North', 'AFC', ['BAL', 'CIN', 'CLE', 'PIT']],
  ['AFC South', 'AFC', ['HOU', 'IND', 'JAX', 'TEN']],
  ['AFC West', 'AFC', ['DEN', 'KC', 'LAC', 'LV']],
  ['NFC East', 'NFC', ['DAL', 'NYG', 'PHI', 'WAS']],
  ['NFC North', 'NFC', ['CHI', 'DET', 'GB', 'MIN']],
  ['NFC South', 'NFC', ['ATL', 'CAR', 'NO', 'TB']],
  ['NFC West', 'NFC', ['ARI', 'LAR', 'SEA', 'SF']],
]);
const CONFERENCES = Object.freeze(['AFC', 'NFC']);
/* Display nicknames, a fact table like the divisions. Not read from survivor.json, whose
   Rams row carries the code as its name; work/test-playoff-leverage.mjs checks every entry
   against the full names in /data/nfl-stadiums.json. */
const NICKNAMES = Object.freeze({
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears',
  CIN: 'Bengals', CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
  HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs', LAC: 'Chargers', LAR: 'Rams',
  LV: 'Raiders', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
  NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks', SF: '49ers', TB: 'Buccaneers',
  TEN: 'Titans', WAS: 'Commanders',
});
const EPS = 1e-9;

function createLeague(divisions = DIVISIONS) {
  const teams = [], conf = [], div = [], divTeams = [], divNames = [], divConf = [];
  const confTeams = CONFERENCES.map(() => []);
  divisions.forEach(([name, cf, list], d) => {
    const c = CONFERENCES.indexOf(cf);
    if (c < 0) throw new Error(`unknown conference ${cf}`);
    divNames.push(name); divConf.push(c); divTeams.push([]);
    for (const code of list) {
      const i = teams.length;
      teams.push(code); conf.push(c); div.push(d);
      divTeams[d].push(i); confTeams[c].push(i);
    }
  });
  const index = new Map(teams.map((t, i) => [t, i]));
  if (index.size !== teams.length) throw new Error('duplicate team code in division table');
  return { n: teams.length, teams, index, conf, div, divTeams, divNames, divConf, confTeams };
}

/* ---------------------------------------------------------------- records ----
   W[i*n+j] = games i won against j; T[i*n+j] = ties between i and j (symmetric).
   pts = wins + ties/2, gp = games played. Everything a tiebreaker needs is derivable. */
function createRecords(n) {
  return { n, W: new Uint8Array(n * n), T: new Uint8Array(n * n), pts: new Float64Array(n), gp: new Float64Array(n) };
}
function copyRecords(dst, src) {
  dst.W.set(src.W); dst.T.set(src.T); dst.pts.set(src.pts); dst.gp.set(src.gp);
}
/* r: 1 = home won, 0 = away won, 0.5 = tie. */
function addResult(rec, h, a, r, sign = 1) {
  const n = rec.n;
  if (r === 1) rec.W[h * n + a] += sign;
  else if (r === 0) rec.W[a * n + h] += sign;
  else { rec.T[h * n + a] += sign; rec.T[a * n + h] += sign; }
  rec.pts[h] += sign * r; rec.pts[a] += sign * (1 - r);
  rec.gp[h] += sign; rec.gp[a] += sign;
}
function removeResult(rec, h, a, r) { addResult(rec, h, a, r, -1); }

const gamesBetween = (rec, i, j) => {
  const n = rec.n;
  return rec.W[i * n + j] + rec.W[j * n + i] + rec.T[i * n + j];
};
const pct = (rec, i) => (rec.gp[i] > 0 ? rec.pts[i] / rec.gp[i] : 0);

/* Win percentage of i in games against the clubs in `set`; NaN when it played none. */
function pctVs(rec, i, set) {
  const n = rec.n;
  let p = 0, g = 0;
  for (const j of set) {
    if (j === i) continue;
    const w = rec.W[i * n + j], l = rec.W[j * n + i], t = rec.T[i * n + j];
    p += w + 0.5 * t; g += w + l + t;
  }
  return g > 0 ? p / g : NaN;
}
function gamesVs(rec, i, set) {
  let g = 0;
  for (const j of set) if (j !== i) g += gamesBetween(rec, i, j);
  return g;
}
/* Opponents every club in S played at least once. The clubs themselves can never qualify:
   a club does not play itself. */
function commonOpponents(rec, S) {
  const out = [];
  for (let j = 0; j < rec.n; j++) {
    if (S.includes(j)) continue;
    if (S.every(i => gamesBetween(rec, i, j) > 0)) out.push(j);
  }
  return out;
}
/* Combined W-L-T percentage of the clubs i BEAT (a beaten-twice club counts twice). */
function sov(rec, i) {
  const n = rec.n;
  let p = 0, g = 0;
  for (let j = 0; j < n; j++) {
    const w = rec.W[i * n + j];
    if (w) { p += w * rec.pts[j]; g += w * rec.gp[j]; }
  }
  return g > 0 ? p / g : 0;
}
/* Combined W-L-T percentage of every opponent, once per game played against it. */
function sos(rec, i) {
  let p = 0, g = 0;
  for (let j = 0; j < rec.n; j++) {
    const k = gamesBetween(rec, i, j);
    if (k) { p += k * rec.pts[j]; g += k * rec.gp[j]; }
  }
  return g > 0 ? p / g : 0;
}

/* ------------------------------------------------------------ tie steps ----
   Each step takes the tied set and returns values aligned to it (higher is better), or
   null when the step does not apply to this set — the procedure then moves on. */
function makeSteps(league, rec) {
  const allApplicable = v => (v.some(Number.isNaN) ? null : v);
  const conferenceOf = i => league.confTeams[league.conf[i]];
  const divisionOf = i => league.divTeams[league.div[i]];
  const h2h = S => allApplicable(S.map(i => pctVs(rec, i, S)));
  const division = S => allApplicable(S.map(i => pctVs(rec, i, divisionOf(i))));
  const conference = S => allApplicable(S.map(i => pctVs(rec, i, conferenceOf(i))));
  const common = minGames => S => {
    const C = commonOpponents(rec, S);
    if (!C.length) return null;
    if (minGames && S.some(i => gamesVs(rec, i, C) < minGames)) return null;
    return allApplicable(S.map(i => pctVs(rec, i, C)));
  };
  const victory = S => S.map(i => sov(rec, i));
  const schedule = S => S.map(i => sos(rec, i));
  /* Two-club wild-card head-to-head applies only if the clubs met. */
  const h2hIfPlayed = S => (gamesBetween(rec, S[0], S[1]) > 0 ? h2h(S) : null);
  return {
    divTwo: [h2h, division, common(0), conference, victory, schedule],
    divMulti: [h2h, division, common(0), conference, victory, schedule],
    wcTwo: [h2hIfPlayed, conference, common(4), victory, schedule],
    wcMulti: [conference, common(4), victory, schedule],
  };
}

function bestOf(S, values) {
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  return S.filter((_, k) => values[k] >= max - EPS);
}
function coinToss(S, lottery) {
  let best = S[0];
  for (const i of S) if (lottery[i] < lottery[best]) best = i;
  return best;
}
function pickTwo(S, steps, lottery) {
  for (const step of steps) {
    const v = step(S);
    if (!v) continue;
    if (v[0] > v[1] + EPS) return S[0];
    if (v[1] > v[0] + EPS) return S[1];
  }
  return coinToss(S, lottery);
}
/* ⚠️ The revert rule is the classic implementation bug: when a multi-club step leaves
   exactly two clubs, they go back to step 1 of the TWO-club format (head-to-head),
   not on to the next multi-club step. */
function pickMulti(S, steps, twoSteps, lottery) {
  let cur = S;
  for (const step of steps) {
    const v = step(cur);
    if (!v) continue;
    const next = bestOf(cur, v);
    if (next.length === 1) return next[0];
    if (next.length === 2 && cur.length > 2) return pickTwo(next, twoSteps, lottery);
    cur = next;
  }
  return cur.length === 2 ? pickTwo(cur, twoSteps, lottery) : coinToss(cur, lottery);
}

/* Wild-card multi-club step 2: "Head-to-head sweep. Applicable only if one club has
   defeated each of the others or if one club has lost to each of the others." */
function sweep(rec, S) {
  const n = rec.n;
  const beatAll = i => S.every(j => j === i || (gamesBetween(rec, i, j) > 0 && rec.W[i * n + j] === gamesBetween(rec, i, j)));
  const lostAll = i => S.every(j => j === i || (gamesBetween(rec, i, j) > 0 && rec.W[j * n + i] === gamesBetween(rec, i, j)));
  const winner = S.find(beatAll);
  if (winner !== undefined) return { winner };
  const loser = S.find(lostAll);
  if (loser !== undefined) return { eliminate: loser };
  return null;
}

/* The three procedures, bound to one record set and one coin toss. Each pick receives
   clubs already tied on overall percentage and returns the one club that advances. */
function createTiebreakers(league, rec, lottery) {
  const steps = makeSteps(league, rec);
  const divPick = S => (S.length === 2
    ? pickTwo(S, steps.divTwo, lottery)
    : pickMulti(S, steps.divMulti, steps.divTwo, lottery));
  /* Wild-card format on a set already reduced to one club per division. */
  const wcPickReduced = S => {
    if (S.length === 1) return S[0];
    if (S.length === 2) return pickTwo(S, steps.wcTwo, lottery);
    const sw = sweep(rec, S);
    if (sw && sw.winner !== undefined) return sw.winner;
    let cur = S;
    if (sw && sw.eliminate !== undefined) {
      cur = S.filter(i => i !== sw.eliminate);
      if (cur.length === 1) return cur[0];
      if (cur.length === 2) return pickTwo(cur, steps.wcTwo, lottery);
    }
    return pickMulti(cur, steps.wcMulti, steps.wcTwo, lottery);
  };
  /* Repeatedly take the best-percentage group and let `pick` choose one club from it;
     the others restart from step 1 on the next pass. */
  const orderBy = (list, pick) => {
    const rest = list.slice(), order = [];
    while (rest.length) {
      let max = -Infinity;
      for (const i of rest) { const p = pct(rec, i); if (p > max) max = p; }
      const tied = rest.filter(i => pct(rec, i) >= max - EPS);
      const w = tied.length === 1 ? tied[0] : pick(tied);
      order.push(w); rest.splice(rest.indexOf(w), 1);
    }
    return order;
  };
  /* Wild-card step 1 first: only the highest-ranked tied club of each division goes on. */
  const wcPick = (S, divRank) => {
    const byDiv = new Map();
    for (const i of S) {
      const d = league.div[i], cur = byDiv.get(d);
      if (cur === undefined || divRank.get(i) < divRank.get(cur)) byDiv.set(d, i);
    }
    return wcPickReduced([...byDiv.values()]);
  };
  return { divPick, wcPick, wcPickReduced, orderBy };
}

function createResolver(league, rec, lottery, wildcards = 3) {
  const { divPick, wcPick, wcPickReduced, orderBy } = createTiebreakers(league, rec, lottery);

  function seedConference(c) {
    const divs = league.divConf.map((cf, d) => (cf === c ? d : -1)).filter(d => d >= 0);
    const divRank = new Map();
    const winners = [];
    for (const d of divs) {
      const order = orderBy(league.divTeams[d], divPick);
      order.forEach((i, k) => divRank.set(i, k));
      winners.push(order[0]);
    }
    /* Seeds 1-4: division winners by percentage, ties by the wild-card procedure. */
    const top = orderBy(winners, wcPickReduced);
    /* Wild cards: step 1 keeps only the highest-ranked tied club from each division. */
    const pool = league.confTeams[c].filter(i => !winners.includes(i));
    const wc = [];
    while (wc.length < wildcards && pool.length) {
      let max = -Infinity;
      for (const i of pool) { const p = pct(rec, i); if (p > max) max = p; }
      const tied = pool.filter(i => pct(rec, i) >= max - EPS);
      const w = tied.length === 1 ? tied[0] : wcPick(tied, divRank);
      wc.push(w); pool.splice(pool.indexOf(w), 1);
    }
    return { seeds: top.concat(wc), winners, divRank };
  }

  return function resolve(out) {
    out.made.fill(0); out.divWin.fill(0); out.seed.fill(0);
    for (let c = 0; c < CONFERENCES.length; c++) {
      const { seeds, winners } = seedConference(c);
      seeds.forEach((i, k) => { out.made[i] = 1; out.seed[i] = k + 1; });
      for (const i of winners) out.divWin[i] = 1;
    }
    return out;
  };
}

function createOutcome(n) {
  return { made: new Uint8Array(n), divWin: new Uint8Array(n), seed: new Uint8Array(n) };
}

/* ------------------------------------------------------------------ rng ----
   sfc32: small, fast, and good enough for Monte Carlo. Seeded from the input hash so the
   same inputs reproduce the same file byte for byte (and a no-change day commits nothing). */
function sfc32(a, b, c, d) {
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}
function rngFromHex(hex) {
  const w = k => parseInt(hex.slice(k * 8, k * 8 + 8), 16) >>> 0;
  if (!/^[0-9a-f]{32,}$/.test(hex)) throw new Error('seed must be at least 32 lowercase hex characters');
  return sfc32(w(0), w(1), w(2), w(3));
}
/* A random permutation rank per team: the season's coin toss for any tie that survives
   strength of schedule. Shared by every flipped branch of the same season. */
function drawLottery(rng, n, out) {
  for (let i = 0; i < n; i++) out[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/* ------------------------------------------------------------- simulate ----
   games: [{h, a, final, r?, p?}] in team-index space. r is the real result of a final;
   p is the home-win probability of an unplayed game. leverage: indexes into `games` of
   the unplayed games whose result is flipped. */
function simulate({ league, games, sims, seedHex, leverage = [], wildcards = 3 }) {
  const n = league.n;
  const base = createRecords(n);
  const remaining = [];
  games.forEach((g, k) => {
    if (g.final) {
      if (![0, 0.5, 1].includes(g.r)) throw new Error(`game ${k}: final without a result`);
      addResult(base, g.h, g.a, g.r);
    } else {
      if (!(g.p > 0 && g.p < 1)) throw new Error(`game ${k}: probability ${g.p} outside (0,1)`);
      remaining.push(k);
    }
  });
  for (const k of leverage) if (games[k].final) throw new Error(`leverage game ${k} is already final`);

  const rec = createRecords(n);
  const lottery = new Int32Array(n);
  const resolve = createResolver(league, rec, lottery, wildcards);
  const out = createOutcome(n), flipped = createOutcome(n);
  const rng = rngFromHex(seedHex);
  const result = new Float64Array(games.length);

  const made = new Float64Array(n), divWin = new Float64Array(n), winsSum = new Float64Array(n);
  const seedCount = Array.from({ length: n }, () => new Float64Array(8));
  const L = leverage.length;
  /* branch 0 = home team wins the leverage game, branch 1 = away team wins */
  const branchMade = Array.from({ length: L }, () => [new Float64Array(n), new Float64Array(n)]);
  const diffSum = Array.from({ length: L }, () => new Float64Array(n));
  const diffSq = Array.from({ length: L }, () => new Float64Array(n));

  for (let s = 0; s < sims; s++) {
    copyRecords(rec, base);
    drawLottery(rng, n, lottery);
    for (const k of remaining) {
      const g = games[k];
      const r = rng() < g.p ? 1 : 0;
      result[k] = r;
      addResult(rec, g.h, g.a, r);
    }
    resolve(out);
    for (let i = 0; i < n; i++) {
      made[i] += out.made[i]; divWin[i] += out.divWin[i]; winsSum[i] += rec.pts[i];
      seedCount[i][out.seed[i]] += 1;
    }
    for (let l = 0; l < L; l++) {
      const g = games[leverage[l]], r = result[leverage[l]];
      const natural = r === 1 ? 0 : 1;
      removeResult(rec, g.h, g.a, r); addResult(rec, g.h, g.a, 1 - r);
      resolve(flipped);
      removeResult(rec, g.h, g.a, 1 - r); addResult(rec, g.h, g.a, r);
      const home = natural === 0 ? out.made : flipped.made;
      const away = natural === 0 ? flipped.made : out.made;
      const bm = branchMade[l];
      for (let i = 0; i < n; i++) {
        bm[0][i] += home[i]; bm[1][i] += away[i];
        const d = home[i] - away[i];
        if (d) { diffSum[l][i] += d; diffSq[l][i] += d * d; }
      }
    }
  }

  const N = sims;
  const se = (sum, sq) => Math.sqrt(Math.max(0, sq / N - (sum / N) ** 2) / N);
  return {
    sims: N,
    remaining: remaining.length,
    teams: league.teams.map((code, i) => ({
      i, code,
      playoffs: made[i] / N,
      division: divWin[i] / N,
      bye: seedCount[i][1] / N,
      seeds: Array.from(seedCount[i].slice(1), v => v / N),
      winsMean: winsSum[i] / N,
    })),
    leverage: leverage.map((k, l) => ({
      game: k,
      ifHomeWin: Array.from(branchMade[l][0], v => v / N),
      ifAwayWin: Array.from(branchMade[l][1], v => v / N),
      /* standard error of P(made | home wins) - P(made | away wins), per team */
      diffSe: Array.from(diffSum[l], (v, i) => se(v, diffSq[l][i])),
    })),
  };
}

/* One deterministic resolution of a complete or partial record set — used by the
   historical replay and the unit fixtures. */
function seedLeague(league, rec, { lottery, wildcards = 3 } = {}) {
  const lot = lottery || Int32Array.from({ length: league.n }, (_, i) => i);
  const resolve = createResolver(league, rec, lot, wildcards);
  const out = resolve(createOutcome(league.n));
  const seeds = CONFERENCES.map(() => []);
  for (let i = 0; i < league.n; i++) if (out.seed[i]) seeds[league.conf[i]][out.seed[i] - 1] = league.teams[i];
  return { seeds, out };
}

module.exports = {
  DIVISIONS, CONFERENCES, NICKNAMES, createLeague, createRecords, copyRecords, addResult, removeResult,
  pct, pctVs, sov, sos, commonOpponents, gamesBetween, createTiebreakers, createResolver, createOutcome,
  seedLeague, simulate, sfc32, rngFromHex, drawLottery,
};
