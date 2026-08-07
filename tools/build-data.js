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

function write(name, env) {
  if (!env.as_of) throw new Error('missing as_of: ' + name);
  if (!env.source) throw new Error('missing source: ' + name);
  const body = { ...env, built: BUILT, canonical_url: 'https://datadawgs216.com/data/' + name };
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
