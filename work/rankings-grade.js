
/* The Dog Track — grading half (Stage B): stats, matching, metrics, publication.
 *
 * ⚠️ EDIT THIS FILE, NEVER THE ASSEMBLED WORKER. It is concatenated with
 * rankings-block.js into the DD-RANKINGS-BLOCK region by work/assemble.mjs.
 *
 * ⚠️ THE METHODOLOGY IS PRE-REGISTERED (spec §3) AND THIS FILE IMPLEMENTS IT LITERALLY.
 * Three metrics, no fourth. The depths, the G values, the 2,000 bootstrap draws, the 0.7
 * shrinkage, the grade cutoffs and the tie rule are all spec constants, not tuning knobs.
 * The page publishes §3 verbatim before Week 1; changing a number here after that is an
 * amendment that owes the reader a dated note saying what changed and why.
 *
 * WHAT PUBLISHES AND WHAT DOES NOT
 * /rankings/graded/{season}/{week} and the snapshots stay private: they are derived from
 * paid inputs at player level. /rankings/public/{season} carries scores only, and
 * GET /rankings/grades is the single public read in this entire feature. The unmatched
 * review list DOES carry player names — it is returned from the admin-only grade route,
 * because adding an alias requires seeing the name — and the public doc carries only the
 * count, as excluded_unmatched.
 */

const RANKINGS_G = { RB: 12, WR: 12, QB: 6, TE: 6 };            // capture-rate group size, §3
const RANKINGS_STARTABLE = { RB: 24, WR: 24, QB: 12, TE: 12 };  // hygiene window, §3
const RANKINGS_BOOTSTRAP_DRAWS = 2000;
const RANKINGS_SHRINK_K = 0.7;
const RANKINGS_EB_FROM_WEEK = 10;
const RANKINGS_MIN_WEEKS = 4;                                   // provisional + matched-week floor
const RANKINGS_METHOD_VERSION = "1.0";
const RANKINGS_SLEEPER_STATS = "https://api.sleeper.app/v1/stats/nfl/regular";

/* ============================================================== rank arithmetic ==== */

/* Mid-ranks for ties (§3: "actual finish = within-position rank by PPR points, mid-ranks
 * for ties"). Two players tied for 3rd both get 3.5, and the next player gets 5 — the
 * positions are consumed, not compressed. Feeding competition ranks (3,3,5) or dense
 * ranks (3,3,4) into Spearman instead would quietly bias every tied week. */
function rankingsMidRanks(scores) {
  const order = scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const ranks = new Array(scores.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const mid = ((i + 1) + (j + 1)) / 2;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = mid;
    i = j + 1;
  }
  return ranks;
}

function rankingsPearson(a, b) {
  const n = a.length;
  if (n < 2) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return null;      // a constant vector has no correlation
  return num / Math.sqrt(da * db);
}

/* Spearman ρ IS Pearson on the rank vectors. Both inputs here are already mid-ranks, so
 * this is the tie-corrected form rather than the 1 - 6Σd²/n(n²-1) shortcut, which is only
 * valid without ties. */
const rankingsSpearman = (serviceRanks, actualRanks) => rankingsPearson(serviceRanks, actualRanks);

/* Weighted Kendall τ, §3: "hyperbolic weights on actual-finish rank (scipy weightedtau
 * semantics; implement in JS: additive hyperbolic weighting, w(r)=1/(r+1))".
 *
 * Pair weight is additive — w(r_i) + w(r_j) — so a pair involving the actual RB1 carries
 * far more than a pair of week-long benchwarmers. r is the 1-based actual finish rank
 * exactly as §3 writes it, so the actual winner weighs 1/2. A tied pair contributes 0 to
 * the numerator and its full weight to the denominator (tau-a treatment of ties). */
function rankingsWeightedTau(serviceRanks, actualRanks) {
  const n = serviceRanks.length;
  if (n < 2) return null;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = 1 / (actualRanks[i] + 1) + 1 / (actualRanks[j] + 1);
      num += w * Math.sign(serviceRanks[j] - serviceRanks[i]) * Math.sign(actualRanks[j] - actualRanks[i]);
      den += w;
    }
  }
  return den === 0 ? null : num / den;
}

/* Capture rate, §3: points scored by the service's top-G group ÷ points scored by the
 * actual top-G group. Computed on the service's list as pasted — a top-12 RB who did not
 * play contributes 0 and correctly costs the service, which is the whole point of the
 * "money view". This is why it runs on the full ranked list rather than the
 * inactive-stripped correlation pool. */
function rankingsCaptureRate(entrantRanked, pointsOf, actualPool, G) {
  const topG = entrantRanked.slice().sort((a, b) => a.rank - b.rank).slice(0, G);
  const got = topG.reduce((s, r) => s + (pointsOf(r.key) || 0), 0);
  const best = actualPool.slice().sort((a, b) => b.points - a.points).slice(0, G)
    .reduce((s, p) => s + p.points, 0);
  if (!best) return null;
  return (got / best) * 100;
}

