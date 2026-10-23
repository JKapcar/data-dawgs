#!/usr/bin/env node
/* Build data/nfl-playoff-leverage.json — this week's playoff leverage, simulated.
 *
 *   node tools/build-playoff-leverage.js                 # 100,000 seasons, writes data/
 *   node tools/build-playoff-leverage.js --sims 2000 --out /tmp/x.json   # tests
 *
 * Inputs, both already published by the site and both dated:
 *   /data/nfl-schedule.json  canonical 2026 schedule and verified finals (results)
 *   /data/survivor.json      home-win probability for every game (`p`, with `src`)
 * Engine: work/playoff-leverage-engine.js (rules, validation and limits are documented there).
 *
 * ⚠️ DETERMINISTIC BY DESIGN. The RNG seed is a hash of the exact simulation inputs, and
 * as_of/built come from the inputs, never from the clock. Same inputs → byte-identical file,
 * so the daily workflow commits nothing on a day nothing moved.
 * ⚠️ FAILS CLOSED. An unplayed game with no probability, a probability outside (0,1), a
 * division table that disagrees with the schedule's own `divisional` flag, or a duplicate
 * join is an error, not a skipped row. A wrong chart is worse than yesterday's chart.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('../work/playoff-leverage-engine.js');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const k = args.indexOf('--' + name);
  return k >= 0 ? args[k + 1] : fallback;
};
const SIMS = Number(opt('sims', 100000));
const OUT = path.resolve(opt('out', path.join(ROOT, 'data', 'nfl-playoff-leverage.json')));
const SCHEDULE = path.resolve(opt('schedule', path.join(ROOT, 'data', 'nfl-schedule.json')));
const PROBS = path.resolve(opt('probabilities', path.join(ROOT, 'data', 'survivor.json')));
if (!Number.isInteger(SIMS) || SIMS < 100) throw new Error('--sims must be an integer >= 100');

const ENGINE = 'playoff-leverage-engine v1';
const TIER_MEANING_LABS = 'Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.';
const r4 = x => Math.round(x * 1e4) / 1e4;
const etDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

const schedule = JSON.parse(fs.readFileSync(SCHEDULE, 'utf8'));
const probs = JSON.parse(fs.readFileSync(PROBS, 'utf8'));
const league = E.createLeague();
const season = schedule.data.season;
if (probs.data.meta.season !== season) throw new Error(`season mismatch: schedule ${season}, probabilities ${probs.data.meta.season}`);

const games = schedule.data.games.filter(g => g.season_type === 'REG');
if (games.length !== 272) throw new Error(`expected 272 regular-season games, got ${games.length}`);

/* The division table is a fact table; prove it against the schedule's own flag. */
for (const g of games) {
  const h = league.index.get(g.home_team), a = league.index.get(g.away_team);
  if (h === undefined || a === undefined) throw new Error(`${g.game_id}: unknown team`);
  if ((league.div[h] === league.div[a]) !== Boolean(g.divisional))
    throw new Error(`${g.game_id}: division table disagrees with the schedule's divisional flag`);
}

/* Probabilities are joined on (week, away, home): survivor ids spell the Rams LA, its
   team fields and the canonical schedule spell them LAR. */
const key = (wk, a, h) => `${wk}|${a}|${h}`;
const pRows = new Map();
for (const row of probs.data.games) {
  const k = key(row.wk, row.a, row.h);
  if (pRows.has(k)) throw new Error(`duplicate probability row ${k}`);
  pRows.set(k, row);
}

const simGames = games.map(g => {
  const h = league.index.get(g.home_team), a = league.index.get(g.away_team);
  if (g.status === 'final') {
    if (!Number.isInteger(g.home_score) || !Number.isInteger(g.away_score)) throw new Error(`${g.game_id}: final without scores`);
    const r = g.home_score > g.away_score ? 1 : g.home_score < g.away_score ? 0 : 0.5;
    return { g, h, a, final: true, r };
  }
  const row = pRows.get(key(g.week, g.away_team, g.home_team));
  if (!row) throw new Error(`${g.game_id}: unplayed game has no probability row`);
  if (!(row.p > 0 && row.p < 1)) throw new Error(`${g.game_id}: probability ${row.p} outside (0,1)`);
  return { g, h, a, final: false, p: row.p, src: row.src };
});

const unplayed = simGames.filter(x => !x.final);
const week = unplayed.length ? Math.min(...unplayed.map(x => x.g.week)) : null;
const leverageIdx = simGames
  .map((x, k) => ({ x, k }))
  .filter(({ x }) => !x.final && x.g.week === week)
  .sort((u, v) => u.x.g.kickoff_at.localeCompare(v.x.g.kickoff_at) || u.x.g.game_id.localeCompare(v.x.g.game_id))
  .map(({ k }) => k);

