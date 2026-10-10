/* Ops health: the read side of every scheduled job's lasterror trail.
   Exercises the ASSEMBLED Worker with only the network (Firebase, GitHub, SportsGameOdds,
   the schedule sources) and KV faked, plus a sandboxed slice for the outcome rules.

   Proves: a no-op tick does not clear a failure and a real success does; exactly one KV write
   per transition; at most one heartbeat write per cron per hour; GET /ops/health never carries
   error text or a planted secret; and a KV that throws inside the bookkeeping leaves every job
   result, and every non-ops write, exactly as it was.

   Run:  cd work && node test-ops-health.mjs
*/
import { webcrypto } from "crypto";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import vm from "vm";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from "../dawg-bot-worker.js";

const WORK = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(WORK, "../dawg-bot-worker.js"), "utf8");
const nflCsv = readFileSync(resolve(WORK, "../tests/fixtures/nflverse-games-sample.csv"), "utf8");
const cfbCsv = readFileSync(resolve(WORK, "../tests/fixtures/cfbfastr-schedule-2026-sample.csv"), "utf8");

let pass = 0, fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
};
let unhandled = 0;
process.on("unhandledRejection", () => { unhandled++; });

const SECRET = "top-secret";
const DB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";

// KV fake that honours get(key, "json"), records every put, and can be told to fail.
const makeKV = (throwOn = () => false) => {
  const store = new Map(), puts = [];
  return {
    store, puts,
    async get(key, type) {
      if (throwOn(key)) throw new Error("KV unavailable");
      const v = store.has(key) ? store.get(key) : null;
      const t = typeof type === "string" ? type : type && type.type;
      return t === "json" && v !== null ? JSON.parse(v) : v;
    },
    async put(key, value, options) {
      if (throwOn(key)) throw new Error("KV unavailable");
      store.set(key, value); puts.push({ key, value, options });
    },
    async list() { return { keys: [], list_complete: true, cursor: "" }; },
  };
};
const opsPuts = (kv, key) => kv.puts.filter(p => p.key === key);

// Network fake. github: 204 | 500. firebase: "ok" | "leaks" (a thrown error carrying the URL,
// and with it the auth secret). sgo: "ok" | "rate-limit".
const net = { github: 204, firebase: "ok", sgo: "ok" };
const sgoEvent = (T0) => ({
  eventID: "sgo-cfb-1", sportID: "FOOTBALL", leagueID: "NCAAF",
  teams: { home: { teamID: "CLEVELAND_STATE_NCAAF", names: { long: "CLEVELAND STATE", short: "HME" } },
           away: { teamID: "AKRON_NCAAF", names: { long: "AKRON", short: "AWY" } } },
  status: { startsAt: new Date(T0 + 24.5 * 3600e3).toISOString(), started: false, ended: false },
  odds: { "points-home-game-ml-home": { byBookmaker: { draftkings: { odds: "-150", available: true, lastUpdatedAt: new Date(T0 - 4 * 6e4).toISOString() } } },
          "points-away-game-ml-away": { byBookmaker: { draftkings: { odds: "+130", available: true, lastUpdatedAt: new Date(T0 - 4 * 6e4).toISOString() } } } },
});
let sgoT0 = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof URL ? input.href : (input && input.url) || input));
  if (url.origin === DB) {
    if (net.firebase === "leaks") throw new Error("connect ECONNREFUSED " + url.href);
    const path = url.pathname.replace(/\.json$/, "");
    const method = (init && init.method) || "GET";
    if (method !== "GET") return new Response("null", { status: 200 });
    const body = path === "/forecast/live/lease" ? { until: 9e15 } : path === "/bozo/leagues" ? {} : null;
    return new Response(JSON.stringify(body), { status: 200, headers: { ETag: '"e1"' } });
  }
  if (url.origin === "https://api.github.com") return new Response(null, { status: net.github });
  if (url.origin === "https://raw.githubusercontent.com") {
    return new Response(url.pathname.includes("nflverse/") ? nflCsv : cfbCsv, { status: 200, headers: { ETag: '"fixture"' } });
  }
  if (url.origin === "https://api.sportsgameodds.com") {
    if (net.sgo === "rate-limit") return new Response(JSON.stringify({ success: false, error: "monthly object limit" }), { status: 429 });
    return new Response(JSON.stringify({ success: true, data: [sgoEvent(sgoT0)] }), { status: 200 });
  }
  return new Response("not found", { status: 404 });
};

// Run one tick and let every waitUntil branch settle, as the runtime would.
async function tick(cron, at, env) {
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  let result, error = null;
  try { result = await worker.scheduled({ cron, scheduledTime: at }, env, ctx); }
  catch (e) { error = e; }
  await Promise.allSettled(pending);
  return { result, error };
}
const FIVE = "*/5 * * * *", HOURLY = "9 * * * *", DAILY = "0 9 * * *";
const at = iso => Date.parse(iso);
const health = (kv, job) => { const v = kv.store.get("ops:health:" + job); return v ? JSON.parse(v) : null; };

