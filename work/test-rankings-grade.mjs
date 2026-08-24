/* The Dog Track, Stage B — the pre-registered methodology, against hand-computed answers.
 *
 * Run: node work/test-rankings-grade.mjs
 *
 * ⚠️ WHY THE NUMBERS BELOW ARE WRITTEN OUT LONGHAND.
 * Spec §3 is PRE-REGISTERED: it publishes on the page before Week 1 and grades rows that
 * are immutable afterwards. A metric that is subtly wrong does not announce itself — it
 * produces plausible correlations forever. So the fixtures here are small enough to work
 * by hand, and the expected values are derived in the comments rather than captured from a
 * previous run. A test that asserts "whatever it did last time" would have locked in the
 * bug it was written to catch.
 *
 * Worked example used throughout (no ties, so both metrics are checkable by hand):
 *     service ranks a = [1, 2, 3, 4]
 *     actual  ranks b = [2, 1, 4, 3]
 *   Spearman: d = [-1, +1, -1, +1], Σd² = 4, n = 4
 *             ρ = 1 − 6(4) / (4·15) = 1 − 24/60 = 0.6
 *   Weighted τ with w(r) = 1/(r+1) on the ACTUAL rank, additive pair weights:
 *             pairs → −5/6, +8/15, +7/12, +7/10, +3/4, −9/20
 *             numerator 77/60, denominator 231/60  →  τ = 77/231 = 1/3
 *
 * ⚠️ Every player name here is invented (engagement rule 2).
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createContext, runInContext } from "vm";
import { webcrypto } from "crypto";

const WORK = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(WORK, "rankings-block.js"), "utf8")
  + "\n" + readFileSync(resolve(WORK, "rankings-grade.js"), "utf8");

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Math.abs(a - b) < eps;

/* ------------------------------------------------------------------ RTDB stub ----- */
function makeDb() {
  const tree = {}; const etags = new Map(); let seq = 0;
  const parts = p => String(p).split("/").filter(Boolean);
  const read = p => { let n = tree; for (const k of parts(p)) { if (n == null || typeof n !== "object") return null; n = n[k]; } return n === undefined ? null : n; };
  const write = (p, v) => { const ks = parts(p); let n = tree; for (const k of ks.slice(0, -1)) { if (typeof n[k] !== "object" || n[k] === null) n[k] = {}; n = n[k]; } n[ks[ks.length - 1]] = v; };
  const etagOf = p => etags.get(p) || 'W/"null"';
  return {
    tree, read,
    async fbGet(env, path, withEtag) { const d = read(path); return { data: d === null ? null : structuredClone(d), etag: withEtag ? etagOf(path) : null }; },
    async fbPut(env, path, value, etag) { if (etag !== undefined && etag !== null && etag !== etagOf(path)) return false; write(path, structuredClone(value)); etags.set(path, 'W/"' + (++seq) + '"'); return true; },
    async fbPost(env, path, value) { const id = "-ev" + (++seq); const cur = read(path) || {}; cur[id] = structuredClone(value); write(path, cur); return id; },
    async fbPatch() { throw new Error("unused"); },
  };
}

function makeCtx({ stats, slim, schedule } = {}) {
  const db = makeDb();
  async function fetchStub(url) {
    const u = String(url);
    if (u.includes("nfl-schedule.json")) {
      return schedule ? { ok: true, json: async () => schedule } : { ok: false, status: 502 };
    }
    if (u.includes("api.sleeper.app/v1/stats")) {
      return stats ? { ok: true, json: async () => stats } : { ok: false, status: 502 };
    }
    if (u.includes("api.sleeper.app/v1/players")) {
      return slim ? { ok: true, json: async () => slim.raw } : { ok: false, status: 502 };
    }
    if (u.includes("site.api.espn.com")) return { ok: false, status: 403 };
    return { ok: false, status: 404 };
  }
  const sandbox = {
    console, fetch: fetchStub, Response, URL, TextEncoder, crypto: webcrypto,
    FETCH_SHAPES: [{ name: "bare", headers: {} }],
    SLEEPER_SLIM_KEY: "sleeper:players:slim",
    SLEEPER_PLAYERS_URL: "https://api.sleeper.app/v1/players/nfl",
    sleeperSlimFromRaw: raw => ({ players: raw, count: Object.keys(raw).length }),
    json: (obj, status, cors) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } }),
    sha256hex: async str => {
      const buf = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    },
    fbGet: (...a) => db.fbGet(...a), fbPut: (...a) => db.fbPut(...a),
    fbPost: (...a) => db.fbPost(...a), fbPatch: (...a) => db.fbPatch(...a),
  };
  const ctx = createContext(sandbox);
  runInContext(SRC, ctx, { filename: "rankings.js" });
  return { ctx, db };
}

