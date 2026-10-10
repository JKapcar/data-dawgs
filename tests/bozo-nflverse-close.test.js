// nflverse games.csv as the free, labelled backup close ("nflverse close (book unspecified)").
// Real 2026 rows; the sign checks are pinned to games whose results are known.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const src = fs.readFileSync('dawg-bot-worker.js', 'utf8');
const cut = (a, b) => { const x = src.indexOf(a), y = src.indexOf(b, x); assert.ok(x >= 0 && y > x, a); return src.slice(x, y); };
const csv = fs.readFileSync('tests/fixtures/nflverse-games-2026-close-sample.csv', 'utf8');
const seed = fs.readFileSync('bozo-team-registry.mjs', 'utf8').match(/export const BOZO_ESPN_TEAM_SEED = ([\s\S]*);\s*$/)[1];

function rig() {
  const logs = [];
  const ctx = { Request, Response, URL, AbortController, setTimeout, clearTimeout, Date, Intl,
    console: { log: (...x) => logs.push(x) }, BOZO_CLOSE_BOOK: 'draftkings', SEASON: 2026,
    fetch: async () => { throw Error('Unexpected fetch'); } };
  vm.createContext(ctx);
  vm.runInContext([
    `const BOZO_ESPN_TEAM_SEED=${seed};`,
    cut('const BOZO_GRADEABLE_SPORTS', 'const ledgerKey'),
    cut('const bzNorm =', '/* ---------------- player props'),
    cut('const bzAmerican =', '/* Resolve one free-text prop'),
    cut('async function bozoCloseTargets(', '// `periods`'),
    cut('function bozoMatchEvent(', '/* The cron body.'),
    cut('function bozoScheduledTeamSide(', 'function bozoScheduledOutcome('),
    cut('function bozoScheduledOutcome(', '// Independent of the research CSVs'),
    'const ledgerKey = (season, week, playerKey) => `${season}-w${week}-${playerKey}`;',
    'this.api={bozoNormalizeNflSchedule,bozoNflverseCloseQuote,bozoNflverseCloseEligible,bozoCloseMutation,bozoScheduleFindGame,bozoScheduledOutcome,bozoCloseTargets,assertQuote};',
  ].join('\n'), ctx);
  return { ctx, logs, ...ctx.api };
}

const r0 = rig();
const games = r0.bozoNormalizeNflSchedule(csv, 2026);
const byId = id => games.find(g => g.nflverseGameId === id);
const tbDal = byId('2026_05_TB_DAL'), ariNyg = byId('2026_04_ARI_NYG'), atlNo = byId('2026_04_ATL_NO');
const phiJax = byId('2026_05_PHI_JAX');
// The doc was fetched well after every final in the fixture.
const doc = { sport: 'nfl', season: 2026, fetchedAt: '2026-10-09T23:00:00.000Z', games };
const leg = (x) => ({ sport: 'nfl', game: 'TB @ DAL', startsAt: tbDal.startsAt, canonicalKey: tbDal.canonicalKey, ...x });

test('normalizer copies the exact nflverse betting columns for real rows', () => {
  assert.equal(games.length, 5);
  assert.deepEqual({ ...tbDal.nflverseLines }, { spreadLine: 9.5, homeSpreadOdds: -108, awaySpreadOdds: -112,
    totalLine: 49.5, overOdds: -110, underOdds: -110, homeMoneyline: -535, awayMoneyline: 400 });
  assert.equal(tbDal.completed, true); assert.equal(tbDal.awayScore, 24); assert.equal(tbDal.homeScore, 16);
  assert.equal(tbDal.espnEventId, '401872980');
});

