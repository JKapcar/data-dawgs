/* Personal draft-state transport contract against the assembled Worker.
 * Only the network is faked: routing, session verification, schema validation,
 * byte caps, Firebase ETags, CAS conflicts and CORS all run through production code.
 *
 * Run: cd work && node test-draft-state.mjs
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import worker from "../dawg-bot-worker.js";
import draftLeague from "../draft-league.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const DB_HOST = "data-dawgs-draft-default-rtdb.firebaseio.com";
const ENV = { FB_SECRET: "firebase-test", BOZO_PEPPER: "draft-state-test-pepper" };
const LEAGUE_ID = "dd_" + "a".repeat(32);
const OTHER_ID = "dd_" + "b".repeat(32);
const UID = "u_testaccount00000000000001";
const ORIGIN = "https://datadawgs216.com";

let db;
let etags;
let forceRace;
let omitEtag;
function reset() {
  db = {
    users: { [UID]: { name: "Kap", passwordSetAt: 0, draftState: {} } },
    leagues: {
      [LEAGUE_ID]: { game: "draft", name: "Draft rehearsal" },
      [OTHER_ID]: { game: "bozo", name: "Wrong game" },
    },
    // Deliberately separate shared state. Personal writes must never copy or mutate it.
    drafts: { [LEAGUE_ID]: { state: { picks: [{ player: "Shared Pick" }] } } },
  };
  etags = new Map();
  forceRace = false;
  omitEtag = false;
}

const splitPath = pathname => pathname.replace(/^\//, "").replace(/\.json$/, "").split("/").filter(Boolean).map(decodeURIComponent);
function getAt(parts) {
  let node = db;
  for (const part of parts) {
    if (!node || typeof node !== "object" || !(part in node)) return null;
    node = node[part];
  }
  return node;
}
function setAt(parts, value) {
  let node = db;
  for (const part of parts.slice(0, -1)) node = node[part] ||= {};
  node[parts.at(-1)] = value;
}
function etagFor(parts) {
  const key = parts.join("/");
  if (!etags.has(key)) etags.set(key, 1);
  return `"${etags.get(key)}"`;
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname !== DB_HOST) throw new Error("unexpected fetch: " + url);
  const parts = splitPath(url.pathname);
  const method = String(init.method || "GET").toUpperCase();
  if (method === "GET") {
    const headers = !omitEtag && init.headers && (init.headers["X-Firebase-ETag"] || init.headers.get?.("X-Firebase-ETag"))
      ? { ETag: etagFor(parts) } : {};
    return new Response(JSON.stringify(getAt(parts)), { status: 200, headers });
  }
  if (method === "PUT") {
    const key = parts.join("/");
    const match = init.headers && (init.headers["if-match"] || init.headers.get?.("if-match"));
    if (forceRace || (match && match !== etagFor(parts))) {
      forceRace = false;
      return new Response("null", { status: 412 });
    }
    setAt(parts, JSON.parse(init.body));
    etags.set(key, (etags.get(key) || 1) + 1);
    return new Response("null", { status: 200 });
  }
  throw new Error("unexpected RTDB method: " + method);
};

const te = new TextEncoder();
const b64url = value => btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sessionFor(uid = UID) {
  const payload = b64url(JSON.stringify({ u: uid, n: "Kap", e: Date.now() + 86_400_000, p: 0 }));
  const key = await crypto.subtle.importKey("raw", te.encode(ENV.BOZO_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(payload));
  return payload + "." + b64url(String.fromCharCode(...new Uint8Array(sig)));
}

const EMPTY = {
  filters: { query: "", position: "ALL", hideTaken: false, taggedOnly: false,
    sort: { key: "rank", direction: "asc" } },
  marks: [], keeperIds: [],
};
const request = async ({ method = "GET", league = LEAGUE_ID, token, body, headers = {} } = {}) => {
  const url = new URL("https://toto.example/auth/draft-state");
  if (league !== null) url.searchParams.append("league_id", league);
  const init = { method, headers: { Origin: ORIGIN, ...headers } };
  if (token) init.headers["X-Bozo-Session"] = token;
  if (body !== undefined) {
    init.headers["Content-Type"] ||= "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await worker.fetch(new Request(url, init), ENV);
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
};

reset();
const token = await sessionFor();

{
  const response = await worker.fetch(new Request("https://toto.example/auth/draft-state", {
    method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type,x-dawg-session,x-bozo-session" },
  }), ENV);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /(?:^|,\s*)PUT(?:,|$)/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Dawg-Session/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Bozo-Session/);
}

assert.equal((await request()).response.status, 401, "missing session");
assert.equal((await request({ token, league: "bad/id" })).response.status, 400, "invalid league id");
assert.equal((await request({ token, league: "dd_" + "z".repeat(32) })).response.status, 404, "missing league");
assert.equal((await request({ token, league: OTHER_ID })).response.status, 403, "non-draft league");

{
  const { response, json } = await request({ token });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store", "GET response is private");
  assert.deepEqual(json, { ok: true, leagueId: LEAGUE_ID, exists: false, version: 0, updatedAt: null, state: EMPTY });
}

assert.equal((await request({ method: "PUT", token, body: "{}", headers: { "Content-Type": "text/plain" } })).response.status, 415);
assert.equal((await request({ method: "PUT", token, body: "x".repeat(65_537) })).response.status, 413);
assert.equal((await request({ method: "PUT", token, body: { baseVersion: 0, state: { ...EMPTY, rankings: [] } } })).response.status, 422,
  "proprietary/arbitrary fields are rejected");

const personal = {
  filters: { query: "é", position: "WR", hideTaken: true, taggedOnly: false,
    sort: { key: "silva", direction: "desc" } },
  marks: [
    { playerId: "nfl:00-0036900", mark: "taken" },
    { playerId: "nfl:00-0036322", mark: "target" },
  ],
  keeperIds: ["nfl:00-0036322"],
};

{
  const { response, json } = await request({ method: "PUT", token, body: { baseVersion: 0, state: personal } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store", "PUT response is private");
  assert.equal(json.version, 1);
  assert.equal(Number.isSafeInteger(json.updatedAt), true);
  assert.deepEqual(json.state.marks.map(row => row.playerId), ["nfl:00-0036322", "nfl:00-0036900"], "sets are canonicalized");
  assert.equal(db.drafts[LEAGUE_ID].state.picks[0].player, "Shared Pick", "personal taken marks never touch shared board state");
  assert.deepEqual(Object.keys(db.users[UID].draftState[LEAGUE_ID]).sort(), ["state", "updatedAt", "version"]);
}

{
  const conflict = await request({ method: "PUT", token, body: { baseVersion: 0, state: EMPTY } });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.json.current.version, 1);
  const won = await request({ method: "PUT", token, body: { baseVersion: conflict.json.current.version, state: EMPTY } });
  assert.equal(won.response.status, 200, "an explicit rebase makes the personal local snapshot the last accepted write");
  assert.equal(won.json.version, 2);
}

{
  forceRace = true;
  const raced = await request({ method: "PUT", token, body: { baseVersion: 2, state: personal } });
  assert.equal(raced.response.status, 409, "ETag race is surfaced, never silently overwritten");
}

{
  omitEtag = true;
  const unsafe = await request({ method: "PUT", token, body: { baseVersion: 2, state: personal } });
  assert.equal(unsafe.response.status, 502, "a missing Firebase ETag fails closed instead of becoming a blind write");
  omitEtag = false;
}

{
  const rigSource = fs.readFileSync(new URL("../draft-league.js", import.meta.url), "utf8");
  const boardSource = fs.readFileSync(new URL("../board.html", import.meta.url), "utf8");
  const personalSource = fs.readFileSync(new URL("../draft-personal-sync.js", import.meta.url), "utf8");
  const workerSource = fs.readFileSync(new URL("../dawg-bot-worker.js", import.meta.url), "utf8");
  const pattern = draftLeague.LEAGUE_ID_PATTERN;
  assert.equal(pattern, "^dd_[A-Za-z0-9_-]{22,64}$");
  assert.match(workerSource, new RegExp(`DRAFT_LEAGUE_ID_PATTERN = ${JSON.stringify(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(rigSource, /const LEAGUE_ID_PATTERN = "\^dd_\[A-Za-z0-9_-\]\{22,64\}\$"/);
  for (let i = 0; i < 50; i++) assert.match(draftLeague.generateId(crypto), new RegExp(pattern));
  const sortable = [...boardSource.matchAll(/\{key:"([^"]+)",label:"[^"]+"[^}]*sortable:true\}/g)].map(match => match[1]);
  const workerSortKeys = JSON.parse(workerSource.match(/const DRAFT_SORT_KEYS = (\[[^;]+\]);/)[1]);
  const clientSortKeys = JSON.parse(personalSource.match(/const SORT_KEYS=Object\.freeze\((\[[^)]+\])\)/)[1]);
  assert.deepEqual([...sortable].sort(), [...workerSortKeys].sort(), "Worker allowlist matches the rig's sortable columns");
  assert.deepEqual([...clientSortKeys].sort(), [...workerSortKeys].sort(), "client and Worker share the same sort-key contract");
}

/* Signed-in Last Dawg Standing league shelf. This is deliberately a much
 * smaller contract than draft-state: IDs + an unverified private focus roster. */