const KEY = "test-admin-key-0123456789abcdef";
const ENV = { RANKINGS_ADMIN_KEY: KEY, RL: null };
function req(method, { body, key } = {}) {
  return { method, headers: { get: h => (String(h).toLowerCase() === "x-dd-admin" ? (key === undefined ? null : key) : null) }, text: async () => JSON.stringify(body || {}) };
}
async function call(ctx, method, path, opts = {}) {
  const url = new URL("https://toto.example" + path);
  const res = await ctx.handleRankings(req(method, opts), url, opts.env || ENV, {});
  const text = await res.text();
  let obj = null; try { obj = JSON.parse(text); } catch (e) {}
  return { status: res.status, body: obj, text };
}

/* ================================================================== the math ====== */
async function main() {
  const { ctx } = makeCtx({});
  /* ⚠️ A vm context exposes function DECLARATIONS as properties but not `const` bindings,
   * so `ctx.rankingsSpearman` is undefined while `ctx.rankingsMidRanks` works. Rather than
   * reshape the source to suit the test, resolve every name by evaluating it in the
   * context — which also means the test reads the real binding, not a copy. */
  const M = new Proxy({}, { get: (_, k) => (typeof k === "string" ? runInContext(k, ctx) : undefined) });

  /* ---- mid-ranks (§3: "mid-ranks for ties") ---- */
  {
    // points [10,20,20,5] → 20s tie for 1st and 2nd → both 1.5; 10 → 3rd; 5 → 4th
    const r = M.rankingsMidRanks([10, 20, 20, 5]);
    ok(r[1] === 1.5 && r[2] === 1.5, "tied scores share the mid-rank");
    ok(r[0] === 3, "the tie CONSUMES both positions — the next player is 3rd, not 2nd");
    ok(r[3] === 4, "the last player ranks 4th");
    const three = M.rankingsMidRanks([7, 7, 7]);
    ok(three.every(v => v === 2), "a three-way tie is (1+2+3)/3 = 2 for all of them");
  }

  /* ---- Spearman ---- */
  {
    ok(near(M.rankingsSpearman([1, 2, 3, 4], [1, 2, 3, 4]), 1), "perfect agreement is ρ = 1");
    ok(near(M.rankingsSpearman([1, 2, 3, 4], [4, 3, 2, 1]), -1), "perfect inversion is ρ = −1");
    ok(near(M.rankingsSpearman([1, 2, 3, 4], [2, 1, 4, 3]), 0.6, 1e-12),
      "the worked example gives exactly 0.6", M.rankingsSpearman([1, 2, 3, 4], [2, 1, 4, 3]));
    ok(M.rankingsSpearman([1, 1, 1], [1, 2, 3]) === null, "a constant vector has no correlation, and says so rather than returning 0");
    // with ties present the shortcut formula is wrong; Pearson-on-mid-ranks is not
    const tied = M.rankingsSpearman([1, 2.5, 2.5, 4], [1, 2, 3, 4]);
    ok(tied !== null && tied > 0.9 && tied < 1, "mid-ranked input still correlates, just below 1");
  }

  /* ---- weighted Kendall τ ---- */
  {
    ok(near(M.rankingsWeightedTau([1, 2, 3, 4], [1, 2, 3, 4]), 1), "perfect agreement is τ = 1");
    ok(near(M.rankingsWeightedTau([1, 2, 3, 4], [4, 3, 2, 1]), -1), "perfect inversion is τ = −1");
    ok(near(M.rankingsWeightedTau([1, 2, 3, 4], [2, 1, 4, 3]), 1 / 3, 1e-12),
      "the worked example gives exactly 77/231 = 1/3", M.rankingsWeightedTau([1, 2, 3, 4], [2, 1, 4, 3]));

    /* THE POINT OF WEIGHTING: an error at the top must cost more than the same error at the
     * bottom. Swap the actual top two vs. swap the actual bottom two, same service list. */
    const topSwap = M.rankingsWeightedTau([1, 2, 3, 4], [2, 1, 3, 4]);
    const botSwap = M.rankingsWeightedTau([1, 2, 3, 4], [1, 2, 4, 3]);
    ok(topSwap < botSwap, "a miss at the top of the actual finish costs more than the same miss at the bottom",
      `top=${topSwap} bottom=${botSwap}`);

    /* ⚠️ THIS FIXTURE PINS WHICH RANK THE WEIGHTS COME FROM, and it has to be built
     * deliberately: when the service vector and the actual vector are both permutations of
     * 1..n, weighting by either one keeps landing on the SAME number, so the obvious
     * fixtures cannot tell a spec-compliant implementation from one that weights by the
     * service's own rank. Found by mutation testing — the wrong-source mutant passed a
     * suite that already had eight τ assertions in it.
     *   service a = [1, 2, 10, 3]   (10 is an imputed tail slot, so a is NOT a permutation)
     *   actual  b = [1, 2, 3, 4]
     * One discordant pair, (P2, P3). Weighted on ACTUAL rank:
     *   concordant 5/6 + 3/4 + 7/10 + 7/12 + 8/15, discordant −9/20
     *   → (50 + 45 + 42 + 35 + 32 − 27)/60 = 177/60 over 231/60 = 59/77
     * Weighting on the service rank instead gives ≈0.8064, which this catches. */
    ok(near(M.rankingsWeightedTau([1, 2, 10, 3], [1, 2, 3, 4]), 59 / 77, 1e-12),
      "τ weights come from the ACTUAL finish rank, not the service's own rank",
      M.rankingsWeightedTau([1, 2, 10, 3], [1, 2, 3, 4]));
  }

  /* ---- the pre-registered constants themselves ----
   * §3 publishes these numbers on the page before Week 1. They are the methodology, not
   * tuning knobs, so they get asserted directly rather than only implicitly through
   * behaviour — a silent edit to any of them is an unannounced amendment. */
  {
    ok(M.RANKINGS_DEPTHS.RB === 36 && M.RANKINGS_DEPTHS.WR === 48 && M.RANKINGS_DEPTHS.QB === 24 && M.RANKINGS_DEPTHS.TE === 24,
      "pool depths are RB 36 / WR 48 / QB 24 / TE 24");
    ok(M.RANKINGS_G.RB === 12 && M.RANKINGS_G.WR === 12 && M.RANKINGS_G.QB === 6 && M.RANKINGS_G.TE === 6,
      "capture-rate group sizes are RB 12 / WR 12 / QB 6 / TE 6");
    ok(M.RANKINGS_STARTABLE.RB === 24 && M.RANKINGS_STARTABLE.WR === 24 && M.RANKINGS_STARTABLE.QB === 12 && M.RANKINGS_STARTABLE.TE === 12,
      "the hygiene startable window is top 24 RB/WR, top 12 QB/TE");
    ok(M.RANKINGS_BOOTSTRAP_DRAWS === 2000, "the bootstrap draws 2,000 resamples");
    ok(M.RANKINGS_SHRINK_K === 0.7, "the pre-Week-10 shrinkage constant is 0.7");
    ok(M.RANKINGS_EB_FROM_WEEK === 10, "empirical Bayes starts at Week 10");
    ok(M.RANKINGS_MIN_WEEKS === 4, "fewer than 4 weeks is provisional, and too few for a head-to-head call");
  }

  /* ---- capture rate ---- */
  {
    // G = 2. Service ranks A=1, B=2, C=3. Points A=10, B=5, C=20.
    // service top-2 = A+B = 15; actual top-2 = C+A = 30; 15/30 = 50%
    const pts = { A: 10, B: 5, C: 20 };
    const ranked = [{ key: "A", rank: 1 }, { key: "B", rank: 2 }, { key: "C", rank: 3 }];
    const pool = [{ key: "A", points: 10 }, { key: "B", points: 5 }, { key: "C", points: 20 }];
    ok(near(M.rankingsCaptureRate(ranked, k => pts[k], pool, 2), 50), "capture rate is 15/30 = 50%");
    const perfect = [{ key: "C", rank: 1 }, { key: "A", rank: 2 }, { key: "B", rank: 3 }];
    ok(near(M.rankingsCaptureRate(perfect, k => pts[k], pool, 2), 100), "naming the actual top group is 100%");
    ok(M.rankingsCaptureRate(ranked, () => 0, [{ key: "A", points: 0 }], 2) === null,
      "a week where the actual top group scored nothing yields null, not a divide-by-zero");

    /* G must actually bite, or the pre-registered group size is untested. 13 players, the
     * service ranks them in exactly the wrong order (its rank 1 is the worst scorer):
     *   points(Pi) = 86 + i, service rank(Pi) = i
     *   service top-12 = P1..P12  → 87..98 → (87+98)·12/2 = 1110
     *   actual  top-12 = P2..P13  → 88..99 → (88+99)·12/2 = 1122
     *   capture = 1110/1122 = 98.9305%
     * At G = 11 this is 1012/1034 instead, so an off-by-one in RANKINGS_G is visible. */
    const many = Array.from({ length: 13 }, (_, i) => ({ key: `P${i + 1}`, rank: i + 1, points: 86 + (i + 1) }));
    const manyPts = Object.fromEntries(many.map(p => [p.key, p.points]));
    ok(near(M.rankingsCaptureRate(many.map(p => ({ key: p.key, rank: p.rank })), k => manyPts[k],
      many.map(p => ({ key: p.key, points: p.points })), M.RANKINGS_G.RB), 1110 / 1122 * 100, 1e-9),
      "capture rate uses the pre-registered G = 12 at RB");
  }

  /* ---- imputation (§3 + interpretation I1) ---- */
  {
    // entrant ranked X=1 only (deepest = 1); Y, Z, W unranked with consensus Y=5, Z=2, W=9
    // → consensus order Z, Y, W → slots 2, 3, 4
    const pool = ["X", "Y", "Z", "W"];
    const v = M.rankingsEntrantRanks(pool, { X: 1 }, { X: 1, Y: 5, Z: 2, W: 9 });
    ok(v[0] === 1, "a ranked player keeps the rank the service gave him");
    ok(v[2] === 2 && v[1] === 3 && v[3] === 4,
      "unranked players slot at deepest+1 onward, ordered by consensus (I1)", JSON.stringify(v));
    const none = M.rankingsEntrantRanks(["A", "B"], {}, { A: 2, B: 1 });
    ok(none[1] === 1 && none[0] === 2, "with nothing ranked, consensus order decides the whole vector");
  }

  /* ---- bootstrap ---- */
  {
    const weekly = [0.6, 0.5, 0.7, 0.65, 0.55];
    const a = M.rankingsBootstrapCI(weekly, "2026|ALL|ETR");
    const b = M.rankingsBootstrapCI(weekly, "2026|ALL|ETR");
    ok(a && near(a[0], b[0]) && near(a[1], b[1]),
      "the CI is SEEDED — the same week set rebuilds to the identical interval");
    /* Asserted at the PRNG rather than at the interval: with five weekly values the
     * resample distribution is coarse enough that two seeds can legitimately land on the
     * same 2.5/97.5 percentiles, so comparing intervals would be a flaky test of a
     * property that is not actually guaranteed. */
    const s1 = M.rankingsPrng(M.rankingsSeedFrom("2026|ALL|ETR"));
    const s2 = M.rankingsPrng(M.rankingsSeedFrom("2026|ALL|PFF"));
    ok(s1() !== s2(), "a different entrant seeds a different draw sequence");
    ok(a[0] < 0.6 && a[1] > 0.6, "the interval brackets the sample mean");
    ok(M.rankingsBootstrapCI([0.6], "x") === null,
      "one week produces NO interval — a zero-width CI implying certainty is trap #11");
  }

  /* ---- shrinkage ---- */
  {
    const early = M.rankingsShrinkWeights({ A: [0.6, 0.5], B: [0.4, 0.3] }, 5);
    ok(early.mode === "fixed-0.7" && early.weightFor(2) === 0.7, "before Week 10 the declared flat 0.7 applies");
    const late = M.rankingsShrinkWeights({ A: [0.6, 0.62, 0.61, 0.59], B: [0.4, 0.38, 0.41, 0.39] }, 11);
    ok(late.mode === "empirical-bayes", "from Week 10 the empirical-Bayes weight is used");
    ok(late.weightFor(4) > 0.9, "a field that is genuinely separated shrinks very little", late.weightFor(4));
    const noisy = M.rankingsShrinkWeights({ A: [0.9, 0.1, 0.8, 0.2], B: [0.85, 0.15, 0.75, 0.25] }, 11);
    ok(noisy.weightFor(4) < 0.5, "a field that is all week-to-week noise shrinks hard toward the mean", noisy.weightFor(4));
  }

  /* ---- percentiles and letter grades ---- */
  {
    ok(M.rankingsLetter(95) === "A" && M.rankingsLetter(90) === "A", "≥90 is an A");
    ok(M.rankingsLetter(89.9) === "A−" && M.rankingsLetter(80) === "A−", "80–89.9 is an A−");
    ok(M.rankingsLetter(39.9) === "C", "below 40 is a C");
    ok(M.rankingsPercentile(0.7, [0.5, 0.6, 0.7, 0.8]) === 62.5, "percentile counts below plus half the ties");
    ok(M.rankingsPercentile(0.7, []) === null, "no field means no percentile");
  }

  /* ---- normalization is still the ONE shared spec ---- */
  {
    ok(M.rankingsNormName("Kenneth Walker III") === "kenneth walker", "§8.5 normalization is shared with Stage A");
  }

  /* ============================================================ matching ========== */
  {
    const slim = { p1: ["Rusty Kettleman", "RB", "ATL"], p2: ["Barnaby Pinwheel", "WR", "BUF"], p3: ["Rusty Kettleman", "WR", "KC"] };
    const index = M.rankingsPlayerIndex(slim);
    const m1 = M.rankingsMatchRow({ name: "Rusty Kettleman", team: "ATL", pos: "RB" }, index, {});
    ok(m1.id === "p1" && m1.via === "exact", "exact match on normalized name + team + pos");
    const m2 = M.rankingsMatchRow({ name: "Rusty  Kettleman Jr.", team: "ATL", pos: "RB" }, index, {});
    ok(m2.id === "p1", "normalization is applied before matching");
    const traded = M.rankingsMatchRow({ name: "Barnaby Pinwheel", team: "NYJ", pos: "WR" }, index, {});
    ok(traded.id === null && traded.suggestion === "p2",
      "a team mismatch does NOT auto-match — it is offered as a suggestion (trap #1)");
    const viaAlias = M.rankingsMatchRow({ name: "Barnaby Pinwheel", team: "NYJ", pos: "WR" }, index,
      { "barnaby pinwheel|WR": "p2" });
    ok(viaAlias.id === "p2" && viaAlias.via === "alias", "the alias map resolves it once the admin adds it");
    const ambiguous = M.rankingsMatchRow({ name: "Rusty Kettleman", team: "SEA", pos: "WR" }, index, {});
    ok(ambiguous.id === null, "an unresolvable name fails loudly rather than guessing");
    ok(M.rankingsMatchRow({ name: "Nobody Atall", team: "GB", pos: "TE" }, index, {}).suggestion === null,
      "a name with no candidate offers no suggestion");
  }

  /* ---- did-not-play vs. played-and-scored-zero ---- */
  {
    ok(M.rankingsPlayed({ gp: 1, pts_ppr: 0 }) === true, "a player who suited up and scored 0 DID play");
    ok(M.rankingsPlayed({ gp: 0 }) === false, "gp 0 is a did-not-play");
    ok(M.rankingsPlayed(undefined) === false, "no stats row at all is a did-not-play");
    ok(M.rankingsPprOf({ pts_ppr: 12.4 }) === 12.4 && M.rankingsPprOf(undefined) === 0, "PPR points read straight from the source");
  }

  /* ==================================================== the weekly grade ========== */
  {
    /* A tiny world: 3 players per position, so the pool and every metric stay checkable.
     * ETR ranks them right; ESPN ranks them backwards. */
    const slim = {};
    const stats = {};
    const rows = {};
    const POS = ["RB", "WR", "QB", "TE"];
    POS.forEach((pos, pi) => {
      ["Alpha", "Bravo", "Charlie"].forEach((nm, i) => {
        const id = `${pos}${i}`;
        slim[id] = [`${nm} ${pos}man`, pos, "ATL"];
        stats[id] = { gp: 1, pts_ppr: 30 - i * 10 };        // Alpha 30, Bravo 20, Charlie 10
      });
      rows[pos] = [0, 1, 2].map(i => ({ pos, rank: i + 1, name: `${["Alpha", "Bravo", "Charlie"][i]} ${pos}man`, team: "ATL" }));
    });
    const flat = POS.flatMap(p => rows[p]);
    const reversed = flat.map(r => ({ ...r, rank: 4 - r.rank }));

    const { ctx: c2 } = makeCtx({});
    const index = c2.rankingsPlayerIndex(slim); index.slim = slim;
    const out = c2.rankingsGradeWeek({
      captures: { ETR: { rows: flat }, ESPN: { rows: reversed } },
      entrants: { ETR: { type: "service", first_week: 1 }, ESPN: { type: "service", first_week: 1 } },
      stats, index, aliases: {}, blendMembers: ["ETR", "ESPN"],
    });

    ok(out.unmatched.length === 0, "every fixture row matched", JSON.stringify(out.unmatched.slice(0, 2)));
    ok(near(out.positions.RB.entrants.ETR.rho, 1), "the entrant who ranked them correctly scores ρ = 1");
    ok(near(out.positions.RB.entrants.ESPN.rho, -1), "the entrant who ranked them backwards scores ρ = −1");
    ok(near(out.positions.RB.entrants.ETR.capture, 100), "the correct entrant captures 100% of the pot");
    ok(out.positions.RB.entrants.BLEND !== undefined, "BLEND is graded as an entrant without a snapshot of its own");
    ok(out.positions.RB.entrants.ETR.hygiene === null,
      "hygiene is null, not 0 — the Thursday OUT list is not captured yet (gap G1)");
    ok(out.positions.QB.pool_size === 3, "the pool is the union of consensus and actual, minus inactives");

    ok(near(out.positions.RB.entrants.ESPN.capture, 100),
      "with fewer players than G, every list captures the whole pot — G cannot bite here");

    /* inactives leave the correlation pool; a played-but-zero player stays in it */
    const statsOut = { ...stats, RB1: { gp: 0 } };
    const out2 = c2.rankingsGradeWeek({
      captures: { ETR: { rows: flat } },
      entrants: { ETR: { type: "service", first_week: 1 } },
      stats: statsOut, index, aliases: {}, blendMembers: ["ETR"],
    });
    ok(out2.positions.RB.pool_size === 2, "a player who did not play is removed from the pool");
    const statsZero = { ...stats, RB1: { gp: 1, pts_ppr: 0 } };
    const out3 = c2.rankingsGradeWeek({
      captures: { ETR: { rows: flat } },
      entrants: { ETR: { type: "service", first_week: 1 } },
      stats: statsZero, index, aliases: {}, blendMembers: ["ETR"],
    });
    ok(out3.positions.RB.pool_size === 3, "a player who played and scored zero STAYS — that is a real ranking miss");
    ok(out3.positions.RB.entrants.ETR.rho < 1, "and it costs the entrant who ranked him 2nd");
  }

  /* ========================================================== the routes ========== */
  {
    const slim = {}; const stats = {}; const rows = [];
    for (const pos of ["RB", "WR", "QB", "TE"]) {
      const depth = { RB: 36, WR: 48, QB: 24, TE: 24 }[pos];
      for (let i = 1; i <= depth; i++) {
        const id = `${pos}_${i}`;
        const name = `Fixture ${pos}${i} Wobblesworth`;
        slim[id] = [name, pos, "ATL"];
        stats[id] = { gp: 1, pts_ppr: 200 - i };
        rows.push({ pos, rank: i, name, team: "ATL" });
      }
    }
    const csv = rows.map(r => `${r.pos},${r.rank},${r.name},${r.team}`).join("\n");
    const FUTURE = { data: { season: 2026, games: [{ season: 2026, week: 1, kickoff_at: "2099-09-10T00:20:00Z" }] } };

    const { ctx, db } = makeCtx({ stats, slim: { raw: slim }, schedule: FUTURE });
    for (const id of ["ETR", "PFF"]) {
      await call(ctx, "POST", "/rankings/entrants", { key: KEY, body: { id, name: id, type: "service", first_week: 1 } });
      await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: id, csv } });
    }

    const g = await call(ctx, "POST", "/rankings/grade", { key: KEY, body: { season: 2026, week: 1 } });
    ok(g.status === 200 && g.body.ok, "the grade run succeeds", g.text.slice(0, 200));
    ok(g.body.stats_source === "sleeper", "Sleeper is the primary stats source");
    ok(g.body.excluded_unmatched === 0, "no fixture row went unmatched");
    ok(db.read("/rankings/graded/2026/1") !== null, "the graded row is written");
    ok(db.read("/rankings/blend/2026").members.join(",") === "ETR,PFF", "BLEND membership is frozen from the pre-Week-1 service entrants");

    const again = await call(ctx, "POST", "/rankings/grade", { key: KEY, body: { season: 2026, week: 1 } });
    ok(again.status === 409, "re-grading an already-graded week is REFUSED");

    const dry = await call(ctx, "POST", "/rankings/grade", { key: KEY, body: { season: 2026, week: 1, dry_run: true } });
    ok(dry.status === 200 && dry.body.dry_run === true, "a dry run recomputes without writing");

    /* THE PRIVACY GATE: the public doc must not contain a single fixture player name. */
    const pub = await call(ctx, "GET", "/rankings/grades?season=2026", {});
    ok(pub.status === 200, "the grades route is PUBLIC — no admin header needed");
    ok(pub.body.weeks_graded === 1, "the public doc reports one graded week");
    const names = rows.map(r => r.name);
    const leaked = names.filter(n => pub.text.includes(n));
    ok(leaked.length === 0, "ZERO player names in the public doc", leaked.slice(0, 3).join(", "));
    ok(!/"rows"/.test(pub.text), "no rows array reaches the public doc");
    ok(pub.body.scopes.ALL.ETR !== undefined && pub.body.scopes.RB.ETR !== undefined, "ALL and per-position scopes both publish");
    ok(pub.body.scopes.ALL.ETR.provisional === true, "one graded week is flagged provisional (< 4 weeks)");
    ok(pub.body.scopes.ALL.ETR.ci === null, "a single week publishes NO confidence interval");
    ok(pub.body.hygiene_tracked === false, "the doc states plainly that hygiene is not tracked yet");
    ok(pub.body.entrants.ETR.color !== undefined, "entrant identity travels with the doc so the page can render N entrants");

    /* the review list is admin-only and DOES carry names — that is how aliases get added */
    ok(Array.isArray(g.body.unmatched), "the admin grade response carries a review list");

    const alias = await call(ctx, "POST", "/rankings/aliases", { key: KEY, body: { key: "somebody else|WR", player_id: "WR_3" } });
    ok(alias.status === 200 && alias.body.added === 1, "an alias can be added from the review list");
    const conflict = await call(ctx, "POST", "/rankings/aliases", { key: KEY, body: { key: "somebody else|WR", player_id: "WR_9" } });
    ok(conflict.body.conflicts.length === 1 && conflict.body.added === 0,
      "re-pointing an existing alias is refused — earlier weeks were graded against it");
    ok((await call(ctx, "POST", "/rankings/aliases", { body: { key: "x|WR", player_id: "y" } })).status === 403,
      "the alias route is admin-only");
  }

  /* an empty season answers honestly rather than 404ing the page */
  {
    const { ctx } = makeCtx({});
    const pub = await call(ctx, "GET", "/rankings/grades?season=2026", {});
    ok(pub.status === 200 && pub.body.empty === true && pub.body.weeks_graded === 0,
      "before Week 1 the public route returns an honest empty state");
    ok((await call(ctx, "GET", "/rankings/grades?season=0", {})).status === 404, "the sandbox season is never published");
  }

  /* a grade run with no usable stats refuses rather than inventing a week */
  {
    const { ctx } = makeCtx({ stats: null, slim: { raw: { p: ["A B", "RB", "ATL"] } }, schedule: null });
    await call(ctx, "POST", "/rankings/entrants", { key: KEY, body: { id: "ETR", name: "ETR", type: "service", first_week: 1 } });
    const g = await call(ctx, "POST", "/rankings/grade", { key: KEY, body: { season: 2026, week: 1 } });
    ok(g.status === 400 || g.status === 502, "with no snapshots or no stats the run refuses", String(g.status));
  }

  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