// The route memoises for a minute per isolate; step the clock past it for each read.
let clock = Date.parse("2030-01-01T00:00:00Z");
async function readRoute(env) {
  const realNow = Date.now;
  clock += 61e3;
  Date.now = () => clock;
  try {
    const res = await worker.fetch(new Request("https://toto.jkapcar4.workers.dev/ops/health"), env);
    return { res, text: await res.text() };
  } finally { Date.now = realNow; }
}

// ---- 1. Transitions: a failure is recorded once, a no-op never clears it, a real success does.
{
  const kv = makeKV();
  const env = { GH_DISPATCH_TOKEN: SECRET, FB_SECRET: SECRET, RL: kv };
  net.github = 500;
  await tick(FIVE, at("2026-10-10T10:17:00Z"), env);         // nfl-data slot due → dispatch fails
  const first = health(kv, "gh:pacer");
  ok("a failed dispatch marks gh:pacer failing, since the tick that saw it",
    first && first.failing === true && first.since === "2026-10-10T10:17:00.000Z" && first.last_ok_at === null);
  await tick(FIVE, at("2026-10-10T10:22:00Z"), env);         // retried inside the grace, fails again
  ok("a repeated failure writes nothing", opsPuts(kv, "ops:health:gh:pacer").length === 1);
  await tick(FIVE, at("2026-10-10T11:00:00Z"), env);         // nothing due: a no-op tick
  const held = health(kv, "gh:pacer");
  ok("a no-op tick does not clear the failure", held.failing === true && held.since === "2026-10-10T10:17:00.000Z");
  ok("…and writes nothing", opsPuts(kv, "ops:health:gh:pacer").length === 1);
  net.github = 204;
  await tick(FIVE, at("2026-10-10T11:41:00Z"), env);         // cfb-data slot due → dispatch succeeds
  const healed = health(kv, "gh:pacer");
  ok("a real success clears it", healed.failing === false && healed.since === null && healed.last_ok_at === "2026-10-10T11:41:00.000Z");
  await tick(FIVE, at("2026-10-10T11:46:00Z"), env);         // epa-daily slot: another success
  ok("one write per transition: two transitions, two writes", opsPuts(kv, "ops:health:gh:pacer").length === 2);
  ok("jobs that only no-op'd never wrote health at all",
    ["bozo:close", "bozo:scores", "bozo:nearclose", "bozo:autograde", "forecast:live"].every(j => !kv.store.has("ops:health:" + j)));
  ok("the existing lasterror trail is untouched by a dispatch failure (it never threw)", !kv.store.has("gh:pacer:lasterror"));
}

// ---- 2. Heartbeat: at most one write per cron per hour, so a stopped cron reads as silent.
{
  const kv = makeKV();
  const env = { FB_SECRET: SECRET, SGO_KEY: SECRET, RL: kv };
  const T = at("2026-10-11T00:00:00Z");
  for (let i = 0; i <= 13; i++) await tick(FIVE, T + i * 5 * 6e4, env);       // 65 minutes of ticks
  const beats = opsPuts(kv, "ops:cron:" + FIVE).map(p => JSON.parse(p.value).last_fired_at);
  ok("14 five-minute ticks over 65 minutes write the heartbeat twice",
    beats.length === 2 && beats[0] === "2026-10-11T00:00:00.000Z" && beats[1] === "2026-10-11T01:00:00.000Z", JSON.stringify(beats));
  net.sgo = "ok"; sgoT0 = T;
  for (const offset of [0, 30, 60, 120]) await tick(HOURLY, T + offset * 6e4, env);
  const hourly = opsPuts(kv, "ops:cron:" + HOURLY).map(p => Date.parse(JSON.parse(p.value).last_fired_at));
  ok("the hourly cron's heartbeat is never written twice inside an hour",
    hourly.length === 3 && hourly.every((t, i) => i === 0 || t - hourly[i - 1] >= 3600e3), JSON.stringify(hourly));
  await tick(DAILY, at("2026-10-11T09:00:00Z"), env);
  ok("the daily backup cron beats too", kv.store.has("ops:cron:" + DAILY));
  ok("a successful hourly run records both of its jobs healthy",
    health(kv, "cfb:market:24h").failing === false && health(kv, "bozo:schedule").failing === false);
  ok("a successful backup records backup healthy", health(kv, "backup") && health(kv, "backup").failing === false);
  const noCron = makeKV();
  await tick(undefined, at("2026-10-11T09:00:00Z"), { FB_SECRET: SECRET, RL: noCron });
  ok("a manual call with no cron name writes no heartbeat", ![...noCron.store.keys()].some(k => k.startsWith("ops:cron:")));
}

