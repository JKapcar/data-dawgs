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
 * The session must belong to the SITE ADMIN. Copy it out of the browser:
 *   localStorage.getItem('dd.session')   on datadawgs216.com
 */
import { readFileSync } from "fs";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ") || true]));

const BASE = String(args.base || "https://toto.jkapcar4.workers.dev");
const SESSION = String(args.session || "");
if (!SESSION) die("--session is required (site admin's X-Dawg-Session)");

const JOBS = [
  { file: args.standard || "../tmp/demo-season.json",
    id: "demo-2026",   name: "Bozo Boyz (DEMO)",   format: "standard" },
  // ⚠️ The Royale file's own `leagueName` still says "Bozo Boyz (DEMO)" — it was
  // generated before the format had a name. Kap named it Bozo Royale, so the name is
  // set here rather than trusting the payload.
  { file: args.royale   || "../tmp/demo-royale-season.json",
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

function die(msg) { console.error("SEED FAILED: " + msg); process.exit(1); }