const guillotineRequest = async ({ method = "GET", token: authToken, body } = {}) => {
  const init = { method, headers: { Origin: ORIGIN } };
  if (authToken) init.headers["X-Dawg-Session"] = authToken;
  if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const response = await worker.fetch(new Request("https://toto.example/auth/guillotine-state", init), ENV);
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
};

assert.equal((await guillotineRequest()).response.status, 401, "guillotine shelf requires a session");
{
  const empty = await guillotineRequest({ token });
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.json.state, { leagues: [] });
}
const savedShelf = { leagues: [
  { leagueId: "1234567890123456789", focusRosterId: 2 },
  { leagueId: "9876543210987654321", focusRosterId: null },
] };
{
  const put = await guillotineRequest({ method: "PUT", token, body: savedShelf });
  assert.equal(put.response.status, 200);
  assert.deepEqual(put.json.state, savedShelf);
  assert.deepEqual(db.users[UID].guillotineState.state, savedShelf, "shelf is written beneath the session UID");
  assert.deepEqual((await guillotineRequest({ token })).json.state, savedShelf, "shelf survives reload");
}
assert.equal((await guillotineRequest({ method: "PUT", token, body: { leagues: [{ leagueId: "abc", focusRosterId: null }] } })).response.status, 422,
  "Sleeper IDs must be numeric");
assert.equal((await guillotineRequest({ method: "PUT", token, body: { uid: "victim", ...savedShelf } })).response.status, 422,
  "a caller cannot select another account UID");
assert.equal((await guillotineRequest({ method: "PUT", token, body: { leagues: [{ leagueId: "1234567890123456789", focusRosterId: "2" }] } })).response.status, 422,
  "focus roster IDs must be numeric when present");

console.log("draft-state contract tests: ok");