test('canonicalKey maps to nflverse game_id; Monday night lands on the Tuesday UTC date', () => {
  assert.equal(atlNo.startsAt, '2026-10-06T00:15:00.000Z');          // Mon 8:15pm ET
  assert.match(atlNo.canonicalKey, /^nfl\|.+~.+\|2026-10-06$/);
  const pick = { sport: 'nfl', canonicalKey: atlNo.canonicalKey, side: 'ATL', mkt: 'ml' };
  assert.equal(r0.bozoScheduleFindGame(doc, pick).nflverseGameId, '2026_04_ATL_NO');
  // Legacy picks without a canonical key still resolve through "away @ home" + kickoff.
  const legacy = { sport: 'nfl', game: 'ATL @ NO', startsAt: atlNo.startsAt, side: 'ATL', mkt: 'ml' };
  assert.equal(r0.bozoScheduleFindGame(doc, legacy).nflverseGameId, '2026_04_ATL_NO');
  assert.match(tbDal.canonicalKey, /\|2026-10-09$/);                 // Thu 8:15pm ET → Fri UTC
});

test('spread sign: spread_line is home margin; Bozo stores points GIVEN UP (2026_05_TB_DAL)', () => {
  // DAL was the -9.5 home favourite (home_moneyline -535). Bozo stores DAL -9.5 as +9.5.
  const dal = r0.bozoNflverseCloseQuote(leg({ side: 'DAL', mkt: 'spread', line: 9.5 }), tbDal, doc);
  assert.equal(dal.price, -108); assert.equal(dal.opp, -112); assert.equal(dal.line, 9.5); assert.equal(dal.bookLine, -9.5);
  const tb = r0.bozoNflverseCloseQuote(leg({ side: 'TB', mkt: 'spread', line: -9.5 }), tbDal, doc);
  assert.equal(tb.price, -112); assert.equal(tb.opp, -108); assert.equal(tb.line, -9.5); assert.equal(tb.bookLine, 9.5);
  assert.equal(r0.assertQuote(dal, leg({ side: 'DAL', mkt: 'spread', line: 9.5 })), null);
  // The same stored numbers grade correctly against the real 24–16 TB win.
  assert.equal(r0.bozoScheduledOutcome({ sport: 'nfl', side: 'DAL', mkt: 'spread', line: 9.5 }, tbDal).result, 'lost');
  assert.equal(r0.bozoScheduledOutcome({ sport: 'nfl', side: 'TB', mkt: 'spread', line: -9.5 }, tbDal).result, 'won');
  // The wrong sign is a different number, never silently accepted.
  const wrong = r0.bozoNflverseCloseQuote(leg({ side: 'DAL', mkt: 'spread', line: -9.5 }), tbDal, doc);
  assert.equal(wrong.code, 'line_differs'); assert.equal(wrong.final, true);
});

test('spread sign with an AWAY favourite (2026_04_ARI_NYG, spread_line -2.5, ARI -135)', () => {
  const p = { sport: 'nfl', game: 'ARI @ NYG', startsAt: ariNyg.startsAt, canonicalKey: ariNyg.canonicalKey, mkt: 'spread' };
  const ari = r0.bozoNflverseCloseQuote({ ...p, side: 'ARI', line: 2.5 }, ariNyg, doc);   // ARI -2.5
  assert.equal(ari.price, -110); assert.equal(ari.opp, -110); assert.equal(ari.bookLine, -2.5);
  const nyg = r0.bozoNflverseCloseQuote({ ...p, side: 'NYG', line: -2.5 }, ariNyg, doc);  // NYG +2.5
  assert.equal(nyg.bookLine, 2.5);
});

test('alternate numbers are a final, reasoned miss that names both numbers', () => {
  const alt = r0.bozoNflverseCloseQuote(leg({ side: 'DAL', mkt: 'spread', line: 7.5 }), tbDal, doc);
  assert.equal(alt.code, 'line_differs'); assert.equal(alt.final, true);
  assert.match(alt.reason, /DAL -9\.5/); assert.match(alt.reason, /DAL -7\.5/); assert.equal(alt.price, undefined);
  const t = r0.bozoNflverseCloseQuote(leg({ side: 'under', mkt: 'total', line: 48.5 }), tbDal, doc);
  assert.equal(t.code, 'line_differs'); assert.match(t.reason, /49\.5/);
});

