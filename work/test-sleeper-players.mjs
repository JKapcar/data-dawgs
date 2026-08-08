/* GET /sleeper/players-slim — the Worker's daily-cached slim Sleeper player index.
   Exercises the assembled Worker with only Sleeper and KV faked.

   Run:  cd work && node test-sleeper-players.mjs
*/
import { webcrypto } from "crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from "../dawg-bot-worker.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
};

const makeKV = () => {
  const store = new Map(), puts = [];
  return {
    store, puts,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, o) { store.set(k, v); puts.push({ key: k, value: v, options: o }); },
    async list() { return { keys: [], list_complete: true, cursor: "" }; },
  };
};

/* Upstream fixture: enough active fantasy players to clear the fail-closed floor,
   plus the shapes that must be dropped or normalised. */
const upstream = {};
for (let i = 0; i < 600; i++) upstream["f" + i] = { active: true, position: ["QB", "RB", "WR", "TE", "K"][i % 5], full_name: "Filler Player" + i, team: i % 3 ? "CLE" : null };
upstream["4046"] = { active: true, position: "RB", full_name: "Real Back", team: "CLE" };
upstream["9999"] = { active: false, position: "RB", full_name: "Retired Guy", team: null };       // inactive -> dropped
upstream["7777"] = { active: true, position: "OL", full_name: "Blocking Only", team: "PIT" };     // non-fantasy -> dropped
upstream["CLE"]  = { active: true, position: "DEF", first_name: "Cleveland", last_name: "Browns", team: "CLE" }; // DEF has no full_name

let sleeperCalls = 0, sleeperMode = "up";
globalThis.fetch = async (input) => {
  const url = String(input instanceof URL ? input.href : (input && input.url) || input);
  if (!url.startsWith("https://api.sleeper.app/v1/players/nfl")) throw new Error("unexpected fetch: " + url);
  sleeperCalls++;
  if (sleeperMode === "down") return new Response("boom", { status: 500 });
  return new Response(JSON.stringify(upstream), { status: 200, headers: { "Content-Type": "application/json" } });
};

const req = (method = "GET") => new Request("https://toto.jkapcar4.workers.dev/sleeper/players-slim", { method });

/* 1 — method gate */
{
  const env = { RL: makeKV() };
  const r = await worker.fetch(req("POST"), env);
  ok("POST is refused with 405", r.status === 405);
}

/* 2 — no KV binding fails closed */
{
  const r = await worker.fetch(req(), {});
  ok("missing KV is a 503, not a crash", r.status === 503);
}

/* 3 — cold cache: fetches upstream once, slims, stores, serves the envelope */
{
  const env = { RL: makeKV() };
  sleeperCalls = 0;
  const r = await worker.fetch(req(), env);
  const j = await r.json();
  ok("cold cache serves 200", r.status === 200);
  ok("upstream fetched exactly once", sleeperCalls === 1, "calls=" + sleeperCalls);
  ok("envelope carries as_of/source/built", !!j.as_of && !!j.source && !!j.built);
  ok("active fantasy player kept", Array.isArray(j.data.players["4046"]) && j.data.players["4046"][0] === "Real Back");
  ok("inactive player dropped", !("9999" in j.data.players));
  ok("non-fantasy position dropped", !("7777" in j.data.players));
  ok("DEF name assembled from first+last", j.data.players["CLE"] && j.data.players["CLE"][0] === "Cleveland Browns");
  ok("count matches kept players", j.data.count === Object.keys(j.data.players).length);
  ok("index stored in KV", env.RL.store.has("sleeper:players:slim"));
  ok("cache header set for the edge", (r.headers.get("Cache-Control") || "").includes("max-age=3600"));

  /* 4 — warm cache: served from KV, no second upstream call */
  const r2 = await worker.fetch(req(), env);
  ok("warm cache serves 200", r2.status === 200);
  ok("warm cache does NOT refetch upstream", sleeperCalls === 1, "calls=" + sleeperCalls);

  /* 5 — stale cache + upstream down: serves stale and says so */
  const stored = JSON.parse(env.RL.store.get("sleeper:players:slim"));
  stored.built = new Date(Date.now() - 25 * 3600e3).toISOString();
  env.RL.store.set("sleeper:players:slim", JSON.stringify(stored));
  sleeperMode = "down";
  const r3 = await worker.fetch(req(), env);
  const j3 = await r3.json();
  ok("stale copy still serves 200 when upstream is down", r3.status === 200);
  ok("stale response is marked stale", r3.headers.get("X-DD-Stale") === "1" && /STALE/.test(j3.note));
  sleeperMode = "up";
}

/* 6 — no cache + upstream down = 503, never an invented payload */
{
  const env = { RL: makeKV() };
  sleeperMode = "down";
  const r = await worker.fetch(req(), env);
  ok("cold cache + upstream down is a 503", r.status === 503);
  sleeperMode = "up";
}

/* 7 — implausibly small upstream fails closed instead of caching junk */
{
  const env = { RL: makeKV() };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ a: { active: true, position: "RB", full_name: "Lonely", team: null } }), { status: 200 });
  const r = await worker.fetch(req(), env);
  ok("tiny upstream index is refused (503) and not cached",
    r.status === 503 && !env.RL.store.has("sleeper:players:slim"));
  globalThis.fetch = realFetch;
}

console.log("\nsleeper-players: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