/* ⚠️ SEEDED, DELIBERATELY. The public season doc is rebuilt from the immutable graded rows
 * at every grade run. With Math.random the same unchanged week would print a slightly
 * different CI on every rebuild, and a number that moves when nothing happened is a number
 * a reader is right to distrust. The seed is derived from (season, scope, entrant), so a
 * rebuild reproduces the interval exactly and a genuinely new week changes it. */
function rankingsSeedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rankingsPrng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Bootstrap 95% CI on the season mean: resample weeks with replacement, 2,000 draws,
 * percentile method (§3). One week cannot produce an interval and must not pretend to —
 * a CI of width zero implying certainty is trap #11's failure mode. */
function rankingsBootstrapCI(weekly, seedStr) {
  const vals = weekly.filter(v => Number.isFinite(v));
  if (vals.length < 2) return null;
  const rnd = rankingsPrng(rankingsSeedFrom(seedStr));
  const means = new Array(RANKINGS_BOOTSTRAP_DRAWS);
  for (let d = 0; d < RANKINGS_BOOTSTRAP_DRAWS; d++) {
    let s = 0;
    for (let i = 0; i < vals.length; i++) s += vals[Math.floor(rnd() * vals.length)];
    means[d] = s / vals.length;
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * RANKINGS_BOOTSTRAP_DRAWS)],
          means[Math.ceil(0.975 * RANKINGS_BOOTSTRAP_DRAWS) - 1]];
}

const rankingsMean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function rankingsVariance(a) {
  if (a.length < 2) return 0;
  const m = rankingsMean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
}

/* Shrinkage, §3. Before Week 10 it is the declared flat 0.7. From Week 10 the
 * empirical-Bayes weight is used where it is computable: w = var_between /
 * (var_between + var_within/n). var_between is the spread of entrant means with the
 * portion attributable to within-entrant noise removed, floored at zero — a negative
 * between-variance estimate means the field is indistinguishable, and the honest response
 * is to shrink everything to the field mean rather than to report a negative weight. */
function rankingsShrinkWeights(perEntrantWeekly, week) {
  const series = Object.values(perEntrantWeekly).filter(w => w.length >= 1);
  if (week < RANKINGS_EB_FROM_WEEK || series.length < 2) {
    return { mode: "fixed-0.7", weightFor: () => RANKINGS_SHRINK_K };
  }
  const means = series.map(w => rankingsMean(w));
  const withins = series.filter(w => w.length >= 2).map(w => rankingsVariance(w));
  if (!withins.length) return { mode: "fixed-0.7", weightFor: () => RANKINGS_SHRINK_K };
  const varWithin = rankingsMean(withins);
  const nBar = rankingsMean(series.map(w => w.length));
  const varBetween = Math.max(0, rankingsVariance(means) - varWithin / nBar);
  if (varBetween === 0) return { mode: "empirical-bayes", weightFor: () => 0 };
  return {
    mode: "empirical-bayes",
    weightFor: n => varBetween / (varBetween + varWithin / Math.max(1, n)),
  };
}

/* Letter grades, §3: blended percentile of the three metrics vs. the field per scope.
 * A metric the field cannot supply (an all-null hygiene column, say) is dropped from the
 * blend rather than scored as zero. */
function rankingsPercentile(value, field) {
  const vals = field.filter(v => Number.isFinite(v));
  if (!vals.length || !Number.isFinite(value)) return null;
  if (vals.length === 1) return 50;
  const below = vals.filter(v => v < value).length;
  const equal = vals.filter(v => v === value).length;
  return ((below + 0.5 * equal) / vals.length) * 100;
}
function rankingsLetter(p) {
  if (p >= 90) return "A";
  if (p >= 80) return "A−";
  if (p >= 70) return "B+";
  if (p >= 60) return "B";
  if (p >= 50) return "B−";
  if (p >= 40) return "C+";
  return "C";
}

/* ============================================================= name matching ======= */

/* THE ALIAS KEY FORMAT, which aliases.csv must mirror exactly (spec §8.5 contract #2).
 * Two accepted shapes, tried in this order:
 *     "<normalized name>|<TEAM>|<POS>"   → player_id      (most specific)
 *     "<normalized name>|<POS>"          → player_id      (team-independent)
 * The team-independent form exists because a trade is the common reason a Thursday paste
 * disagrees with the player index, and re-aliasing every traded player every week would
 * guarantee the map rots. Normalization is rankingsNormName — the ONE shared spec.
 */
const rankingsAliasKeys = (norm, team, pos) => [`${norm}|${team}|${pos}`, `${norm}|${pos}`];