const seedHex = crypto.createHash('sha256').update(JSON.stringify({
  engine: ENGINE, season, sims: SIMS,
  games: simGames.map(x => [x.h, x.a, x.final ? 'F' : 'P', x.final ? x.r : x.p]),
  leverage: leverageIdx,
})).digest('hex').slice(0, 32);

const t0 = Date.now();
const sim = E.simulate({
  league, sims: SIMS, seedHex, leverage: leverageIdx,
  games: simGames.map(x => ({ h: x.h, a: x.a, final: x.final, r: x.r, p: x.p })),
});
const seconds = (Date.now() - t0) / 1000;

/* Observed standings, for the reader: W-L-T from verified finals only. */
const record = league.teams.map(() => ({ w: 0, l: 0, t: 0 }));
for (const x of simGames) if (x.final) {
  if (x.r === 1) { record[x.h].w++; record[x.a].l++; }
  else if (x.r === 0) { record[x.a].w++; record[x.h].l++; }
  else { record[x.h].t++; record[x.a].t++; }
}
const teams = sim.teams.map(t => ({
  team: t.code,
  name: E.NICKNAMES[t.code],
  conf: E.CONFERENCES[league.conf[t.i]],
  division: league.divNames[league.div[t.i]],
  ...record[t.i],
  playoffs: r4(t.playoffs),
  division_title: r4(t.division),
  bye: r4(t.bye),
  wins_mean: Math.round(t.winsMean * 100) / 100,
}));

const outGames = sim.leverage.map(lv => {
  const x = simGames[lv.game];
  const side = (i, isHome) => {
    const win = isHome ? lv.ifHomeWin[i] : lv.ifAwayWin[i];
    const loss = isHome ? lv.ifAwayWin[i] : lv.ifHomeWin[i];
    return {
      team: league.teams[i], side: isHome ? 'home' : 'away',
      p_win: r4(isHome ? x.p : 1 - x.p),
      now: r4(sim.teams[i].playoffs), if_win: r4(win), if_loss: r4(loss),
      swing: r4(win - loss), swing_se: r4(lv.diffSe[i]),
    };
  };
  const pair = [side(x.a, false), side(x.h, true)].sort((u, v) => v.swing - u.swing || u.team.localeCompare(v.team));
  return {
    game_id: x.g.game_id, kickoff_at: x.g.kickoff_at, neutral_site: Boolean(x.g.neutral_site),
    away: league.teams[x.a], home: league.teams[x.h], p_home: r4(x.p), p_source: x.src,
    leverage: r4(pair[0].swing + pair[1].swing),
    teams: pair,
    if_home_win: lv.ifHomeWin.map(r4),
    if_away_win: lv.ifAwayWin.map(r4),
  };
}).sort((u, v) => v.leverage - u.leverage || u.kickoff_at.localeCompare(v.kickoff_at));

/* Monte Carlo precision, reported rather than assumed: the largest paired standard error of
   any swing on the chart, and of any club's shift between the two results of any game. */
const swingSeMax = Math.max(0, ...outGames.flatMap(g => g.teams.map(t => t.swing_se)));
const shiftSeMax = Math.max(0, ...sim.leverage.flatMap(lv => lv.diffSe));
const weekGames = week === null ? [] : games.filter(g => g.week === week);
const playing = new Set(weekGames.flatMap(g => [g.home_team, g.away_team]));
const finals = games.filter(g => g.status === 'final').sort((u, v) => u.kickoff_at.localeCompare(v.kickoff_at) || u.game_id.localeCompare(v.game_id));
const last = finals[finals.length - 1] || null;

const meta = probs.data.meta || {};
const scheduleAsOf = etDate(schedule.provenance.captured_at);
const asOf = [scheduleAsOf, probs.as_of].sort().pop();
const N = SIMS.toLocaleString('en-US');

