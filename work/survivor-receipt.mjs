/* Prospective survivor receipts — capture and resolve.
 *
 *   node work/survivor-receipt.mjs capture --week 1 [--entry default] [--check]
 *   node work/survivor-receipt.mjs resolve [--check]
 *
 * Spec: claude/survivor-receipts-spec.md. This is the PUBLISHED-LEDGER implementation of
 * it — data/survivor-receipts.json, built here and committed, rather than a KV family.
 *
 * ============================================================================
 * WHY A LEDGER IN GIT RATHER THAN KV
 *
 * The whole feature is one claim: "we said this BEFORE the games were played." A
 * captured_at field is that claim asserting itself. A commit in git, timestamped by
 * something other than this script, is independent corroboration of it — and every
 * later change to the row is a diff with an author and a date. That is worth more than
 * the convenience of writing beside the ownership keys, and it adds no sixth key family
 * to a namespace that is mid-migration.
 *
 * ============================================================================
 * THE PROPERTIES THAT MAKE A RECEIPT WORTH ANYTHING, AND HOW EACH IS ENFORCED
 *
 * 1. PROSPECTIVE BY CONSTRUCTION. capture REFUSES once the week's earliest kickoff has
 *    passed. It does not store-and-flag: a ledger containing late rows marked "late" is
 *    a ledger someone eventually quotes without the flag.
 * 2. WRITE-ONCE. A second capture for the same (season, week, entry_id) is refused.
 *    A genuinely changed call is a NEW row with `supersedes`, still before kickoff, and
 *    both rows stay. Editing a dated call is the failure mode this site exists to avoid.
 * 3. COMPUTED BY THE PAGE'S OWN CODE. The engine is LIFTED out of survivor.html rather
 *    than reimplemented, so a receipt records what the tool actually said. A second
 *    implementation would eventually record what a second implementation said.
 * 4. RESOLVE IS THE ONE LEGAL MUTATION, and only from null to a value. Never value to
 *    a different value.
 *
 * ⚠️ THE INPUT IS PINNED BUT NOT YET REPRODUCIBLE. input_snapshot_id is the sha256 of
 * the survivor.json this was computed from, so a receipt can be checked against the
 * numbers that produced it. Until work/build-survivor-snapshot.mjs is run on a cadence,
 * that snapshot is still a hand-maintained artefact — the receipt is honest about WHAT
 * it read, which is not the same as that input being independently rebuildable.
 * ============================================================================
 */
import fs from "fs";
import { firstKickoffs } from "./survivor-capture-gate.mjs";
import path from "path";
import crypto from "crypto";
import { dirname, resolve as presolve } from "path";
import { fileURLToPath } from "url";

const WORK = dirname(fileURLToPath(import.meta.url));
const ROOT = presolve(WORK, "..");
const LEDGER = path.join(ROOT, "data", "survivor-receipts.json");

const die = m => { console.error("REFUSED: " + m); process.exit(1); };
const readJSON = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const argv = process.argv.slice(2);
const CMD = argv[0];
const flag = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const has = name => argv.includes("--" + name);
const CHECK = has("check");
if (!["capture", "resolve", "init"].includes(CMD))
  die("usage: survivor-receipt.mjs init | capture --week N [--entry ID] [--check] | resolve [--check]");

/* ---- registered configurations -------------------------------------------
   ⚠️ A cron cannot read a reader's localStorage, so the ledger can only ever grade
   configurations the SITE declares. One public default is the honest scope. Grading a
   per-reader config would need those configs stored server-side, which is a different
   feature with a privacy conversation attached. Adding an entry here is adding a thing
   we promise to grade forever — the ledger's value is that nothing is dropped when it
   starts going badly. */
const ENTRIES = {
  default: {
    label: "Public default — 200 entries, single life, no reuse, winnings objective",
    cfg: {
      entries: 200, lives: 1, lifeLost: 0, buybacks: false, buybackThrough: 4,
      buybackRate: 0.35, reuse: false, used: [], tiebreak: "split",
      blendMarket: 0.75, chalk: 2.4, sims: 3000, popularity: {},
      doublePickFrom: 0, doublePickWeeks: [], week18Mode: "normal", objective: "winnings",
    },
  },
};

/* ---- the page's own engine, lifted ---------------------------------------
   Same technique work/test-bozo-clv.mjs uses: take the exact source text rather than
   re-implementing it. If either module is renamed this fails loudly instead of quietly
   grading a stale copy. */
