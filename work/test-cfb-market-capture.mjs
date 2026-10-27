/* Prospectively timestamped CFB market receipts.
   Exercises the assembled Worker with only SportsGameOdds and KV faked.

   Run:  cd work && node test-cfb-market-capture.mjs
*/
import { webcrypto } from "crypto";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from "../dawg-bot-worker.js";

const WORK = dirname(fileURLToPath(import.meta.url));
const nflScheduleCsv = readFileSync(resolve(WORK, "../tests/fixtures/nflverse-games-sample.csv"), "utf8");
const cfbScheduleCsv = readFileSync(resolve(WORK, "../tests/fixtures/cfbfastr-schedule-2026-sample.csv"), "utf8");

let pass = 0, fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
};

const makeKV = () => {
  const store = new Map(), puts = [];
  return {
    store, puts,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value, options) { store.set(key, value); puts.push({ key, value, options }); },
    async list({ prefix = "", limit = 1000, cursor = "" } = {}) {
      const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const offset = cursor ? Number(cursor) : 0;
      const names = all.slice(offset, offset + limit);
      const next = offset + names.length;
      return {
        keys: names.map(name => ({ name })),
        list_complete: next >= all.length,
        cursor: next >= all.length ? "" : String(next),
      };
    },
  };
};

const T0 = Date.parse("2026-08-20T12:09:00.000Z");
const kickoffAt = ms => new Date(ms).toISOString();
const event = ({
  id = "sgo-cfb-1",
  kickoff = T0 + 24.5 * 3600e3,
  home = "CLEVELAND_STATE_NCAAF",
  away = "AKRON_NCAAF",
  prices = true,
} = {}) => ({
  eventID: id,
  sportID: "FOOTBALL",
  leagueID: "NCAAF",
  teams: {
    home: { teamID: home, names: { long: home.replace(/_NCAAF$/, "").replaceAll("_", " "), short: "HME" } },
    away: { teamID: away, names: { long: away.replace(/_NCAAF$/, "").replaceAll("_", " "), short: "AWY" } },
  },
  status: { startsAt: kickoffAt(kickoff), started: false, ended: false },
  odds: prices ? {
    "points-home-game-ml-home": {
      byBookmaker: {
        draftkings: { odds: "-150", available: true, lastUpdatedAt: "2026-08-20T12:05:00.000Z" },
        bovada: { odds: "-200", available: true, lastUpdatedAt: "2026-08-20T12:04:00.000Z" },
        fanduel: { odds: "-145", available: true, lastUpdatedAt: "2026-08-20T12:03:00.000Z" },
      },
    },
    "points-away-game-ml-away": {
      byBookmaker: {
        draftkings: { odds: "+130", available: true, lastUpdatedAt: "2026-08-20T12:05:00.000Z" },
        bovada: { odds: "-200", available: true, lastUpdatedAt: "2026-08-20T12:04:00.000Z" },
      },
    },
  } : {},
});

let mode = "normal";
let calls = [];
let currentEvents = [event()];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof URL ? input.href : (input && input.url) || input));
  if (url.origin === "https://raw.githubusercontent.com") {
    if (init.headers && init.headers["If-None-Match"] === '"fixture"') return new Response(null, { status: 304 });
    const body = url.pathname.includes("nflverse/") ? nflScheduleCsv : cfbScheduleCsv;
    return new Response(body, { status: 200, headers: { ETag: '"fixture"' } });
  }
  calls.push({ url, init });
  if (url.origin !== "https://api.sportsgameodds.com") throw new Error("unexpected fetch: " + url);
  if (mode === "rate-limit") {
    return new Response(JSON.stringify({ success: false, error: "monthly object limit" }), {
      status: 429, headers: { "Content-Type": "application/json" },
    });
  }
  if (mode === "non-json") return new Response("gateway exploded", { status: 502 });
  if (mode === "pagination") {
    const cursor = url.searchParams.get("cursor");
    const data = cursor ? [event({ id: "page-2" })] : [event({ id: "page-1" })];
    return new Response(JSON.stringify({ success: true, data, nextCursor: cursor ? null : "page-two" }), { status: 200 });
  }
  return new Response(JSON.stringify({
    success: true,
    notice: "Amateur tier bookmaker filter applied",
    data: currentEvents,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

// Existing immutable receipts remain readable; scheduled ticks buy nothing.
const kv = makeKV();
const receiptKey = 'cfb:market:24h:2026:1787313600000:sgo-cfb-1';
const receipt = {schema_version:1,event_id:'sgo-cfb-1',season:2026,
 kickoff:'2026-08-21T12:00:00.000Z',captured_at:'2026-08-20T12:09:00.000Z',
 source:{provider:'SportsGameOdds'},moneylines:[{bookmaker:'draftkings',home_price:-150,away_price:130}]};
const original = JSON.stringify(receipt);
kv.store.set(receiptKey,original);
for (const key of ['fixture', undefined]) for (const minutes of [0,5,60,120]) {
 const result = await worker.scheduled({cron:'9 * * * *',scheduledTime:T0+minutes*60000},
  {SGO_KEY:key,RL:kv},{});
 ok('hourly collector explicitly skipped',result.skipped==='bozo_selections_only');
}
ok('repeated ticks and missing provider key spend zero requests',calls.length===0);
ok('existing immutable receipt is untouched',kv.store.get(receiptKey)===original && !kv.puts.some(p=>p.key===receiptKey));
ok('free schedule refresh still runs',kv.puts.some(p=>/schedule/.test(p.key)));

// Public export uses a fenced prefix and a standard data envelope.
const publicResponse = await worker.fetch(new Request(
  "https://toto.example/cfb/market-snapshots?season=2026&limit=50",
  { headers: { Origin: "https://datadawgs216.com" } },
), { RL: kv });
const publicBody = await publicResponse.json();
ok("public export is a standard dated envelope",
  publicResponse.status === 200 && publicBody.as_of === "2026-08-20" && publicBody.source && publicBody.canonical_url);
ok("public export returns only the requested season receipts",
  publicBody.data.season === 2026 && publicBody.data.records.length === 1 && publicBody.data.complete === true);
ok("public export never leaks the SGO credential or operational keys",
  !JSON.stringify(publicBody).includes("top-secret") && !JSON.stringify(publicBody).includes("last-run"));
ok("public export is briefly cacheable and CORS-safe",
  publicResponse.headers.get("Cache-Control") === "public, max-age=300" &&
  publicResponse.headers.get("Access-Control-Allow-Origin") === "https://datadawgs216.com");

const badSeason = await worker.fetch(new Request(
  "https://toto.example/cfb/market-snapshots?season=nope"), { RL: kv });
ok("public export rejects an invalid season", badSeason.status === 400);
const wrongMethod = await worker.fetch(new Request(
  "https://toto.example/cfb/market-snapshots", { method: "POST" }), { RL: kv });
ok("public export is read-only", wrongMethod.status === 405);

let unknownThrew = false;
try { await worker.scheduled({ cron: "17 4 * * *", scheduledTime: T0 }, { RL: makeKV() }, {}); }
catch (e) { unknownThrew = /unknown scheduled trigger/.test(e.message); }
ok("an undeclared cron fails closed instead of running the private backup", unknownThrew);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