function rankingsPlayerIndex(slim) {
  const byTriple = new Map(), byNamePos = new Map();
  for (const [id, row] of Object.entries(slim || {})) {
    const [name, pos, team] = row;
    const norm = rankingsNormName(name);
    if (!norm || !pos) continue;
    byTriple.set(`${norm}|${String(team || "")}|${pos}`, id);
    const np = `${norm}|${pos}`;
    if (!byNamePos.has(np)) byNamePos.set(np, []);
    byNamePos.get(np).push(id);
  }
  return { byTriple, byNamePos };
}

/* ⚠️ TRAP #1 LIVES HERE — name matching is the failure mode of this entire feature.
 * Exact on (normalized name + team + pos), then the alias map, then FAIL LOUDLY. There is
 * deliberately no fuzzy fallback: a wrong merge corrupts a graded row that is immutable by
 * design, and an edit-distance match between two real players is indistinguishable from a
 * correct one at review time. Unmatched rows are excluded from the week and surfaced to
 * the admin with a suggestion, which is how the alias map grows. */
function rankingsMatchRow(row, index, aliases) {
  const norm = rankingsNormName(row.name);
  const triple = `${norm}|${row.team}|${row.pos}`;
  if (index.byTriple.has(triple)) return { id: index.byTriple.get(triple), via: "exact" };

  for (const key of rankingsAliasKeys(norm, row.team, row.pos)) {
    const id = aliases && aliases[key];
    if (id) return { id: String(id), via: "alias" };
  }

  // Unique on name+pos but the team disagrees: almost always a trade. NOT auto-matched —
  // it is offered to the admin as a one-click alias instead.
  const np = index.byNamePos.get(`${norm}|${row.pos}`) || [];
  const suggestion = np.length === 1 ? np[0] : null;
  return { id: null, via: "unmatched", suggestion, alias_key: `${norm}|${row.pos}` };
}

/* ============================================================= stats fetching ===== */

/* Source order per §4: Sleeper first, ESPN as the fallback.
 * ⚠️ The ESPN leg will almost certainly fail from Worker egress — this Worker documents at
 * /scores (8/4/26) that ESPN 403s Cloudflare IPs across every header shape. It is
 * implemented because the spec names it and because the block is not the right place to
 * decide the spec is wrong, but a grade run that reaches it should be read as "Sleeper is
 * down", not as "we have a second working source". Same finding as deviation D1. */