function liftEngine() {
  const html = fs.readFileSync(path.join(ROOT, "survivor.html"), "utf8");
  const grab = (startMark, endMark, what) => {
    const a = html.indexOf(startMark);
    if (a < 0) die(`could not find ${what} in survivor.html — it was renamed or restructured`);
    const b = html.indexOf(endMark, a);
    if (b < 0) die(`could not find the end of ${what}`);
    return html.slice(a, b);
  };
  const engine = grab(
    "/* ===== DD-SURVIVOR-PATH-ENGINE START",
    "/* ===== DD-SURVIVOR-PATH-ENGINE END",
    "the path engine");
  const survivor = grab("window.DDSurvivor = (function(){", "</script>", "the DDSurvivor module");
  const sandbox = { window: {}, console, Math, JSON, Object, Array, Set, Map, Number, String, isFinite, parseFloat };
  sandbox.self = sandbox.window;
  const fn = new Function("window", "self", "console",
    engine + "\n" + survivor + "\nreturn window.DDSurvivor;");
  const S = fn(sandbox.window, sandbox.window, console);
  if (!S || typeof S.rankWeek !== "function") die("lifted DDSurvivor is missing rankWeek");
  return S;
}

/* ---- inputs --------------------------------------------------------------- */
const survEnvelope = readJSON("data/survivor.json");
const D = survEnvelope.data;
if (!D || !D.games) die("data/survivor.json has no data.games");
const snapshotId = "sha256:" + crypto
  .createHash("sha256").update(fs.readFileSync(path.join(ROOT, "data", "survivor.json"))).digest("hex");
const schedule = readJSON("data/nfl-schedule.json").data.games;
const SEASON = D.meta.season;

function loadLedger() {
  if (!fs.existsSync(LEDGER)) return null;
  const env = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  if (!Array.isArray(env.data)) die("survivor-receipts.json has no data array");
  return env;
}
function writeLedger(rows, note) {
  const env = {
    source_page: "/survivor.html",
    tier: "labs",
    /* ⚠️ Derived, never asserted. An empty ledger is not a graded one, and a ledger
       whose rows are all still prospective is not either — `graded: true` on either
       would be the envelope claiming a property the rows do not have. */
    graded: rows.some(r => r.forecast_status === "resolved"),
    as_of: new Date().toISOString().slice(0, 10),
    source: "Captured by work/survivor-receipt.mjs from survivor.html's own engine, before each week's earliest kickoff.",
    note:
      "PROSPECTIVE RECEIPTS. Every row was written before the week it forecasts kicked off — captured_at < kickoff_at is enforced " +
      "at capture, not flagged afterwards, and a row is never edited once written. What is graded is CALIBRATION of the stated win " +
      "probabilities (Brier) and whether the pick survived. This is NOT a claim that the tool beats a pool: whether an entry would " +
      "have won depends on the rest of the field, which is not ours to score. `n` is small and stays small — 18 weeks is at most 18 " +
      "scored predictions per entry — so read every figure next to its n and do not draw a calibration curve on a season.",
    field_notes: {
      recommended: "the board's number-one pick, as an array — a double-pick week states two",
      stated_win_probability: "per leg, in the same order, as stated at capture",
      survived: "AND over the legs; a double week with one loss is false",
      brier: "mean over legs of (p - outcome)^2; null until resolved",
      forecast_status: "prospective | resolved | void",
      supersedes: "receipt_id this row replaces, when lines moved before kickoff; both rows stay",
    },
    counts: {
      registered: rows.length,
      resolved: rows.filter(r => r.forecast_status === "resolved").length,
      prospective: rows.filter(r => r.forecast_status === "prospective").length,
      survived: rows.filter(r => r.resolved && r.resolved.survived).length,
      /* n for the Brier mean, printed so no figure can be quoted without it. */
      brier_n: rows.filter(r => r.resolved).reduce((n, r) => n + r.resolved.leg_results.length, 0),
      brier_mean: (() => {
        const done = rows.filter(r => r.resolved);
        if (!done.length) return null;
        return Number((done.reduce((s2, r) => s2 + r.resolved.brier, 0) / done.length).toFixed(6));
      })(),
    },
    integrity: { rows: rows.length },
    data: rows,
    /* ⚠️ Required by tools/validate-data.js, and the same sentence every other payload
       carries byte-for-byte — the validator checks that too, because a tier that means
       something slightly different per file means nothing. */
    tier_meaning: "Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.",
    built: new Date().toISOString().slice(0, 10),
    canonical_url: "https://datadawgs216.com/data/survivor-receipts.json",
  };
  if (CHECK) {
    console.log("--check: nothing written. Ledger would be:");
    console.log(JSON.stringify(env, null, 1).slice(0, 1400));
    return;
  }
  fs.writeFileSync(LEDGER, JSON.stringify(env, null, 1) + "\n");
  console.log(`wrote data/survivor-receipts.json — ${rows.length} row(s)${note ? " · " + note : ""}`);
  console.log("NEXT: node tools/data-manifest.js, and commit the ledger with it.");
}