test('moneyline and total orient to the side taken', () => {
  const dal = r0.bozoNflverseCloseQuote(leg({ side: 'DAL', mkt: 'ml' }), tbDal, doc);
  assert.deepEqual([dal.price, dal.opp, dal.line], [-535, 400, 0]);
  const tb = r0.bozoNflverseCloseQuote(leg({ side: 'TB', mkt: 'ml' }), tbDal, doc);
  assert.deepEqual([tb.price, tb.opp], [400, -535]);
  const ov = r0.bozoNflverseCloseQuote(leg({ side: 'over', mkt: 'total', line: 49.5 }), tbDal, doc);
  assert.deepEqual([ov.price, ov.opp, ov.line], [-110, -110, 49.5]);
  const lar = r0.bozoNflverseCloseQuote({ sport: 'nfl', game: 'ATL @ NO', startsAt: atlNo.startsAt, side: 'under', dir: 'under', mkt: 'total', line: 47.5 }, atlNo, doc);
  assert.deepEqual([lar.price, lar.opp], [-108, -112]);         // CSV order is under_odds,over_odds
  assert.equal(dal.provider, 'nflverse'); assert.equal(dal.book, 'unspecified');
  assert.equal(dal.providerEventId, '2026_05_TB_DAL'); assert.equal(dal.snapshotAt, doc.fetchedAt);
});

test('pregame rows are refused: not final, or the file predates kickoff', () => {
  const p = { sport: 'nfl', side: 'JAX', mkt: 'ml', startsAt: phiJax.startsAt, canonicalKey: phiJax.canonicalKey };
  const q = r0.bozoNflverseCloseQuote(p, phiJax, doc);
  assert.equal(q.code, 'nflverse_not_final'); assert.equal(q.final, false);
  const early = r0.bozoNflverseCloseQuote(leg({ side: 'DAL', mkt: 'ml' }), tbDal, { ...doc, fetchedAt: '2026-10-08T23:00:00.000Z' });
  assert.equal(early.code, 'nflverse_not_final');
  assert.equal(r0.bozoNflverseCloseQuote(leg({ side: 'DAL', mkt: 'ml' }), null, doc).code, 'event_not_matched');
});

test('props, period legs, other and CFB are untouched', () => {
  for (const p of [leg({ side: 'over', mkt: 'prop', line: 60.5 }), leg({ side: 'DAL', mkt: 'ml', period: '1h' }),
                   leg({ side: 'DAL', mkt: 'other' }), { ...leg({ side: 'DAL', mkt: 'ml' }), sport: 'cfb' }]) {
    const q = r0.bozoNflverseCloseQuote(p, tbDal, doc);
    assert.equal(q.code, 'unsupported_market'); assert.equal(q.final, true);
  }
  const start = Date.parse(tbDal.startsAt), now = start + 6 * 3600000;
  assert.equal(r0.bozoNflverseCloseEligible(leg({ side: 'DAL', mkt: 'prop' }), {}, start, now), false);
  assert.equal(r0.bozoNflverseCloseEligible(leg({ side: 'DAL', mkt: 'ml', period: '1q' }), {}, start, now), false);
});

test('eligibility: empty pair only, after kickoff, inside the window, final miss not re-read', () => {
  const p = leg({ side: 'DAL', mkt: 'ml' }), start = Date.parse(tbDal.startsAt);
  const E = (r, now) => r0.bozoNflverseCloseEligible(p, r, start, now);
  assert.equal(E({}, start + 3600000), true);
  assert.equal(E({}, start - 60000), false);                                  // before kickoff
  assert.equal(E({}, start + 11 * 86400000), false);                         // past the window
  assert.equal(E({ close: -540, closeOpp: 410 }, start + 3600000), false);   // full close is immutable
  assert.equal(E({ close: -540 }, start + 3600000), false);                  // half close: left alone
  assert.equal(E({ closeSource: 'nflverse', closeUnavailableReason: 'x' }, start + 3600000), false);
  assert.equal(E({ closeSource: 'sgo', closeUnavailableReason: 'x' }, start + 3600000), true);
});

