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
 *     node seed-demo-leagues.mjs
 *
 * ⚠️ THE HAND-OFF GOES THROUGH A FILE, NOT THE CLIPBOARD, and that is not fussiness.
 * The clipboard version had an ordering trap with no way out: to run the command you had
 * to copy the command, which overwrote the session you had just copied. Anyone following
 * the instructions in order got a shell command posted to the server as their credential.
 * A file has no such ordering — the browser writes it, the script reads it whenever.
 *
 * ⚠️ And it is SHREDDED the moment it is read, before a single request goes out, because
 * a live session token sitting in Downloads is the one thing worse than one in shell
 * history: nobody ever looks there again.
 *
 * DD_SESSION and --session still work for automation. --session lands in shell history,
 * so prefer the other two.
 */
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { dirname, resolve, join } from "path";
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

// The browser drops the token here. Downloads is the only directory a page can reliably
// write to without the user choosing a location.
const DROP = args["session-file"] ? String(args["session-file"])
                                  : join(homedir(), "Downloads", "dd-session.txt");

const HOWTO =
  "  1. On datadawgs216.com, open the DevTools console (F12) and paste this ONE LINE:\n\n"
+ "     (()=>{const s=localStorage.getItem('dd-bozo-sess');if(!s)return'NOT SIGNED IN';"
+ "const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([s]));"
+ "a.download='dd-session.txt';a.click();return'saved — now run the seed script'})()\n\n"
+ "  2. Back here:  node seed-demo-leagues.mjs\n\n"
+ "     (the file is deleted the moment it is read)";

let SESSION = String(process.env.DD_SESSION || args.session || "").trim();
let fromFile = false;
if (!SESSION && existsSync(DROP)) {
  SESSION = readFileSync(DROP, "utf8").trim();
  fromFile = true;
}

// ⚠️ Catch the placeholder explicitly. It has been pasted literally once already, and the
// failure it produces — a 401 from the Worker — looks like an expired login rather than an
// unsubstituted argument, which sends you debugging the wrong thing.
if (/^PASTE|^<|^your[-_ ]?session/i.test(SESSION))
  die("that's a placeholder, not a session.\n\n" + HOWTO);
// ⚠️ Same class of mistake, one step later: the clipboard flow this replaced could hand
// the script a shell command instead of a token. Name it rather than posting it.
if (/^(cd |node |\$env:|PS )/i.test(SESSION))
  die("that's a shell command, not a session — the clipboard had the wrong thing in it.\n\n" + HOWTO);
if (!SESSION)
  die("no session found.\n\n" + HOWTO);

// A session is <base64url payload>.<hmac>. Decode the payload locally — not to trust it,
// only to fail fast and legibly on an expired or malformed one instead of on a 401.
try {
  const body = JSON.parse(Buffer.from(SESSION.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  if (!body.n || !body.e) die("that doesn't look like a Data Dawgs session token.");
  if (Date.now() > body.e) die(`that session expired ${new Date(body.e).toLocaleString()}. Sign in again and redo step 1.`);
  console.log(`seeding as ${body.n} → ${BASE}`);
} catch (e) {
  if (e && e.__seedFail) throw e;
  die("couldn't read that session token — the file didn't contain a whole one.\n\n" + HOWTO);
}

/* ⚠️ Shred it here — BEFORE the first request, not after the last one. A run that fails
   halfway must not leave a live credential sitting in Downloads, and that is exactly the
   run where someone walks away from the keyboard. Overwrite before unlinking so the bytes
   don't survive in a recoverable slack block. */
if (fromFile) {
  try {
    writeFileSync(DROP, "x".repeat(Math.max(64, SESSION.length)));
    unlinkSync(DROP);
    console.log(`read and deleted ${DROP}\n`);
  } catch (e) {
    console.error(`\n⚠️  COULD NOT DELETE ${DROP} — ${e.message}`);
    console.error(`   Delete it yourself: that file is a live login until ${new Date(JSON.parse(Buffer.from(SESSION.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()).e).toLocaleString()}\n`);
  }
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

  /* ⚠️ A SEASON DOES NOT FIT IN ONE REQUEST. The Worker caps request bodies at 24 KB —
     a shared defence on every route, not something to raise for one admin convenience —
     and the standard demo season is 112 KB of JSON. So the metadata goes with a first
     slice and the rest is appended.

     Batches are sized by measuring the serialised body rather than by counting legs,
     because the first one also carries the week table, the chop log and the roster. A
     fixed leg count would be either wasteful or, on the first batch, over the line. */
  const post = async (body) => {
    const res = await fetch(BASE + "/league/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dawg-Session": SESSION },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) die(`${job.id}: ${res.status} ${out.error || "import failed"}`);
    return out;
  };

  const LIMIT = 20000;                          // 24 KB ceiling, with room for headers
  const meta = {
    id: job.id, name: job.name, format: job.format, buyback: job.buyback || 0,
    season: payload.season, weeks: payload.weeks, weeksPlayed: payload.weeksPlayed,
    note: payload.note, players: payload.players,
    playersStatus: payload.playersStatus, chops: payload.chops, survivor: payload.survivor,
  };

  const remaining = payload.legs.slice();
  let sent = 0, batches = 0, first = true;
  while (remaining.length) {
    const base = first ? { ...meta, legs: [] } : { id: job.id, append: true, legs: [] };
    const slice = [];
    while (remaining.length) {
      slice.push(remaining[0]);
      if (JSON.stringify({ ...base, legs: slice }).length > LIMIT) { slice.pop(); break; }
      remaining.shift();
    }
    if (!slice.length) die(`${job.id}: a single leg is bigger than the ${LIMIT} byte batch limit — something is wrong with the payload`);
    // `done` on the last batch clears the importing flag, and only then.
    await post({ ...base, legs: slice, done: remaining.length === 0 });
    sent += slice.length; batches++; first = false;
    process.stdout.write(`\r  ${job.id}: ${sent}/${payload.legs.length} legs …`);
  }
  process.stdout.write(`\r  ${job.id}: ${sent} legs in ${batches} batches, `
    + `${(payload.players || []).length} players, format ${job.format}, synthetic true\n`);
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