const kickoffOf = (week, team) => {
  const g = schedule.find(x => x.season === SEASON && x.week === week &&
    (x.home_team === team || x.away_team === team));
  return g ? g.kickoff_at : null;
};

/* ======================= init =======================
   An empty ledger is a real state and a publishable one: the surface exists, points at
   a valid envelope, and says nothing has been captured yet. That is the same idiom
   receipts.html already uses for the CFB contract. Generated rather than hand-written so
   the envelope can never drift from what capture writes. */
if (CMD === "init") {
  if (fs.existsSync(LEDGER)) die("data/survivor-receipts.json already exists — init would overwrite it");
  writeLedger([], "empty ledger — nothing captured yet");
}

/* ======================= capture ======================= */
if (CMD === "capture") {
  const week = Number(flag("week"));
  if (!Number.isInteger(week) || week < 1 || week > 18) die("--week must be a whole number from 1 to 18");
  const entryId = flag("entry", "default");
  const entry = ENTRIES[entryId];
  if (!entry) die(`unknown entry '${entryId}' — registered: ${Object.keys(ENTRIES).join(", ")}`);

  const S = liftEngine();
  const cfg = { ...entry.cfg, startWeek: week };
  const rank = S.rankWeek(week, cfg, D);
  if (!rank.rows.length) die(`no legal picks for week ${week}`);

  const dbl = S.isDoubleWeek(cfg, week);
  const top = rank.rows[0];
  const cards = S.candidatePaths(week, cfg, D, rank.rows.slice(0, 3).map(r => r.team));
  const lead = cards.find(c => c.team === top.team);
  if (!lead) die("the leading card did not solve — refusing to record a recommendation without its path");

  const legs = (lead.path[week] || []).map(l => l.team);
  if (!legs.length) die("the leading card has no leg for this week");
  if (dbl && legs.length < 2) die("this is a double-pick week and only one leg solved — refusing to record half an entry");

  /* Freeze before the earliest REGULAR-SEASON game of the week, even when
     the recommendation plays later. Never backfill after seeing an earlier result. */
  const kicks = legs.map(t => kickoffOf(week, t));
  if (kicks.some(k => !k)) die(`no kickoff time for ${legs[kicks.findIndex(k => !k)]} in week ${week}`);
  const first = firstKickoffs(schedule, SEASON).get(week);
  if (!Number.isFinite(first)) die(`no weekly kickoff for week ${week}`);
  const kickoffAt = new Date(first).toISOString();
  const now = new Date();
  if (now >= new Date(kickoffAt))
    die(`week ${week} kicked off at ${kickoffAt} and it is now ${now.toISOString()}. `
      + `A receipt written after kickoff is not prospective and this ledger will not hold one.`);

  const env = loadLedger();
  const rows = env ? env.data.slice() : [];
  const existing = rows.find(r => r.season === SEASON && r.week === week && r.entry_id === entryId
    && r.forecast_status !== "void");
  if (existing && !has("supersede"))
    die(`a receipt already exists for ${SEASON} week ${week} / ${entryId} (${existing.receipt_id}). `
      + `Receipts are write-once. If the call genuinely changed before kickoff, re-run with --supersede `
      + `to add a NEW row that points at this one; both rows stay.`);

  const seq = rows.filter(r => r.season === SEASON && r.week === week && r.entry_id === entryId).length;
  const receipt = {
    receipt_id: `survivor-${SEASON}-w${String(week).padStart(2, "0")}-${entryId}${seq ? "-r" + (seq + 1) : ""}`,
    season: SEASON, week, entry_id: entryId, entry_label: entry.label,

    recommended: legs,
    stated_win_probability: (lead.path[week] || []).map(l => Number(l.p.toFixed(6))),
    stated_leg_source: legs.map(t => (S.weekTable(week, cfg, D)[t] || {}).src || null),
    stated_equity_index: Number((top.evIndex * 100).toFixed(1)),
    stated_run_the_table: Number(lead.survival.toFixed(9)),
    alternatives: cards.filter(c => c.team !== top.team).map(c => {
      const row = rank.rows.find(r => r.team === c.team) || {};
      return { team: c.team, win_probability: Number(c.p.toFixed(6)),
               equity_index: row.evIndex != null ? Number((row.evIndex * 100).toFixed(1)) : null,
               run_the_table: Number(c.survival.toFixed(9)) };
    }),

    objective: cfg.objective,
    ownership_source: rank.popReal ? "posted" : "modelled",
    ownership_adjustment: "alive-count projection; pick mix assumed independent of survival",
    config: {
      entries: cfg.entries, lives: cfg.lives, reuse: cfg.reuse,
      double_pick_weeks: cfg.doublePickWeeks, week18_mode: cfg.week18Mode,
      blend_market: cfg.blendMarket, chalk: cfg.chalk, used_teams: cfg.used,
    },

    input_snapshot_id: snapshotId,
    input_as_of: survEnvelope.as_of || D.meta.captured,
    engine_version: "survivor.html@" + crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(ROOT, "survivor.html"))).digest("hex").slice(0, 12),
    captured_at: now.toISOString(),
    kickoff_at: kickoffAt,
    forecast_status: "prospective",
    supersedes: existing ? existing.receipt_id : null,
    resolved: null,
  };

  console.log(`week ${week} / ${entryId}: ${legs.join(" + ")} at ` +
    receipt.stated_win_probability.map(p => (p * 100).toFixed(1) + "%").join(" + "));
  console.log(`captured_at ${receipt.captured_at} < kickoff_at ${kickoffAt}  ✓`);
  console.log(`ownership ${receipt.ownership_source}${receipt.ownership_source === "modelled"
    ? "  ⚠️  a modelled ranking is close to a win-probability sort — the receipt records that" : ""}`);
  console.log(`input_snapshot_id ${snapshotId}`);
  rows.push(receipt);
  writeLedger(rows, `week ${week} captured`);
}