test('mutation labels the book unspecified, the source nflverse, and keeps both receipts', () => {
  const t = { pick: leg({ side: 'DAL', mkt: 'ml' }), key: 'pat', player: 'Pat', uid: 'u_pat', season: 2026, week: 5 };
  const q = r0.bozoNflverseCloseQuote(t.pick, tbDal, doc);
  const m = r0.bozoCloseMutation(t, q, null, 'cron-time');
  for (const base of ['results/pat', 'ledger/2026-w5-pat']) {
    assert.equal(m[`${base}/close`], -535); assert.equal(m[`${base}/closeOpp`], 400);
    assert.equal(m[`${base}/closeBook`], 'unspecified'); assert.equal(m[`${base}/closeSource`], 'nflverse');
    assert.equal(m[`${base}/closeObservedAt`], doc.fetchedAt); assert.equal(m[`${base}/closeProviderEventId`], '2026_05_TB_DAL');
    assert.equal(m[`${base}/closeUnavailableReason`], null);
  }
  const miss = r0.bozoCloseMutation(t, null, 'No nflverse close: x.', 'cron-time', 'nflverse');
  assert.equal(miss['results/pat/close'], null); assert.equal(miss['results/pat/closeSource'], 'nflverse');
  // The paid providers are unchanged: DraftKings book, provider as the source.
  const dk = r0.bozoCloseMutation(t, { price: -500, opp: 380, provider: 'odds_api', snapshotAt: 's' }, null, 'c');
  assert.equal(dk['results/pat/closeBook'], 'draftkings'); assert.equal(dk['results/pat/closeSource'], 'odds_api');
  assert.equal(dk['results/pat/closeProviderEventId'], undefined);
});

test('targets: paid recovery stays throttled while the free nflverse backfill is still offered', async () => {
  const r = rig(), start = Date.parse(tbDal.startsAt), now = start + 6 * 3600000, kv = new Map();
  const picks = { a: { ...leg({ side: 'DAL', mkt: 'ml' }), eventId: '401872980' },
                  b: { ...leg({ side: 'over', mkt: 'prop', line: 60.5 }), eventId: '401872980' },
                  c: { ...leg({ side: 'TB', mkt: 'ml' }), eventId: '401872980' } };
  const league = { week: 5, season: 2026, status: 'open', picks, results: { c: { close: 400, closeOpp: -535 } } };
  Object.assign(r.ctx, { BOZO_CLOSE_LEAD_MS: 420000, BOZO_CLOSE_STALE_MS: 1200000, BOZO_CLOSE_RECOVERY_MS: 172800000,
    BOZO_CLOSE_RETRY_MS: 3600000, loadLeagues: async () => ({ main: league }), loadUsers: async () => ({}),
    playerName: k => k, memberNameAt: () => null, accountName: () => '', UID_RE: /^u_/ });
  const env = { ODDS_API_KEY: 'fixture', RL: { get: async k => kv.get(k), put: async (k, v) => kv.set(k, v) } };
  const first = await r.ctx.bozoCloseTargets(env, now);
  // The prop has no paid recovery after the stale window and no nflverse market: not a target.
  assert.deepEqual(Array.from(first).map(t => [t.key, t.oddsApi, t.nflverse]).map(x => [...x]), [['a', true, true]]);
  const second = await r.ctx.bozoCloseTargets(env, now + 300000);      // paid gate closed for an hour
  assert.deepEqual(Array.from(second).map(t => [t.key, t.oddsApi, t.nflverse]).map(x => [...x]), [['a', false, true]]);
  const noKey = await r.ctx.bozoCloseTargets({ RL: env.RL }, now);      // Odds API switched off entirely
  assert.deepEqual(Array.from(noKey).map(t => [t.key, t.oddsApi, t.nflverse]).map(x => [...x]), [['a', false, true]]);
});