async function rankingsFetchStats(season, week) {
  try {
    const r = await fetch(`${RANKINGS_SLEEPER_STATS}/${season}/${week}`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) {
      const raw = await r.json();
      if (raw && typeof raw === "object" && Object.keys(raw).length) return { stats: raw, source: "sleeper" };
    }
  } catch (e) { /* fall through */ }

  for (const shape of FETCH_SHAPES) {
    try {
      const r = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`,
        { cf: { cacheTtl: 300, cacheEverything: true }, headers: shape.headers });
      if (!r.ok) continue;
      await r.json();
      // ESPN's scoreboard does not carry per-player PPR; reaching here means Sleeper is
      // down and the run cannot be graded honestly. Refuse rather than invent a number.
      return { stats: null, source: "espn-unusable" };
    } catch (e) { /* try the next shape */ }
  }
  return { stats: null, source: null };
}

/* Did a player actually play? §3 removes inactives, byes and ruled-OUT players from the
 * correlation pool — but NOT a player who suited up and scored zero, who is a genuine
 * ranking miss and must keep costing the service that ranked him. Sleeper omits the row
 * entirely for a player who did not appear, and carries gp on those who did. */
function rankingsPlayed(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.gp !== undefined) return Number(entry.gp) > 0;
  return Object.keys(entry).length > 0;
}
const rankingsPprOf = entry => (entry && Number.isFinite(Number(entry.pts_ppr)) ? Number(entry.pts_ppr) : 0);

/* ============================================================ the weekly grade ==== */

/* BLEND membership freezes at Week 1 and is written once (§3: "a mutating benchmark
 * corrupts comparability"). Recomputing it every week from the live registry would quietly
 * admit every mid-season entrant into the benchmark that all the relative-to-field numbers
 * are measured against, which is the same class of error as a moving goalpost. */
async function rankingsBlendMembers(env, season, entrants, dryRun) {
  const path = `/rankings/blend/${season}`;
  const { data } = await fbGet(env, path);
  if (data && Array.isArray(data.members)) return data;

  const members = Object.entries(entrants)
    .filter(([, e]) => e.type === "service" && Number(e.first_week) <= 1)
    .map(([id]) => id)
    .sort();
  const frozen = { members, frozen_at_week: 1, frozen_at: new Date().toISOString() };
  if (!dryRun) {
    try { await fbPut(env, path, frozen); } catch (e) { /* a failed freeze retries next run */ }
  }
  return frozen;
}

/* Imputation for a player the entrant did not rank (§3: "slot at that service's deepest
 * ranked player + 1, ties broken by consensus order").
 *
 * ⚠️ INTERPRETATION I1, recorded in the spec. "Ties broken by consensus order" is read as
 * assigning consecutive slots — deepest+1, deepest+2, … in consensus order — rather than
 * giving every unranked player the identical value deepest+1 and mid-ranking the block.
 * The two readings agree on ordering and differ in how hard the unranked tail pulls on ρ.
 * Consecutive slots is the reading that actually breaks the tie, which is what the text
 * says. Raised for ratification rather than assumed. */
function rankingsEntrantRanks(pool, rankedByKey, consensusRank) {
  const deepest = Math.max(0, ...Object.values(rankedByKey));
  const unranked = pool.filter(k => rankedByKey[k] === undefined)
    .sort((a, b) => (consensusRank[a] ?? Infinity) - (consensusRank[b] ?? Infinity));
  const imputed = {};
  unranked.forEach((k, i) => { imputed[k] = deepest + 1 + i; });
  return pool.map(k => (rankedByKey[k] !== undefined ? rankedByKey[k] : imputed[k]));
}

/* Hygiene (§3, G1 resolved): count the players who were officially OUT at capture time yet
 * sat inside the startable range of that entrant's list. Never touches the correlation.
 *
 * The OUT list is stamped onto the capture on Thursday as Sleeper player ids
 * (rankingsOutList — statuses Out/IR/PUP/Sus, once per week, undercount-safe), and the
 * ranked rows arriving here are the MATCHED rows, already carrying their ids — so this is
 * a set lookup, not a second name-matching pass that could disagree with the first.
 * A capture whose OUT fetch failed carries null and that week's hygiene honestly reads
 * null: an annotation gap is not a clean record, and it is never rendered as 0. */
function rankingsHygiene(capture, ranked, pos) {
  const out = capture && capture.out_at_capture;
  if (!Array.isArray(out)) return null;
  const outSet = new Set(out);
  const window = RANKINGS_STARTABLE[pos];
  return ranked.filter(r => r.rank <= window && outSet.has(r.key)).length;
}

function rankingsGradeWeek({ captures, entrants, stats, index, aliases, blendMembers }) {
  const unmatched = [];
  const positions = {};

  // player_id -> PPR points, and the per-position actual boards, from the stats source
  const pointsOf = id => rankingsPprOf(stats[id]);
  const playedOf = id => rankingsPlayed(stats[id]);

  const actualByPos = {};
  for (const pos of RANKINGS_POS) actualByPos[pos] = [];
  for (const [id, row] of Object.entries(index.slim || {})) {
    const pos = row[1];
    if (!RANKINGS_POS.includes(pos)) continue;
    if (!playedOf(id)) continue;
    actualByPos[pos].push({ key: id, points: pointsOf(id) });
  }

  // match every entrant's rows once, up front
  const matched = {};
  for (const [eid, cap] of Object.entries(captures)) {
    matched[eid] = { byPos: {}, capture: cap };
    for (const pos of RANKINGS_POS) matched[eid].byPos[pos] = [];
    for (const row of cap.rows || []) {
      const m = rankingsMatchRow(row, index, aliases);
      if (!m.id) {
        unmatched.push({ entrant: eid, pos: row.pos, rank: row.rank, name: row.name, team: row.team,
                         suggestion: m.suggestion, alias_key: m.alias_key });
        continue;
      }
      matched[eid].byPos[row.pos].push({ key: m.id, rank: row.rank, name: row.name, team: row.team });
    }
  }

  for (const pos of RANKINGS_POS) {
    const depth = RANKINGS_DEPTHS[pos];

    // consensus = mean rank across the uploaded SERVICE entrants (§3)
    const serviceIds = Object.keys(captures).filter(id => entrants[id] && entrants[id].type === "service");
    const consensusAcc = {};
    for (const eid of serviceIds) {
      for (const r of matched[eid].byPos[pos]) {
        if (!consensusAcc[r.key]) consensusAcc[r.key] = [];
        consensusAcc[r.key].push(r.rank);
      }
    }
    const consensusRank = {};
    Object.entries(consensusAcc).forEach(([k, arr]) => { consensusRank[k] = rankingsMean(arr); });
    const consensusTop = Object.keys(consensusRank)
      .sort((a, b) => consensusRank[a] - consensusRank[b]).slice(0, depth);

    const actualTop = actualByPos[pos].slice().sort((a, b) => b.points - a.points)
      .slice(0, depth).map(p => p.key);

    // pool = union, minus anyone who did not play (§3 removes inactives from the correlation)
    const pool = [...new Set([...consensusTop, ...actualTop])].filter(playedOf);
    const actualRanks = rankingsMidRanks(pool.map(pointsOf));
    const actualPool = pool.map(k => ({ key: k, points: pointsOf(k) }));

    // BLEND's per-player mean rank across the frozen membership, using each member's own
    // imputation so a player one member skipped is not scored as if the field skipped him
    const blendPresent = blendMembers.filter(id => captures[id]);
    const blendRanked = [];
    if (blendPresent.length) {
      const universe = [...new Set(blendPresent.flatMap(id => matched[id].byPos[pos].map(r => r.key)))];
      const perMember = blendPresent.map(id => {
        const byKey = {};
        matched[id].byPos[pos].forEach(r => { byKey[r.key] = r.rank; });
        const vals = rankingsEntrantRanks(universe, byKey, consensusRank);
        return Object.fromEntries(universe.map((k, i) => [k, vals[i]]));
      });
      const means = universe.map(k => ({ key: k, mean: rankingsMean(perMember.map(m => m[k])) }));
      means.sort((a, b) => a.mean - b.mean);
      means.forEach((m, i) => blendRanked.push({ key: m.key, rank: i + 1, name: "", team: "" }));
    }

    const rows = {};
    const graders = Object.keys(captures).map(id => ({ id, ranked: matched[id].byPos[pos], cap: matched[id].capture }));
    if (blendRanked.length) graders.push({ id: "BLEND", ranked: blendRanked, cap: null });

    for (const g of graders) {
      const byKey = {};
      g.ranked.forEach(r => { byKey[r.key] = r.rank; });
      const serviceRanks = rankingsEntrantRanks(pool, byKey, consensusRank);
      rows[g.id] = {
        rho: pool.length >= 2 ? rankingsSpearman(serviceRanks, actualRanks) : null,
        tau: pool.length >= 2 ? rankingsWeightedTau(serviceRanks, actualRanks) : null,
        capture: rankingsCaptureRate(g.ranked, pointsOf, actualPool, RANKINGS_G[pos]),
        hygiene: g.cap ? rankingsHygiene(g.cap, g.ranked, pos) : null,
        ranked_n: g.ranked.length,
        imputed_n: pool.filter(k => byKey[k] === undefined).length,
      };
    }

    positions[pos] = { pool_size: pool.length, entrants: rows };
  }

  return { positions, unmatched };
}

/* ======================================================== season aggregation ====== */

/* Rebuilt from the immutable graded rows at every run — derivable, so rebuilding is safe
 * (§2). Everything below is a score; nothing player-level reaches this document. */
async function rankingsRebuildPublic(env, season, entrants, blend, dryRun) {
  const { data } = await fbGet(env, `/rankings/graded/${season}`);
  const gradedWeeks = Object.keys(data || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);

  const scopes = {};
  const weeks = {};
  const latestWeek = gradedWeeks.length ? gradedWeeks[gradedWeeks.length - 1] : 0;
  let excludedUnmatched = 0;

  const seriesFor = {};                       // scope -> entrant -> [weekly value]
  const perWeekMetric = {};                   // week -> scope -> entrant -> raw metrics

  for (const w of gradedWeeks) {
    const row = data[String(w)];
    excludedUnmatched += Number(row.excluded_unmatched || 0);
    perWeekMetric[w] = {};
    const ids = new Set();
    for (const pos of RANKINGS_POS) Object.keys((row.positions[pos] || {}).entrants || {}).forEach(i => ids.add(i));

    for (const pos of RANKINGS_POS) {
      perWeekMetric[w][pos] = {};
      for (const id of ids) {
        const m = ((row.positions[pos] || {}).entrants || {})[id];
        if (!m) continue;
        perWeekMetric[w][pos][id] = { rho: m.rho, tau: m.tau, capture: m.capture, hygiene: m.hygiene };
        for (const [metric, val] of [["rho", m.rho], ["tau", m.tau], ["capture", m.capture], ["hygiene", m.hygiene]]) {
          if (!Number.isFinite(val)) continue;
          seriesFor[pos] = seriesFor[pos] || {};
          seriesFor[pos][id] = seriesFor[pos][id] || {};
          seriesFor[pos][id][metric] = seriesFor[pos][id][metric] || [];
          seriesFor[pos][id][metric].push(val);
        }
      }
    }

    // ALL = equal-weight mean across the four positions (§3, a declared choice)
    perWeekMetric[w].ALL = {};
    for (const id of ids) {
      const pick = metric => {
        const vals = RANKINGS_POS.map(p => (perWeekMetric[w][p][id] || {})[metric]).filter(Number.isFinite);
        return vals.length === RANKINGS_POS.length ? rankingsMean(vals) : null;
      };
      const rho = pick("rho"), tau = pick("tau"), capture = pick("capture");
      /* Hygiene at the ALL scope is a SUM across positions, not a mean — it is a counter
       * (the mockup's hygOf does the same). A week whose OUT list was unavailable has all
       * four positions null and stays null rather than becoming a fake zero. */
      const hygVals = RANKINGS_POS.map(p => (perWeekMetric[w][p][id] || {}).hygiene).filter(Number.isFinite);
      const hygiene = hygVals.length ? hygVals.reduce((a, b) => a + b, 0) : null;
      perWeekMetric[w].ALL[id] = { rho, tau, capture, hygiene };
      if (Number.isFinite(hygiene)) {
        seriesFor.ALL = seriesFor.ALL || {};
        seriesFor.ALL[id] = seriesFor.ALL[id] || {};
        seriesFor.ALL[id].hygiene = seriesFor.ALL[id].hygiene || [];
        seriesFor.ALL[id].hygiene.push(hygiene);
      }
      for (const [metric, val] of [["rho", rho], ["tau", tau], ["capture", capture]]) {
        if (!Number.isFinite(val)) continue;
        seriesFor.ALL = seriesFor.ALL || {};
        seriesFor.ALL[id] = seriesFor.ALL[id] || {};
        seriesFor.ALL[id][metric] = seriesFor.ALL[id][metric] || [];
        seriesFor.ALL[id][metric].push(val);
      }
    }
    weeks[String(w)] = perWeekMetric[w];
  }

  for (const scope of ["ALL", ...RANKINGS_POS]) {
    const byEntrant = seriesFor[scope] || {};
    const ids = Object.keys(byEntrant);
    if (!ids.length) { scopes[scope] = {}; continue; }

    const rhoSeries = Object.fromEntries(ids.map(id => [id, byEntrant[id].rho || []]));
    const fieldMean = rankingsMean(ids.map(id => rankingsMean(rhoSeries[id])).filter(Number.isFinite));
    const shrink = rankingsShrinkWeights(rhoSeries, latestWeek);

    const rows = {};
    for (const id of ids) {
      const weekly = rhoSeries[id];
      const raw = rankingsMean(weekly);
      const w = shrink.weightFor(weekly.length);
      const shrunk = Number.isFinite(raw) && Number.isFinite(fieldMean) ? fieldMean + w * (raw - fieldMean) : null;

      // relative-to-field: this entrant's weekly ρ minus BLEND's that same week, over the
      // weeks THIS entrant was graded — the headline cross-entrant comparison (§3)
      let relative = null;
      const blendWeekly = [];
      const mineWeekly = [];
      for (const wk of gradedWeeks) {
        const mine = ((perWeekMetric[wk][scope] || {})[id] || {}).rho;
        const bl = ((perWeekMetric[wk][scope] || {}).BLEND || {}).rho;
        if (Number.isFinite(mine) && Number.isFinite(bl)) { mineWeekly.push(mine); blendWeekly.push(bl); }
      }
      if (mineWeekly.length) relative = rankingsMean(mineWeekly.map((v, i) => v - blendWeekly[i]));

      rows[id] = {
        rho: shrunk, rho_raw: raw,
        ci: rankingsBootstrapCI(weekly, `${season}|${scope}|${id}`),
        tau: rankingsMean(byEntrant[id].tau || []),
        capture: rankingsMean(byEntrant[id].capture || []),
        // season hygiene = the sum of the weeks that had an OUT list; null if none did
        hygiene: (byEntrant[id].hygiene || []).length
          ? (byEntrant[id].hygiene).reduce((a, b) => a + b, 0) : null,
        relative_to_field: relative,
        weeks_graded: weekly.length,
        weekly_rho: weekly,
        provisional: weekly.length < RANKINGS_MIN_WEEKS,
      };
    }

    // PHOTO FINISH (§3): tied with the leader if your CI upper ≥ the leader's CI lower
    const ranked = Object.entries(rows).filter(([, r]) => Number.isFinite(r.rho))
      .sort((a, b) => b[1].rho - a[1].rho);
    const leader = ranked.length ? ranked[0] : null;
    for (const [id, r] of Object.entries(rows)) {
      r.tied_with_leader = !!(leader && r.ci && leader[1].ci && r.ci[1] >= leader[1].ci[0]);
      if (leader && id === leader[0]) r.tied_with_leader = true;
    }

    // letter grades from the blended percentile of the three metrics vs. the field
    const field = m => Object.values(rows).map(r => r[m]);
    for (const [id, r] of Object.entries(rows)) {
      const ps = [rankingsPercentile(r.rho, field("rho")),
                  rankingsPercentile(r.tau, field("tau")),
                  rankingsPercentile(r.capture, field("capture"))].filter(Number.isFinite);
      r.grade = ps.length ? rankingsLetter(rankingsMean(ps)) : null;
    }
    // "Tied services display the leader's grade" (§3)
    if (leader && rows[leader[0]] && rows[leader[0]].grade) {
      for (const r of Object.values(rows)) if (r.tied_with_leader) r.grade = rows[leader[0]].grade;
    }
    scopes[scope] = rows;
  }

  const doc = {
    season,
    weeks_graded: gradedWeeks.length,
    scoring: "PPR",
    updated_at: new Date().toISOString(),
    method_version: RANKINGS_METHOD_VERSION,
    provisional: true,                        // stays true until the declared promotion gate
    shrinkage_mode: rankingsShrinkWeights(seriesFor.ALL || {}, latestWeek).mode,
    excluded_unmatched: excludedUnmatched,
    /* true the moment any graded week carried an OUT list. Stays false over weeks graded
     * before this capability shipped — those can never be backfilled (G1), and the page
     * renders their hygiene as "not tracked yet" rather than 0. */
    hygiene_tracked: Object.values(scopes).some(rows =>
      Object.values(rows).some(r => Number.isFinite(r.hygiene))),
    entrants: Object.fromEntries(Object.entries(entrants).map(([id, e]) => [id, {
      name: e.name, type: e.type, color: e.color, first_week: e.first_week,
      blend_member: (blend.members || []).includes(id),
    }])),
    blend: { members: blend.members || [], frozen_at_week: blend.frozen_at_week || 1 },
    scopes,
    weeks,
  };
  if (!dryRun) await fbPut(env, `/rankings/public/${season}`, doc);
  return doc;
}

/* ================================================================== the routes ==== */

async function rankingsGrade(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const season = Number(body.season);
  const week = Number(body.week);
  const dryRun = body.dry_run === true;
  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  if (!Number.isInteger(week) || week < 1 || week > 18) return json({ error: "bad week" }, 400, cors);

  /* Write-once. A graded row is the record of what a service said BEFORE the games; a
   * re-grade is how that record silently becomes a record of something else. */
  const existing = await fbGet(env, `/rankings/graded/${season}/${week}`);
  if (existing.data && !dryRun)
    return json({ error: "week already graded — graded rows are immutable", graded_at: existing.data.graded_at }, 409, cors);

  const entrants = await rankingsEntrants(env);
  const { data: snapRaw } = await fbGet(env, `/rankings/snapshots/${season}/${week}`);
  const captures = {};
  const skipped = [];
  for (const [eid, caps] of Object.entries(snapRaw || {})) {
    const active = rankingsActiveCapture(caps);
    if (!active) { skipped.push({ entrant: eid, reason: "no_snapshot" }); continue; }

    /* Trap #5's other half: a capture accepted with kickoff_check "deferred" has never
     * actually been checked against a kickoff. Grade time is where that debt comes due —
     * verify now, and refuse the row if it turns out to have been late. */
    if (active.capture.kickoff_check === "deferred" && season !== 0) {
      const ko = await rankingsFirstKickoff(env, season, week);
      if (ko.at && Date.parse(active.capture.captured_at) >= Date.parse(ko.at)) {
        skipped.push({ entrant: eid, reason: "late_on_deferred_check", captured_at: active.capture.captured_at, kickoff_at: ko.at });
        await rankingsLog(env, { action: "grade_exclude", entrant: eid, season, week,
                                 detail: { reason: "late_on_deferred_check", capture_id: active.id } });
        continue;
      }
    }
    captures[eid] = active.capture;
  }

  if (!Object.keys(captures).length)
    return json({ error: "no gradeable snapshots for this week", skipped }, 400, cors);

  const { stats, source } = await rankingsFetchStats(season, week);
  if (!stats) return json({ error: "no usable stats source — refusing to grade", stats_source: source }, 502, cors);

  const slim = await rankingsSlimIndex(env);
  if (!slim) return json({ error: "player index unavailable — refusing to grade" }, 503, cors);
  const index = rankingsPlayerIndex(slim);
  index.slim = slim;

  const { data: aliases } = await fbGet(env, "/rankings/aliases");
  const blend = await rankingsBlendMembers(env, season, entrants, dryRun);

  const { positions, unmatched } = rankingsGradeWeek({
    captures, entrants, stats, index, aliases: aliases || {}, blendMembers: blend.members,
  });

  const row = {
    graded_at: new Date().toISOString(),
    stats_source: source,
    method_version: RANKINGS_METHOD_VERSION,
    excluded_unmatched: unmatched.length,
    entrants_graded: Object.keys(positions.RB ? positions.RB.entrants : {}),
    positions,
  };
  if (!dryRun) {
    await fbPut(env, `/rankings/graded/${season}/${week}`, row);
    await rankingsLog(env, { action: "grade", season, week,
                             detail: { stats_source: source, excluded_unmatched: unmatched.length } });
  }

  const doc = season === 0 && !dryRun
    ? null                                     // season 0 is the sandbox; it never publishes
    : await rankingsRebuildPublic(env, season, entrants, blend, dryRun || season === 0);

  return json({
    ok: true, dry_run: dryRun, season, week, stats_source: source,
    entrants_graded: row.entrants_graded, skipped,
    excluded_unmatched: unmatched.length,
    unmatched,                                 // admin-only: names are needed to add aliases
    weeks_graded: doc ? doc.weeks_graded : null,
  }, 200, cors);
}

/* The player index. Reuses the Worker's existing daily-cached slim copy rather than adding
 * a second index — Sleeper's own guidance is one /players/nfl pull per day, and two
 * independent caches would mean two different answers to "who is a WR". */
async function rankingsSlimIndex(env) {
  const kv = env.RL || null;
  if (kv) {
    try {
      const cached = await kv.get(SLEEPER_SLIM_KEY);
      if (cached) {
        const payload = JSON.parse(cached);
        if (payload && payload.data && payload.data.players) return payload.data.players;
      }
    } catch (e) { /* fall through to a live pull */ }
  }
  try {
    const r = await fetch(SLEEPER_PLAYERS_URL);
    if (!r.ok) return null;
    return sleeperSlimFromRaw(await r.json()).players;
  } catch (e) { return null; }
}

/* THE ONLY PUBLIC READ IN THIS FEATURE. Derived scores, entrant identity and the method
 * version — no player, no rank, no snapshot. Before Week 1 it answers with an honest empty
 * state rather than a 404, so the page can render "season opens Sep 10" from real data. */
async function rankingsGrades(request, url, env, cors) {
  const season = Number(url.searchParams.get("season") || new Date().getUTCFullYear());
  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  // ⚠️ Order matters: `season < 1` first would swallow 0 into a generic "bad season" and
  // leave this branch dead, which is exactly how it was written the first time.
  if (season === 0) return json({ error: "the sandbox season is not published" }, 404, cors);

  const { data } = await fbGet(env, `/rankings/public/${season}`);
  if (!data) {
    return json({
      season, weeks_graded: 0, scoring: "PPR", method_version: RANKINGS_METHOD_VERSION,
      provisional: true, empty: true,
      note: "No graded weeks yet. Methodology is pre-registered and published; receipts follow the first Tuesday grade run.",
      entrants: {}, scopes: {}, weeks: {},
    }, 200, cors);
  }
  return json(data, 200, cors);
}

/* The other half of trap #1's loop: the review list surfaces an unmatched name, this turns
 * it into an alias, and the next grade run matches it. Bulk form accepts the seed import
 * from the local pipeline's aliases.csv (§8.5 contract #2) through the same door — one
 * validation path, one audit trail, no special-case importer. */
async function rankingsAliasAdd(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const incoming = Array.isArray(body.aliases) ? body.aliases
    : (body.key && body.player_id ? [{ key: body.key, player_id: body.player_id }] : null);
  if (!incoming || !incoming.length) return json({ error: "aliases required" }, 400, cors);
  if (incoming.length > 4000) return json({ error: "too many aliases in one call" }, 400, cors);

  const { data, etag } = await fbGet(env, "/rankings/aliases", true);
  const map = data || {};
  const added = [], rejected = [], conflicts = [];

  for (const a of incoming) {
    const key = String((a && a.key) || "").trim().toLowerCase();
    const pid = String((a && a.player_id) || "").trim();
    // key is "<normalized name>|<POS>" or "<normalized name>|<TEAM>|<POS>" — see rankingsAliasKeys
    if (!/^[^|]+\|[a-z]{2,4}(\|[a-z]{2,4})?$/.test(key) || !pid) { rejected.push({ key, reason: "bad_key" }); continue; }
    const norm = key.split("|");
    const canonical = [rankingsNormName(norm[0]), ...norm.slice(1).map(s => s.toUpperCase())].join("|");
    if (map[canonical] && map[canonical] !== pid) {
      // An alias that already points somewhere else is a corruption risk, not an update:
      // it would silently re-point a name that previous weeks were graded against.
      conflicts.push({ key: canonical, existing: map[canonical], proposed: pid });
      continue;
    }
    if (map[canonical] === pid) continue;
    map[canonical] = pid;
    added.push(canonical);
  }

  if (added.length) {
    const wrote = await fbPut(env, "/rankings/aliases", map, etag);
    if (!wrote) return json({ error: "alias map changed under us, retry" }, 409, cors);
    await rankingsLog(env, { action: "alias_add", detail: { count: added.length } });
  }
  return json({ ok: true, added: added.length, rejected, conflicts, total: Object.keys(map).length }, 200, cors);
}
