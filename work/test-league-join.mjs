/* CEP-7 league join links — GET/POST /league/join and POST /league/join-code.
   Exercises the assembled Worker with only Firebase RTDB and KV faked.

   Run:  cd work && node test-league-join.mjs
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
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: "" }; },
  };
};

/* ------------------------------ fake RTDB ------------------------------- */
const enc = encodeURIComponent;
let db;
const resetDb = () => {
  db = {
    users: { Kap: { pw: "x" }, Jeff: { pw: "x" }, Sam: { pw: "x" }, Dana: { pw: "x" }, Nia: { pw: "x" } },
    // sessionAuth pins a session to the password on file: /bozoauth/<name>.setAt must
    // equal the session's `p`. These records are what make a minted session real.
    bozoauth: { Kap: { setAt: 0 }, Jeff: { setAt: 0 }, Sam: { setAt: 0 }, Dana: { setAt: 0 }, Nia: { setAt: 0 } },
    leagues: {
      main: {
        name: "Data Dawgs", manager: "Kap",
        members: { Kap: true, Jeff: true },
        season: 2026, week: 1, status: "open",
      },
      side: {
        name: "Side Pot", manager: "Jeff",
        members: { Jeff: true },
        season: 2026, week: 1, status: "open",
      },
    },
  };
};
resetDb();

const at = (path) => {
  // "/bozo/leagues/main/members" -> node
  const parts = path.replace(/^\//, "").split("/");
  if (parts[0] === "users") return { get: () => db.users, set: v => (db.users = v) };
  if (parts[0] === "bozoauth") {
    if (parts.length === 1) return { get: () => db.bozoauth, set: v => (db.bozoauth = v) };
    const who = decodeURIComponent(parts[1]);
    return { get: () => db.bozoauth[who] ?? null, set: v => (db.bozoauth[who] = v) };
  }
  if (parts[0] === "bozo" && parts[1] === "leagues") {
    if (parts.length === 2) return { get: () => db.leagues, set: v => (db.leagues = v) };
    const lid = parts[2];
    if (parts.length === 3) return { get: () => db.leagues[lid], set: v => (db.leagues[lid] = v) };
    if (parts[3] === "members")
      return { get: () => db.leagues[lid].members, set: v => (db.leagues[lid].members = v) };
  }
  return { get: () => null, set: () => {} };
};

const ENV = { FB_SECRET: "fbsecret", BOZO_PEPPER: "pepper", BOZO_ADMIN: "Kap", RL: makeKV() };

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof URL ? input.href : (input && input.url) || input));
  if (!/firebaseio|firebasedatabase/.test(url.hostname)) throw new Error("unexpected fetch " + url.hostname);
  const path = url.pathname.replace(/\.json$/, "");
  const node = at(path);
  const method = (init.method || "GET").toUpperCase();
  if (method === "GET") return new Response(JSON.stringify(node.get() ?? null), { status: 200 });
  const body = init.body ? JSON.parse(init.body) : null;
  if (method === "PUT") { node.set(body); return new Response("{}", { status: 200 }); }
  if (method === "PATCH") {
    const cur = node.get() || {};
    for (const [k, v] of Object.entries(body || {})) {
      if (v === null) delete cur[k]; else cur[k] = v;
    }
    node.set(cur);
    return new Response("{}", { status: 200 });
  }
  if (method === "DELETE") { node.set(null); return new Response("{}", { status: 200 }); }
  return new Response("{}", { status: 200 });
};

