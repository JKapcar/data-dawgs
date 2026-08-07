/* Nightly RTDB backup — the scheduled() handler against the ASSEMBLED Worker,
   with only the network and KV faked. The backup is the last line of defence
   for the only unrecoverable data on the site, so the suite asserts not just
   that it writes, but that it stays READ-ONLY against Firebase and that a
   failed run leaves a post-mortem trail instead of dying silently.

   Run:  cd work && node test-backup.mjs
*/
import { webcrypto } from "crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from "../dawg-bot-worker.js";

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const DB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";
const WHOLE_DB = {
  bozo: { leagues: { main: { name: "Data Dawgs", week: 3 } } },
  drafts: { pepperoninipples: { simulated: true } },
  users: { Kap: { hash: "not-a-real-hash" } },
};

let netMode = "normal";                  // normal | denied
const fbRequests = [];                   // every RTDB call, with method
globalThis.fetch = async (input, init) => {
  const u = String(input instanceof URL ? input.href : (input && input.url) || input);
  const method = (init && init.method) || (input && input.method) || "GET";
  if (u.startsWith(DB)) {
    fbRequests.push({ u, method });
    if (netMode === "denied") return new Response('{"error":"Permission denied"}', { status: 401 });
    return new Response(JSON.stringify(WHOLE_DB), { status: 200 });
  }
  throw new Error("unexpected fetch: " + u);
};

// KV fake that records puts verbatim, options included.
const makeKV = () => {
  const store = new Map(), puts = [];
  return {
    store, puts,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, opts) { store.set(k, v); puts.push({ k, v, opts }); },
  };
};

const T0 = Date.parse("2026-09-15T09:00:00Z");

// -- a normal nightly run ----------------------------------------------------
{
  const kv = makeKV();
  await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s", RL: kv }, {});
  const dated = kv.puts.find((p) => p.k === "backup:2026-09-15");
  const latest = kv.puts.find((p) => p.k === "backup:latest");
  ok("dated snapshot written under backup:<day>", !!dated);
  ok("dated snapshot expires (180d), so KV prunes itself",
     dated && dated.opts && dated.opts.expirationTtl === 15552000);
  ok("backup:latest written with NO expiry — the floor never falls out",
     latest && !latest.opts);
  const parsed = dated && JSON.parse(dated.v);
  ok("payload records when it was taken", parsed && parsed.taken === "2026-09-15T09:00:00.000Z");
  ok("payload is the WHOLE database — users and bozoauth included, not a path list to forget",
     parsed && parsed.db && parsed.db.users && parsed.db.bozo && parsed.db.drafts && true);
  // Caught live 8/7: fbGet(env, "") builds `${DB}.json` — ".json" glued onto the
  // HOSTNAME, which DNS-fails as a Cloudflare 530. The root read must be "/" so the
  // URL is `${DB}/.json`. Assert the exact shape, not a prefix a mangled host also matches.
  ok("one RTDB read, at the root, host intact",
     fbRequests.length === 1 && fbRequests[0].u.startsWith(DB + "/.json?"));
  ok("backup is READ-ONLY against Firebase — no PUT/PATCH/DELETE ever",
     fbRequests.every((r) => r.method === "GET"));
  ok("no error key on a clean run", !kv.store.has("backup:lasterror"));
}

// -- second run same day overwrites, different day adds ----------------------
{
  const kv = makeKV();
  await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s", RL: kv }, {});
  await worker.scheduled({ scheduledTime: T0 + 86400000 }, { FB_SECRET: "s", RL: kv }, {});
  ok("next day gets its own key", kv.store.has("backup:2026-09-15") && kv.store.has("backup:2026-09-16"));
}

// -- DD_KV preferred over RL when both exist (same rule as survivor) ---------
{
  const dd = makeKV(), rl = makeKV();
  await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s", DD_KV: dd, RL: rl }, {});
  ok("DD_KV preferred over RL, matching survivorKV", dd.puts.length > 0 && rl.puts.length === 0);
}

// -- a failed run must scream, not shrug -------------------------------------
{
  netMode = "denied";
  const kv = makeKV();
  let threw = false;
  try { await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s", RL: kv }, {}); }
  catch (e) { threw = true; }
  ok("RTDB failure propagates so the cron log shows a failed run", threw);
  const err = kv.store.get("backup:lasterror");
  ok("…and leaves backup:lasterror for the post-mortem", !!err && /401/.test(err));
  ok("…without writing a corrupt snapshot", !kv.store.has("backup:2026-09-15") && !kv.store.has("backup:latest"));
  netMode = "normal";
}

// -- no KV binding is a hard error, not a silent no-op -----------------------
{
  let threw = false;
  try { await worker.scheduled({ scheduledTime: T0 }, { FB_SECRET: "s" }, {}); }
  catch (e) { threw = /no KV binding/.test(e.message); }
  ok("missing KV binding throws by name", threw);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
