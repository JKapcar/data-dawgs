#!/usr/bin/env node
/*
 * tools/build-data.js — regenerates every file in /data/ from the site's own HTML.
 *
 * The pages are the source of truth; /data/ is a derived, dated mirror of them.
 * Run this whenever a number changes on a page, then run tools/validate-data.js.
 *
 *   node tools/build-data.js && node tools/validate-data.js
 *
 * No dependencies. Node 18+.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------------------------------------------------------------
 * 1. Pull the JS literals out of the flat HTML.
 *    Brace-matching walk that respects string literals, so a "}" inside
 *    a player note cannot terminate the blob early.
 * ------------------------------------------------------------- */
function grab(file, marker, opener) {
  const s = read(file);
  const i = s.indexOf(marker);
  if (i < 0) throw new Error('marker not found: ' + marker + ' in ' + file);
  const j = s.indexOf(opener, i);
  let depth = 0, inStr = false, q = '', esc = false, k = j;
  for (; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) { k++; break; } }
  }
  const raw = s.slice(j, k);
  try { return JSON.parse(raw); } catch (e) { return (0, eval)('(' + raw + ')'); }
}

const POOL      = grab('master.html',   'const POOL = [',       '[');
const RC        = grab('receipts.html', 'window.RC=',           '{');
const NF        = grab('nfelo.html',    'window.NF=',           '{');
const SV        = grab('survivor.html', 'window.SV=',           '{');
const TEAMS     = grab('auction.html',  'const DEFAULT_TEAMS=', '[');
const TEAM_META = grab('stats.html',    'const TEAM_META = {',  '{');
const STATS     = grab('stats.html',    'const DATA = {',       '{');

/* ---------------------------------------------------------------
 * 2. EPA aggregation — mirrors stats.html's aggregate() exactly.
 *    REG season, plays with a down, full win-probability range.
 * ------------------------------------------------------------- */
const b64 = s => {
  const bin = Buffer.from(s, 'base64');
  return new Uint8Array(bin.buffer, bin.byteOffset, bin.length);
};
const DATA = STATS;
const C = DATA.cols;
const S = b64(C.season), W = b64(C.week), POS = b64(C.pos), DEFT = b64(C.def),
      DOWN = b64(C.down), QTR = b64(C.qtr), WPA = b64(C.wp), FL = b64(C.flags);
