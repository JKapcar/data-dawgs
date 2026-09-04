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

// Normal capture: API contract, immutable KV record, provenance and quote gates.
const kv = makeKV();
const first = await worker.scheduled(
  { cron: "9 * * * *", scheduledTime: T0 },
  { SGO_KEY: "top-secret", RL: kv },
  {},
);
ok("hourly trigger queries exactly one API page", calls.length === 1 && first.pages === 1);
const request = calls[0];
ok("request is NCAAF-only", request.url.searchParams.get("leagueID") === "NCAAF");
ok("request asks for the declared 24-to-25-hour window",
  Date.parse(request.url.searchParams.get("startsAfter")) === T0 + 24 * 3600e3 - 1 &&
  Date.parse(request.url.searchParams.get("startsBefore")) === T0 + 25 * 3600e3);
ok("API credential stays in a header, never the URL",
  !request.url.href.includes("top-secret") && request.init.headers["x-api-key"] === "top-secret");
ok("only main markets are requested and opposing sides are explicit",
  request.url.searchParams.get("oddID").includes("points-home-game-ml-home") &&
  request.url.searchParams.get("includeOpposingOdds") === "true" &&
  request.url.searchParams.get("includeAltLines") === "false");

const receiptKey = [...kv.store.keys()].find(k => k.startsWith("cfb:market:24h:2026:"));
const receipt = JSON.parse(kv.store.get(receiptKey));
ok("receipt is keyed by season, kickoff and event", /cfb:market:24h:2026:\d+:sgo-cfb-1/.test(receiptKey));
ok("capture time and lead are prospective facts",
  receipt.captured_at === "2026-08-20T12:09:00.000Z" && receipt.lead_seconds === 24.5 * 3600);
ok("named provider and machine-readable observation timestamp are recorded",
  receipt.source.provider === "SportsGameOdds" && receipt.source.observation_timestamp_available === true);
ok("valid paired book survives proportional devig",
  receipt.moneylines.length === 1 && receipt.moneylines[0].bookmaker === "draftkings" &&
  Math.abs(receipt.moneylines[0].home_probability_no_vig + receipt.moneylines[0].away_probability_no_vig - 1) < 1e-6);
ok("impossible hold and missing opposing side are published as rejected input",
  receipt.rejected_quotes.some(x => x.bookmaker === "bovada" && x.reason === "implausible-hold") &&
  receipt.rejected_quotes.some(x => x.bookmaker === "fanduel" && x.reason === "missing-opposing-side"));
ok("provider tier notice follows the receipt", /Amateur tier/.test(receipt.source.provider_notice));
ok("receipt carries a canonical SHA-256 snapshot id", /^[0-9a-f]{64}$/.test(receipt.integrity.snapshot_id));
ok("nothing is mislabelled as modelled, simulated or graded",
  receipt.grading.modelled === false && receipt.grading.simulation === false && receipt.grading.graded === false);
ok("operational last-run summary is separate from immutable data",
  kv.store.has("cfb:market:24h:last-run") && first.stored === 1 && first.priced === 1);

// Exact replay is idempotent. The provider call still happens because event IDs are
// only known after the filtered query, but the frozen receipt is not overwritten.
const immutablePutsBefore = kv.puts.filter(p => p.key === receiptKey).length;
const second = await worker.scheduled(
  { cron: "9 * * * *", scheduledTime: T0 }, { SGO_KEY: "top-secret", RL: kv }, {});
const immutablePutsAfter = kv.puts.filter(p => p.key === receiptKey).length;
ok("replaying a cron does not overwrite an existing receipt",
  second.existing === 1 && second.stored === 0 && immutablePutsBefore === immutablePutsAfter);

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

// API pagination is followed and every page remains inside the same local window.
mode = "pagination"; calls = [];
const pagedKV = makeKV();
const paged = await worker.scheduled(
  { cron: "9 * * * *", scheduledTime: T0 }, { SGO_KEY: "top-secret", RL: pagedKV }, {});
ok("provider pagination is exhausted before publishing", paged.pages === 2 && paged.stored === 2 && calls.length === 2);
ok("opaque provider cursor is passed unchanged", calls[1].url.searchParams.get("cursor") === "page-two");

// A rescheduled event gets a second immutable receipt because kickoff is in the key.
mode = "normal"; calls = [];
const T1 = T0 + 3600e3;
currentEvents = [event({ kickoff: T1 + 24.5 * 3600e3 })];
const rescheduled = await worker.scheduled(
  { cron: "9 * * * *", scheduledTime: T1 }, { SGO_KEY: "top-secret", RL: kv }, {});
ok("reschedule creates a new receipt instead of rewriting the old one",
  rescheduled.stored === 1 && [...kv.store.keys()].filter(k => k.endsWith(":sgo-cfb-1")).length === 2);

// An event can be honestly frozen as unpriced; absence is evidence, not a dropped row.
currentEvents = [event({ id: "no-price", kickoff: T1 + 24.6 * 3600e3, prices: false })];
const noPrice = await worker.scheduled(
  { cron: "9 * * * *", scheduledTime: T1 }, { SGO_KEY: "top-secret", RL: kv }, {});
const noPriceKey = [...kv.store.keys()].find(k => k.endsWith(":no-price"));
const noPriceRecord = JSON.parse(kv.store.get(noPriceKey));
ok("missing prices produce an explicit unpriced receipt", noPrice.unpriced === 1 && noPriceRecord.status === "unpriced");

// Provider and configuration failures leave an operational trail and publish no row.
mode = "rate-limit"; calls = [];
const failedKV = makeKV();
let rateThrew = false;
try {
  await worker.scheduled({ cron: "9 * * * *", scheduledTime: T0 }, { SGO_KEY: "top-secret", RL: failedKV }, {});
} catch (e) { rateThrew = /429/.test(e.message) && !e.message.includes("top-secret"); }
ok("provider failure propagates without leaking the credential", rateThrew);
ok("provider failure leaves lasterror but no receipt",
  failedKV.store.has("cfb:market:24h:lasterror") &&
  ![...failedKV.store.keys()].some(k => /^cfb:market:24h:2026:/.test(k)));

const missingKeyKV = makeKV();
let keyThrew = false;
try {
  await worker.scheduled({ cron: "9 * * * *", scheduledTime: T0 }, { RL: missingKeyKV }, {});
} catch (e) { keyThrew = /SGO_KEY/.test(e.message); }
ok("missing SGO secret fails by name", keyThrew && missingKeyKV.store.has("cfb:market:24h:lasterror"));

let unknownThrew = false;
try { await worker.scheduled({ cron: "17 4 * * *", scheduledTime: T0 }, { RL: makeKV() }, {}); }
catch (e) { unknownThrew = /unknown scheduled trigger/.test(e.message); }
ok("an undeclared cron fails closed instead of running the private backup", unknownThrew);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