const env = {
  as_of: asOf,
  source: `Data Dawgs season simulation (${ENGINE}, work/playoff-leverage-engine.js) over /data/nfl-schedule.json ` +
    `results (snapshot ${schedule.integrity.snapshot_id.slice(0, 19)}…, captured ${schedule.provenance.captured_at}) and ` +
    `/data/survivor.json game probabilities (nfelo ${meta.nfelo_sha || 'unknown'}, captured ${meta.captured || probs.as_of}).`,
  tier: 'labs',
  graded: false,
  note: `SIMULATION OUTPUT, ungraded — not a forecast receipt and not a betting signal. Each of ${N} simulated seasons ` +
    'keeps every finished game\'s real result and plays every unplayed 2026 regular-season game once at its /data/survivor.json ' +
    'home-win probability (the published nfelo forecast for the current week, the nfelo season projection after it). ' +
    'Leverage is paired: every season is also played with one game\'s result flipped while every other game keeps its simulated ' +
    'result. Team strength is held fixed and games are independent, so probabilities near 0% and 100% are overconfident. ' +
    'Seeding follows the NFL tie-breaking procedures through strength of schedule; a tie that survives SOS goes to a coin toss ' +
    'because points are not simulated. Daily snapshot: rebuilt after the nfelo refresh, deterministic for identical inputs.',
  built: asOf,
  canonical_url: 'https://datadawgs216.com/data/nfl-playoff-leverage.json',
  tier_meaning: TIER_MEANING_LABS,
  method: {
    engine: ENGINE,
    simulation: `${N} seasons. Finals are real results (a tie counts half a win). Each unplayed game is one independent Bernoulli draw at p_home; no simulated ties.`,
    leverage: 'Paired common random numbers: for each game of the target week, every simulated season is replayed with that result flipped. if_win and if_loss are P(playoffs) across all seasons with the team forced to win or lose that game; swing = if_win - if_loss. now = P(playoffs) across the unforced seasons.',
    ordering: 'Games by the sum of both teams\' swings, largest first; within a game, the larger swing first.',
    tiebreakers: 'NFL division and wild-card procedures: head-to-head (wild-card multi-club: sweep only), division record, common games (wild card: minimum four), conference record, strength of victory, strength of schedule, then a per-season coin toss. Two clubs left by a multi-club step revert to two-club step 1; each division order is fixed before wild cards are drawn. Seeds 1-4 are division winners, 5-7 wild cards.',
    precision: `Monte Carlo, paired: swing_se is each swing's standard error (probability scale). Largest on this file: ${r4(swingSeMax)} for a swing, ` +
      `${r4(shiftSeMax)} for any club's shift between a game's two results. The page lists other clubs' shifts of 0.002 (0.2 points) or more.`,
    limits: [
      'Team strength is fixed within a season and games are independent: no rating updates, injuries or QB changes beyond what p_home already carries. This understates uncertainty, so values near 0 and 1 are overconfident.',
      'Tie-breaking steps after strength of schedule (points-based) are not modelled; those ties go to a coin toss.',
      'A game whose final has not reached /data/nfl-schedule.json is simulated as unplayed, even after kickoff.',
      'Ungraded. Nothing here has been scored against outcomes, and it is not a consensus of models.',
    ],
    validation: 'work/validate-playoff-history.mjs replays real seasons (nflverse/nfldata games.csv) through the same seeding code and requires every conference\'s actual playoff field, byes and wild-card pairings with hosts; it runs on every pull request that touches the engine.',
  },
  inputs: {
    schedule: {
      url: '/data/nfl-schedule.json', as_of: schedule.as_of, snapshot_id: schedule.integrity.snapshot_id,
      source_commit: schedule.provenance.source_commit, captured_at: schedule.provenance.captured_at,
      finals: finals.length, unplayed: unplayed.length,
    },
    probabilities: {
      url: '/data/survivor.json', as_of: probs.as_of, nfelo_sha: meta.nfelo_sha || null, captured: meta.captured || null,
      nfelo_observed_at: meta.market_observed_at || null, method: meta.probability_method || null,
      current_week: 'src "nfelo": published nfelo forecast', later_weeks: 'src "nfelo-season": ' +
        ((meta.season_projection && meta.season_projection.assumption) || 'nfelo season projection'),
    },
  },
  data: {
    season, week, sims: SIMS, seed: seedHex,
    precision: { swing_se_max: r4(swingSeMax), shift_se_max: r4(shiftSeMax) },
    week_games: { total: weekGames.length, final: weekGames.filter(g => g.status === 'final').length, remaining: leverageIdx.length },
    byes: week === null ? [] : league.teams.filter(t => !playing.has(t)),
    last_final: last && { game_id: last.game_id, kickoff_at: last.kickoff_at, away: last.away_team, home: last.home_team, away_score: last.away_score, home_score: last.home_score },
    team_order: league.teams,
    teams,
    games: outGames,
  },
};

fs.writeFileSync(OUT, JSON.stringify(env, null, 1) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT) || OUT}: week ${week}, ${leverageIdx.length} games, ${N} seasons in ${seconds.toFixed(1)}s, seed ${seedHex.slice(0, 8)}`);