const i16 = s => { const b = Buffer.from(s, 'base64'); return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const u16 = s => { const b = Buffer.from(s, 'base64'); return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const EPA = i16(C.epa), CPOE = i16(C.cpoe), NAMEI = u16(C.name);
const N = DATA.n, PBP_TEAMS = DATA.teams, NAMES = DATA.names, SEASONS = DATA.seasons;

function aggregateEpa(seasonIdx, minDb) {
  const nT = PBP_TEAMS.length;
  const mk = () => ({ n: 0, epa: 0, succ: 0, pn: 0, pepa: 0, rn: 0, repa: 0 });
  const off = Array.from({ length: nT }, mk);
  const def = Array.from({ length: nT }, mk);
  const qbs = new Map();
  for (let i = 0; i < N; i++) {
    if (!seasonIdx.has(S[i])) continue;
    if ((FL[i] >> 3) & 1) continue;            // REG only
    const d = DOWN[i]; if (d === 0) continue;  // exclude non-down plays, as page default does
    const isPass = FL[i] & 1, succ = (FL[i] >> 1) & 1, epa = EPA[i] / 100;
    const o = off[POS[i]]; o.n++; o.epa += epa; o.succ += succ;
    if (isPass) { o.pn++; o.pepa += epa; } else { o.rn++; o.repa += epa; }
    if (DEFT[i] !== 255) {
      const dd = def[DEFT[i]]; dd.n++; dd.epa += epa; dd.succ += succ;
      if (isPass) { dd.pn++; dd.pepa += epa; } else { dd.rn++; dd.repa += epa; }
    }
    const ni = NAMEI[i];
    if (ni > 0) {
      let q = qbs.get(ni);
      if (!q) { q = { n: 0, epa: 0, succ: 0, db: 0, dbEpa: 0, dbSucc: 0, cp: 0, cpn: 0, tm: new Map() }; qbs.set(ni, q); }
      q.n++; q.epa += epa; q.succ += succ;
      if (isPass) { q.db++; q.dbEpa += epa; q.dbSucc += succ; if ((FL[i] >> 2) & 1) { q.cp += CPOE[i] / 10; q.cpn++; } }
      q.tm.set(POS[i], (q.tm.get(POS[i]) || 0) + 1);
    }
  }
  const r3 = v => (Number.isFinite(v) ? +v.toFixed(4) : null);
  const teams = PBP_TEAMS.map((ab, i) => ({
    team: ab,
    name: (TEAM_META[ab] || {}).name || ab,
    plays: off[i].n,
    off_epa_play: r3(off[i].n ? off[i].epa / off[i].n : NaN),
    off_success: r3(off[i].n ? off[i].succ / off[i].n : NaN),
    off_dropback_epa: r3(off[i].pn ? off[i].pepa / off[i].pn : NaN),
    off_rush_epa: r3(off[i].rn ? off[i].repa / off[i].rn : NaN),
    def_epa_play: r3(def[i].n ? def[i].epa / def[i].n : NaN),
    def_success: r3(def[i].n ? def[i].succ / def[i].n : NaN),
    def_dropback_epa: r3(def[i].pn ? def[i].pepa / def[i].pn : NaN),
    def_rush_epa: r3(def[i].rn ? def[i].repa / def[i].rn : NaN),
  })).filter(t => t.plays > 0).sort((a, b) => b.off_epa_play - a.off_epa_play);

  const qbrows = [];
  for (const [ni, q] of qbs) {
    if (q.db < minDb) continue;
    let bestT = -1, bestC = 0;
    for (const [t, c] of q.tm) if (c > bestC) { bestC = c; bestT = t; }
    qbrows.push({
      player: NAMES[ni], team: PBP_TEAMS[bestT], dropbacks: q.db, plays: q.n,
      epa_per_dropback: r3(q.db ? q.dbEpa / q.db : NaN),
      epa_per_play: r3(q.n ? q.epa / q.n : NaN),
      dropback_success: r3(q.db ? q.dbSucc / q.db : NaN),
      cpoe: r3(q.cpn ? q.cp / q.cpn : NaN),
      total_epa: r3(q.epa),
    });
  }
  qbrows.sort((a, b) => b.epa_per_dropback - a.epa_per_dropback);
  return { teams, qbs: qbrows };
}


const EPA_AGG = { by_season: {}, pooled: null };
SEASONS.forEach((yr, i) => { EPA_AGG.by_season[yr] = aggregateEpa(new Set([i]), 200); });
EPA_AGG.pooled = aggregateEpa(new Set(SEASONS.map((_, i) => i)), 500);

/* ---------------------------------------------------------------
 * 3. Envelopes. as_of and source are mandatory — write() refuses without them.
 * ------------------------------------------------------------- */
fs.mkdirSync(OUT, { recursive: true });
const BUILT = process.env.DD_BUILD_DATE || new Date().toISOString().slice(0, 10);

/* ⚠️ BUILT is when this script RAN. It is not an as_of.
   league.json and bozo-rules.json describe configuration captured from the pages on a
   specific day; if they took their as_of from BUILT, re-running the build tomorrow would
   silently advance their date with no data change — false freshness, the exact failure
   this whole layer exists to prevent. Bump CONFIG_AS_OF by hand when the config actually
   changes. */
const CONFIG_AS_OF = '2026-08-06';
const files = {};

/* ---------------------------------------------------------------
 * Tier, read from the pages themselves.
 *
 * A human sees a chip; an agent saw nothing, so a Labs experiment and a
 * validated tool were indistinguishable to anything consuming /data/.
 * Derived by scanning for the live chip rather than hardcoded, so the
 * machine-readable tier CANNOT drift from what the site displays.
 * ------------------------------------------------------------- */
const TIERS = { labs: 'labs', dawg: 'dawg', pound: 'pound' };
function tierOf(page) {
  if (!page) return TIERS.labs;
  let html;
  try { html = read(page); } catch (e) { return TIERS.labs; }
  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  if (!chip) return TIERS.labs;                       // no chip = implicitly Labs
  const label = chip[1].trim().toLowerCase();
  if (label.startsWith('dawg')) return TIERS.dawg;
  if (label.includes('pound')) return TIERS.pound;
  return TIERS.labs;
}
const TIER_MEANING = {
  labs: 'Labs — useful and live, still being challenged. Open questions may remain about calibration, assumptions, data quality or edge. Use with your eyes open.',
  dawg: 'Working Dawg — earned its collar. Evidence survived validation: receipts against a benchmark chosen in advance for forecasters, named sources and reproducible maths for measurement tools.',
  pound: 'The Pound — shelved, with the reason attached.',
};

function write(name, env) {
  if (!env.as_of) throw new Error('missing as_of: ' + name);
  if (!env.source) throw new Error('missing source: ' + name);
  if (!env.tier) throw new Error('missing tier: ' + name);
  if (typeof env.graded !== 'boolean') throw new Error('missing graded: ' + name);
  const body = { ...env, tier_meaning: TIER_MEANING[env.tier], built: BUILT, canonical_url: 'https://datadawgs216.com/data/' + name };
  const txt = JSON.stringify(body, null, 1);
  fs.writeFileSync(path.join(OUT, name), txt);
  files[name] = {
    bytes: Buffer.byteLength(txt),
    as_of: env.as_of,
    sha256: crypto.createHash('sha256').update(txt).digest('hex'),
    note: env.note,
  };
}

/* ---------- pool.json ---------- */

write('pool.json', {
  source_page: '/master.html',
  tier: tierOf('master.html'),
  graded: false,
  as_of: '2026-07-29',
  source: 'Market Value (MV) auction-dollar snapshot, captured 2026-07-29 and republished unchanged since.',
  note:
    'MV is a market-consensus auction-dollar value, NOT a points projection. ' +
    'STALENESS WARNING: this snapshot is ' +
    Math.round((Date.parse(BUILT) - Date.parse('2026-07-29')) / 86400000) +
    ' days old as of the build date and the underlying market moves through August. ' +
    'Do not quote these dollars as current without saying the date out loud.',
  scoring_keys: {
    full: 'Full PPR auction dollars',
    half: 'Half PPR auction dollars (league default)',
    sf: 'Superflex auction dollars',
  },
  field_notes: {
    rank: 'overall rank within this snapshot',
    silva: 'source-analyst positional rank string, kept under its original field name',
    tags: 'site editorial tags: buy | fade | zrb (zero-RB)',
    note: 'one-line editorial comment; opinion, not data',
  },
  count: POOL.length,
  data: POOL,
});

/* ---------- receipts.json ---------- */

write('receipts.json', {
  source_page: '/receipts.html',
  tier: tierOf('receipts.html'),
  graded: false,
  as_of: RC.meta.locked,
  source:
    'Pre-registered 2026 forecasts derived from nfelo ' + RC.meta.model +
    ' at commit ' + RC.meta.nfelo + ', locked ' + RC.meta.locked + '.',
  note:
    'These are PRE-REGISTERED calls: written down before the season and locked with a SHA-256 hash. ' +
    'n=' + RC.meta.n + ' games, ' + RC.meta.withBenchmark + ' of them carrying a devigged closing-line benchmark. ' +
    'None are graded yet — the 2026 season has not started. Anything claiming a hit rate for these is wrong.',
  integrity: {
    sha256: RC.meta.sha256,
    canonical_string_spec:
      'Take `data` in the order stored (the locked order — do NOT re-sort). For each row emit ' +
      '`${id}|${p.toFixed(4)}|${mk == null ? "" : mk.toFixed(4)}` and join the rows with "\\n" (LF, no ' +
      'trailing newline). SHA-256 the UTF-8 bytes, hex lowercase. Recompute it yourself — do not take our word for it.',
    canonical_example_first_row: '2026_01_ARI_LAC|0.8060|0.8271',
    canonical_string_bytes: 6697,
    canonical_rows: 272,
    verify_note:
      'The point of publishing the spec is that you do not have to trust this site. ' +
      'If your recomputation disagrees with the stored hash, the ledger changed after it was locked.',
  },
  power: RC.power,
  meta: RC.meta,
  data: RC.preds,
});

/* ---------- nfelo.json ---------- */

write('nfelo.json', {
  source_page: '/nfelo.html',
  tier: tierOf('nfelo.html'),
  graded: false,
  as_of: NF.meta.captured,
  source: 'nfelo ' + NF.meta.model_version + ' (' + NF.meta.repo + ') at commit ' + NF.meta.sha + '.',
  note:
    'Backtest figures span ' + NF.headline.seasons[0] + '-' + NF.headline.seasons[1] + ' and OVERLAP the model\'s own ' +
    'optimisation window, so they are in-sample-ish and should not be read as out-of-sample skill. ' +
    'nfelo straight-up ' + NF.headline.nfelo_su.toFixed(4) + ' vs market ' + NF.headline.mkt_su.toFixed(4) + ' over n=' +
    NF.headline.n + ' is a difference well inside noise (SE ' + NF.headline.se_pp.toFixed(2) + ' pp).',
  data: NF,
});

/* ---------- models.json ---------- */

write('models.json', {
  source_page: '/survivor.html',
  tier: tierOf('survivor.html'),
  graded: false,
  as_of: SV.meta.captured,
  source: 'Fitted on nfelo ratings + nflverse schedule; parameters as used live on survivor.html and receipts.html.',
  note:
    'These are the exact parameters the site uses. Return them alongside any number you derive from them. ' +
    'The margin model is a linear Elo-to-points map with a normal residual — it is deliberately simple and its ' +
    'residual SD (13.18) is larger than most people intuit, which is the whole point.',
  data: {
    margin_model: {
      elo_per_point: SV.meta.elo_per_pt,
      home_field_advantage_points: SV.meta.hfa,
      residual_sd_points: SV.meta.sd,
      spread_formula: 'expected_margin_home = (elo_home - elo_away) / elo_per_point + hfa',
      win_prob_formula: 'P(home win) = 1 - Phi(0.5 - expected_margin / residual_sd)  [normal CDF]',
      backtest: {
        model_straight_up: SV.meta.model_su,
        blend_straight_up: SV.meta.blend_su,
        market_straight_up: SV.meta.market_su,
        caveat: 'Backtest, not out-of-sample. The market column is the benchmark that matters.',
      },
    },
    bozo_index: {
      description:
        'Standard-deviation table used to measure how far a side finished under its number ' +
        '("Worst Beat"). Not a betting model — a scoring device for the Bozo game.',
      sd_by_sport: {
        NFL: { margin: 13.5, total: 10.5 },
        CFB: { margin: 16, total: 14 },
        NBA: { margin: 11.5, total: 17 },
        CBB: { margin: 10.5, total: 13 },
        MLB: { margin: 4.4, total: 4.2 },
        NHL: { margin: 2.3, total: 2.1 },
      },
      prop_sd_caveat: 'Props use a placeholder SD of line x 0.55. That is openly a guess. Flag it before leaning on it.',
    },
    survivor_engine: {
      defaults: {
        entries: 200, lives: 1, buybacks: false, buyback_through: 4, buyback_rate: 0.35,
        double_pick_from: 0, reuse_teams: false, start_week: 1, tiebreak: 'split',
        blend_market_weight: 0.75, field_chalk_exponent: 2.4, sims: 3000,
      },
      known_limitation:
        'Double-pick weeks are recorded but NOT simulated. Every survival number after a double-pick week ' +
        'is too optimistic. Open backlog item.',
      ownership_note:
        'Pool ownership is MODELLED (chalk exponent over market win probability), not observed. ' +
        'No real pick data exists yet.',
    },
    nfelo_reference: { version: NF.meta.model_version, commit: NF.meta.sha, repo: NF.meta.repo },
  },
});

/* ---------- survivor.json ---------- */
write('survivor.json', {
  source_page: '/survivor.html',
  tier: tierOf('survivor.html'),
  graded: false,
  as_of: SV.meta.captured,
  source: 'nfelo ' + SV.meta.nfelo_sha + ' ratings + ' + SV.meta.sched_src + ' 2026 schedule.',
  note:
    'Full 2026 schedule with per-game win probabilities. `src` says where each probability came from: ' +
    '"market" = derived from a real line, "model" = Elo-only. Ownership is modelled, not observed.',
  field_notes: {
    mm: 'model expected margin, home perspective (points)',
    mk: 'market-implied home win probability, devigged (null when no line)',
    p: 'blended home win probability actually used',
    src: 'market | model',
  },
  data: { meta: SV.meta, elo: SV.elo, teams: SV.teams, games: SV.games },
});

/* ---------- epa-teams.json ---------- */

write('epa-teams.json', {
  source_page: '/stats.html',
  tier: tierOf('stats.html'),
  graded: false,
  as_of: '2026-07-29',
  source: 'nflverse play-by-play, 2023-2025. Captured 2026-07-29; covers through the completed 2025 season.',
  note:
    'Regular season only, plays with a down (excludes kickoffs/XPs/etc). Per-season tables use a 200-dropback ' +
    'minimum for QBs; the pooled table uses 500. These are descriptive aggregates, not projections — ' +
    'team EPA is famously unstable year to year, so do not read 2025 as 2026.',
  field_notes: {
    off_epa_play: 'offensive EPA per play (higher is better)',
    def_epa_play: 'EPA per play allowed (LOWER is better — sign is not flipped)',
    cpoe: 'completion percentage over expected, percentage points',
  },
  data: EPA_AGG,
});

/* ---------- league.json ---------- */

write('league.json', {
  source_page: '/dashboard.html',
  tier: tierOf('dashboard.html'),
  graded: false,
  as_of: CONFIG_AS_OF,
  source: 'Live league configuration as it ships in auction.html.',
  note: 'Public configuration only. No rosters, no tokens, nothing league-private lives in this repo.',
  data: {
    format: 'offline auction, 14 teams',
    budget: 200,
    roster_spots: 15,
    starting_lineup: 'QB, 2 RB, 2 WR, TE, 2 FLEX (W/R/T), DEF, rest bench. No kicker.',
    scoring_default: 'half PPR',
    scoring_supported: ['half', 'full', 'sf'],
    bid_rule: '$0 bids are legal, so a team\'s max bid equals its dollars remaining.',
    teams: TEAMS.map(([name, owner]) => ({ name, owner })),
    live_draft_state: {
      note:
        'The live auction mirrors to a public Firebase RTDB. Room "pepperoninipples" currently holds ' +
        'SIMULATED picks for league testing — do not treat it as a real draft.',
      rtdb: 'https://data-dawgs-draft-default-rtdb.firebaseio.com',
      default_room: 'pepperoninipples',
    },
  },
});

/* ---------- bozo-rules.json ---------- */
write('bozo-rules.json', {
  source_page: '/bozo.html',
  tier: tierOf('bozo.html'),
  graded: false,
  as_of: CONFIG_AS_OF,
  source: 'bozo.html ruleset and the Worker-enforced write path, as deployed.',
  note:
    'The board is fully open by design — every leg, price and timestamp is visible to everyone and to ' +
    'everyone\'s bots before they place. That was a decision, not an oversight.',
  data: {
    game:
      'Each member submits ONE leg. Every leg goes on ONE real parlay, funded by last week\'s bozo. ' +
      'Whoever busts it worst wears it and funds the next ticket.',
    rules: [
      'Favorites only, inside the league price band.',
      'No exact duplicate legs.',
      'The ticket locks the moment the last leg lands; that moment is the close.',
      'Editing a leg resets both your timestamp AND your price.',
      'Only legs that LOST are eligible to be the bozo. Nobody who cashed can wear it.',
    ],
    price_band: { ceiling: -100, floor: -500, unit: 'American odds', enforced_by: 'Worker, not the page' },
    tiebreak: {
      mechanism:
        'Each week the tiebreaker hierarchy is a FRESH RANDOM PERMUTATION of the league\'s live levers, ' +
        'drawn on the server and written once. Walk the drawn order; the first lever that isolates one ' +
        'person names the bozo; ties fall to the next lever down.',
      design_rationale:
        'The randomisation is the design, not decoration: it keeps each lever legible while making the meta ' +
        'unsolvable. A weighted composite was considered and rejected — any blend is just a new deterministic ' +
        'objective someone will solve.',
      levers: [
        { key: 'odds', name: 'Shortest Odds', desc: 'biggest favorite in the pool' },
        { key: 'beat', name: 'Worst Beat', desc: 'finished furthest under its number, in standard deviations' },
        { key: 'last', name: 'Last In', desc: 'final leg submitted' },
        { key: 'clv', name: 'Worst CLV', desc: 'price moved most against it' },
      ],
    },
    trust_model: {
      writes: 'Every write goes through the Worker, which stamps server time, maps token to player, and validates.',
      identity: 'One-time join tokens. No accounts.',
      what_is_not_verified:
        'EVERY PRICE ON THIS BOARD IS SELF-REPORTED. Nothing checks it against a book. Report what was entered, ' +
        'flag what looks off market, never vouch for a number and never accuse anyone.',
    },
    known_soft_spots: [
      'Bozo odds and leg-win numbers are SIMULATION output, not observation. Say so when quoting them.',
      'The simulation draws every leg independently. Two legs on the same game are not independent.',
      'Worst CLV is UNMEASURED — no closing prices are captured yet. Never state anyone\'s CLV.',
      'A spread or total priced past about -145 is off market. A moneyline has no internal cross-check at all.',
    ],
  },
});

/* ---------- The Pound: upstream provenance, contracts and tool inventory ----------
 * These three files are deliberately generated here rather than hand-edited in /data/.
 * The public JSON is part of the same honesty contract as every older surface: a tool
 * can be useful before every delivery layer exists, but its status may not pretend the
 * missing layers are live.
 */
const UPSTREAM_MODELS = [
  { id: '538-classic', creator: 'FiveThirtyEight', repository: 'fivethirtyeight/nfl-elo-game',
    upstream_commit: 'fbec1afa38ece5befe24fb21be8ddba8eb160fe6', version: null,
    captured_at: '2026-08-07', license: 'MIT', license_status: 'verified-license-file',
    integration_mode: 'reimplementation', data_status: 'historical reference available',
    notes: 'Permanent simple benchmark. Data Dawgs may preserve the published mathematics with attribution; current 2026 team-state production is not built yet.' },
  { id: 'nfelodcm', creator: 'Robert Greer', repository: 'greerreNFL/nfelodcm',
    upstream_commit: 'aa6660855758e2e508c37fe38c9066f06c583ac9', version: '0.2.21',
    captured_at: '2026-08-07', license: 'MIT', license_status: 'verified-package-metadata',
    integration_mode: 'pending', data_status: 'not installed in the static-site workflow',
    notes: 'Lawful candidate for the shared NFL data loader. A scheduled build and snapshot retention policy are still required.' },
  { id: 'nfeloml', creator: 'Robert Greer', repository: 'greerreNFL/nfeloml',
    upstream_commit: 'b96bbc78abfbd4253230bb388c531728b042aa93', version: '0.1.11',
    captured_at: '2026-08-07', license: 'MIT', license_status: 'verified-package-metadata',
    integration_mode: 'pending', data_status: 'not installed in the static-site workflow',
    notes: 'Lawful inference primitive for EP, EPA and WP. Independent calibration has not been run by Data Dawgs.' },
  { id: 'nfelo', creator: 'Robert Greer', repository: 'greerreNFL/nfelo',
    upstream_commit: '0d3f8418f1f9fc4755ff42acb2d5f56c27c137ca', version: '4.3.0',
    captured_at: '2026-08-07', license: null, license_status: 'unverified-no-license-file',
    integration_mode: 'output', data_status: 'dated public output mirrored',
    notes: 'Do not copy code. Data Dawgs consumes public output and publishes its own validation; the existing backtest overlaps the model optimization window.' },
  { id: 'nfeloqb', creator: 'Robert Greer', repository: 'greerreNFL/nfeloqb',
    upstream_commit: 'd1958ddff4607bf28e495ac03489e41f81e38a1d', version: null,
    captured_at: '2026-08-07', license: null, license_status: 'unverified-no-license-file',
    integration_mode: 'pending', data_status: 'public output exists; canonical adapter not built',
    notes: 'No code reuse. QB context remains optional until an output adapter and independent out-of-sample test exist.' },
  { id: 'nfelosrs', creator: 'Robert Greer', repository: 'greerreNFL/nfelosrs',
    upstream_commit: '527b28fb75f9b1c457d3983e91e9b6ea4188acee', version: null,
    captured_at: '2026-08-07', license: null, license_status: 'unverified-no-license-file',
    integration_mode: 'pending', data_status: 'no canonical Data Dawgs output',
    notes: 'Methodology may be independently implemented; upstream code may not be copied without permission.' },
  { id: 'nfelohfa', creator: 'Robert Greer', repository: 'greerreNFL/nfelohfa',
    upstream_commit: 'fe4e41899b94e465d583e4c919ff39840dc64aa6', version: null,
    captured_at: '2026-08-07', license: null, license_status: 'unverified-no-license-file',
    integration_mode: 'pending', data_status: 'no canonical Data Dawgs output',
    notes: 'The Pound includes an independent transparent HFA calculator, not copied upstream code.' },
  { id: 'nfelounits', creator: 'Robert Greer', repository: 'greerreNFL/nfelounits',
    upstream_commit: '626415483728ec3ee3c9d8af21a373ed9a498d8b', version: null,
    captured_at: '2026-08-07', license: null, license_status: 'research-and-educational-language-only',
    integration_mode: 'pending', data_status: 'public repository; Data Dawgs output not built',
    notes: 'Not an OSI software license. Performance figures are upstream claims until independently replicated on fixed samples.' },
  { id: 'nfelomarket-data', creator: 'Robert Greer', repository: 'greerreNFL/nfelomarket_data',
    upstream_commit: 'd78bca3c4b6ef4a3ddc52ab07534a47a9292647c', version: null,
    captured_at: '2026-08-07', license: null, license_status: 'unverified-no-license-file',
    integration_mode: 'pending', data_status: 'no licensed live feed configured',
    notes: 'The independent odds/vig contract is live in the browser; a lawful timestamped market feed is still missing.' },
  { id: 'nfelotranslation', creator: 'Robert Greer', repository: 'greerreNFL/nfelotranslation',
    upstream_commit: '5cf05b54063e10085146e358e91b90193f1ef8c5', version: '0.2.2',
    captured_at: '2026-08-07', license: null, license_status: 'unverified-no-license-declaration',
    integration_mode: 'reimplementation', data_status: 'independent normal-model approximation available',
    notes: 'The Pound implementation uses Data Dawgs published normal-margin parameters and does not copy upstream package code or fitted key-number distributions.' },
  { id: 'wepa', creator: 'Robert Greer', repository: 'greerreNFL/wepa',
    upstream_commit: 'e11013e5ae8e7c94117006a8b7ef501dd51c299a', version: 'v3',
    captured_at: '2026-08-07', license: null, license_status: 'unverified-no-license-file',
    integration_mode: 'pending', data_status: 'no canonical Data Dawgs output',
    notes: 'A lawful original implementation needs a declared specification and out-of-sample comparison with ordinary EPA.' },
  { id: 'nfl-cover-probability', creator: 'Robert Greer', repository: 'greerreNFL/nfl_cover_probability',
    upstream_commit: '97c8542480a96666109c422682c72e3b7dd6ca4d', version: null,
    captured_at: '2026-08-07', license: null, license_status: 'unverified-no-license-file',
    integration_mode: 'reimplementation', data_status: 'independent pregame normal-model calculator available',
    notes: 'The upstream repository describes a live-game ML model. The Pound does not copy it and clearly labels its simpler pregame approximation.' },
];

const MODEL_CONTRACTS = {
  contract_version: '1.0.0-stage',
  canonical_game_id: 'season_week_away_home using canonical current team abbreviations, for example 2026_01_PIT_CLE',
  model_id_rule: 'lowercase stable slug; model version changes do not change model_id',
  forecast_status_values: ['backtest', 'prospective'],
  forecast_required: ['forecast_id', 'game_id', 'season', 'week', 'kickoff_at', 'captured_at',
    'model_id', 'model_name', 'model_version', 'source_repo', 'source_commit', 'source_capture_at',
    'home_team', 'away_team', 'home_win_probability', 'expected_margin_home', 'model_spread_home',
    'home_cover_probability', 'push_probability', 'input_snapshot_id', 'forecast_status',
    'methodology_url', 'license_status'],
  null_policy: 'Unsupported values are null. A missing model output is never imputed merely to complete a row.',
  probability_rule: 'Every non-null probability is a finite number in [0,1].',
  receipt_policy: {
    prospective: 'Append-only after publication. Record the exact input snapshot and contemporaneous market state before kickoff.',
    results: 'Store outcomes separately and join by forecast_id; never mutate the forecast receipt.',
    backtests: 'Always labelled backtest and never mixed silently with prospective leaderboards.',
  },
  comparable_sample_rule: 'Leaderboard comparisons disclose each sample and prefer identical game sets. No ranking across silently different samples.',
  calculator_contracts: {
    odds_converter: { inputs: ['american_odds'], outputs: ['decimal_odds', 'implied_probability'] },
    parlay: { inputs: ['american_odds[]'], outputs: ['decimal_odds', 'american_odds', 'implied_probability'] },
    hold_vig: { inputs: ['side_a_american', 'side_b_american'], outputs: ['raw_implied[]', 'hold', 'devig_probability[]'] },
    bet_ev: { inputs: ['win_probability', 'american_odds'], outputs: ['break_even_probability', 'expected_profit_per_unit', 'roi'] },
    hedge: { inputs: ['original_stake', 'original_american', 'hedge_american'], outputs: ['hedge_stake', 'locked_profit'] },
    passer_rating: { inputs: ['attempts', 'completions', 'yards', 'touchdowns', 'interceptions'], outputs: ['nfl_passer_rating'] },
    elo_game: { inputs: ['home_elo', 'away_elo', 'home_field_elo'], outputs: ['home_win_probability', 'away_win_probability'] },
    normal_translation: { inputs: ['home_win_probability', 'residual_sd_points', 'optional_home_line_sportsbook_convention'],
      outputs: ['expected_margin_home', 'model_spread_home', 'home_cover_probability', 'push_probability'],
      formula: 'expected_margin_home = 0.5 + residual_sd_points * inverse_standard_normal(home_win_probability)', modelled: true,
      assumptions: ['published 0.5-point win threshold', 'home favorite lines are negative', 'continuous cover approximation', 'zero push probability', 'no NFL key-number mass'] },
    forecast_grade: { inputs: ['forecast_probability', 'outcome_0_or_1'], outputs: ['brier', 'log_loss'] },
    belief_summary: { inputs: ['probabilities[]'], outputs: ['count', 'mean', 'median', 'min', 'max', 'range', 'standard_deviation', 'crosses_50'],
      note: 'Equal-weight descriptive statistics only; this is not a validated consensus blend.' },
  },
};

const POUND_MINIMUM_PATHS = {
  'model-scoreboard': 'Normalize and publish at least one lawfully integrated independent model feed, then join it by canonical game_id.',
  disagreement: 'Accumulate prospective receipts for at least two independent models and test a preregistered relationship between dispersion and forecast error.',
  '538-classic': 'Build canonical historical/current inputs, reproduce official historical probabilities within tolerance, publish current forecasts, and lock prospective receipts.',
  nfeloml: 'Run the MIT package in a scheduled precompute job with schema checks and publish static output, or build and validate a Worker-compatible inference port.',
  nfeloqb: 'Obtain a reusable license, permission, or lawful dated output; then build the starter mapping, adapter, and prospective validation.',
  wepa: 'Obtain a reusable methodology or licensed output, implement the weighting against canonical play data, and test it against ordinary EPA out of sample.',
  srs: 'Secure a lawful win-total feed and reusable methodology, then publish versioned preseason and weekly ratings from canonical schedules.',
  hfa: 'Build a canonical historical-game input, estimate HFA by declared period/context, and publish a dated series with uncertainty.',
  units: 'Obtain a reusable license, permission, or lawful output; normalize unit ratings to canonical teams and replicate performance claims independently.',
  translation: 'Add a versioned discrete NFL margin distribution with key-number and push mass, then validate cover probabilities prospectively.',
  market: 'Secure a lawful market feed and retain source, observation time, price, close status, and declared devig method in canonical snapshots.',
  'cover-ev': 'Pair a timestamped line feed with a prospectively graded margin distribution and publish cover calibration before making edge claims.',
  odds: 'Expose the tested conversion through a read-only Worker tool using the published calculator contract.',
  parlay: 'Keep price multiplication as the base mode; add joint-probability output only after a declared, tested correlation input or model exists.',
  hedge: 'Expose the tested equal-net-outcome calculation through a read-only Worker tool using the published calculator contract.',
  passer: 'Expose the tested passer-rating calculation through a read-only Worker tool using the published calculator contract.',
  grader: 'Join immutable forecast receipts to separate outcomes, aggregate only comparable samples, and publish calibration and sample counts.',
  receipts: 'Emit normalized forecasts from multiple models before kickoff, retain exact input snapshots, and store later results separately by forecast_id.',
  regimes: 'Accumulate adequate prospective samples, preregister slices and minimum counts, and mark post-hoc analysis exploratory.',
  ensembles: 'Accumulate prospective model errors, then benchmark mean, median and candidate weighting methods against the market and best individual model.',
  'nfl-data': 'Add a scheduled nfelodcm-backed job with schema, freshness and row-count gates plus retained canonical snapshots.',
};

const calculatorIds = new Set(['disagreement', '538-classic', 'hfa', 'translation', 'market', 'cover-ev', 'odds', 'parlay', 'hedge', 'passer', 'grader', 'ensembles']);

const POUND_TOOLS = [
  ['model-scoreboard', 'Model Scoreboard / Mean & Conflict', 'Compare dated model and market beliefs game by game.', 'frontend-only',
    'Uses the dated nfelo and market snapshots already published by Data Dawgs.', 'Interactive game table with metric/source states.',
    'Explain the equal-weight mean, range, dissent and missing models without claiming a validated consensus blend.', 'dd_analyze_matchup covers the current two-source matchup view.',
    '/data/nfelo.json + /data/survivor.json', 'More independently licensed model feeds are needed for a true multi-model board.'],
  ['disagreement', 'Transparent Disagreement Engine', 'Show mean, median, range, standard deviation and decision-boundary splits.', 'frontend-only',
    'Any list of probabilities, plus the current scoreboard.', 'Belief-summary lab and per-game descriptive statistics.',
    'Descriptive uncertainty only; never call disagreement a predictive edge.', 'No dedicated endpoint.',
    '/data/model-contracts.json', 'Validation against future forecast error needs prospective multi-model receipts.'],
  ['538-classic', '538 Classic Elo', 'Provide a permanent simple benchmark/control.', 'frontend-only',
    'User-supplied Elo ratings; MIT mathematics HFA=65.', 'One-game probability calculator.',
    'Describe this as a calculator until canonical 2026 state and receipts ship.', 'No MCP tool.',
    '/data/upstream-models.json', 'Historical reproduction and current team-state pipeline are not staged in this slice.'],
  ['nfelo', 'nfelo Power Ratings', 'Use a dated public model output with Data Dawgs validation.', 'complete',
    '2026-08-06 nfelo snapshot and existing historical backtest.', 'Existing nfelo page plus Pound scoreboard.',
    'State that the backtest overlaps optimization and has not established out-of-sample skill.', 'dd_analyze_matchup',
    '/data/nfelo.json + /data/models.json', null],
  ['nfeloml', 'nfeloml EP / EPA / WP', 'Offer deterministic play-level inference primitives.', 'backend-blocked',
    'MIT package and canonical play inputs.', 'Contract and provenance only.',
    'Do not present upstream calibration as Data Dawgs-verified.', 'No runtime is integrated.',
    '/data/upstream-models.json', 'Static GitHub Pages cannot run the Python/XGBoost package; a precompute job or Worker-compatible port is required.'],
  ['nfeloqb', 'QB Context', 'Measure starter/replacement and passing-context deltas.', 'data-blocked',
    'Lawful dated output plus starter mapping.', 'Inventory card; no invented QB adjustment.',
    'Context is optional and unvalidated for DFS or game forecasting.', 'No MCP tool.',
    '/data/upstream-models.json', 'No verified reusable license and no canonical Data Dawgs adapter.'],
  ['wepa', 'Weighted EPA', 'Compare context-weighted EPA with ordinary EPA.', 'data-blocked',
    'Lawful methodology or output plus canonical play data.', 'Inventory card and explicit ordinary-EPA baseline.',
    'Any improvement claim waits on fixed out-of-sample tests.', 'No MCP tool.',
    '/data/upstream-models.json', 'No verified reusable license and no Data Dawgs implementation.'],
  ['srs', 'SRS / Win-Total Ratings', 'Estimate team strength, priors and schedule difficulty.', 'data-blocked',
    'Timestamped lawful win-total market inputs and schedule.', 'Inventory card.',
    'Market inputs must carry source, time and vig handling.', 'No MCP tool.',
    '/data/upstream-models.json', 'No verified reusable license or licensed market feed.'],
  ['hfa', 'Home-Field Adjustment Tracker', 'Inspect the effect of a transparent HFA assumption.', 'frontend-only',
    'User-supplied ratings and HFA; site defaults are dated.', 'Interactive Elo/margin calculator.',
    'Labels inputs modelled and does not claim the default is current truth.', 'No MCP tool.',
    '/data/models.json', 'Historical HFA tracking feed is not built.'],
  ['units', 'Unit Ratings', 'Separate pass, rush and special-teams strengths.', 'data-blocked',
    'Lawful unit outputs and canonical play data.', 'Inventory card.',
    'Upstream performance numbers remain upstream claims.', 'No MCP tool.',
    '/data/upstream-models.json', 'Research/educational language is not a reusable software license.'],
  ['translation', 'Probability / Spread Translation', 'Translate win probability into expected margin and cover estimates.', 'frontend-only',
    'User probability and dated Data Dawgs normal residual SD.', 'Interactive calculator.',
    'Calls the result MODELLED and names the normal, independent, no-key-number assumption.', 'No MCP tool.',
    '/data/models.json + /data/model-contracts.json', 'Discrete key-number distribution and push model are not implemented.'],
  ['market', 'Market Normalizer', 'Normalize American odds, implied probability, hold and devig probabilities.', 'frontend-only',
    'User-entered prices.', 'Odds and hold/vig calculators.',
    'No sportsbook feed, closing-line claim or vendor attribution.', 'No MCP tool.',
    '/data/model-contracts.json', 'A timestamped licensed market feed is missing.'],
  ['cover-ev', 'Cover Probability / EV', 'Turn a declared probability and price into break-even and expected value.', 'frontend-only',
    'User probability and price, or the modelled normal translator.', 'Interactive calculator.',
    'Distinguishes the user/model probability from the price-implied probability.', 'No MCP tool.',
    '/data/model-contracts.json', 'No live line feed and no independently graded cover model.'],
  ['odds', 'Odds Converter', 'Convert American odds to decimal odds and implied probability.', 'frontend-only',
    'User-entered odds.', 'Interactive calculator.', 'Deterministic conversion; no predictive claim.', 'No MCP tool.',
    '/data/model-contracts.json', 'No dedicated calculator MCP endpoint is deployed.'],
  ['parlay', 'Parlay Calculator', 'Compound declared leg prices.', 'frontend-only',
    'User-entered American odds.', 'Interactive calculator.', 'Assumes price multiplication; does not claim leg independence.', 'No MCP tool.',
    '/data/model-contracts.json', 'No dedicated calculator MCP endpoint is deployed; correlation-aware joint probability remains undefined.'],
  ['hedge', 'Hedge Calculator', 'Size the opposite side for equal net outcome.', 'frontend-only',
    'Original stake/price and hedge price.', 'Interactive calculator.', 'Arithmetic, not advice; ignores limits, tax and execution risk.', 'No MCP tool.',
    '/data/model-contracts.json', 'No dedicated calculator MCP endpoint is deployed.'],
  ['passer', 'NFL Passer Rating', 'Reproduce the public deterministic NFL passer-rating formula.', 'frontend-only',
    'Attempts, completions, yards, touchdowns and interceptions.', 'Interactive calculator.', 'Descriptive statistic, not a forecast or QBR substitute.', 'No MCP tool.',
    '/data/model-contracts.json', 'No dedicated calculator MCP endpoint is deployed.'],
  ['grader', 'Forecast Grader', 'Compute Brier score and log loss for one declared forecast.', 'frontend-only',
    'Probability and binary outcome.', 'Interactive calculator.', 'One observation is not model validation; sample size stays visible.', 'No MCP tool.',
    '/data/model-contracts.json', 'Leaderboard aggregation waits on immutable comparable receipts.'],
  ['receipts', 'Immutable Multi-Model Receipts', 'Make prospective forecasts auditable after outcomes are known.', 'data-blocked',
    'Normalized forecasts, input snapshots and market state before kickoff.', 'Contract and link to the existing 2026 receipt ledger.',
    'Never mix backtests and prospective forecasts.', 'No dedicated MCP receipt tool.',
    '/data/receipts.json + /data/model-contracts.json', 'Only the current nfelo-derived ledger exists; multi-model append-only storage is not built.'],
  ['regimes', 'Regime Analysis', 'Evaluate performance by declared football conditions.', 'data-blocked',
    'Adequate prospective comparable samples and predeclared slices.', 'Inventory card only.',
    'Post-hoc slices are exploratory; sample sizes and multiple-comparison risk must be shown.', 'No MCP tool.',
    '/data/model-contracts.json', 'There are no multi-model prospective results yet.'],
  ['ensembles', 'Ensemble Lab', 'Compare mean, median and later weighted blends.', 'frontend-only',
    'User-entered probabilities or future normalized forecasts.', 'Belief-summary calculator; equal-weight only.',
    'Complex methods wait until they beat equal weight on held-out data.', 'No MCP tool.',
    '/data/model-contracts.json', 'Weighted ensembles need prospective error history.'],
  ['nfl-data', 'NFL Data Backbone', 'Create validated, reproducible canonical snapshots for every model.', 'backend-blocked',
    'nfelodcm, GitHub Actions, schema/freshness gates and snapshot retention.', 'Inventory and provenance contract.',
    'Fail closed on schema drift and suspicious row-count changes.', 'No MCP tool.',
    '/data/upstream-models.json', 'No scheduled canonical data job exists in this static repository.'],
].map(([id, name, intended_user_value, status, required_data, human_ui, ai_language, mcp_api, machine_readable, blocker]) => {
  const existingTool = (mcp_api.match(/^(dd_[a-z0-9_]+)/) || [])[1] || null;
  return {
    id, name, intended_user_value,
    existing_website_implementation: id === 'nfelo' ? '/nfelo.html + /pound.html#scoreboard'
      : id === 'model-scoreboard' ? '/pound.html#scoreboard'
      : calculatorIds.has(id) ? '/pound.html#calculators' : '/pound.html#inventory',
    existing_worker_mcp_implementation: existingTool,
    required_data, human_facing_ui_requirement: human_ui, ai_language_requirement: ai_language,
    mcp_api_requirement: existingTool
      ? `Keep ${existingTool} read-only and align its contract with the public JSON.`
      : calculatorIds.has(id)
        ? 'Expose the staged deterministic browser function through a read-only Worker tool using the published calculator contract.'
        : 'Add a read-only Worker tool only after the required deterministic data or runtime is validated.',
    machine_readable_requirement: machine_readable, status, exact_blocker: blocker,
    minimum_path_to_completion: blocker ? POUND_MINIMUM_PATHS[id] : 'No known blocker for the staged scope.'
  };
});

for (const tool of POUND_TOOLS) {
  if (tool.exact_blocker && !tool.minimum_path_to_completion) throw new Error(`missing Pound minimum path: ${tool.id}`);
}

write('upstream-models.json', {
  as_of: '2026-08-07', source: 'Primary upstream GitHub repositories and package metadata inspected 2026-08-07.',
  tier: TIERS.pound, graded: false,
  note: 'License status is an implementation gate, not legal advice. Public code without a verified reusable license is not copied or repackaged.',
  data: UPSTREAM_MODELS,
});

write('model-contracts.json', {
  as_of: '2026-08-07', source: 'Data Dawgs normalized forecasting and calculator contract, staged 2026-08-07.',
  tier: TIERS.pound, graded: false,
  note: 'A contract is not a forecast. It prevents incompatible models and missing values from being silently normalized into false agreement.',
  data: MODEL_CONTRACTS,
});

write('pound-tools.json', {
  as_of: '2026-08-07', source: 'Reconciled against the Data Dawgs site, Worker source and inspected upstream projects on 2026-08-07.',
  tier: TIERS.pound, graded: false,
  note: 'Complete means the requested delivery layers are live. Frontend-only means the browser tool and public contract exist but no MCP endpoint does. Blocked tools keep an exact minimum path instead of being omitted.',
  data: POUND_TOOLS,
});

/* ---------- tier-audit.json ----------
 * The 2026-08-07 audit of every tool against the gate, machine-readable.
 * `verdict` is one of: stands | promote | demote | outside.
 * This is a judgment, not a measurement — `checked` and `not_checked` are the
 * point of the file, not decoration.
 */
const AUDIT = [
  { id: 'epa-stats', name: 'NFL EPA Stats', page: '/stats.html', lane: 'dawg', verdict: 'stands',
    path: 'instrument',
    checked: 'Aggregation independently re-implemented outside the page (tools/build-data.js) from the same encoded columns; outputs internally consistent and consistent with the seasons (SF 2023, BAL 2024, NE 2025 leading offensive EPA/play). Sources named, snapshot dated.',
    not_checked: 'No external cross-check against a published nflfastR table. Re-implementing the page’s own algorithm proves the maths is reproducible, not that it is right.',
    owed: 'One spot-check against a public source.' },
  { id: 'nfelo', name: 'nfelo Power Ratings', page: '/nfelo.html', lane: 'dawg', verdict: 'stands',
    path: 'instrument',
    checked: 'Pinned to nfelo commit 0d3f8418, model v4.3.0. Source named, derivation reproducible, dated.',
    caveat: 'The collar certifies the MIRROR, not the forecasts. Backtest on file: n=4,053, nfelo SU 0.6674 vs market 0.6677 — nfelo behind by 0.02pp against a 0.196pp standard error, i.e. indistinguishable, and in-sample-ish because it overlaps nfelo’s own optimisation window.',
    owed: 'A one-line qualifier on the page itself, matching the homepage disclaimer.' },
  { id: 'draft-rig', name: 'Fantasy Draft Dashboard (the draft rig)', page: '/dashboard.html', lane: 'dawg', verdict: 'stands',
    path: 'operational',
    checked: 'Ran a live 14-team draft end to end. For an operational tool that is the right evidence — "does it work" is answered by working under load.',
    conditions: [
      'The Dashboard is a frame shell over board.html, dataviz.html, report.html and auction.html. Those are live standalone URLs with NO tier chip — same code, different verdict depending on how you arrive.',
      'The Grades view is a measurement dressed as a judgment: letter(0.5*z(surplus) + 0.5*z(starting-lineup value)). It measures buying value relative to the room, not whether the roster will win. Fix is labelling, not demotion.',
      'The rig runs on a 2026-07-29 market snapshot from a source that publishes through August. The tool works; the input is decaying. Collar is conditional on a refresh before draft night.',
    ] },
  { id: 'receipts', name: 'Receipts', page: '/receipts.html', lane: 'labs', verdict: 'stands',
    path: 'instrument',
    checked: 'Sources named (nfelo 0d3f8418, nflverse/nfldata, ESPN). Canonical string published and recomputes the locked hash — 272 rows, 6,697 bytes. Dated. Failure threshold pre-registered before any 2026 game.',
    blocker: 'The trust mechanism is SELF-ANCHORED. Data Dawgs hosts the ledger, the hash and the spec. Recomputation proves today’s file matches today’s hash; it cannot prove these were the predictions made before the games. A page whose purpose is verifiability cannot earn a collar on verification that is not independently checkable.',
    promotion_path: 'Anchor the hash externally and timestamp it. Nothing else needs to change.' },
  { id: 'master-data', name: 'Master Data', page: '/master.html', lane: 'labs', verdict: 'stands',
    path: 'instrument',
    blocker: 'Staleness, not method. Would clear on sources and reproducibility; the source updates daily and the file says 2026-07-29.',
    promotion_path: 'A refresh cadence. Cheapest promotion available.' },
  { id: 'survivor', name: 'Survivor', page: '/survivor.html', lane: 'labs', verdict: 'stands',
    path: 'forecast',
    blocker: 'No receipts. Two disclosed defects: double-pick weeks are recorded but not simulated, so survival numbers after such a week are optimistic in a known direction; ownership is modelled, not observed.' },
  { id: 'bozo', name: 'Bozo', page: '/bozo.html', lane: 'labs', verdict: 'stands',
    path: 'forecast',
    blocker: 'Every price is self-reported and unverified. The simulation draws legs independently, knowably false for two legs on the same game. Worst CLV is unmeasured. The game is well designed; the numbers are not validated.' },
  { id: 'dfs', name: 'DFS Solver & Contest Simulator', page: '/dfs.html', lane: 'labs', verdict: 'stands',
    path: 'forecast',
    blocker: 'Built 2026-08-06, zero graded slates. Determinism is a strength but is not validation — an optimiser is exactly as good as the projections it is fed, and those are untested.' },
  { id: 'guillotine', name: 'Guillotine Companion', page: '/guillotine.html', lane: 'labs', verdict: 'stands',
    path: 'forecast', blocker: 'Nothing graded, nothing claimed.' },
  { id: 'strategy', name: 'Strategy', page: '/strategy.html', lane: 'labs', verdict: 'outside',
    reason: 'A synthesis of one analyst’s opinions, not a tool. Tiering it implies a validation question that does not apply.' },
  { id: 'dawgs-page', name: 'Dawgs', page: '/dawgs.html', lane: 'labs', verdict: 'outside',
    reason: 'Photographs. Not a tool.' },
];

write('tier-audit.json', {
  as_of: '2026-08-07',
  source: 'Audit of every live tool against the gate on index.html#tiers, performed 2026-08-07.',
  tier: TIERS.labs,
  graded: false,
  note:
    'ONE REVIEWER, ONE DAY, reasoning from the code and the published data. This is a judgment, ' +
    'not a measurement — which is the gate’s known weakness and the reason the audit is published ' +
    'rather than held. Result: NO promotions, NO demotions. That is a suspiciously comfortable ' +
    'outcome and is flagged as such; it survives only because every collar came back with a ' +
    'condition attached. Treat these verdicts as falsifiable.',
  headline_finding:
    'The Pound is empty. After ~170 commits, zero recorded retirements. Either nothing has ever ' +
    'failed, or failures are being abandoned rather than recorded — and the first is not plausible. ' +
    'An empty Pound is survivorship bias appearing in the one structure built to prevent it.',
  gate: 'Does it work, and can it be trusted? Forecasts need receipts against a benchmark chosen in advance; measurement tools need named sources and reproducible math. Nothing clears by feeling finished.',
  what_would_change_our_mind: {
    'epa-stats': 'An external cross-check that disagrees with the page.',
    nfelo: 'Nothing this season — the market comparison is unresolvable in one year by the site’s own pre-registered arithmetic.',
    'draft-rig': 'A draft night where the rig fails under load, or a refusal to refresh the market snapshot before it.',
    receipts: 'An external, timestamped anchor would promote it. Nothing else would.',
    'any-labs-tool': 'Receipts against a benchmark declared in advance.',
  },
  counts: {
    audited: AUDIT.length,
    dawgs: AUDIT.filter(a => a.lane === 'dawg').length,
    labs: AUDIT.filter(a => a.lane === 'labs' && a.verdict !== 'outside').length,
    pound: 0,
    promotions_recommended: AUDIT.filter(a => a.verdict === 'promote').length,
    demotions_recommended: AUDIT.filter(a => a.verdict === 'demote').length,
    outside_the_tier_system: AUDIT.filter(a => a.verdict === 'outside').length,
  },
  data: AUDIT,
});

/* ---------- surfaces.json — the machine-access map ----------
 * Every human surface on the site, and what an agent can call instead.
 * `status` is honest: live | planned | none. The validator asserts that every
 * "live" entry resolves to a file that actually exists, so this file cannot
 * claim coverage the site does not have.
 */
// The deployed /mcp tools. ⚠️ Flip nothing here before the tool answers a
// real call from a real client — this list IS counts.mcp_tools_live and the
// validator asserts the endpoint exists whenever it is non-empty.
const MCP_LIVE = ['dd_whoami', 'dd_league_overview', 'dd_bozo_week', 'dd_bozo_standings',
  'dd_draft_board', 'dd_draft_pool', 'dd_survivor_week', 'dd_scores',
  'dd_dfs_correlations', 'dd_guillotine_odds', 'dd_site_map',
  'dd_survivor_ev', 'dd_analyze_matchup'];
const MCP_ENDPOINT = {
  path: '/mcp/u_<personal token>   (legacy: /mcp/<league passphrase>)',
  transport: 'streamable-http',
  host: 'https://toto.jkapcar4.workers.dev',
  mint: 'https://datadawgs216.com/connect.html',
  auth:
    'PER-USER tokens, minted at /connect.html, stored hashed and revocable one at a time — ' +
    'so the server knows who is asking and a leak costs one member, not fourteen. The older ' +
    'shared league passphrase still works and is ANONYMOUS; it is kept only so nobody is cut ' +
    'off mid-season. Either way the URL IS the credential: per-user makes a leak containable, ' +
    'not secure, and it must never be described as security.',
  identity:
    'dd_whoami reports the caller. Rows belonging to them are marked `you: true`. An anonymous ' +
    'connection is told so explicitly and instructed to ask rather than assume whose is whose.',
  writes: 'None. Every tool is read-only, asserted by test against the source.',
};

const SURFACES = [
  { id: 'draft-pool', name: 'Player pool + Market Value', page: '/master.html',
    machine: [{ kind: 'json', url: '/data/pool.json', status: 'live' },
              { kind: 'mcp', tool: 'dd_draft_pool', status: 'live' }],
    planned: ['rest:/api/pool'] },
  { id: 'draft-strategy', name: '2026 draft strategy', page: '/strategy.html',
    machine: [{ kind: 'markdown', url: '/data/strategy.md', status: 'live' }],
    planned: [] },
  { id: 'live-draft', name: 'Live auction — board, auctioneer, big board, dashboard, report card',
    page: '/dashboard.html',
    machine: [{ kind: 'json', url: '/data/league.json', status: 'live', covers: 'league configuration only' },
              { kind: 'mcp', tool: 'dd_draft_board', status: 'live', covers: 'live budgets, open slots, true max bids, clock, block, recent sales' }],
    planned: ['rest:/api/draft'],
    gap: 'The Firebase mirror still has no dated JSON snapshot surface; dd_draft_board reads it live instead.' },
  { id: 'epa', name: 'NFL EPA explorer', page: '/stats.html',
    machine: [{ kind: 'json', url: '/data/epa-teams.json', status: 'live', covers: 'team and QB aggregates' }],
    planned: ['mcp:query_stats', 'rest:/api/epa'],
    gap: 'Play-level data (109,933 plays) is not exposed; only aggregates.' },
  { id: 'nfelo', name: 'nfelo power ratings', page: '/nfelo.html',
    machine: [{ kind: 'json', url: '/data/nfelo.json', status: 'live' },
              { kind: 'json', url: '/data/models.json', status: 'live', covers: 'the margin model parameters' },
              { kind: 'mcp', tool: 'dd_analyze_matchup', status: 'live', covers: 'one current matchup with dated nfelo, market and model context' }],
    planned: ['rest:/api/matchup'] },
  { id: 'survivor', name: 'Survivor pool EV', page: '/survivor.html',
    machine: [{ kind: 'json', url: '/data/survivor.json', status: 'live', covers: 'schedule and win probabilities' },
              { kind: 'mcp', tool: 'dd_survivor_week', status: 'live', covers: 'stored weekly ownership snapshots, staleness-flagged' },
              { kind: 'mcp', tool: 'dd_survivor_ev', status: 'live', covers: 'modelled pool survival EV with assumptions returned in the payload' }],
    planned: [],
    gap: 'Pool ownership is modelled, not observed, and double-pick weeks are recorded but not simulated.' },
  { id: 'receipts', name: 'Pre-registered forecasts', page: '/receipts.html',
    machine: [{ kind: 'json', url: '/data/receipts.json', status: 'live' },
              { kind: 'markdown', url: '/data/receipts-method.md', status: 'live' },
              { kind: 'json', url: '/data/tier-audit.json', status: 'live', covers: 'the tier audit — our own tools graded against the gate' },
              { kind: 'markdown', url: '/data/tier-audit.md', status: 'live' }],
    planned: ['mcp:get_receipts', 'mcp:verify_receipts'] },
  { id: 'bozo', name: 'Bozo — weekly group parlay', page: '/bozo.html',
    machine: [{ kind: 'json', url: '/data/bozo-rules.json', status: 'live', covers: 'ruleset only' },
              { kind: 'markdown', url: '/data/bozo-rules.md', status: 'live' },
              { kind: 'mcp', tool: 'dd_bozo_week', status: 'live', covers: 'the live board, legs in submission order' },
              { kind: 'mcp', tool: 'dd_bozo_standings', status: 'live', covers: 'season ledger summary' },
              { kind: 'mcp', tool: 'dd_league_overview', status: 'live' }],
    planned: ['mcp:submit_bozo_leg'],
    gap: 'Reads are live over MCP. Write access (submitting a leg) waits on the trust layer, deliberately.' },
  { id: 'dfs', name: 'DFS solver + contest simulator', page: '/dfs.html',
    machine: [{ kind: 'mcp', tool: 'dd_dfs_correlations', status: 'live', covers: 'the measured correlation structure only — never projections or ownership, which exist only in each user\'s browser' }],
    planned: ['mcp:solve_dfs_lineup'],
    gap: 'The solver is a pure function running in the browser. The correlation matrix it uses is served; the solve itself is not.' },
  { id: 'guillotine', name: 'Guillotine league tools', page: '/guillotine.html',
    machine: [{ kind: 'mcp', tool: 'dd_guillotine_odds', status: 'live' }],
    planned: ['json:/data/guillotine.json'] },
  { id: 'pound', name: 'The Pound model and calculator workbench', page: '/pound.html',
    machine: [{ kind: 'json', url: '/data/pound-tools.json', status: 'live', covers: 'complete inventory, delivery status and exact blockers' },
              { kind: 'json', url: '/data/model-contracts.json', status: 'live', covers: 'forecast, receipt and calculator contracts' },
              { kind: 'json', url: '/data/upstream-models.json', status: 'live', covers: 'source, commit and license provenance' }],
    planned: ['mcp:model_scoreboard', 'mcp:model_calculators'],
    gap: 'Browser calculators are deterministic and public, but no dedicated calculator MCP endpoint exists.' },
  { id: 'method', name: 'How this site reasons', page: '/index.html',
    machine: [{ kind: 'markdown', url: '/data/method.md', status: 'live' },
              { kind: 'markdown', url: '/data/toto-philosophy.md', status: 'live' }],
    planned: ['mcp:prompts'] },
];

write('surfaces.json', {
  as_of: BUILT,
  source: 'Generated from the site itself. Tier is read from each page\'s live chip.',
  tier: TIERS.labs,
  graded: false,
  note:
    'THE DESIGN INTENT, STATED PLAINLY: every part of this site that makes sense to expose to a ' +
    'machine gets a dated JSON or markdown surface, and — where a tool computes something rather ' +
    'than just reporting it — an MCP tool and a REST route. This file is the map of how far that ' +
    'has actually got. `status` is honest. "planned" means NOT BUILT: do not tell a user you can ' +
    'call it. Gaps are listed on purpose — a coverage map that hides its holes is marketing.',
  policy: {
    reads: 'Public, free, CORS-open, no key, no rate limit.',
    writes: 'Every write goes through a Worker that stamps server time and validates. None are live yet.',
    dating: 'Every payload carries as_of and source. Quote the date with the number.',
    tiers: TIER_MEANING,
  },
  mcp: { ...MCP_ENDPOINT, tools_live: MCP_LIVE },
  counts: {
    surfaces: SURFACES.length,
    with_live_machine_access: SURFACES.filter(s => s.machine.some(m => m.status === 'live')).length,
    with_no_machine_access: SURFACES.filter(s => s.machine.every(m => m.status === 'none')).length,
    mcp_tools_live: MCP_LIVE.length,
    mcp_tools_planned: [...new Set(SURFACES.flatMap(s => s.planned).filter(p => p.startsWith('mcp:')))].length,
  },
  data: SURFACES.map(s => ({ ...s, tier: tierOf(s.page.replace(/^\//, '')) })),
});

/* ---------- index.json (manifest) ---------- */
const manifest = {
  as_of: BUILT,
  source: 'Generated manifest of every machine-readable surface on datadawgs216.com.',
  note:
    'Start here. Each entry carries its own as_of — check it before quoting anything. ' +
    'The sha256 is of the file as served; recompute it if you care.',
  site: 'https://datadawgs216.com',
  built: BUILT,
  data: {
    files: Object.entries(files).map(([name, m]) => ({
      path: '/data/' + name,
      url: 'https://datadawgs216.com/data/' + name,
      ...m,
    })),
    // Hand-authored mirrors. Not generated by this script, but they ARE part of the
    // contract, so they belong in the manifest with the same bytes + sha256 treatment.
    // Add new ones here or validate-data.js will not know they exist.
    markdown: [
      'strategy.md', 'receipts-method.md', 'bozo-rules.md', 'method.md', 'toto-philosophy.md',
      'tier-audit.md',
    ].map(name => {
      const p = path.join(OUT, name);
      const txt = fs.readFileSync(p, 'utf8');
      return {
        path: '/data/' + name,
        url: 'https://datadawgs216.com/data/' + name,
        bytes: Buffer.byteLength(txt),
        sha256: crypto.createHash('sha256').update(txt).digest('hex'),
        as_of: (txt.match(/^as_of:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m) || [])[1] || null,
      };
    }),
  },
};
const mtxt = JSON.stringify(manifest, null, 1);
fs.writeFileSync(path.join(OUT, 'index.json'), mtxt);

console.log('name'.padEnd(20), 'KB'.padStart(7), 'as_of');
for (const [n, m] of Object.entries(files)) console.log(n.padEnd(20), (m.bytes / 1024).toFixed(1).padStart(7), m.as_of);
console.log('index.json'.padEnd(20), (Buffer.byteLength(mtxt) / 1024).toFixed(1).padStart(7), BUILT);
