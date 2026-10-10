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
    'this.api={bozoNormalizeNflSchedule,bozoNflverseCloseQuote,bozoNflverseCloseEligible,bozoCloseMutation,bozoScheduleFindGame,bozoScheduledOutcome,bozoCloseTargets,assertQuote,bozoNflverseLineRef,bozoNflverseLedgerPlan,bozoNflverseLedgerPeriod,runBozoNflverseLedgerBackfill};',
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
  patches = []; target = { ...target, priorReason: why, priorLineRef: 9.5 };   // points-vs-close already written too
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

/* ---------------- points vs the nflverse main close ---------------- */
const pts = (p, g = tbDal) => r0.bozoNflverseLineRef(p, g, doc);

test('points vs close: spread sign for HOME and AWAY legs (positive = better number)', () => {
  // Close: DAL -9.5 (stored 9.5), TB +9.5 (stored -9.5).
  assert.equal(pts(leg({ side: 'DAL', mkt: 'spread', line: 7.5 })).closePointsVsClose, 2);    // DAL -7.5: better
  assert.equal(pts(leg({ side: 'DAL', mkt: 'spread', line: 10.5 })).closePointsVsClose, -1);  // DAL -10.5: worse
  assert.equal(pts(leg({ side: 'TB', mkt: 'spread', line: -10.5 })).closePointsVsClose, 1);   // TB +10.5: better
  assert.equal(pts(leg({ side: 'TB', mkt: 'spread', line: -8.5 })).closePointsVsClose, -1);   // TB +8.5: worse
  const home = pts(leg({ side: 'DAL', mkt: 'spread', line: 7.5 }));
  assert.equal(home.closeLineRef, 9.5); assert.equal(home.closeLineRefSource, 'nflverse');
  assert.equal(home.closeLineRefObservedAt, doc.fetchedAt); assert.equal(home.closeLineRefEventId, '2026_05_TB_DAL');
  assert.equal(pts(leg({ side: 'TB', mkt: 'spread', line: -10.5 })).closeLineRef, -9.5);
  // Away favourite (ARI -2.5 close): ARI -1.5 is better by 1, NYG +1.5 is worse by 1.
  const a = { sport: 'nfl', game: 'ARI @ NYG', startsAt: ariNyg.startsAt, canonicalKey: ariNyg.canonicalKey, mkt: 'spread' };
  assert.equal(pts({ ...a, side: 'ARI', line: 1.5 }, ariNyg).closePointsVsClose, 1);
  assert.equal(pts({ ...a, side: 'NYG', line: -1.5 }, ariNyg).closePointsVsClose, -1);
  assert.equal(pts(leg({ side: 'DAL', mkt: 'spread', line: 9.5 })).closePointsVsClose, 0);    // main number
});

test('points vs close: OVER and UNDER signs; ml, props, periods and pregame rows get none', () => {
  assert.equal(pts(leg({ side: 'over', mkt: 'total', line: 47.5 })).closePointsVsClose, 2);
  assert.equal(pts(leg({ side: 'over', mkt: 'total', line: 50.5 })).closePointsVsClose, -1);
  assert.equal(pts(leg({ side: 'under', mkt: 'total', line: 51.5 })).closePointsVsClose, 2);
  assert.equal(pts(leg({ side: 'under', mkt: 'total', line: 48.5 })).closePointsVsClose, -1);
  assert.equal(pts(leg({ side: 'over', dir: 'over', mkt: 'total', line: 47.5 })).closeLineRef, 49.5);
  assert.equal(pts(leg({ side: 'DAL', mkt: 'ml' })), null);
  assert.equal(pts(leg({ side: 'over', mkt: 'prop', line: 60.5 })), null);
  assert.equal(pts(leg({ side: 'DAL', mkt: 'spread', line: 4.5, period: '1h' })), null);
  assert.equal(pts({ sport: 'nfl', side: 'JAX', mkt: 'spread', line: 5.5, startsAt: phiJax.startsAt }, phiJax), null);
  assert.equal(r0.bozoNflverseLineRef(leg({ side: 'DAL', mkt: 'spread', line: 7.5 }), tbDal, { ...doc, fetchedAt: '2026-10-08T00:00:00Z' }), null);
});

