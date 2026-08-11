#!/usr/bin/env node
/* Seed the two demo leagues from the simulator's output.
 *
 *   node seed-demo-leagues.mjs --session <X-Dawg-Session> \
 *        --standard ../tmp/demo-season.json --royale ../tmp/demo-royale-season.json
 *
 * ⚠️ THIS IS A HAND-RUN SEEDING SCRIPT AND IS NOT WIRED INTO ANY PRODUCTION PATH.
 * The simulator that produced these files isn't either. Both exist so a league can see
 * a populated board before a single real leg is graded, and both are run by a person who
 * meant to run them.
 *
 * ⚠️ Every row it posts is stored with synthetic:true, which the Worker forces on and
 * the caller cannot switch off. That flag is the only thing keeping fabricated closes
 * out of receipts, the model scoreboard and every cross-league aggregate. The close
 * capture skips synthetic leagues outright, so an invented price can never be mistaken
 * for an observed one or overwritten by a real one.
 *
 * ⚠️ Import is create-only. If the league already exists the Worker refuses rather than
 * merging — delete it from the leagues card first. Half-simulated is not a state anyone
 * could reason about later.
 *
 * The session must belong to the SITE ADMIN and is read from the DD_SESSION environment
 * variable. In the browser console on datadawgs216.com:
 *
 *     copy(localStorage.getItem('dd-bozo-sess'))
 *
 * then in PowerShell:
 *
 *     $env:DD_SESSION = Get-Clipboard; node seed-demo-leagues.mjs
 *
 * ⚠️ THE ENV VAR IS THE POINT, not a convenience. A session token pasted as a command
 * argument lands in PowerShell history and in the scrollback of whatever window it was
 * typed into, where it stays valid until it expires. --session still works for a
 * throwaway, but the env var is the way to do this.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// ⚠️ Resolved against THIS FILE, not the shell's working directory. The default paths
// used to be "../tmp/..." relative to cwd, which silently meant a different place
// depending on where you happened to be standing when you ran it.
const HERE = dirname(fileURLToPath(import.meta.url));
const rel = (p) => resolve(HERE, p);

// One place where a refusal turns into a clean exit. See the note on die().
const onFail = (e) => {
  console.error("\nSEED FAILED: " + ((e && e.__seedFail) ? e.message : (e && e.stack) || e));
  process.exitCode = 1;
};
process.on("uncaughtException", onFail);
process.on("unhandledRejection", onFail);

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ") || true]));

const BASE = String(args.base || "https://toto.jkapcar4.workers.dev");
const SESSION = String(process.env.DD_SESSION || args.session || "").trim();
// ⚠️ Catch the placeholder explicitly. It has been pasted literally at least once, and
// the failure it produces — a 401 from the Worker — looks like an expired login rather
// than an unsubstituted argument, which sends you debugging the wrong thing.
if (/^PASTE|^<|^your[-_ ]?session/i.test(SESSION))
  die("that's the placeholder, not a session. Run:  copy(localStorage.getItem('dd-bozo-sess'))  in the\n"
    + "           browser console on datadawgs216.com, then:  $env:DD_SESSION = Get-Clipboard");
if (!SESSION)
  die("no session. In the browser console on datadawgs216.com run:\n"
    + "             copy(localStorage.getItem('dd-bozo-sess'))\n"
    + "           then in this window:\n"
    + "             $env:DD_SESSION = Get-Clipboard; node seed-demo-leagues.mjs");

// A session is <base64url payload>.<hmac>. Decode the payload locally — not to trust it,
// only to fail fast and legibly on an expired or malformed one instead of on a 401.
try {
  const body = JSON.parse(Buffer.from(SESSION.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  if (!body.n || !body.e) die("that doesn't look like a Data Dawgs session token.");
  if (Date.now() > body.e) die(`that session expired ${new Date(body.e).toISOString()}. Sign in again and re-copy it.`);
  console.log(`seeding as ${body.n} → ${BASE}\n`);
} catch (e) {
  if (e && e.__seedFail) throw e;
  die("couldn't read that session token — check the whole value was copied.");
}

const JOBS = [
  { file: args.standard ? String(args.standard) : rel("../tmp/demo-season.json"),
    id: "demo-2026",   name: "Bozo Boyz (DEMO)",   format: "standard" },
  // ⚠️ The Royale file's own `leagueName` still says "Bozo Boyz (DEMO)" — it was
  // generated before the format had a name. Kap named it Bozo Royale, so the name is
  // set here rather than trusting the payload.
  { file: args.royale ? String(args.royale) : rel("../tmp/demo-royale-season.json"),
    id: "demo-royale", name: "Bozo Royale (DEMO)", format: "royale", buyback: 25 },
];

for (const job of JOBS) {
  let payload;
  try { payload = JSON.parse(readFileSync(job.file, "utf8")); }
  catch (e) { die(`could not read ${job.file}: ${e.message}`); }

  if (payload.synthetic !== true) die(`${job.file} is not marked synthetic — refusing to import it`);
  if (payload.format !== job.format)
    die(`${job.file} says format "${payload.format}" but this job expects "${job.format}"`);

  const body = {
    id: job.id, name: job.name, format: job.format, buyback: job.buyback || 0,
    season: payload.season, weeks: payload.weeks, weeksPlayed: payload.weeksPlayed,
    legs: payload.legs, note: payload.note,
    playersStatus: payload.playersStatus, chops: payload.chops, survivor: payload.survivor,
  };

  const res = await fetch(BASE + "/league/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dawg-Session": SESSION },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) die(`${job.id}: ${res.status} ${out.error || "import failed"}`);
  console.log(`${job.id}: ${out.legs} legs, ${out.players} players, format ${out.format}, synthetic ${out.synthetic}`);
}

console.log("\nBoth demos seeded. They carry a DEMO · SIMULATED badge everywhere they appear,");
console.log("are excluded from every aggregate, and are one click to hard-delete from the leagues card.");

/* ⚠️ Throws rather than calling process.exit(1).
   process.exit() while a fetch is still settling tears the event loop down under libuv
   and Node on Windows aborts with
     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
   printed AFTER the real error, which reads like the script crashed rather than declined.
   Setting exitCode and unwinding lets the process end on its own terms with the same
   status. */
function die(msg) {
  const e = new Error(msg);
  e.__seedFail = true;
  throw e;
}
