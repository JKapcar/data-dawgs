/* Automatic grading and the manager's override — the invariants that move money.
 *
 * Run: node test-bozo-autograde.mjs
 *
 * ⚠️ WHY THIS IS ITS OWN SUITE. Both features write the rows the league settles on. The
 * auto-grader can name who wore a week and spend a re-deploy without anybody clicking
 * anything, and the override can set any of it to anything. The failure modes are not
 * crashes — they are a week that eliminates the wrong person, quietly, at 3am. These pin
 * the gates that stop that.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const WORK = dirname(fileURLToPath(import.meta.url));
const worker = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
const page = readFileSync(resolve(WORK, "..", "bozo.html"), "utf8");
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, "");

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };

/* ---- one write path, not two ---- */

/* ⚠️ THE SHARED COMMIT IS THE POINT. The manager's button and the cron must reach the
   same code to name a bozo, resolve a chop and spend a re-deploy. Two copies would be
   two places for the league's most consequential write to drift, and the drift would
   only ever be found by someone being wrongly eliminated. */
ok(/async function bozoCommitGrade\(env, lid, state, body, status\)/.test(worker),
   "the write half of grading exists once, as a shared function");
ok(/const committed = await bozoCommitGrade\(env, lid, state, body, status\);/.test(worker),
   "the manager's confirmed grade goes through it");