function closeRig() {
  const r = rig();
  let patches = [];
  Object.assign(r.ctx, {
    bozoOddsApiCapture: async () => { throw Error('must not be called when oddsApi is false'); },
    bozoFetchEvents: async () => { throw Error('no live SGO after kickoff'); },
    bozoTeamRegistry: async () => r.ctx.bozoBuildTeamRegistry('nfl').aliases,
    bozoScheduleDoc: async () => doc, LG: l => l, cfbMarketKV: () => null,
    fbPatch: async (e, path, patch) => patches.push([path, patch]),
  });
  vm.runInContext(cut('async function runBozoCloseCapture(', '/* GET /bozo/clv?') + 'this.runClose=runBozoCloseCapture;', r.ctx);
  return { r, get patches() { return patches; }, reset() { patches = []; } };
}

test('cron: alternate spread keeps price null with its reason and writes points-vs-close separately, once', async () => {
  const c = closeRig(), start = Date.parse(tbDal.startsAt), now = start + 6 * 3600000;
  const base = { key: 'pat', player: 'Pat', uid: 'u_pat', lid: 'main', season: 2026, week: 5, startMs: start, oddsApi: false, nflverse: true };
  let target = { ...base, pick: leg({ side: 'DAL', mkt: 'spread', line: 7.5 }) };
  c.r.ctx.bozoCloseTargets = async () => [target];
  await c.r.ctx.runClose({}, now);
  const p = c.patches[0][1];
  for (const b of ['results/pat', 'ledger/2026-w5-pat']) {
    assert.equal(p[`${b}/close`], null); assert.equal(p[`${b}/closeOpp`], null);
    assert.match(p[`${b}/closeUnavailableReason`], /No nflverse close: nflverse closing spread was DAL -9\.5/);
    assert.equal(p[`${b}/closeLineRef`], 9.5); assert.equal(p[`${b}/closePointsVsClose`], 2);
    assert.equal(p[`${b}/closeLineRefSource`], 'nflverse');
  }
  c.reset(); target = { ...target, priorReason: p['results/pat/closeUnavailableReason'], priorLineRef: 9.5 };
  await c.r.ctx.runClose({}, now);
  assert.equal(c.patches.length, 0);                                    // nothing rewritten
  c.reset(); target = { ...base, pick: leg({ side: 'DAL', mkt: 'ml' }) };
  await c.r.ctx.runClose({}, now);
  assert.equal(c.patches[0][1]['results/pat/close'], -535);
  assert.equal(c.patches[0][1]['results/pat/closeLineRef'], undefined);  // ml has no number
});

test('precedence: once nflverse wrote a full pair, paid recovery inside 48h does not target the leg', async () => {
  const r = rig(), start = Date.parse(tbDal.startsAt), now = start + 6 * 3600000, kv = new Map();
  const picks = { a: { ...leg({ side: 'DAL', mkt: 'ml' }), eventId: '401872980' } };
  const league = { week: 5, season: 2026, status: 'open', picks,
    results: { a: { close: -535, closeOpp: 400, closeSource: 'nflverse', closeBook: 'unspecified' } } };
  Object.assign(r.ctx, { BOZO_CLOSE_LEAD_MS: 420000, BOZO_CLOSE_STALE_MS: 1200000, BOZO_CLOSE_RECOVERY_MS: 172800000,
    BOZO_CLOSE_RETRY_MS: 3600000, loadLeagues: async () => ({ main: league }), loadUsers: async () => ({}),
    playerName: k => k, memberNameAt: () => null, accountName: () => '', UID_RE: /^u_/ });
  const env = { ODDS_API_KEY: 'fixture', RL: { get: async k => kv.get(k), put: async (k, v) => kv.set(k, v) } };
  assert.equal((await r.ctx.bozoCloseTargets(env, now)).length, 0);
  assert.equal(kv.size, 0);                                             // no paid credit gate even touched
});

/* ---------------- past-week ledger backfill ---------------- */
const sk = (x) => [x.eventId, x.mkt, x.side, x.mkt === 'ml' ? '' : String(x.line ?? ''), '', ...(x.period ? [x.period] : [])].join('|');
const row = (week, x) => { const r = { league: 'main', season: 2026, week, player: 'Pat', sport: 'nfl', ...x };
  r.selectionKey = x.selectionKey === undefined ? sk(r) : x.selectionKey; return r; };