test('cron: paid miss after kickoff → nflverse fills; final miss is written once; pregame waits', async () => {
  const r = rig(), start = Date.parse(tbDal.startsAt), now = start + 6 * 3600000;
  let patches = [], target;
  const base = { key: 'pat', player: 'Pat', uid: 'u_pat', lid: 'main', season: 2026, week: 5, startMs: start, oddsApi: false, nflverse: true };
  Object.assign(r.ctx, {
    bozoCloseTargets: async () => [target],
    bozoOddsApiCapture: async () => { throw Error('must not be called when oddsApi is false'); },
    bozoFetchEvents: async () => { throw Error('no live SGO after kickoff'); },
    bozoTeamRegistry: async () => r.ctx.bozoBuildTeamRegistry('nfl').aliases,
    bozoScheduleDoc: async () => doc,
    fbPatch: async (e, path, patch) => patches.push(patch), LG: l => l, cfbMarketKV: () => null,
  });
  vm.runInContext(cut('async function runBozoCloseCapture(', '/* GET /bozo/clv?') + 'this.runClose=runBozoCloseCapture;', r.ctx);
  target = { ...base, pick: { ...leg({ side: 'DAL', mkt: 'spread', line: 9.5 }) } };
  let out = await r.ctx.runClose({}, now);
  assert.equal(out.captured, 1);
  assert.equal(patches[0]['results/pat/close'], -108); assert.equal(patches[0]['ledger/2026-w5-pat/closeOpp'], -112);
  assert.equal(patches[0]['results/pat/closeSource'], 'nflverse'); assert.equal(patches[0]['results/pat/closeBook'], 'unspecified');

  patches = []; target = { ...base, pick: leg({ side: 'DAL', mkt: 'spread', line: 7.5 }) };
  out = await r.ctx.runClose({}, now);
  assert.equal(out.captured, 0);
  assert.equal(patches[0]['results/pat/close'], null);
  assert.match(patches[0]['results/pat/closeUnavailableReason'], /^No nflverse close: nflverse closing spread was DAL -9\.5/);
  const why = patches[0]['results/pat/closeUnavailableReason'];
  patches = []; target = { ...target, priorReason: why };
  await r.ctx.runClose({}, now);
  assert.equal(patches.length, 0);                                     // same reason is not rewritten

  patches = []; target = { ...base, startMs: Date.parse(phiJax.startsAt),
    pick: { sport: 'nfl', side: 'JAX', mkt: 'ml', startsAt: phiJax.startsAt, canonicalKey: phiJax.canonicalKey } };
  out = await r.ctx.runClose({}, Date.parse(phiJax.startsAt) + 3600000);
  assert.equal(out.captured, 0); assert.equal(patches.length, 0);      // not final: retry, write nothing

  patches = []; target = { ...base, nflverse: false, pick: leg({ side: 'DAL', mkt: 'ml' }) };
  out = await r.ctx.runClose({}, now);
  assert.equal(out.captured, 0); assert.equal(patches.length, 0);      // ineligible legs keep old behaviour
});

test('surfaces label nflverse closes and never as plain "closing line"', () => {
  assert.match(cut('async function bozoClv(', 'const weeks = [...new Set'), /closeLabel: r\.closeSource === BOZO_NFLVERSE_CLOSE_SOURCE/);
  assert.match(src, /const BOZO_NFLVERSE_CLOSE_LABEL = "nflverse close \(book unspecified\)";/);
  assert.match(fs.readFileSync('work/mcp-block.js', 'utf8'), /closeLabel: r\.closeSource === "nflverse" && r\.close != null \? "nflverse close \(book unspecified\)"/);
  assert.doesNotMatch(cut('/* ===================== nflverse backup close', 'function bozoScheduledOutcome('), /circa/i);
});