// ---- 3. The route: job names and timestamps only — never error text, never a secret.
{
  const kv = makeKV();
  const env = { GH_DISPATCH_TOKEN: SECRET, FB_SECRET: SECRET, SGO_KEY: SECRET, RL: kv };
  net.firebase = "leaks";                                     // errors now carry ?auth=top-secret
  await tick(FIVE, at("2026-10-12T10:17:00Z"), env);
  net.firebase = "ok";
  net.sgo = "rate-limit";
  const hourly = await tick(HOURLY, at("2026-10-12T11:09:00Z"), env);
  net.sgo = "ok";
  ok("a failing market capture still fails its tick, as before", hourly.error && /429/.test(hourly.error.message));
  const trail = kv.store.get("forecast:live:lasterror") || "";
  ok("forecast-live now leaves a lasterror trail in the same pattern",
    /"at":/.test(trail) && trail.includes(SECRET), "(the trail is a private post-mortem; the route must not echo it)");
  ok("autograde's trail also carries the leaked secret, for the route to prove it never echoes",
    (kv.store.get("bozo:autograde:lasterror") || "").includes(SECRET));
  const { res, text } = await readRoute(env);
  const body = JSON.parse(text);
  ok("GET /ops/health answers 200 JSON", res.status === 200 && /application\/json/.test(res.headers.get("Content-Type")));
  ok("cached for about a minute", res.headers.get("Cache-Control") === "public, max-age=60");
  const byJob = Object.fromEntries(body.jobs.map(j => [j.job, j]));
  ok("every job is listed, failing or not",
    ["bozo:close", "bozo:scores", "bozo:nearclose", "bozo:autograde", "gh:pacer", "forecast:live", "cfb:market:24h", "bozo:schedule", "backup"]
      .every(j => byJob[j] && typeof byJob[j].failing === "boolean"));
  ok("failing jobs carry the tick that first saw them",
    byJob["forecast:live"].failing && byJob["forecast:live"].since === "2026-10-12T10:17:00.000Z" &&
    byJob["bozo:autograde"].failing && byJob["cfb:market:24h"].failing && byJob["cfb:market:24h"].since === "2026-10-12T11:09:00.000Z");
  ok("crons carry their last heartbeat",
    body.crons.find(c => c.cron === FIVE).last_fired_at === "2026-10-12T10:17:00.000Z" &&
    body.crons.find(c => c.cron === HOURLY).last_fired_at === "2026-10-12T11:09:00.000Z" &&
    body.crons.find(c => c.cron === DAILY).last_fired_at === null);
  const errorTexts = [...kv.store.entries()].filter(([k]) => k.endsWith(":lasterror")).map(([, v]) => JSON.parse(v).error);
  ok("the planted secret never reaches the route", !text.includes(SECRET) && !text.includes("auth="));
  ok("no lasterror text reaches the route", errorTexts.length >= 3 && errorTexts.every(e => !text.includes(e)));
  ok("no provider or database detail reaches the route", !/429|RTDB|ECONNREFUSED|firebaseio|monthly object limit/i.test(text));
  ok("each job row is exactly {job, cron, failing, since, last_ok_at}",
    body.jobs.every(j => Object.keys(j).sort().join() === "cron,failing,job,last_ok_at,since"));
  // Memoised for a minute: a read inside the minute is the same body.
  const realNow = Date.now; Date.now = () => clock + 30e3;
  let again;
  try { again = await (await worker.fetch(new Request("https://toto.jkapcar4.workers.dev/ops/health"), env)).text(); }
  finally { Date.now = realNow; }
  ok("a read inside the minute is served from the isolate copy", again === text);
  const post = await worker.fetch(new Request("https://toto.jkapcar4.workers.dev/ops/health", { method: "POST" }), env);
  ok("only GET is served", post.status === 405);
  const { res: noKv } = await readRoute({});
  ok("no KV binding answers 503 with a fixed message", noKv.status === 503);
}