ok(/await bozoCommitGrade\(env, lid, withResults, \{/.test(worker),
   "the automatic grade goes through the same one");

/* The conflict case has to survive the extraction: two people marked differently on one
   real-world fact is refused, not auto-reconciled, on BOTH paths. */
ok(/return \{ conflict:/.test(worker) && /if \(committed\.conflict\)/.test(worker),
   "a same-selection disagreement still refuses, through the shared path");
ok(/if \(committed\.conflict\)\s*\n\s*return \{ league: lid, week, graded: false, conflict/.test(worker),
   "the auto-grader refuses on a conflict instead of picking a winner");

/* ---- what the auto-grader is allowed to do ---- */

ok(/async function runBozoAutoGrade/.test(worker) && /async function bozoAutoGradeOne/.test(worker),
   "the auto-grader exists");
ok(/await bozoGradeFromScheduleKv\(env, lg, lg\.results\)/.test(worker),
   "every automatic result comes from the scheduled source, never a browser");

/* ⚠️ THE STATUS FLIP IS THE CONSEQUENTIAL PART. Flipping to graded names who wore the
   week, resolves the chop and spends a re-deploy. One unsettled leg must stop it. */
ok(/if \(blocked\.length \|\| !Object\.keys\(picks\)\.length\)\s*\n\s*return \{ league: lid, week, graded: false/.test(worker),
   "a pending leg stops the status flip — a half-finished week never eliminates anybody");
ok(/awaiting_manual_grade/.test(worker),
   "a hand-graded leg nobody has graded counts as pending, not as settled");
ok(/const blocked = \[\.\.\.automatic\.pending, \.\.\.handPending/.test(worker),
   "both kinds of pending block the week: an unreachable score AND an ungraded prop");

/* Results still land while the week is pending — that is the whole point, legs settling
   on the board as games end rather than all at once days later. */
ok(/if \(JSON\.stringify\(automatic\.results\) !== before\)\s*\n\s*await fbPut\(env, LG\(lid\) \+ "\/results", automatic\.results\);/.test(worker),
   "settled legs are written even while the week is still pending, and only when changed");

/* ⚠️ Who wore it is DERIVED by the same lever machinery the manager's card runs. The
   cron must never invent a bozo. */
ok(/const decided = royaleDecideChop\(withResults, lg\.order\);/.test(worker),
   "the bozo is derived by the existing levers, from the results just written");
ok(/bozo: decided\.ticketCashed \? null : decided\.chopped/.test(worker),
   "a cashed ticket names nobody");

ok(/if \(!lg \|\| lg\.status !== "placed"\) continue;/.test(worker),
   "only a placed ticket can settle — open has no ticket, graded is already done");
ok(/if \(lg\.synthetic === true\) continue;/.test(worker),
   "the simulator's league is never auto-graded — it is not real money");
ok(/out\.push\(\{ league: lid, error:/.test(worker),
   "one league's bad state does not stop the others settling");

/* ---- the cron ---- */
ok(/bozo:autograde:lasterror/.test(worker),
   "auto-grading has its own lasterror key, so a failure is attributable");
ok(/const gradeRun = runBozoAutoGrade\(env,/.test(worker) && /ctx\.waitUntil\(gradeRun\)/.test(worker),
   "it runs in its own failure domain and is kept alive past the tick");

/* ---- the override ---- */

ok(/async function bozoAdmin/.test(worker) && /"\/bozo\/admin"/.test(worker),
   "the override route exists and is routed");
ok(/const auth = await requireManager\(request, env, lid\);[\s\S]{0,120}if \(method === "GET"\)/.test(worker),
   "reads and writes both require the league's manager");

/* ⚠️ A god of one league is still not a god of somebody else's. */
ok(/function adminPath/.test(worker) && /Bad path segment/.test(worker),
   "a path that climbs out of the league subtree is refused");

/* ⚠️ THE RECORD IS THE ONE THING IT CANNOT WRITE. Not to constrain the manager — they
   can already change every number it describes — but a log that can be edited proves
   nothing, including when it would exonerate them. */
ok(/if \(parts\[0\] === "audit"\)/.test(worker),
   "the audit log cannot itself be edited through the override");
ok(/from: prior, to: next/.test(worker),
   "every entry records the value it replaced, so a change can be undone by hand");
ok(/let prior = null;[\s\S]{0,200}await fbGet\(env, full\)/.test(worker),
   "the prior value is read before the write, not after");

/* The log is written after the change lands: a record claiming an edit that never
   happened is worse than a missing one. */
const auditIdx = worker.indexOf("Written AFTER the change lands");
ok(auditIdx > 0 && worker.indexOf('LG(lid) + "/audit"', auditIdx) > auditIdx,
   "the audit entry is written after the value changes, never before");

ok(/if \(!at\.path\)\s*\n\s*return json\(\{ error: "Name the field to change/.test(worker),
   "replacing the whole league node in one call is refused — that is not an edit");

/* ---- the panel ---- */
ok(/id="godPath"/.test(pageCode) && /id="godValue"/.test(pageCode) && /id="godSave"/.test(pageCode),
   "the override panel exists");
ok(/JSON\.parse\(box\.value === '' \? 'null' : box\.value\)/.test(pageCode),
   "values are parsed as JSON, never coerced — \"false\" and false are different writes");

/* ⚠️ result and won are two spellings of one fact, and surfaces read whichever they were
   written against. Setting one alone is how a leg ends up won on the ticket and lost in
   the ledger. */
ok(/path: `results\/\$\{encodeURIComponent\(k\)\}\/result`/.test(pageCode)
   && /path: `results\/\$\{encodeURIComponent\(k\)\}\/won`/.test(pageCode),
   "a one-click result override writes result and won together");

ok(/id="godAudit"/.test(pageCode) && /No overrides recorded/.test(pageCode),
   "the panel shows the record of what has been overridden");
ok(/does not re-run the levers/.test(page),
   "the panel warns that an override re-derives nothing");

/* ---- a settled leg reads settled ---- */

/* ⚠️ THE BUG THIS PINS. Results now land one game at a time, but every surface decided a
   leg's mark from the WEEK's status — so a leg whose game finished hours ago still showed
   as running until every other leg had settled too. Writing the result and never showing
   it is indistinguishable, to the person looking at the board, from not grading at all. */
ok(/const outcome = r\.result \|\| \(r\.won===true\?'won':r\.won===false\?'lost':null\);/.test(pageCode),
   "the ticket takes each leg's outcome from the leg, not from the week");
ok(/: outcome==='lost' \? 'lost'/.test(pageCode),
   "a lost leg reads lost while the rest of the week is still running");
ok(/: graded \? 'void'/.test(pageCode),
   "an unsettled leg is only void once the week is graded — before that it is still on");
ok(/const mark = o==='won' \? '✓' : o==='lost' \? '✕'/.test(pageCode),
   "the season bill marks a settled leg the same way");
ok(/const outcome = o==='won' \? ' WON' : o==='lost' \? ' LOST'/.test(pageCode),
   "Toto reports a settled leg as settled instead of calling it still running");
ok(/settledN\s*\n?\s*\? live\.length \+ ' of ' \+ expected \+ ' in · ' \+ settledN \+ ' settled'/.test(pageCode),
   "the ticket header counts what has settled, so a live grader is visible");

/* ---- a leg saves on its own, and a hand-set result sticks ---- */

/* ⚠️ THE ASK THIS PINS. The grade card's only commit used to be the whole-week two-phase
   confirm, which refuses while anything is pending — so a manager could pick "Lost" for a
   prop on Thursday and had nothing to press until Monday. Every leg now saves itself. */
ok(/async function saveLeg\(p, btn\)/.test(pageCode) && /data-save=/.test(pageCode),
   "every leg on the grade card has its own Save");
ok(/path:`results\/\$\{key\}\/result`, value:result \}/.test(pageCode)
   && /path:`results\/\$\{key\}\/won`/.test(pageCode),
   "a per-leg save writes result and won together");
ok(/path:`results\/\$\{key\}\/resultSource`, value:'manual'/.test(pageCode),
   "a per-leg save stamps the result as set by hand");
ok(/ov=clvAssumedOpp\(cv\); assumed=true;/.test(pageCode)
   && /closeOppSource`, value: assumed \? 'assumed' : 'manual'/.test(pageCode),
   "a lone close on the grade card gets its other side assumed and stamped as such");
ok(/await godWrite\(edits\);[\s\S]{0,120}await refresh\(\);/.test(pageCode),
   "the save goes through the audited override route and repaints");
ok(/decide\(\)[\s\S]*querySelectorAll\('\[data-w\]'\)/.test(pageCode),
   "the week-level grade still reads the same row attributes, so the two paths agree");

/* ⚠️ Without this the feed re-graded a hand-set leg on the next tick or the next Pull,
   and a manager who had just corrected a wrong result watched it flip back. */
ok(/if \(\(results\[key\] \|\| \{\}\)\.resultSource === "manual"\) continue;/.test(worker),
   "the schedule grader skips a leg whose result was set by hand");
{
  const guard = worker.indexOf('resultSource === "manual") continue;');
  const strip = worker.indexOf('for (const field of ["actual", "result", "won", "gradeSource", "gradeObservedAt"]) delete row[field];');
  ok(guard > 0 && strip > guard,
     "...and skips it BEFORE the pending branch that would strip its result");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
