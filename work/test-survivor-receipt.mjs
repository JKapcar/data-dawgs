/* Survivor receipts — the refusals, the grading, and the immutability.
 *
 * Run: node work/test-survivor-receipt.mjs
 *
 * ⚠️ WHAT THIS IS ACTUALLY GUARDING.
 * A receipt ledger's entire value is that its rows could not have been written after the
 * fact. Every property that makes that true is a REFUSAL, and a refusal that quietly
 * stops refusing looks exactly like a working feature. So this file spends most of its
 * assertions proving the script says no:
 *   · no to a capture after kickoff
 *   · no to a second capture for the same week
 *   · no to re-resolving a row that already has a result
 *   · no to init over an existing ledger
 * The happy paths are the easy part and are checked mainly so the refusals cannot pass
 * by the script being broken in general.
 *
 * It drives the real CLI against real repo data, with the schedule temporarily swapped
 * for a fixture. Everything is restored in a finally block — a crashed run must not
 * leave data/nfl-schedule.json holding a fake kickoff.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const WORK = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WORK, "..");
const SCRIPT = path.join(WORK, "survivor-receipt.mjs");
const SCHED = path.join(ROOT, "data", "nfl-schedule.json");
const LEDGER = path.join(ROOT, "data", "survivor-receipts.json");

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};

// run the CLI; never throws, so a refusal is data rather than a crash
function run(...args) {
  try {
    return { code: 0, out: execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}
const ledger = () => JSON.parse(fs.readFileSync(LEDGER, "utf8"));

/* ---- save everything we are about to touch ---- */
const schedBackup = fs.readFileSync(SCHED, "utf8");
const ledgerExisted = fs.existsSync(LEDGER);
const ledgerBackup = ledgerExisted ? fs.readFileSync(LEDGER, "utf8") : null;

const setSchedule = mutate => {
  const j = JSON.parse(schedBackup);
  mutate(j.data.games);
  fs.writeFileSync(SCHED, JSON.stringify(j));
};

