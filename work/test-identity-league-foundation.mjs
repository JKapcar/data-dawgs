/* UID identity + universal league foundation against the assembled Worker.
 * Run from work/: node test-identity-league-foundation.mjs
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../dawg-bot-worker.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let assertions = 0;
const check = (condition, message) => { assertions++; assert.ok(condition, message); };
const equal = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };

const DB_HOST = "data-dawgs-draft-default-rtdb.firebaseio.com";
const ORIGIN = "https://datadawgs216.com";
const ENV = {
  FB_SECRET: "firebase-test", BOZO_PEPPER: "foundation-test-pepper",
  RESEND_KEY: "resend-test", MAIL_FROM: "Data Dawgs <signin@datadawgs216.com>",
};

const kvStore = new Map();
ENV.RL = {
  async get(key) { return kvStore.has(key) ? kvStore.get(key) : null; },
  async put(key, value) { kvStore.set(key, String(value)); },
  async delete(key) { kvStore.delete(key); },
};

let db = { users: {}, emailIndex: {}, leagues: {} };
const versions = new Map();
const mail = [];
let postSeq = 0;
const partsOf = pathname => pathname.replace(/^\//, "").replace(/\.json$/, "").split("/").filter(Boolean).map(decodeURIComponent);
const keyOf = parts => parts.join("/");
function getAt(parts) {
  let value = db;
  for (const part of parts) {
    if (!value || typeof value !== "object" || !(part in value)) return null;
    value = value[part];
  }
  return value;
}
function setAt(parts, value) {
  if (!parts.length) { db = value; return; }
  let node = db;
  for (const part of parts.slice(0, -1)) node = node[part] ||= {};
  if (value === null) delete node[parts.at(-1)]; else node[parts.at(-1)] = value;
  versions.set(keyOf(parts), (versions.get(keyOf(parts)) || 1) + 1);
}
const etag = parts => `"${versions.get(keyOf(parts)) || 1}"`;
const header = (headers, name) => headers && (headers.get?.(name) || headers[name] || headers[name.toLowerCase()]);

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "api.resend.com") {
    mail.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "mail-" + mail.length }), { status: 200 });
  }
  if (url.hostname !== DB_HOST) throw new Error("unexpected fetch " + url);
  const parts = partsOf(url.pathname);
  const method = String(init.method || "GET").toUpperCase();
  if (method === "GET") {
    const headers = header(init.headers, "X-Firebase-ETag") ? { ETag: etag(parts) } : {};
    return new Response(JSON.stringify(getAt(parts)), { status: 200, headers });
  }
  const match = header(init.headers, "if-match");
  if (match && match !== etag(parts)) return new Response("null", { status: 412 });
  if (method === "PUT") {
    setAt(parts, JSON.parse(init.body));
    return new Response("null", { status: 200 });
  }
  if (method === "PATCH") {
    const patch = JSON.parse(init.body);
    for (const [path, value] of Object.entries(patch)) setAt(parts.concat(path.split("/").map(decodeURIComponent)), value);
    return new Response("null", { status: 200 });
  }
  if (method === "DELETE") {
    setAt(parts, null);
    return new Response("null", { status: 200 });
  }
  if (method === "POST") {
    const id = "event_" + (++postSeq);
    setAt(parts.concat(id), JSON.parse(init.body));
    return new Response(JSON.stringify({ name: id }), { status: 200 });
  }
  throw new Error("unexpected method " + method);
};

async function call(path, { method = "POST", body, session, ip = "203.0.113.7", origin = ORIGIN } = {}) {
  const headers = { Origin: origin, "CF-Connecting-IP": ip };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session) headers["X-Dawg-Session"] = session;
  const response = await worker.fetch(new Request("https://toto.example" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), ENV);
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
}
function tokenFromLastMail(param) {
  const text = mail.at(-1).text;
  const found = text.match(new RegExp("[?&]" + param + "=([^\\s&]+)"));
  assert.ok(found, "mail contains " + param + " token");
  return found[1];
}
function sessionPayload(token) {
  const payload = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(payload));
}

{
  const response = await worker.fetch(new Request("https://toto.example/auth/draft-state", {
    method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "PUT" },
  }), ENV);
  equal(response.status, 200, "preflight succeeds");
  check(response.headers.get("Access-Control-Allow-Methods").includes("PUT"), "preflight advertises PUT");
  check(response.headers.get("Access-Control-Allow-Headers").includes("X-Dawg-Session"), "preflight accepts X-Dawg-Session requests");
  equal(response.headers.get("Access-Control-Expose-Headers"), "X-Dawg-Session", "renewal header exposed");
}

equal((await call("/auth/lookup", { body: { email: "kap@example.com" } })).json.known, false, "unknown lookup");
const first = await call("/auth/signup", { body: {
  name: "Kap", email: "KAP@Example.com", password: "correct horse battery staple",
  entitlement: { plan: "member", status: "active" }, roles: { site_admin: true },
} });
equal(first.response.status, 201, "signup created");
check(/^u_[A-Za-z0-9_-]{22,64}$/.test(first.json.uid), "UID shape");
equal(db.users[first.json.uid].email, "kap@example.com", "email normalized");
equal(db.users[first.json.uid].emailVerified, false, "signup is unverified");
equal(db.users[first.json.uid].roles.site_admin, undefined, "body cannot self-grant admin");
equal(db.users[first.json.uid].entitlement.plan, "free", "body cannot self-grant entitlement");
check(Object.values(db.emailIndex).some(v => v.uid === first.json.uid), "email reservation persisted");

equal((await call("/auth/signup", { body: { name: "Someone", email: "kap@example.com", password: "different password" } })).response.status,
  409, "duplicate email rejected");
const second = await call("/auth/signup", { body: { name: "Kap", email: "other@example.com", password: "another valid password" }, ip: "203.0.113.8" });
equal(second.response.status, 201, "duplicate display name allowed");
check(second.json.uid !== first.json.uid, "duplicate names retain distinct UIDs");
equal((await call("/auth/lookup", { body: { email: "KAP@example.com" } })).json.known, true, "known lookup");

const raced = await Promise.all([
  call("/auth/signup", { body: { name: "Race One", email: "  RACE@Example.com ", password: "race password one" }, ip: "203.0.113.21" }),
  call("/auth/signup", { body: { name: "Race Two", email: "race@example.com", password: "race password two" }, ip: "203.0.113.22" }),
]);
equal(raced.filter(x => x.response.status === 201).length, 1, "atomic email reservation admits one concurrent signup");
equal(raced.filter(x => x.response.status === 409).length, 1, "atomic email reservation rejects the concurrent loser");
equal(Object.values(db.users).filter(u => u.email === "race@example.com").length, 1, "normalized raced email has one account write");
equal(Object.values(db.emailIndex).filter(v => v.email === "race@example.com").length, 1, "normalized raced email has one index owner");

const unconfirmedChange = await call("/auth/email", { body: { email: "  OTHER.NEW@Example.com " }, session: second.json.session, ip: "203.0.113.23" });
equal(unconfirmedChange.response.status, 202, "unconfirmed account may request a corrected address");
equal(db.users[second.json.uid].email, "other@example.com", "wrong address remains only until corrected address is proven");
equal(mail.at(-1).to.length, 1, "correction mail has exactly one recipient");
equal(mail.at(-1).to[0], "other.new@example.com", "correction mail goes only to the new normalized address");
const unconfirmedEmailToken = tokenFromLastMail("email-change");
equal((await call("/auth/email-confirm", { body: { token: unconfirmedEmailToken }, ip: "203.0.113.23" })).response.status,
  200, "unconfirmed account can prove and adopt the corrected address");
equal(db.users[second.json.uid].email, "other.new@example.com", "corrected address becomes the account login");
equal(db.users[second.json.uid].emailVerified, true, "corrected address is verified by its own link");

equal((await call("/auth/login", { body: { email: "kap@example.com", password: "wrong password" } })).response.status, 401, "wrong login");
check([...kvStore.keys()].some(k => k.startsWith("loginid:")), "email failure bucket written");
check([...kvStore.keys()].some(k => k.startsWith("loginip:")), "IP failure bucket written");
const login = await call("/auth/login", { body: { email: "KAP@EXAMPLE.COM", password: "correct horse battery staple" }, ip: "203.0.113.9" });
equal(login.response.status, 200, "email login succeeds");
equal(sessionPayload(login.json.session).u, first.json.uid, "session carries immutable UID");

equal((await call("/auth/mcp-token", { body: { action: "mint" }, session: login.json.session })).response.status,
  403, "unverified UID cannot mint MCP token");
const verifyRequest = await call("/auth/verify-request", { body: {}, session: login.json.session, ip: "203.0.113.10" });
equal(verifyRequest.response.status, 200, "verification mail sent");
const verifyToken = tokenFromLastMail("verify");
equal((await call("/auth/verify", { body: { token: verifyToken }, ip: "203.0.113.10" })).response.status, 200, "verification token consumed");
equal(db.users[first.json.uid].emailVerified, true, "account verified");
equal((await call("/auth/verify", { body: { token: verifyToken }, ip: "203.0.113.10" })).response.status, 410, "verification token single-use");
const mcp = await call("/auth/mcp-token", { body: { action: "mint" }, session: login.json.session });
equal(mcp.response.status, 200, "verified UID mints MCP token");
check(db.users[first.json.uid].mcpToken && db.users[first.json.uid].mcpToken !== mcp.json.token, "only MCP hash stored");

equal((await call("/league/create", { body: { game: "draft", name: "Rehearsal", gateCode: "short", settings: {} }, session: login.json.session })).response.status,
  400, "short gate rejected");
const created = await call("/league/create", { body: {
  game: "draft", name: "Rehearsal", gateCode: "lake-erie-216", settings: { budget: 200 },
}, session: login.json.session });
equal(created.response.status, 201, "league created");
const leagueId = created.json.league.id;
check(/^dd_[A-Za-z0-9_-]{22,64}$/.test(leagueId), "server league ID follows shared contract");
equal(created.json.league.visibility, "public", "draft league is public");
equal(created.json.league.member, true, "manager starts as member");
equal(created.json.league.gate, undefined, "gate secret omitted from response");
equal(Object.values(db.leagues[leagueId].events)[0].type, "league_created", "creation is event-backed");
equal((await call("/league/mine", { method: "GET", session: login.json.session })).json.leagues.length, 1, "mine lists membership");

const secondLogin = await call("/auth/login", { body: { email: "other.new@example.com", password: "another valid password" }, ip: "203.0.113.11" });
equal((await call("/league/join", { body: { leagueId, gateCode: "wrong-code" }, session: secondLogin.json.session })).response.status,
  403, "wrong league gate rejected");
const joined = await call("/league/join", { body: { leagueId, gateCode: "lake-erie-216" }, session: secondLogin.json.session });
equal(joined.response.status, 200, "member joins");
equal(joined.json.already, false, "first join is new");
const rejoined = await call("/league/join", { body: { leagueId, gateCode: "lake-erie-216" }, session: secondLogin.json.session });
equal(rejoined.json.already, true, "repeat join is idempotent");
equal(Object.values(db.leagues[leagueId].events).filter(e => e.type === "member_joined").length, 1, "repeat join appends no duplicate event");
equal((await call("/league/gate", { method: "PUT", body: { leagueId, gateCode: "new-code-216" }, session: secondLogin.json.session })).response.status,
  403, "member cannot manage gate");
equal((await call("/league/gate", { method: "PUT", body: { leagueId, gateCode: "new-code-216" }, session: login.json.session })).response.status,
  200, "manager changes gate");
equal((await call("/league/join", { body: { leagueId, gateCode: "lake-erie-216" }, session: secondLogin.json.session })).response.status,
  403, "old gate stops immediately");

const recentMine = await call("/league/mine", { method: "GET", session: login.json.session });
equal(recentMine.response.headers.get("X-Dawg-Session"), null, "recent session is not churned");
const oldPayload = sessionPayload(login.json.session);
oldPayload.i = Date.now() - 8 * 864e5;
const enc = btoa(JSON.stringify(oldPayload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(ENV.BOZO_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(enc));
const oldSession = enc + "." + btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const renewed = await call("/league/mine", { method: "GET", session: oldSession });
check(!!renewed.response.headers.get("X-Dawg-Session"), "old session rotates on authenticated call");
check(sessionPayload(renewed.response.headers.get("X-Dawg-Session")).i > oldPayload.i, "renewal has new issued-at");

const emailChange = await call("/auth/email", { body: { email: "kap.new@example.com" }, session: login.json.session, ip: "203.0.113.12" });
equal(emailChange.response.status, 202, "email change awaits proof");
equal(db.users[first.json.uid].email, "kap@example.com", "old login remains during pending change");
equal((await call("/auth/login", { body: { email: "kap@example.com", password: "correct horse battery staple" }, ip: "203.0.113.13" })).response.status,
  200, "old email still logs in before confirm");
const emailToken = tokenFromLastMail("email-change");
equal((await call("/auth/email-confirm", { body: { token: emailToken }, ip: "203.0.113.12" })).response.status,
  200, "new email confirmed");
equal(db.users[first.json.uid].email, "kap.new@example.com", "new email becomes primary only after proof");
equal(db.users[first.json.uid].emailVerified, true, "new primary is verified by the link");
equal((await call("/auth/login", { body: { email: "kap@example.com", password: "correct horse battery staple" }, ip: "203.0.113.14" })).response.status,
  401, "old email no longer logs in after confirm");
equal((await call("/auth/login", { body: { email: "kap.new@example.com", password: "correct horse battery staple" }, ip: "203.0.113.15" })).response.status,
  200, "new email logs in after confirm");

console.log(`identity/league foundation: ${assertions} assertions passed`);