const atl = { eventId: '401872979', game: 'ATL @ NO', startsAt: atlNo.startsAt, canonicalKey: atlNo.canonicalKey };
const ari = { eventId: '401872966', game: 'ARI @ NYG', startsAt: ariNyg.startsAt, canonicalKey: ariNyg.canonicalKey };
const tbd = { eventId: '401872980', game: 'TB @ DAL', startsAt: tbDal.startsAt, canonicalKey: tbDal.canonicalKey };
function ledgerLeagues() {
  return {
    main: { week: 5, season: 2026, ledger: {
      '2026-w4-a': row(4, { ...atl, mkt: 'ml', side: 'ATL' }),                         // price
      '2026-w4-b': row(4, { ...ari, mkt: 'spread', side: 'ARI', line: 1.5 }),          // alt: reason + ref
      '2026-w4-c': row(4, { ...atl, mkt: 'total', side: 'over', dir: 'over', line: 47.5 }), // exact main: price + ref 0
      '2026-w4-d': row(4, { ...atl, mkt: 'prop', side: 'over', line: 60.5, prop: 'Bijan rush yds' }),
      '2026-w4-e': row(4, { ...atl, mkt: 'ml', side: 'ATL', period: '1h' }),           // period: skipped
      '2026-w4-f': row(4, { ...atl, mkt: 'ml', side: 'ATL', selectionKey: null }),     // no key: fail closed
      '2026-w4-g': row(4, { ...atl, mkt: 'ml', side: 'ATL', close: -110, closeOpp: -110, closeSource: 'odds_api' }),
      '2026-w4-h': row(4, { ...atl, mkt: 'ml', side: 'ATL', close: -120 }),            // half: left alone
      '2025-w4-i': row(4, { ...atl, season: 2025, mkt: 'ml', side: 'ATL' }),           // other season
      '2026-w5-j': row(5, { ...tbd, mkt: 'ml', side: 'DAL' }),                         // current week: live path
    } },
    fake: { synthetic: true, week: 5, season: 2026, ledger: { '2026-w4-z': row(4, { ...atl, mkt: 'ml', side: 'ATL' }) } },
  };
}
const apply = (leagues, plan) => { for (const [lid, patch] of plan.patches) for (const [path, v] of Object.entries(patch)) {
  const [, rowKey, f] = path.split('/'); leagues[lid].ledger[rowKey][f] = v; } };
const NOW = Date.parse('2026-10-10T12:00:00Z');

test('ledger backfill: past-week rows only, write-once, no overwrites, fail-closed period', () => {
  const L = ledgerLeagues(), plan = r0.bozoNflverseLedgerPlan(L, doc, NOW);
  const keys = [...plan.patches.keys()];
  assert.deepEqual(keys, ['main']);                                     // synthetic league untouched
  const p = plan.patches.get('main'), touched = [...new Set(Object.keys(p).map(k => k.split('/')[1]))].sort();
  assert.deepEqual(touched, ['2026-w4-a', '2026-w4-b', '2026-w4-c']);
  assert.equal(p['ledger/2026-w4-a/close'], -102); assert.equal(p['ledger/2026-w4-a/closeOpp'], -118);
  assert.equal(p['ledger/2026-w4-a/closeSource'], 'nflverse'); assert.equal(p['ledger/2026-w4-a/closeBook'], 'unspecified');
  assert.equal(p['ledger/2026-w4-a/closeProviderEventId'], '2026_04_ATL_NO');
  assert.equal(p['ledger/2026-w4-b/close'], null); assert.match(p['ledger/2026-w4-b/closeUnavailableReason'], /ARI -2\.5.*ARI -1\.5/);
  assert.equal(p['ledger/2026-w4-b/closePointsVsClose'], 1); assert.equal(p['ledger/2026-w4-b/closeLineRef'], 2.5);
  assert.equal(p['ledger/2026-w4-c/close'], -112); assert.equal(p['ledger/2026-w4-c/closePointsVsClose'], 0); // main number 47.5
  assert.ok(Object.keys(p).every(k => k.startsWith('ledger/')));         // never results/ for past weeks
  assert.equal(r0.bozoNflverseLedgerPeriod({ selectionKey: '1|ml|ATL|||1h' }), '1h');
  assert.equal(r0.bozoNflverseLedgerPeriod({ selectionKey: '1|ml|ATL||', label: 'ATL 1st half ML' }), null);
  assert.equal(r0.bozoNflverseLedgerPeriod({ selectionKey: '' }), null);
});