// ---- 4. Bookkeeping is its own failure domain: a KV that throws on every ops key leaves
//         every job result, and every non-ops write, identical.
{
  const strip = kv => kv.puts.filter(p => !p.key.startsWith("ops:"))
    .map(p => p.key + "=" + String(p.value).replace(/"at":"[^"]*"/g, '"at":"…"'));
  const runAll = async kv => {
    const env = { GH_DISPATCH_TOKEN: SECRET, FB_SECRET: SECRET, SGO_KEY: SECRET, RL: kv };
    const out = [];
    net.github = 500; out.push(await tick(FIVE, at("2026-10-13T10:17:00Z"), env));
    net.github = 204; out.push(await tick(FIVE, at("2026-10-13T11:41:00Z"), env));
    sgoT0 = at("2026-10-13T12:09:00Z"); out.push(await tick(HOURLY, sgoT0, env));
    net.sgo = "rate-limit"; out.push(await tick(HOURLY, at("2026-10-13T13:09:00Z"), env)); net.sgo = "ok";
    out.push(await tick(DAILY, at("2026-10-14T09:00:00Z"), env));
    return out.map(o => JSON.stringify({ result: o.result, error: o.error && o.error.message }));
  };
  const good = makeKV(), broken = makeKV(k => k.startsWith("ops:"));
  const a = await runAll(good), b = await runAll(broken);
  ok("job results are identical with the ops KV throwing", a.join("\n") === b.join("\n"), a.find((x, i) => x !== b[i]));
  ok("non-ops writes (receipts, last-run, lasterror) are identical", strip(good).join("\n") === strip(broken).join("\n"));
  ok("…and the broken KV really did refuse every ops write", ![...broken.store.keys()].some(k => k.startsWith("ops:")) &&
    [...good.store.keys()].some(k => k.startsWith("ops:")));
  ok("no unhandled rejection escaped the bookkeeping", unhandled === 0);
}

// ---- 5. The outcome rules, sandboxed: what counts as a failure, a real success, a no-op.
{
  const start = SOURCE.indexOf("function opsOutcome(job, r) {");
  const end = SOURCE.indexOf("\n}\n", start) + 3;
  const box = {};
  vm.createContext(box);
  vm.runInContext(SOURCE.slice(start, end) + "\nthis.opsOutcome = opsOutcome;", box);
  const o = box.opsOutcome;
  const cases = [
    ["bozo:close", { error: "boom" }, "fail", "a thrown job reaches health as { error }"],
    ["bozo:close", { captured: 1, skipped: 0, checked: 1 }, "ok", "a captured close"],
    ["bozo:close", { captured: 0, skipped: 3, checked: 3 }, "noop", "skips alone are not a success"],
    ["bozo:close", { captured: 0, skipped: 0, checked: 0 }, "noop", "nothing near kickoff"],
    ["bozo:scores", { nfl: { due: 1, refreshed: true, error: "provider_error" }, cfb: { due: 0 } }, "fail", "a refused refresh"],
    ["bozo:scores", { nfl: { due: 1, refreshed: true, error: null }, cfb: { due: 0 } }, "ok", "a refreshed archive"],
    ["bozo:scores", { nfl: { due: 2, refreshed: false, error: "provider_error" }, cfb: { due: 0 } }, "noop", "a throttled tick is not a new attempt"],
    ["bozo:scores", { nfl: { skipped: "no_schedule" }, cfb: { skipped: "no_schedule" } }, "noop", "no schedule"],
    ["bozo:nearclose", { nfl: { error: "quota_exceeded" }, cfb: { skipped: "no_kickoff_in_gate" } }, "fail", "a refused sport"],
    ["bozo:nearclose", { nfl: { events: 3, stored: 1, unpriced: 0 }, cfb: { skipped: "no_kickoff_in_gate" } }, "ok", "a fetched slate"],
    ["bozo:nearclose", { skipped: "sgo_unconfigured" }, "noop", "unconfigured"],
    ["bozo:autograde", { checked: 1, leagues: [{ league: "a", error: "bad state" }] }, "fail", "a league that errored"],
    ["bozo:autograde", { checked: 1, leagues: [{ league: "a", week: 5, graded: false, wrote: false }] }, "ok", "a league evaluated"],
    ["bozo:autograde", { checked: 1, leagues: [{ league: "a", skipped: "already-decided" }] }, "noop", "an already-decided week"],
    ["gh:pacer", { skipped: "token_unset" }, "noop", "inert pacer"],
    ["gh:pacer", { at: "x", due: 1, dispatched: ["nfl-data.yml"], failed: [] }, "ok", "a dispatch"],
    ["gh:pacer", { at: "x", due: 2, dispatched: ["a"], failed: [{ workflow: "b", status: 500 }] }, "fail", "a failed dispatch outweighs a good one"],
    ["forecast:live", { status: "already_running" }, "noop", "lease held elsewhere"],
    ["forecast:live", { status: "attention", missing_upcoming: ["g"] }, "ok", "a completed run, whatever the data says"],
    ["cfb:market:24h", { events: 0, stored: 0 }, "ok", "a completed capture"],
    ["bozo:schedule", [{ sport: "nfl" }, { sport: "cfb" }], "ok", "a completed refresh"],
    ["backup", { day: "2026-10-10", bytes: 10 }, "ok", "a completed backup"],
  ];
  for (const [job, r, want, why] of cases) ok(`outcome ${job}: ${why} → ${want}`, o(job, r) === want, o(job, r));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
