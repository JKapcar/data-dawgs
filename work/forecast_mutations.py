#!/usr/bin/env python3
"""Stage FC-A mutation harness.

Break each storage guarantee in turn and confirm the assertion that claims to protect it
actually goes red. A mutation that leaves the gate green is information about the TEST,
not about the code — three tests on this repo have already passed with the behaviour they
named deleted.

Run:  cd work && python3 forecast_mutations.py

Grades work/test-forecast-store.mjs. The worker is restored after every mutation, and the
harness refuses to start unless the baseline is green and refuses to finish unless the
restored tree is green again.
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WORKER = Path("../dawg-bot-worker.js").resolve()
SUITE = "test-forecast-store.mjs"


def run_suite():
    """Return (ok, set_of_failed_assertion_names)."""
    # ⚠️ encoding="utf-8" is load-bearing, not tidiness. text=True alone decodes with the
    # locale default, which on Windows is cp1252: every "—" and "…" in an assertion name
    # comes back mojibake. That breaks the detail-stripping regex below AND every substring
    # match against `expect`, so a mutation that really did go red gets graded "red on the
    # wrong assertions" — and, worse, an expectation naming a non-ASCII assertion can never
    # be satisfied. The suite's test names use both characters liberally.
    proc = subprocess.run([shutil.which("node") or "node", SUITE],
                          capture_output=True, text=True, encoding="utf-8", timeout=300)
    failed = set(re.findall(r"^\s*FAIL\s+(.*?)(?:\s+—.*)?$", proc.stdout, re.M))
    return proc.returncode == 0, failed, proc.stdout


# Each mutation: (id, what it breaks, [(old, new), ...], assertions that MUST go red).
# The expected assertions are matched as substrings, so a reworded test name fails loudly
# here rather than silently downgrading the harness to "something went red".
MUTATIONS = [
    ("M1", "the per-game route no longer refuses before kickoff", [(
        '  if (Date.now() < game.kickoff_ms)\n'
        '    return json({ error: "Forecasts stay private until kickoff." }, 409, cors);',
        '  if (false)\n'
        '    return json({ error: "Forecasts stay private until kickoff." }, 409, cors);',
    )], ["the per-game route refuses 409 before kickoff"]),

    ("M2", "the own-week route returns the whole week instead of just the caller", [(
        '    mine = (await fbGet(env, fcEntryPath(sport, season, week, auth.name, null))).data || {};',
        '    mine = Object.assign({}, ...Object.values('
        '(await fbGet(env, `${FC_ROOT}/entries/${sport}/${season}/${week}`)).data || {}));',
    )], ["no other user appears anywhere in the response body",
         "it returns only my entries"]),

    ("M3", "touched is DERIVED from the value instead of stored separately", [(
        '    .filter(r => r && r.touched === true && r.entrant_kind !== "agent" &&\n'
        '                 Number.isFinite(Number(r.home_win_probability)))',
        '    .filter(r => r && Number(r.home_win_probability) !== 0.5 && r.entrant_kind !== "agent" &&\n'
        '                 Number.isFinite(Number(r.home_win_probability)))',
    )], ["the consensus is the trimmed mean of LOG-ODDS, not of probabilities",
         "it trims one from each end once n >= 5",
         "the untouched entry is excluded from the crowd",
         "the deliberate 50 IS counted as a contributor",
         "contributors_sha256 recomputes from the entries"]),

    ("M4", "the consensus averages probabilities instead of log-odds", [(
        'const fcSigmoid = z => 1 / (1 + Math.exp(-z));',
        'const fcSigmoid = z => z;',
    ), (
        '  return Math.log(q / (1 - q));',
        '  return q;',
    )], ["the consensus is the trimmed mean of LOG-ODDS, not of probabilities",
         "...and is nowhere near the linear mean of the same kept values"]),

    ("M5", "captured_at is stamped at seal time instead of the latest contribution", [(
        '    const capturedMs = Math.max(...agg.contributors.map(r => Number(r.submitted_at) || 0));',
        '    const capturedMs = now;',
    )], ["captured_at is the LATEST contributing submitted_at, not the seal time",
         "captured_at strictly precedes kickoff",
         "a sealed row exists for the kicked-off game"]),

    ("M6", "a forecast may be written after kickoff", [(
        '  if (now >= game.kickoff_ms)\n'
        '    return json({ error: "That game has kicked off. Forecasts are locked." }, 409, cors);',
        '  if (false)\n'
        '    return json({ error: "That game has kicked off. Forecasts are locked." }, 409, cors);',
    )], ["a write at or after kickoff is refused 409",
         "...and nothing was stored for it"]),

    ("M7", "the client may assert its own home_win_probability", [(
        '  if ("home_win_probability" in body)\n'
        '    return json({ error: "home_win_probability is derived, not submitted." }, 400, cors);',
        '  if (false)\n'
        '    return json({ error: "home_win_probability is derived, not submitted." }, 400, cors);',
    )], ["a client-asserted home_win_probability is REFUSED"]),

    ("M8", "an existing sealed row can be overwritten", [(
        '    if (already[encodeURIComponent(gameId)]) {\n'
        '      skipped.push({ game_id: gameId, why: "already sealed" }); continue;\n'
        '    }',
        '    if (false) {\n'
        '      skipped.push({ game_id: gameId, why: "already sealed" }); continue;\n'
        '    }',
    )], ["a second seal does not overwrite an existing row",
         "...and says so rather than silently doing nothing"]),

    ("M9", "the minimum-touch threshold is removed", [(
        'const FC_MIN_TOUCH = 3;',
        'const FC_MIN_TOUCH = 0;',
    )], ["two touched entries produce NO row rather than a thin one",
         "...and the reason is reported"]),

    ("M10", "the logit clamp is removed", [(
        '  const q = Math.min(FC_CLAMP_HI, Math.max(FC_CLAMP_LO, Number(p)));',
        '  const q = Number(p);',
    )], ["a certainty of 1.0 is clamped to 0.99 rather than passed through"]),

    ("M11", "a running total is stored beside the entries", [(
        '  try { await fbPut(env, path, entry); }\n'
        '  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }\n'
        '  return json({ ok: true, entry }, 200, cors);',
        '  try { await fbPut(env, path, entry); }\n'
        '  catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }\n'
        # ⚠️ `entrant`, not `name` — FC-C renamed the binding. Referencing the old name here
        # threw a ReferenceError INSIDE this mutation's own `catch {}`, so the standings node
        # was never written and M11 silently stopped testing anything while still reading as
        # a valid mutation. A mutation that cannot fail is worse than no mutation.
        '  try { await fbPut(env, `${FC_ROOT}/standings/${sport}/${game.season}/'
        '${encodeURIComponent(entrant)}`, { points: 0 }); } catch {}\n'
        '  return json({ ok: true, entry }, 200, cors);',
    )], ["the forecast tree contains no total, standing, score or rank node"]),

    ("M12", "the client's submitted_at is trusted", [(
        '    submitted_at: now,',
        '    submitted_at: Number(body.submitted_at) || now,',
    )], ["a client-supplied submitted_at is ignored"]),

    ("M13", "sealing drops the admin requirement", [(
        '  const auth = await requireAdmin(request, env);\n'
        '  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);\n'
        '\n'
        '  let body;\n'
        '  try { body = await readBody(request); }\n'
        '  catch { return json({ error: "Bad JSON." }, 400, cors); }\n'
        '\n'
        '  const sport = String(body.sport || "");\n'
        '  if (!FC_SPORTS[sport]) return json({ error: "Unknown sport." }, 400, cors);\n'
        '  const season = parseInt(body.season, 10);',
        '  const auth = await sessionAuth(request, env);\n'
        '  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);\n'
        '\n'
        '  let body;\n'
        '  try { body = await readBody(request); }\n'
        '  catch { return json({ error: "Bad JSON." }, 400, cors); }\n'
        '\n'
        '  const sport = String(body.sport || "");\n'
        '  if (!FC_SPORTS[sport]) return json({ error: "Unknown sport." }, 400, cors);\n'
        '  const season = parseInt(body.season, 10);',
    )], ["sealing is admin only"]),

    # ---- FC-C, the entrant model -------------------------------------------
    # Each of these is a plausible-looking simplification of the entrant work, and each
    # destroys something the stage exists to guarantee.

    ("M14", "a bot writes under its OWNER's name instead of its own", [(
        '    return { entrant: bot.entrant, kind: "agent", owner: bot.owner, source: "api" };',
        '    return { entrant: bot.owner, kind: "agent", owner: bot.owner, source: "api" };',
    )], ["the owner's own entry on the same game is byte-for-byte untouched",
         "and still holds the human's number, not the bot's",
         "it lands under the BOT's name, not its owner's"]),

    ("M15", "an idempotent repeat is treated as a fresh revision", [(
        '  if (idemKey !== null && prior && prior.idempotency_key === idemKey)\n'
        '    return json({ ok: true, entry: prior, idempotent: true }, 200, cors);',
        '  if (false)\n'
        '    return json({ ok: true, entry: prior, idempotent: true }, 200, cors);',
    )], ["and is reported as idempotent",
         "and does NOT bump the revision",
         "and does NOT move submitted_at"]),

    ("M16", "agents are admitted to the crowd consensus", [(
        '    .filter(r => r && r.touched === true && r.entrant_kind !== "agent" &&',
        '    .filter(r => r && r.touched === true &&',
    )], ["only the three humans are counted",
         "no agent is in the contributor list",
         "and the agents' numbers did not move the consensus"]),

    ("M17", "a bot token is accepted wherever a session is", [(
        'async function forecastMine(request, url, env, cors) {\n'
        '  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);\n'
        '  const auth = await sessionAuth(request, env);',
        'async function forecastMine(request, url, env, cors) {\n'
        '  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);\n'
        '  const auth = await fcEntrantAuth(request, env);',
    )], ["a bot token is refused on /forecast/entries"]),

    ("M18", "a revoked bot token keeps working", [(
        '    if (b.revoked === true) return { err: "That bot token was revoked.", code: 403 };',
        '    if (false) return { err: "That bot token was revoked.", code: 403 };',
    )], ["a revoked token is refused 403"]),

    ("M19", "bot registration stops checking the account namespace", [(
        '    if (taken) return json({ error: `That name is already ${taken}. Bots and people share one namespace.` }, 409, cors);',
        '    if (false) return json({ error: `That name is already ${taken}. Bots and people share one namespace.` }, 409, cors);',
    )], ["a bot may not take an existing account name",
         "case-insensitively",
         "a bot may not take another bot's name"]),
]


def main():
    original = WORKER.read_text(encoding="utf-8")
    backup = Path(tempfile.gettempdir()) / "dawg-bot-worker.fc-baseline.js"
    backup.write_text(original, encoding="utf-8")

    print("baseline")
    ok, failed, out = run_suite()
    if not ok:
        print("  BASELINE IS RED — fix that before grading anything\n" + out)
        return 1
    print("  ok   the suite is green before any mutation\n")

    graded = 0
    problems = []
    for mid, what, edits, expect in MUTATIONS:
        text = original
        for old, new in edits:
            n = text.count(old)
            if n != 1:
                problems.append(f"{mid}: anchor appears {n} times, not once — {old[:60]!r}")
                text = None
                break
            text = text.replace(old, new)
        if text is None:
            print(f"  SKIP {mid}  {what}")
            continue

        WORKER.write_text(text, encoding="utf-8")
        try:
            ok, failed, out = run_suite()
        finally:
            WORKER.write_text(original, encoding="utf-8")

        missed = [e for e in expect if not any(e in f for f in failed)]
        if ok:
            problems.append(f"{mid}: the suite stayed GREEN with {what} — the test is not testing it")
            print(f"  FAIL {mid}  stayed green: {what}")
        elif missed:
            problems.append(f"{mid}: went red, but not on {missed} (red on {sorted(failed)})")
            print(f"  FAIL {mid}  red on the wrong assertions: {missed}")
        else:
            graded += 1
            print(f"  ok   {mid}  {what}  →  {len(failed)} red")

    print("\nrestored tree")
    ok, failed, out = run_suite()
    if not ok:
        problems.append("the restored worker is RED — the harness did not put it back cleanly")
        print("  FAIL the restored suite is red\n" + out)
    else:
        print("  ok   green again after restore")

    print(f"\n{graded}/{len(MUTATIONS)} mutations graded")
    for p in problems:
        print("  ⚠️ " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