test('ledger backfill is idempotent: applying the plan then re-planning writes nothing', () => {
  const L = ledgerLeagues();
  apply(L, r0.bozoNflverseLedgerPlan(L, doc, NOW));
  const again = r0.bozoNflverseLedgerPlan(L, doc, NOW);
  assert.equal(again.written, 0); assert.equal(again.patches.size, 0);
  assert.equal(L.main.ledger['2026-w4-g'].close, -110); assert.equal(L.main.ledger['2026-w4-g'].closeSource, 'odds_api');
  assert.equal(L.main.ledger['2026-w4-h'].close, -120); assert.equal(L.main.ledger['2026-w4-h'].closeOpp, undefined);
});

test('ledger backfill is bounded per run and converges without double writes', () => {
  const L = { main: { week: 9, season: 2026, ledger: {} } };
  for (let i = 0; i < 7; i++) L.main.ledger[`2026-w4-p${i}`] = row(4, { ...atl, mkt: 'ml', side: i % 2 ? 'NO' : 'ATL' });
  const seen = new Map(); let runs = 0, plan;
  do {
    plan = r0.bozoNflverseLedgerPlan(L, doc, NOW, { batch: 3 });
    assert.ok(plan.written <= 3);
    for (const k of Object.keys(plan.patches.get('main') || {})) { const rk = k.split('/')[1]; if (k.endsWith('/close')) seen.set(rk, (seen.get(rk) || 0) + 1); }
    apply(L, plan); runs++;
  } while (plan.written > 0 && runs < 10);
  assert.equal(runs, 4);                                                // 3 + 3 + 1, then an empty run
  assert.equal(seen.size, 7); assert.ok([...seen.values()].every(n => n === 1));
  const capped = r0.bozoNflverseLedgerPlan(ledgerLeagues(), doc, NOW, { scanMax: 2 });
  assert.equal(capped.scanned, 2); assert.equal(capped.truncated, true);
});

test('ledger runner: cadence gate, no KV, and one PATCH per league', async () => {
  const r = rig(), kv = new Map(), patches = [];
  Object.assign(r.ctx, { bozoScheduleDoc: async () => doc, loadLeagues: async () => ledgerLeagues(), LG: l => l,
    fbPatch: async (e, path, patch) => patches.push([path, patch]) });
  const env = { RL: { get: async k => kv.get(k), put: async (k, v) => kv.set(k, v) } };
  const first = await r.ctx.runBozoNflverseLedgerBackfill(env, NOW);
  assert.equal(first.written, 3); assert.equal(patches.length, 1); assert.equal(patches[0][0], 'main');
  assert.equal((await r.ctx.runBozoNflverseLedgerBackfill(env, NOW + 60000)).skipped, 'cadence');
  assert.equal((await r.ctx.runBozoNflverseLedgerBackfill({}, NOW)).skipped, 'no_kv');
  assert.equal((await r.ctx.runBozoNflverseLedgerBackfill(env, NOW + 31 * 60000)).written, 3); // stub tree is fresh each call
});

