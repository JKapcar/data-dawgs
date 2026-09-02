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
  const probe = await call("/league/access", { body: { league: "main", action: "status" }, session: KAP });
  if (probe.status === 401 || probe.status === 403) {
    const alt = ["Authorization", "X-Bozo-Session", "X-Dawg-Auth", "X-Session"];
    let found = null;
    for (const h of alt) {
      const r = await worker.fetch(new Request(ORIGIN + "/league/access", {
        method: "POST", headers: { "Content-Type": "application/json", [h]: h === "Authorization" ? "Bearer " + KAP : KAP },
        body: JSON.stringify({ league: "main", action: "status" }),
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

/* -------------------------- manager passwords -------------------------- */
{
  const setMain = await call2("/league/access", { body: { league: "main", action: "password", password: "Main Password!" }, session: KAP });
  ok("manager sets a league password", setMain.status === 200 && setMain.j.passwordEnabled === true, JSON.stringify(setMain.j));
  const mainRec = JSON.parse(ENV.RL.store.get("joinlink:lg:main"));
  ok("KV stores only a scoped password hash", !!mainRec.passwordHash && !JSON.stringify(mainRec).includes("Main Password!"));

  const setSide = await call2("/league/access", { body: { league: "side", action: "password", password: "Side Password!" }, session: JEFF });
  ok("another manager sets their own password", setSide.status === 200 && setSide.j.passwordEnabled === true);
  const notMine = await call2("/league/access", { body: { league: "side", action: "status" }, session: SAM });
  ok("a non-manager cannot read access status", notMine.status === 403, String(notMine.status));
}

/* ------------------------------- search -------------------------------- */
{
  const anon = await call2("/league/search", { body: { query: "Data" } });
  ok("league search requires sign-in", anon.status === 401 && anon.j.needSignIn === true, JSON.stringify(anon.j));

  const pub = await call2("/league/search", { body: { query: "Data" }, session: SAM });
  ok("public league matches a partial name", pub.status === 200 && pub.j.results.some(x => x.id === "main"));

  const privatePartial = await call2("/league/search", { body: { query: "Pot" }, session: SAM });
  ok("private league names appear in partial directory search", privatePartial.status === 200 && privatePartial.j.results.some(x => x.id === "side"));

  const directory = await call2("/league/search", { body: { query: "" }, session: SAM });
  ok("empty search returns the signed-in league directory", directory.status === 200 && directory.j.results.length >= 2 && directory.j.limit === 20);

  const ownPartial = await call2("/league/search", { body: { query: "Side" }, session: JEFF });
  ok("a member may partially search their own league", ownPartial.status === 200 && ownPartial.j.results.some(x => x.id === "side"));
}

/* -------------------------------- join --------------------------------- */
{
  const anon = await call2("/league/join", { body: { league: "side", password: "Side Password!" } });
  ok("joining requires a session", anon.status === 401 && anon.j.needSignIn === true, JSON.stringify(anon.j));

  const wrong = await call2("/league/join", { body: { league: "side", password: "wrong password" }, session: SAM, ip: "2.2.2.2" });
  ok("wrong league password is refused", wrong.status === 403 && /password/.test(wrong.j.error || ""), JSON.stringify(wrong.j));

  const before = Object.keys(db.leagues.side.members).length;
  const joined = await call2("/league/join", { body: { league: "side", password: "Side Password!" }, session: SAM, ip: "2.2.2.3" });
  ok("signed-in account joins the selected league", joined.status === 200 && joined.j.ok === true, JSON.stringify(joined.j));
  ok("membership lands exactly once", db.leagues.side.members[enc("Sam")] === true && Object.keys(db.leagues.side.members).length === before + 1);

  const twice = await call2("/league/join", { body: { league: "side", password: "not needed now" }, session: SAM });
  ok("existing membership is a successful no-op", twice.status === 200 && twice.j.already === true);
}

/* -------------------------- cap and open week --------------------------- */
{
  const size = Object.keys(db.leagues.main.members).length;
  await call2("/league/access", { body: { league: "main", action: "cap", cap: size }, session: KAP });
  const full = await call2("/league/join", { body: { league: "main", password: "Main Password!" }, session: DANA, ip: "3.3.3.3" });
  ok("member cap blocks a valid password", full.status === 409 && /full/.test(full.j.error || ""), JSON.stringify(full.j));

  await call2("/league/access", { body: { league: "main", action: "cap", cap: 20 }, session: KAP });
  db.leagues.main.status = "placed";
  const placed = await call2("/league/join", { body: { league: "main", password: "Main Password!" }, session: DANA, ip: "3.3.3.4" });
  ok("a placed ticket blocks mid-week joining", placed.status === 409 && /placed/.test(placed.j.error || ""), JSON.stringify(placed.j));
  db.leagues.main.status = "open";
}

/* ----------------------------- visibility ------------------------------ */
{
  const publicBefore = await call2("/league/list", { method: "GET" });
  ok("unsigned directory initially excludes the private side league", !publicBefore.j.leagues.some(x => x.id === "side"));

  const pub = await call2("/league/access", { body: { league: "side", action: "visibility", visibility: "public" }, session: JEFF });
  ok("manager can make their league public", pub.status === 200 && pub.j.visibility === "public");
  const publicAfter = await call2("/league/list", { method: "GET" });
  ok("public visibility changes the unsigned directory", publicAfter.j.leagues.some(x => x.id === "side"));

  const forced = await call2("/league/access", { body: { league: "main", action: "visibility", visibility: "private" }, session: KAP });
  ok("the two house public rooms cannot be made private", forced.status === 400);
  await call2("/league/access", { body: { league: "side", action: "visibility", visibility: "private" }, session: JEFF });
}

/* -------------------------- retired link paths -------------------------- */
{
  const oldPreview = await call2("/league/join?code=" + "x".repeat(22), { method: "GET" });
  ok("reusable join-link preview is retired", oldPreview.status === 410);
  const oldMint = await call2("/league/join-code", { body: { league: "main", action: "get" }, session: KAP });
  ok("cached manager pages cannot mint links", oldMint.status === 410);
  const perPerson = await call2("/league/invite", { body: { league: "main", player: "Nia" }, session: KAP });
  ok("per-person league invites are retired", perPerson.status === 410);
}

/* ----------------------------- rate limit ------------------------------ */
{
  let last = null;
  for (let n = 0; n < 25; n++)
    last = await call2("/league/join", { body: { league: "side", password: "wrong again" }, session: NIA, ip: "9.9.9.9" });
  ok("password attempts are rate limited per IP", last.status === 429, String(last.status));
}

/* ------------------------- draft rig stays public ---------------------- */
{
  const src = (await import("fs")).readFileSync(new URL("../dawg-bot-worker.js", import.meta.url), "utf8");
  const draftRoutes = ["/drafts", "/draft"];
  const gated = draftRoutes.some(r => new RegExp('pathname === "' + r + '"[^\\n]*leagueJoin').test(src));
  ok("no draft route was wired through the Bozo password gate", !gated);
}

console.log("\nleague-access: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