/* --------------------------- session minting ---------------------------- */
const te = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sessionFor(name) {
  const payload = b64url(JSON.stringify({ n: name, e: Date.now() + 864e5, p: 0 }));
  const key = await crypto.subtle.importKey("raw", te.encode(ENV.BOZO_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(payload));
  return payload + "." + b64(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ORIGIN = "https://toto.jkapcar4.workers.dev";
const call = async (path, { method = "POST", body, session, ip } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (session) headers["X-Dawg-Session"] = session;
  if (ip) headers["CF-Connecting-IP"] = ip;
  const r = await worker.fetch(new Request(ORIGIN + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), ENV);
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

/* Discover the session header name the Worker actually reads, so this test does not
   silently pass by treating every call as anonymous. */
const KAP = await sessionFor("Kap");
{
  const probe = await call("/league/join-code", { body: { league: "main" }, session: KAP });
  if (probe.status === 401 || probe.status === 403) {
    const alt = ["Authorization", "X-Bozo-Session", "X-Dawg-Auth", "X-Session"];
    let found = null;
    for (const h of alt) {
      const r = await worker.fetch(new Request(ORIGIN + "/league/join-code", {
        method: "POST", headers: { "Content-Type": "application/json", [h]: h === "Authorization" ? "Bearer " + KAP : KAP },
        body: JSON.stringify({ league: "main" }),
      }), ENV);
      if (r.status === 200) { found = h; break; }
    }
    if (found) console.log("  (session header: " + found + ")");
    else { console.log("  FAIL could not authenticate a session against the Worker"); process.exit(1); }
    globalThis.__SESSION_HEADER = found;
  }
}
const SESSION_HEADER = globalThis.__SESSION_HEADER || "X-Dawg-Session";
const call2 = async (path, { method = "POST", body, session, ip } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (session) headers[SESSION_HEADER] = SESSION_HEADER === "Authorization" ? "Bearer " + session : session;
  if (ip) headers["CF-Connecting-IP"] = ip;
  const r = await worker.fetch(new Request(ORIGIN + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), ENV);
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

const JEFF = await sessionFor("Jeff");
const SAM  = await sessionFor("Sam");
const DANA = await sessionFor("Dana");
const NIA  = await sessionFor("Nia");

/* ------------------------------- mint ----------------------------------- */
let code;
{
  const r = await call2("/league/join-code", { body: { league: "main" }, session: KAP });
  ok("manager mints a code", r.status === 200 && !!r.j.code, JSON.stringify(r.j).slice(0, 120));
  code = r.j.code;
  ok("code is 22 url-safe chars", /^[A-Za-z0-9_-]{22}$/.test(code || ""), code);
  ok("link points at signon.html?league=", (r.j.link || "").includes("/signon.html?league=" + code));
  ok("default cap is 20", r.j.cap === 20, String(r.j.cap));
  ok("code is stored in KV, not Firebase",
    ENV.RL.store.has("joinlink:code:" + code) && !JSON.stringify(db).includes(code));

  const again = await call2("/league/join-code", { body: { league: "main" }, session: KAP });
  ok("get is idempotent — same code back", again.j.code === code);
}

/* --------------------------- authorisation ------------------------------ */
{
  const anon = await call2("/league/join-code", { body: { league: "main" } });
  ok("anonymous cannot mint", anon.status === 401 || anon.status === 403, String(anon.status));

  const notMine = await call2("/league/join-code", { body: { league: "main" }, session: JEFF });
  ok("a non-manager cannot mint for someone else's league", notMine.status === 403, String(notMine.status));

  const ownLeague = await call2("/league/join-code", { body: { league: "side" }, session: JEFF });
  ok("a manager can mint for their OWN league", ownLeague.status === 200 && !!ownLeague.j.code);

  const adminAny = await call2("/league/join-code", { body: { league: "side" }, session: KAP });
  ok("site admin can mint for any league", adminAny.status === 200);

  const bogus = await call2("/league/join-code", { body: { league: "nope" }, session: KAP });
  ok("unknown league is refused", bogus.status === 404, String(bogus.status));

  const getOnly = await call2("/league/join-code", { method: "GET", session: KAP });
  ok("GET on join-code is 405", getOnly.status === 405, String(getOnly.status));
}

/* ------------------------------- preview -------------------------------- */
{
  const p = await call2("/league/join?code=" + code, { method: "GET" });
  ok("preview works signed out", p.status === 200 && p.j.name === "Data Dawgs");
  ok("preview reports size and cap", p.j.size === 2 && p.j.cap === 20);
  ok("preview leaks no member names", !JSON.stringify(p.j).includes("Jeff"));

  const bad = await call2("/league/join?code=" + "z".repeat(22), { method: "GET" });
  ok("unknown code previews as 404", bad.status === 404, String(bad.status));

  const malformed = await call2("/league/join?code=short", { method: "GET" });
  ok("malformed code is 400", malformed.status === 400, String(malformed.status));
}

/* ------------------------------- redeem --------------------------------- */
{
  const anon = await call2("/league/join", { body: { code } });
  ok("redeem requires a session", anon.status === 401 && anon.j.needSignIn === true, JSON.stringify(anon.j));

  const before = Object.keys(db.leagues.main.members).length;
  const r = await call2("/league/join", { body: { code }, session: SAM });
  ok("signed-in stranger joins with a good code", r.status === 200 && r.j.ok === true, JSON.stringify(r.j));
  ok("member actually landed in Firebase", db.leagues.main.members[enc("Sam")] === true);
  ok("size grew by exactly one", Object.keys(db.leagues.main.members).length === before + 1);

  const twice = await call2("/league/join", { body: { code }, session: SAM });
  ok("joining twice is a no-op, not an error", twice.status === 200 && twice.j.already === true);
  ok("double join did not duplicate the member", Object.keys(db.leagues.main.members).length === before + 1);

  const stale = await call2("/league/join", { body: { code: "z".repeat(22) }, session: DANA });
  ok("a dead code is refused", stale.status === 404);
  ok("refusal message does not distinguish never-existed from rotated",
    /no longer good/.test(stale.j.error || ""), stale.j.error);
}

/* ------------------------------- rotation ------------------------------- */
{
  const rot = await call2("/league/join-code", { body: { league: "main", action: "rotate" }, session: KAP });
  ok("rotate returns a different code", rot.status === 200 && rot.j.code && rot.j.code !== code);
  const dead = await call2("/league/join", { body: { code }, session: DANA });
  ok("the OLD code dies immediately", dead.status === 404, String(dead.status));
  ok("old lookup key is gone from KV", !ENV.RL.store.has("joinlink:code:" + code));
  const fresh = await call2("/league/join", { body: { code: rot.j.code }, session: DANA });
  ok("the NEW code works", fresh.status === 200 && fresh.j.ok === true);
  code = rot.j.code;
}

/* --------------------------------- cap ---------------------------------- */
{
  const size = Object.keys(db.leagues.main.members).length;   // Kap, Jeff, Sam, Dana = 4
  const setCap = await call2("/league/join-code", { body: { league: "main", action: "cap", cap: size }, session: KAP });
  ok("manager sets the cap", setCap.status === 200 && setCap.j.cap === size, JSON.stringify(setCap.j));
  ok("cap response reports the league as full", setCap.j.full === true);

  const full = await call2("/league/join", { body: { code }, session: NIA });
  ok("a full league refuses a valid code", full.status === 409 && /full/.test(full.j.error || ""), JSON.stringify(full.j));
  ok("nobody was added past the cap", Object.keys(db.leagues.main.members).length === size);

  const low = await call2("/league/join-code", { body: { league: "main", action: "cap", cap: 1 }, session: KAP });
  ok("cap below the minimum is refused", low.status === 400);
  const high = await call2("/league/join-code", { body: { league: "main", action: "cap", cap: 999 }, session: KAP });
  ok("cap above the maximum is refused", high.status === 400);

  // a cap under the current roster closes the door but evicts nobody
  const shrink = await call2("/league/join-code", { body: { league: "main", action: "cap", cap: 2 }, session: KAP });
  ok("cap below current size is allowed", shrink.status === 200 && shrink.j.cap === 2);
  ok("shrinking the cap evicts nobody", Object.keys(db.leagues.main.members).length === size);

  await call2("/league/join-code", { body: { league: "main", action: "cap", cap: 20 }, session: KAP });
}

/* ---------------------- placed board refuses new joins ------------------- */
{
  db.leagues.main.status = "placed";
  const r = await call2("/league/join", { body: { code }, session: NIA });
  ok("a placed ticket blocks joining mid-week", r.status === 409 && /placed/.test(r.j.error || ""), JSON.stringify(r.j));
  ok("blocked join did not write a member", !db.leagues.main.members[enc("Nia")]);
  db.leagues.main.status = "open";
  const after = await call2("/league/join", { body: { code }, session: NIA });
  ok("joining works again once the week reopens", after.status === 200);
}

/* --------------------------------- off ---------------------------------- */
{
  const off = await call2("/league/join-code", { body: { league: "main", action: "off" }, session: KAP });
  ok("manager can turn the link off", off.status === 200 && off.j.code === null);
  ok("turning off clears both KV keys",
    !ENV.RL.store.has("joinlink:lg:main") && !ENV.RL.store.has("joinlink:code:" + code));
  const dead = await call2("/league/join", { body: { code }, session: await sessionFor("Kap") });
  ok("no code works after off", dead.status === 404);
}

/* ------------------------------ rate limit ------------------------------ */
{
  ENV.RL.store.clear();
  const mint = await call2("/league/join-code", { body: { league: "side", action: "rotate" }, session: JEFF });
  const c = mint.j.code;
  let last = null;
  for (let i = 0; i < 25; i++) last = await call2("/league/join", { body: { code: "y".repeat(22) }, session: SAM, ip: "9.9.9.9" });
  ok("redemption is rate limited per IP", last.status === 429, String(last.status));
  const other = await call2("/league/join", { body: { code: c }, session: SAM, ip: "1.2.3.4" });
  ok("a different IP is unaffected", other.status === 200, String(other.status));
}

/* ------------------------- draft rig stays ungated ----------------------- */
{
  const src = (await import("fs")).readFileSync("../dawg-bot-worker.js", "utf8");
  const draftRoutes = ["/drafts", "/draft"];
  const gated = draftRoutes.some(r => new RegExp('pathname === "' + r + '"[^\\n]*leagueJoin').test(src));
  ok("no draft route was wired through the join gate (AGENTS.md rule 6)", !gated);
  ok("join code never appears in a Firebase write path",
    !/fbPatch\([^)]*joinlink|fbPut\([^)]*joinlink/.test(src));
}

console.log("\nleague-join: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
