#!/usr/bin/env node
/* Bozo Menu ledger + source scorecard, built only from PUBLIC Worker feeds:
 *   /bozo/menu.json?week=…          the published menu (never the private library)
 *   /scores?sport=…&dates=…&closes=1  finals and DraftKings near-closes
 *
 *   node tools/bozo-menu-ledger.mjs                 fetch from the Worker, write data/
 *   node tools/bozo-menu-ledger.mjs --fixtures DIR  read menu-*.json + scores-*.json from DIR
 *
 * ⚠️ WHAT IS GRADED. Only the claim as published, at its published line. A shopping target
 * ("worst_acceptable") is not a claim. A push is a push; a game with no final stays pending.
 * Nothing is back-filled: no close from an entry price, no assumed juice, no invented weight.
 * Every rate carries its n, and nothing is ranked below 30 graded rows ("insufficient").
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOTO = 'https://toto.jkapcar4.workers.dev';
export const MIN_RANK_N = 30;
const Z90 = 1.6448536269514722;

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const num = s => {
  const t = String(s ?? '').trim().replace(/−/g, '-').replace(/^\+/, '');
  if (!t) return null;               // a missing number is null, never 0
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const round = (x, d = 4) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
const implied = a => a < 0 ? -a / (-a + 100) : 100 / (a + 100);
const devig = (mine, theirs) => {
  if (!Number.isFinite(mine) || !Number.isFinite(theirs)) return null;
  const p = implied(mine), q = implied(theirs);
  return p / (p + q);
};
export function wilson(k, n, z = Z90) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [round(Math.max(0, c - h)), round(Math.min(1, c + h))];
}

// NFL scores carry nflverse abbreviations; menus carry full names.
const NFL = { ARI: 'arizonacardinals', ATL: 'atlantafalcons', BAL: 'baltimoreravens', BUF: 'buffalobills',
  CAR: 'carolinapanthers', CHI: 'chicagobears', CIN: 'cincinnatibengals', CLE: 'clevelandbrowns',
  DAL: 'dallascowboys', DEN: 'denverbroncos', DET: 'detroitlions', GB: 'greenbaypackers', HOU: 'houstontexans',
  IND: 'indianapoliscolts', JAX: 'jacksonvillejaguars', KC: 'kansascitychiefs', LV: 'lasvegasraiders',
  LAC: 'losangeleschargers', LA: 'losangelesrams', LAR: 'losangelesrams', MIA: 'miamidolphins',
  MIN: 'minnesotavikings', NE: 'newenglandpatriots', NO: 'neworleanssaints', NYG: 'newyorkgiants',
  NYJ: 'newyorkjets', PHI: 'philadelphiaeagles', PIT: 'pittsburghsteelers', SF: 'sanfrancisco49ers',
  SEA: 'seattleseahawks', TB: 'tampabaybuccaneers', TEN: 'tennesseetitans', WAS: 'washingtoncommanders' };
const teamKey = (sport, t) => sport === 'nfl' ? (NFL[t.abbr] || norm(t.name)) : norm(t.name);
// "Ball State Cardinals at Northwestern Wildcats" / "Texas Longhorns vs Oklahoma Sooners (Cotton Bowl, neutral site)"
export function parseEvent(event) {
  const s = String(event || '').replace(/\s*\(.*\)\s*$/, '');
  const m = s.match(/^(.*?)\s+(?:at|@|vs\.?)\s+(.*)$/i);
  return m ? { away: m[1].trim(), home: m[2].trim() } : null;
}
// Longest-prefix match of a schedule team onto a menu full name ("South Florida" -> "South Florida Bulls").
const fits = (menuName, key) => { const m = norm(menuName); return key && m.startsWith(key) ? key.length : 0; };
const sportOf = c => /nfl/i.test(c.sport) ? 'nfl' : 'cfb';
const espnId = c => (c.sources || []).map(s => String(s.url || '').match(/gameId\/(\d+)/)).find(Boolean)?.[1] || null;

export function matchGame(c, scores) {
  const sport = sportOf(c), games = (scores[sport] || []);
  const id = espnId(c);
  if (id) { const g = games.find(x => String(x.id) === id); if (g) return { game: g, by: 'espn-id' }; }
  const ev = parseEvent(c.event), kick = Date.parse(c.kickoff || '');
  if (!ev || !Number.isFinite(kick)) return null;
  let best = null, tied = false;
  for (const g of games) {
    if (Math.abs(Date.parse(g.start) - kick) > 6 * 3600e3) continue;
    const away = g.teams.find(t => !t.home), home = g.teams.find(t => t.home);
    if (!away || !home) continue;
    for (const swap of [false, true]) {
      const a = fits(swap ? ev.home : ev.away, teamKey(sport, away)), h = fits(swap ? ev.away : ev.home, teamKey(sport, home));
      if (!a || !h) continue;
      const score = a + h;
      if (!best || score > best.score) { best = { game: g, score, swap }; tied = false; }
      else if (score === best.score && g !== best.game) tied = true;
    }
  }
  return best && !tied ? { game: best.game, by: 'teams+kickoff', swapped: best.swap } : null;
}

// The selection as published: side, line (signed as displayed), and whether the side is home.
export function parseSelection(c, game) {
  const sport = sportOf(c), market = String(c.market || '').toLowerCase();
  const away = game && game.teams.find(t => !t.home), home = game && game.teams.find(t => t.home);
  if (market === 'total') {
    const def = String(c.edge && c.edge.definition || '');
    const side = /favoring under/i.test(def) || /\bunder\b/i.test(c.selection) ? 'under' : 'over';
    const line = num(c.base && c.base.line) ?? num((def.match(/base-market reference ([\d.]+)/) || [])[1]);
    return { market, side, line };
  }
  const label = market === 'moneyline' ? String(c.selection).replace(/\s+moneyline.*$/i, '')
    : String(c.selection).replace(/\s*\(.*$/, '').replace(/\s+[−+\-]?\d+(\.\d+)?\s*$/, '');
  const line = market === 'spread' ? num((String(c.selection).match(/([−+\-]\d+(?:\.\d+)?)\s*(?:\(|$)/) || [])[1]) : null;
  let isHome = null;
  if (away && home) {
    // Exact name beats abbreviation beats prefix: "Louisiana" is a prefix of "Louisiana Tech".
    const a = norm(label);
    const fit = t => {
      const k = teamKey(sport, t);
      if (k && a === k) return 1000;
      if (a && a === norm(t.abbr)) return 900;
      return k && (k.startsWith(a) || a.startsWith(k)) ? Math.min(a.length, k.length) : 0;
    };
    const fa = fit(away), fh = fit(home);
    isHome = fh > fa ? true : fa > fh ? false : null;
  }
  return { market: market === 'moneyline' ? 'moneyline' : market, side: label, line, isHome };
}

// Numeric claims named on the published row (edge definition), never the private evidence.
export function sourceClaims(c, sel) {
  const def = String(c.edge && c.edge.definition || ''), out = [];
  if (/poster blend/i.test(def) && c.edge.unit === 'points' && sel.line != null)
    out.push({ source: 'blend (1/3 PFF + 1/3 SP+ + 1/3 DRatings)', kind: 'margin', value: round(-sel.line + c.edge.value, 2),
      derived: 'published line and edge: side margin = -line + edge' });
  const t = def.match(/DRatings total ([\d.]+)/i);
  if (t) out.push({ source: 'DRatings', kind: 'total', value: Number(t[1]) });
  const ml = def.match(/DRatings win estimate minus break-even probability at observed (-?\d+)/i);
  if (ml && c.edge.unit === 'percentage_points') {
    const price = Number(ml[1]);
    out.push({ source: 'DRatings', kind: 'probability', value: round(implied(price) + c.edge.value / 100, 4),
      derived: `edge (pp) + break-even at ${price}` });
  }
  return out;
}

const sideScores = (game, isHome) => {
  const home = game.teams.find(t => t.home), away = game.teams.find(t => !t.home);
  return isHome ? [home.score, away.score] : [away.score, home.score];
};

// Close for the selection, in the selection's orientation, from the scheduled-orientation near-close.
function closeFor(close, sel) {
  if (!close) return null;
  if (sel.market === 'spread' && close.spread && sel.isHome != null) {
    const s = close.spread, flip = !sel.isHome;
    const line = flip ? -s.home_line : s.home_line;
    const atLine = [s, ...(s.alternates || [])].map(r => ({ line: flip ? -r.home_line : r.home_line,
      mine: flip ? r.away_price : r.home_price, theirs: flip ? r.home_price : r.away_price }))
      .find(r => Math.abs(r.line - sel.line) < 0.001) || null;
    return { line, price: flip ? s.away_price : s.home_price, opp: flip ? s.home_price : s.away_price, atLine };
  }
  if (sel.market === 'total' && close.total) {
    const s = close.total, over = sel.side === 'over';
    const atLine = [s, ...(s.alternates || [])].map(r => ({ line: r.line, mine: over ? r.over_price : r.under_price,
      theirs: over ? r.under_price : r.over_price })).find(r => Math.abs(r.line - sel.line) < 0.001) || null;
    return { line: s.line, price: over ? s.over_price : s.under_price, opp: over ? s.under_price : s.over_price, atLine };
  }
  if (sel.market === 'moneyline' && close.moneyline && sel.isHome != null) {
    const m = close.moneyline;
    const mine = sel.isHome ? m.home_price : m.away_price, theirs = sel.isHome ? m.away_price : m.home_price;
    return { line: null, price: mine, opp: theirs, atLine: { line: null, mine, theirs } };
  }
  return null;
}

export function gradeRow(c, week, published_at, scores) {
  const hit = matchGame(c, scores), game = hit && hit.game;
  const sel = parseSelection(c, game);
  const base = c.base || null;
  const row = {
    id: c.id, week, sport: sportOf(c), event: c.event, kickoff: c.kickoff || null, market: sel.market,
    status: c.status, published_at, screened_at: c.screened_at || null,
    selection: { text: c.selection, side: sel.side, line: sel.line,
      // The schedule team the side resolved to, so a reader can audit the match.
      team: sel.market === 'total' || sel.isHome == null || !game ? null
        : game.teams.find(t => t.home === sel.isHome).abbr,
      odds: base ? base.odds ?? null : null, book: base ? base.book ?? null : null, quoted_at: base ? base.quoted_at ?? null : null },
    edge: c.edge ? { value: c.edge.value, unit: c.edge.unit, definition: c.edge.definition } : null,
    sources: (c.sources || []).map(s => ({ name: s.name, as_of: s.as_of || null })),
    claims: sourceClaims(c, sel),
    game: game ? { id: String(game.id), matched_by: hit.by, final: game.final === true,
      score_source: game.scoreSource || null, score_observed_at: game.scoreObservedAt || null } : null,
    result: 'pending', actual: null, close: null, clv: null, grade_note: null,
  };
  if (!game) { row.grade_note = 'no scheduled game matched'; return row; }
  if (sel.market !== 'total' && sel.isHome == null) { row.grade_note = 'selection side not resolved to a team'; return row; }
  if (game.final === true) {
    const home = game.teams.find(t => t.home).score, away = game.teams.find(t => !t.home).score;
    if (sel.market === 'total') {
      const total = home + away, edge = sel.side === 'over' ? total - sel.line : sel.line - total;
      row.actual = { total };
      row.result = edge > 0 ? 'win' : edge < 0 ? 'loss' : 'push';
    } else {
      const [mine, theirs] = sideScores(game, sel.isHome), margin = mine - theirs;
      row.actual = { side_margin: margin, total: home + away };
      const edge = sel.market === 'spread' ? margin + sel.line : margin;
      row.result = edge > 0 ? 'win' : edge < 0 ? 'loss' : (sel.market === 'moneyline' ? 'void' : 'push');
    }
  } else row.grade_note = 'no final yet';
  const cl = closeFor(game.close, sel);
  if (cl) {
    row.close = { label: game.close.label, book: game.close.book, source: game.close.source,
      captured_at: game.close.captured_at, line: cl.line, price: cl.price, opp: cl.opp,
      price_at_published_line: cl.atLine ? { mine: cl.atLine.mine, theirs: cl.atLine.theirs } : null };
    const pts = sel.market === 'spread' ? round(sel.line - cl.line, 2)
      : sel.market === 'total' ? round(sel.side === 'over' ? cl.line - sel.line : sel.line - cl.line, 2) : null;
    const closeFair = cl.atLine ? devig(cl.atLine.mine, cl.atLine.theirs) : null;
    row.clv = { points: pts, close_fair_prob_at_published_line: round(closeFair),
      // Entry de-vig needs both entry sides; the menu saves one, so this stays null rather than assume juice.
      prob_pp: null };
  }
  return row;
}

function summarize(rows) {
  const graded = rows.filter(r => ['win', 'loss'].includes(r.result));
  const wins = graded.filter(r => r.result === 'win').length, n = graded.length;
  const pushes = rows.filter(r => r.result === 'push').length;
  const clv = rows.map(r => r.clv && r.clv.points).filter(x => x != null);
  const fair = rows.map(r => r.clv && r.clv.close_fair_prob_at_published_line).filter(x => x != null);
  return {
    n_graded: n, wins, losses: n - wins, pushes,
    hit_rate: n ? round(wins / n) : null, hit_wilson90: wilson(wins, n),
    clv_points: { n: clv.length, mean: clv.length ? round(clv.reduce((a, b) => a + b, 0) / clv.length, 3) : null },
    close_fair_prob_at_line: { n: fair.length, mean: fair.length ? round(fair.reduce((a, b) => a + b, 0) / fair.length) : null },
    verdict: n >= MIN_RANK_N ? 'rankable' : `insufficient (n=${n} < ${MIN_RANK_N})`,
  };
}

function pointErrors(rows, kind) {
  const errs = [], closeErrs = [];
  for (const r of rows) {
    const claim = r.claims.find(x => x.kind === kind);
    if (!claim || !r.actual || r.result === 'pending') continue;
    const actual = kind === 'total' ? r.actual.total : r.actual.side_margin;
    if (actual == null) continue;
    errs.push(claim.value - actual);
    if (r.close && r.close.line != null)
      closeErrs.push(kind === 'total' ? r.close.line - actual : -r.close.line - actual);
  }
  const mae = a => a.length ? round(a.reduce((s, x) => s + Math.abs(x), 0) / a.length, 3) : null;
  return { n: errs.length, mae: mae(errs), bias: errs.length ? round(errs.reduce((a, b) => a + b, 0) / errs.length, 3) : null,
    close_mae_same_games: { n: closeErrs.length, mae: mae(closeErrs) } };
}

function probScores(rows) {
  const ps = [];
  for (const r of rows) {
    const claim = r.claims.find(x => x.kind === 'probability');
    if (!claim || !['win', 'loss'].includes(r.result)) continue;
    const y = r.result === 'win' ? 1 : 0, p = Math.min(1 - 1e-12, Math.max(1e-12, claim.value));
    ps.push({ brier: (claim.value - y) ** 2, log: -(y ? Math.log(p) : Math.log(1 - p)) });
  }
  const mean = k => ps.length ? round(ps.reduce((s, x) => s + x[k], 0) / ps.length) : null;
  return { n: ps.length, brier: mean('brier'), log_loss: mean('log'),
    calibration: ps.length >= MIN_RANK_N ? 'see ledger rows' : `insufficient (n=${ps.length} < ${MIN_RANK_N})` };
}

export function buildScorecard(rows) {
  const active = rows.filter(r => r.status !== 'scratch');
  const by = pred => active.filter(pred);
  const blend = by(r => r.claims.some(c => c.source.startsWith('blend')));
  const drTot = by(r => r.claims.some(c => c.source === 'DRatings' && c.kind === 'total'));
  const drP = by(r => r.claims.some(c => c.source === 'DRatings' && c.kind === 'probability'));
  const bucket = r => {
    if (!r.edge) return 'none';
    const v = Math.abs(r.edge.value);
    return `${r.edge.unit}: ${v < 3 ? '<3' : v < 5 ? '3-5' : '5+'}`;
  };
  const buckets = {};
  for (const r of active) (buckets[bucket(r)] ||= []).push(r);
  return {
    benchmarks: { random_hit_rate: 0.5, breakeven_at_minus_110: round(110 / 210), close: 'clv_points and close MAE are measured against the DraftKings near-close' },
    menu: summarize(active),
    scratched_for_the_record: summarize(rows.filter(r => r.status === 'scratch')),
    sources: [
      { source: 'blend (1/3 PFF + 1/3 SP+ + 1/3 DRatings)', claims: blend.length, ...summarize(blend), margin: pointErrors(blend, 'margin') },
      { source: 'DRatings totals', claims: drTot.length, ...summarize(drTot), total: pointErrors(drTot, 'total') },
      { source: 'DRatings win probability', claims: drP.length, ...summarize(drP), probability: probScores(drP) },
      { source: 'PFF', claims: 0, verdict: 'not gradeable as published: no per-source number on any row' },
      { source: 'SP+', claims: 0, verdict: 'not gradeable as published: no per-source number on any row' },
    ],
    edge_buckets: Object.fromEntries(Object.entries(buckets).sort().map(([k, rs]) => [k, summarize(rs)])),
  };
}

// The tier sentence must be byte-identical to tools/build-data.js (validate-data checks it), so it
// is read from there rather than copied.
function tierMeaning(tier) {
  const src = fs.readFileSync(path.join(ROOT, 'tools/build-data.js'), 'utf8');
  const block = src.match(/const TIER_MEANING = \{([\s\S]*?)\n\};/);
  const m = block && [...block[1].matchAll(/^\s*(labs|dawg|pound):\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)].find(x => x[1] === tier);
  if (!m) throw new Error(`could not read TIER_MEANING.${tier} from tools/build-data.js`);
  return m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

export function buildLedger(menus, scores, built = new Date().toISOString()) {
  const rows = [];
  for (const m of menus) for (const c of m.candidates || []) rows.push(gradeRow(c, m.week, m.published_at || null, scores));
  rows.sort((a, b) => String(a.week).localeCompare(String(b.week)) || String(a.kickoff).localeCompare(String(b.kickoff)) || a.id.localeCompare(b.id));
  const as_of = built.slice(0, 10);
  const weeks = menus.map(m => m.week).sort();
  // labs: graded rows exist, but nothing here is validated, and no verdict is drawn below 30 rows.
  const envelope = (name, note, data) => ({
    as_of, source: 'Data Dawgs public Bozo Menu (Worker /bozo/menu.json) graded against Worker /scores finals and DraftKings near-closes (SportsGameOdds).',
    tier: 'labs', graded: true, note, data, tier_meaning: tierMeaning('labs'), built,
    canonical_url: `https://datadawgs216.com/data/${name}` });
  return {
    ledger: envelope('bozo-menu-ledger.json',
      'One row per published candidate per week, graded at its published line only. Results are pending until a final exists; a push is a push. Closes are NEAR-CLOSE (SportsGameOdds free tier, about 10 minutes behind DraftKings). Entry probability CLV stays null because the menu saves one entry side; no juice is assumed. Simulation-free; not a recommendation.',
      { weeks, rows }),
    scorecard: envelope('bozo-menu-scorecard.json',
      `Source scorecard for the Bozo Menu. Every number carries its n; nothing is ranked below ${MIN_RANK_N} graded rows. Benchmarks: 50% at the line, 52.38% break-even at -110, and the near-close.`,
      { weeks, rows_total: rows.length, ...buildScorecard(rows) }),
  };
}

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.json();
}
const ymd = iso => iso.slice(0, 10).replace(/-/g, '');

async function main() {
  const fx = process.argv.indexOf('--fixtures') > -1 ? process.argv[process.argv.indexOf('--fixtures') + 1] : null;
  let menus, scores;
  if (fx) {
    menus = fs.readdirSync(fx).filter(f => /^menu-.*\.json$/.test(f)).sort().map(f => JSON.parse(fs.readFileSync(path.join(fx, f))));
    scores = { nfl: [], cfb: [] };
    for (const f of fs.readdirSync(fx).filter(f => /^scores-(nfl|cfb).*\.json$/.test(f)))
      scores[f.match(/^scores-(nfl|cfb)/)[1]].push(...JSON.parse(fs.readFileSync(path.join(fx, f))).games);
  } else {
    const latest = await getJson(`${TOTO}/bozo/menu.json`);
    const weeks = [...new Set([...(latest.published_weeks || []).map(w => w.week || w), latest.week].filter(Boolean))].sort();
    menus = [];
    for (const w of weeks) menus.push(w === latest.week ? latest : await getJson(`${TOTO}/bozo/menu.json?week=${w}`));
    const kicks = menus.flatMap(m => (m.candidates || []).map(c => c.kickoff)).filter(k => !isNaN(Date.parse(k || ''))).sort();
    scores = { nfl: [], cfb: [] };
    if (kicks.length) {
      const lo = ymd(new Date(Date.parse(kicks[0]) - 86400e3).toISOString()), hi = ymd(new Date(Date.parse(kicks.at(-1)) + 86400e3).toISOString());
      for (const sport of ['nfl', 'cfb']) scores[sport] = (await getJson(`${TOTO}/scores?sport=${sport}&dates=${lo}-${hi}&closes=1`)).games || [];
    }
  }
  const { ledger, scorecard } = buildLedger(menus, scores);
  // An unchanged payload leaves the file alone, so a quiet day is not a commit with a new date.
  const write = (name, value) => {
    const file = path.join(ROOT, 'data', name);
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (prev && JSON.stringify(prev.data) === JSON.stringify(value.data)) return false;
    fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
    return true;
  };
  const changed = [write('bozo-menu-ledger.json', ledger), write('bozo-menu-scorecard.json', scorecard)].some(Boolean);
  const g = scorecard.data.menu;
  console.log(`ledger: ${ledger.data.rows.length} rows, ${g.n_graded} graded (${g.wins}-${g.losses}-${g.pushes}), weeks ${ledger.data.weeks.join(', ')}${changed ? '' : ' (unchanged)'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
}