/* ======================= resolve ======================= */
if (CMD === "resolve") {
  const env = loadLedger();
  if (!env) die("no ledger yet — capture something first");
  const rows = env.data.map(r => ({ ...r }));
  let done = 0, waiting = 0;

  for (const r of rows) {
    if (r.forecast_status !== "prospective") continue;   // ⚠️ resolved rows are never re-resolved
    const games = r.recommended.map(t => schedule.find(g =>
      g.season === r.season && g.week === r.week && (g.home_team === t || g.away_team === t)));
    if (games.some(g => !g)) { console.warn(`  ${r.receipt_id}: a leg has no scheduled game — left prospective`); waiting++; continue; }
    if (games.some(g => g.status !== "final" || g.home_score == null || g.away_score == null)) {
      waiting++; continue;                                // not all final yet: leave it alone
    }
    const legResults = r.recommended.map((t, i) => {
      const g = games[i];
      const mine = g.home_team === t ? g.home_score : g.away_score;
      const theirs = g.home_team === t ? g.away_score : g.home_score;
      /* ⚠️ A tie is not a win. Survivor pools differ on it, and rather than pick a rule
         the row records "tie" and is excluded from `survived` as a loss — which is the
         stricter reading, and the one that cannot flatter the tool. */
      return mine > theirs ? "win" : mine === theirs ? "tie" : "loss";
    });
    const survived = legResults.every(x => x === "win");
    const brier = r.stated_win_probability.reduce((sum, p, i) =>
      sum + Math.pow(p - (legResults[i] === "win" ? 1 : 0), 2), 0) / legResults.length;
    r.forecast_status = "resolved";
    r.resolved = {
      resolved_at: new Date().toISOString(),
      leg_results: legResults,
      survived,
      brier: Number(brier.toFixed(6)),
      result_source: "data/nfl-schedule.json",
    };
    console.log(`  ${r.receipt_id}: ${legResults.join(",")} → ${survived ? "SURVIVED" : "OUT"} · brier ${r.resolved.brier}`);
    done++;
  }
  console.log(`${done} resolved, ${waiting} still waiting on results`);
  if (!done) { console.log("nothing to write"); process.exit(0); }
  writeLedger(rows, `${done} resolved`);
}