test('surfaces expose points-vs-close next to the close fields with its own label', () => {
  const clv = cut('async function bozoClv(', 'const weeks = [...new Set');
  for (const f of ['closeLineRef', 'closePointsVsClose', 'closeLineRefSource', 'closeLineRefObservedAt', 'closeLineRefLabel']) {
    assert.match(clv, new RegExp(f + ':'));
    assert.match(fs.readFileSync('work/mcp-block.js', 'utf8'), new RegExp(f + ':'));
  }
  assert.match(src, /const BOZO_NFLVERSE_LINE_REF_LABEL = "points vs nflverse main close \(book unspecified\)";/);
  assert.match(src, /ledgerBackfill = await runBozoNflverseLedgerBackfill\(/);
});

/* ---------------- manual replacement of an nflverse close ---------------- */
const fkey = 'u_pat', frow = `2026-w4-${fkey}`;
function fillRig(row) {
  const writes = [], ctx = { Request, Response, Date, Intl, crypto: require('node:crypto').webcrypto,
    readBody: r => r.json(), leagueOf: () => 'main', SEASON: 2026, LG: id => '/bozo/leagues/' + id,
    ledgerKey: (s, w, k) => `${s}-w${w}-${k}`, json: (b, status) => ({ body: b, status }),
    requireManager: async () => ({ name: 'Manager', league: { season: 2026, week: 4, picks: { [fkey]: {} } } }),
    fbGet: async () => ({ data: { week: 4, ...row } }), fbPatch: async (env, ...args) => writes.push(args) };
  vm.createContext(ctx);
  vm.runInContext(cut('async function bozoCloseFill(', '/* GET /bozo/close-gaps'), ctx);
  return { writes, save: b => ctx.bozoCloseFill(new Request('https://t/bozo/close', { method: 'POST',
    body: JSON.stringify({ league: 'main', row: frow, ...b }) }), {}, {}) };
}
const nvRow = { close: -102, closeOpp: -118, closeBook: 'unspecified', closeSource: 'nflverse',
  closeObservedAt: '2026-10-06T14:00:00.000Z', closeProviderEventId: '2026_04_ATL_NO',
  closeLineRef: 9.5, closePointsVsClose: 2, closeLineRefSource: 'nflverse' };

test('manual fill REPLACES an nflverse close once, keeps the replaced values and the line ref', async () => {
  const r = fillRig(nvRow), out = await r.save({ close: -110, closeOpp: -110, closeBook: 'FanDuel' });
  assert.equal(out.status, 200);
  const p = r.writes[0][1];
  for (const b of [`ledger/${frow}`, `results/${fkey}`]) {
    assert.equal(p[`${b}/close`], -110); assert.equal(p[`${b}/closeOpp`], -110);
    assert.equal(p[`${b}/closeSource`], 'manual'); assert.equal(p[`${b}/closeBook`], 'fanduel');
    assert.match(p[`${b}/closeObservedAt`], /^\d{4}-\d\d-\d\dT/);
    assert.equal(p[`${b}/closeProviderEventId`], null);
    const was = p[`${b}/closeReplaced`];
    assert.deepEqual({ ...was, replacedAt: 'x' }, { close: -102, closeOpp: -118, closeBook: 'unspecified',
      closeSource: 'nflverse', closeObservedAt: '2026-10-06T14:00:00.000Z', closeProviderEventId: '2026_04_ATL_NO',
      replacedAt: 'x', replacedBy: 'Manager' });
  }
  assert.ok(!Object.keys(p).some(k => /closeLineRef|closePointsVsClose/.test(k)));   // left intact
  const audit = Object.entries(p).find(([k]) => k.startsWith('audit/'))[1];
  assert.equal(audit.from.close, -102); assert.equal(audit.from.closeSource, 'nflverse'); assert.equal(audit.to.closeSource, 'manual');
  // Default book stays DraftKings when none is entered.
  const d = fillRig(nvRow); await d.save({ close: -110, closeOpp: -110 });
  assert.equal(d.writes[0][1][`ledger/${frow}/closeBook`], 'draftkings');
});

test('the manual replacement is write-once: a later fill or clear is refused with the real source', async () => {
  const replaced = { ...nvRow, close: -110, closeOpp: -110, closeSource: 'manual', closeBook: 'draftkings',
    closeObservedAt: '2026-10-07T01:30:00.000Z', closeReplaced: { close: -102, closeOpp: -118, closeSource: 'nflverse' } };
  for (const body of [{ close: -102, closeOpp: -118 }, { close: null, closeOpp: null }]) {
    const r = fillRig(replaced), out = await r.save(body);
    assert.equal(out.status, 409); assert.equal(r.writes.length, 0);
    assert.equal(out.body.error, "That leg already has a manual DraftKings close entered at Oct 6, 2026, 9:30 PM ET (it replaced the nflverse close) and can't be overwritten.");
  }
});

test('book closes stay refused exactly as before, and the message names the actual source', async () => {
  const cases = [
    [{ close: -150, closeOpp: 130, closeBook: 'draftkings', closeSource: 'odds_api', closeObservedAt: '2026-10-04T16:58:00Z' },
     "That leg already has a DraftKings close captured at Oct 4, 2026, 12:58 PM ET via The Odds API and can't be overwritten."],
    [{ close: -150, closeOpp: 130, closeBook: 'draftkings', closeSource: 'sgo', closeObservedAt: '2026-10-04T16:58:00Z' },
     "That leg already has a DraftKings close captured at Oct 4, 2026, 12:58 PM ET via SportsGameOdds and can't be overwritten."],
  ];
  for (const [row, msg] of cases) {
    const r = fillRig(row), out = await r.save({ close: -110, closeOpp: -110 });
    assert.equal(out.status, 409); assert.equal(out.body.error, msg); assert.equal(r.writes.length, 0);
    assert.equal((await fillRig(row).save({ clvPts: 1 })).status, 200);       // CLV-only still allowed
  }
});

test('an nflverse close cannot be cleared or half-replaced; CLV-only and bad book handled', async () => {
  for (const body of [{ close: null, closeOpp: null }, { close: -110 }]) {
    const r = fillRig(nvRow), out = await r.save(body);
    assert.equal(out.status, 409); assert.equal(r.writes.length, 0);
    assert.equal(out.body.error, 'That leg has an nflverse close (book unspecified) read at Oct 6, 2026, 10:00 AM ET. It can be replaced with a real two-sided book price, but not cleared.');
  }
  const c = fillRig(nvRow); assert.equal((await c.save({ clvPts: 0.5 })).status, 200);
  assert.equal(c.writes[0][1][`ledger/${frow}/close`], undefined);
  assert.equal((await fillRig(nvRow).save({ close: -110, closeOpp: -110, closeBook: '<script>' })).status, 400);
});

test('automatic sources never overwrite a manual close (live targets and ledger backfill)', async () => {
  const manual = { close: -110, closeOpp: -110, closeSource: 'manual', closeBook: 'draftkings',
    closeObservedAt: '2026-10-07T01:30:00.000Z', closeReplaced: { closeSource: 'nflverse' } };
  const start = Date.parse(tbDal.startsAt);
  assert.equal(r0.bozoNflverseCloseEligible(leg({ side: 'DAL', mkt: 'ml' }), manual, start, start + 3600000), false);
  const r = rig(), kv = new Map();
  const league = { week: 5, season: 2026, status: 'open', picks: { a: { ...leg({ side: 'DAL', mkt: 'ml' }), eventId: '401872980' } },
    results: { a: manual } };
  Object.assign(r.ctx, { BOZO_CLOSE_LEAD_MS: 420000, BOZO_CLOSE_STALE_MS: 1200000, BOZO_CLOSE_RECOVERY_MS: 172800000,
    BOZO_CLOSE_RETRY_MS: 3600000, loadLeagues: async () => ({ main: league }), loadUsers: async () => ({}),
    playerName: k => k, memberNameAt: () => null, accountName: () => '', UID_RE: /^u_/ });
  const env = { ODDS_API_KEY: 'fixture', RL: { get: async k => kv.get(k), put: async (k, v) => kv.set(k, v) } };
  assert.equal((await r.ctx.bozoCloseTargets(env, start + 3600000)).length, 0);
  const L = { main: { week: 9, season: 2026, ledger: { '2026-w4-m': row(4, { ...atl, mkt: 'ml', side: 'ATL', ...manual }) } } };
  assert.equal(r0.bozoNflverseLedgerPlan(L, doc, NOW).written, 0);
});

test('surfaces: replaced value and label exposed; gap list unlocks only nflverse closes', () => {
  const clv = cut('async function bozoClv(', 'const weeks = [...new Set');
  assert.match(clv, /closeReplaced: r\.closeReplaced \|\| null/);
  assert.match(clv, /"manual close \(replaced nflverse close\)"/);
  const mcp = fs.readFileSync('work/mcp-block.js', 'utf8');
  assert.match(mcp, /closeReplaced: r\.closeReplaced \|\| null/); assert.match(mcp, /"manual close \(replaced nflverse close\)"/);
  const gaps = cut('async function bozoCloseGaps(', 'const every =');
  assert.match(gaps, /locked: r\.closeObservedAt != null && r\.close != null && r\.closeOpp != null && r\.closeSource !== "nflverse"/);
  assert.match(gaps, /replaceable: r\.closeSource === "nflverse"/);
  assert.doesNotMatch(src, /captured at kickoff from the book/);
});