try {
  /* ---------- 1. init ---------- */
  if (fs.existsSync(LEDGER)) fs.unlinkSync(LEDGER);
  let r = run("init");
  ok(r.code === 0 && fs.existsSync(LEDGER), "init creates an empty ledger", r.out.trim());
  let L = ledger();
  ok(L.data.length === 0, "…with zero rows");
  /* ⚠️ An empty ledger claiming graded:true would be the envelope asserting a property
     its rows do not have. It is derived from the rows, not written by hand. */
  ok(L.graded === false, "an empty ledger is NOT graded");
  ok(L.counts.registered === 0 && L.counts.brier_mean === null,
     "…and reports no Brier rather than a zero one", JSON.stringify(L.counts));
  ok(typeof L.tier_meaning === "string" && L.tier_meaning.startsWith("Pup —"),
     "the envelope carries the site's shared tier_meaning");

  r = run("init");
  ok(r.code !== 0 && /already exists/.test(r.out),
     "init REFUSES to overwrite an existing ledger", r.out.trim().slice(0, 80));

  /* ---------- 2. capture, and the prospective gate ---------- */
  // week 1 far in the future — the real schedule already has that, so capture succeeds
  r = run("capture", "--week", "1");
  ok(r.code === 0, "a capture before kickoff succeeds", r.out.trim().slice(0, 120));
  L = ledger();
  ok(L.data.length === 1, "…and lands one row");
  const rec = L.data[0];
  ok(new Date(rec.captured_at) < new Date(rec.kickoff_at),
     "captured_at is before kickoff_at, which is the whole claim",
     `${rec.captured_at} vs ${rec.kickoff_at}`);
  ok(Array.isArray(rec.recommended) && rec.recommended.length >= 1,
     "recommended is an array even for a single-pick week", JSON.stringify(rec.recommended));
  ok(rec.stated_win_probability.length === rec.recommended.length,
     "one stated probability per leg");
  ok(rec.forecast_status === "prospective" && rec.resolved === null,
     "a fresh row is prospective and unresolved");
  ok(rec.alternatives.length >= 1, "the other cards are recorded, so the pick can be judged against them");
  ok(/^sha256:/.test(rec.input_snapshot_id), "the input snapshot is pinned", rec.input_snapshot_id);
  ok(L.graded === false, "one prospective row still does not make the ledger graded");

  /* ---------- 3. write-once ---------- */
  r = run("capture", "--week", "1");
  ok(r.code !== 0 && /write-once/i.test(r.out),
     "a second capture for the same week is REFUSED", r.out.trim().slice(0, 90));
  ok(ledger().data.length === 1, "…and nothing was appended");

  // a genuine change before kickoff is a NEW row that points at the old one
  r = run("capture", "--week", "1", "--supersede");
  ok(r.code === 0, "--supersede is allowed while still before kickoff", r.out.trim().slice(0, 80));
  L = ledger();
  ok(L.data.length === 2, "…and it ADDS a row rather than editing one");
  ok(L.data[1].supersedes === L.data[0].receipt_id,
     "…which names the row it replaces", `${L.data[1].supersedes} vs ${L.data[0].receipt_id}`);
  ok(L.data[0].receipt_id !== L.data[1].receipt_id, "the two rows have different ids");
  /* ⚠️ The superseded row is still there, unedited. That is the point: a dated call that
     changed is two facts, not one corrected fact. */
  ok(L.data[0].captured_at && L.data[0].forecast_status === "prospective",
     "the superseded row is untouched, not rewritten");

  /* ---------- 4. the prospective gate actually closes ---------- */
  fs.unlinkSync(LEDGER); run("init");
  setSchedule(games => { for (const g of games) if (g.week === 1) g.kickoff_at = "2020-01-01T00:00:00Z"; });
  r = run("capture", "--week", "1");
  ok(r.code !== 0 && /not prospective/i.test(r.out),
     "a capture AFTER kickoff is refused — not stored-and-flagged", r.out.trim().slice(0, 110));
  ok(ledger().data.length === 0, "…and the ledger stays empty");
  fs.writeFileSync(SCHED, schedBackup);

  /* ---------- 5. resolve ---------- */
  fs.unlinkSync(LEDGER); run("init"); run("capture", "--week", "1");
  const picked = ledger().data[0].recommended[0];
  const stated = ledger().data[0].stated_win_probability[0];

  // nothing is final yet, so resolve must do nothing at all
  r = run("resolve");
  ok(/0 resolved/.test(r.out), "resolve leaves unfinished weeks alone", r.out.trim().slice(0, 60));
  ok(ledger().data[0].forecast_status === "prospective", "…and the row is untouched");

  // now make the pick's game final, with the pick WINNING
  setSchedule(games => {
    for (const g of games) {
      if (g.week !== 1) continue;
      if (g.home_team !== picked && g.away_team !== picked) continue;
      g.status = "final";
      g.home_score = g.home_team === picked ? 24 : 17;
      g.away_score = g.away_team === picked ? 24 : 17;
    }
  });
  r = run("resolve");
  ok(r.code === 0 && /1 resolved/.test(r.out), "a final game resolves the row", r.out.trim().slice(0, 90));
  L = ledger();
  const res = L.data[0].resolved;
  ok(L.data[0].forecast_status === "resolved" && res, "the row is marked resolved");
  ok(res.survived === true && res.leg_results[0] === "win", "a winning pick survives",
     JSON.stringify(res.leg_results));
  const wantBrier = Number(Math.pow(stated - 1, 2).toFixed(6));
  ok(Math.abs(res.brier - wantBrier) < 1e-6,
     "Brier is (p − 1)² on a win, computed from the STATED probability",
     `${res.brier} vs ${wantBrier}`);
  ok(L.graded === true, "a resolved row makes the ledger graded");
  ok(L.counts.brier_n === 1 && L.counts.brier_mean === res.brier,
     "counts carry n alongside the Brier mean", JSON.stringify(L.counts));

  /* ⚠️ Resolve must never re-resolve. It is the one legal mutation and only from null
     to a value — a second pass that recomputed could silently change a published grade. */
  const before = JSON.stringify(ledger().data[0].resolved);
  setSchedule(games => {                      // flip the result under it
    for (const g of games) {
      if (g.week !== 1) continue;
      if (g.home_team !== picked && g.away_team !== picked) continue;
      g.status = "final";
      g.home_score = g.home_team === picked ? 3 : 40;
      g.away_score = g.away_team === picked ? 3 : 40;
    }
  });
  r = run("resolve");
  ok(/0 resolved/.test(r.out), "a resolved row is not resolved again", r.out.trim().slice(0, 60));
  ok(JSON.stringify(ledger().data[0].resolved) === before,
     "…and its recorded result is byte-identical afterwards");

  /* ---------- 6. a loss, and a tie ---------- */
  for (const [label, mine, theirs, want, survives] of [
    ["a loss", 10, 31, "loss", false],
    ["a tie", 20, 20, "tie", false],
  ]) {
    fs.unlinkSync(LEDGER); run("init"); fs.writeFileSync(SCHED, schedBackup); run("capture", "--week", "1");
    const t = ledger().data[0].recommended[0];
    setSchedule(games => {
      for (const g of games) {
        if (g.week !== 1) continue;
        if (g.home_team !== t && g.away_team !== t) continue;
        g.status = "final";
        g.home_score = g.home_team === t ? mine : theirs;
        g.away_score = g.away_team === t ? mine : theirs;
      }
    });
    run("resolve");
    const rr = ledger().data[0].resolved;
    ok(rr.leg_results[0] === want, `${label} is recorded as ${want}`, JSON.stringify(rr.leg_results));
    /* ⚠️ A tie is not a win. Pools differ on it; rather than pick a rule, the row records
       "tie" and survived stays false — the stricter reading, and the one that cannot
       flatter the tool. */
    ok(rr.survived === survives, `${label} → survived is ${survives}`);
  }

  console.log(`survivor receipts: ${pass} passed, ${fail} failed`);
} finally {
  /* ⚠️ Always. A crashed run must not leave the repo holding a fake kickoff time or a
     test ledger — both would be committed by the next person who ran git add -A. */
  fs.writeFileSync(SCHED, schedBackup);
  if (ledgerBackup !== null) fs.writeFileSync(LEDGER, ledgerBackup);
  else if (fs.existsSync(LEDGER)) fs.unlinkSync(LEDGER);
}
process.exit(fail ? 1 : 0);
