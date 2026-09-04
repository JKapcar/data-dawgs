/* Per-user identity, isolation, and the first compute tool — against the ASSEMBLED
   Worker with its real helpers (loadUsers, hmac, timingSafeEqual, mcpAuth) and only the
   network faked. The Worker cannot be deployed from here, so this is where the identity
   layer has to prove itself before Kap pastes it.

   Run:  cd work && node test-identity.mjs
*/
import fs from "fs";
import { webcrypto } from "crypto";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const WORK = dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
const BUNDLE = join(tmpdir(), "worker-identity.mjs");
const BUNDLED_SRC = SRC.replace('"./bozo-team-registry.mjs"',
  JSON.stringify(pathToFileURL(resolve(WORK, "..", "bozo-team-registry.mjs")).href));
fs.writeFileSync(BUNDLE, BUNDLED_SRC + "\nexport { handleMcp, MCP_TOOLS, mcpAuth, mcpTokenHash, newMcpToken, emailToName, bozoSignup, bozoLogin, readSession, loadUsers, bozoRoster, authInvite, makeSession, entitlementOf, freeEntitlement , authName };\n");

const DB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";
const PEPPER = "test-pepper-value";
const ENV = { BOZO_PEPPER: PEPPER, DAWG_PASS: "shared-league-pass", FB_SECRET: "x",
              DD_KV: { async get() { return null; } } };

/* ---- state the fake network serves ---- */
let USERS = {};                       // filled after tokens are hashed
const LEAGUE = {
  name: "Data Dawgs", manager: "Kap", season: 2026, week: 3, status: "open",
  members: { Kap: true, Jeff: true, Mo: true },
  picks: { Mo: { label: "BUF -3.5", ts: 300 }, Kap: { label: "Chase o24.5", ts: 100 } },
  order: ["Mo", "Kap", "Jeff"],
  ledger: {
    a: { player: "Kap", season: 2026, week: 1, rank: 2, shortestOdds: true },
    b: { player: "Mo", season: 2026, week: 1, rank: 1 },
  },
};
/* Sleeper: 3 completed weeks for a 4-team guillotine league */
const SLEEPER = {
  "/state/nfl": { week: 4, season: "2026", season_type: "regular" },
  "/league/999": { name: "Chop Shop", season: "2026", total_rosters: 4 },
  "/league/999/users": [
    { user_id: "u1", display_name: "kap", metadata: { team_name: "Pepperoni Nipples" } },
    { user_id: "u2", display_name: "jeff", metadata: { team_name: "Tri Hard" } },
    { user_id: "u3", display_name: "mo", metadata: {} },
    { user_id: "u4", display_name: "sal", metadata: { team_name: "Salsa" } },
  ],
  "/league/999/rosters": [
    { roster_id: 1, owner_id: "u1" }, { roster_id: 2, owner_id: "u2" },
    { roster_id: 3, owner_id: "u3" }, { roster_id: 4, owner_id: "u4" },
  ],
  // roster 4 is consistently worst → should be most at risk
  "/league/999/matchups/1": [
    { roster_id: 1, points: 120 }, { roster_id: 2, points: 110 },
    { roster_id: 3, points: 105 }, { roster_id: 4, points: 78 }],
  "/league/999/matchups/2": [
    { roster_id: 1, points: 131 }, { roster_id: 2, points: 99 },
    { roster_id: 3, points: 118 }, { roster_id: 4, points: 82 }],
  "/league/999/matchups/3": [
    { roster_id: 1, points: 125 }, { roster_id: 2, points: 104 },
    { roster_id: 3, points: 96 }, { roster_id: 4, points: 71 }],
};
/* a one-completed-week league, to prove the refusal */
const SLEEPER_THIN = { ...SLEEPER, "/state/nfl": { week: 2, season: "2026", season_type: "regular" } };
let sleeperSet = SLEEPER;

globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.startsWith(DB + "/users.json")) return new Response(JSON.stringify(USERS));
  if (url.startsWith(DB + "/bozo/leagues.json")) return new Response(JSON.stringify({ main: LEAGUE }));
  if (url.startsWith(DB + "/bozo/leagues/main/ledger.json")) return new Response(JSON.stringify(LEAGUE.ledger));
  if (url.startsWith(DB)) return new Response("null");
  if (url.startsWith("https://api.sleeper.app/v1")) {
    const path = url.replace("https://api.sleeper.app/v1", "").split("?")[0];
    if (path in sleeperSet) return new Response(JSON.stringify(sleeperSet[path]));
    return new Response("null", { status: 404 });
  }
  if (url.includes("/board.html")) return new Response('window.DD_POOL = [];');
  return new Response("nope", { status: 404 });
};

const W = await import(pathToFileURL(BUNDLE).href);

/* ---- mint two tokens the way the Worker would ---- */
const TOK_KAP = W.newMcpToken(), TOK_JEFF = W.newMcpToken(), TOK_STALE = W.newMcpToken();
USERS = {
  Kap:  { mcpToken: await W.mcpTokenHash(ENV, TOK_KAP),  email: "kap@example.com" },
  Jeff: { mcpToken: await W.mcpTokenHash(ENV, TOK_JEFF), email: "jeff@example.com" },
  Mo:   {},                                   // never minted
};

const call = async (body, cred) => {
  const url = new URL("https://w.example.com/mcp/" + encodeURIComponent(cred));
  const req = new Request(url, { method: "POST", headers: { "Content-Type": "application/json" },
                                 body: JSON.stringify(body) });
  const res = await W.handleMcp(req, url, ENV);
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
};
const tool = async (name, args, cred) => {
  const r = await call({ jsonrpc: "2.0", id: 1, method: "tools/call",
                         params: { name, arguments: args || {} } }, cred);
  if (r.status !== 200) return { httpError: r.status };
  const res = r.body.result;
  // ⚠️ toolErr returns a plain sentence, not JSON — parsing it blindly throws and looks
  // like a tool failure when it IS the tool correctly reporting a failure.
  const parse = t => { try { return JSON.parse(t); } catch { return t; } };
  return { ...res, data: res.content ? parse(res.content[0].text) : null };
};

console.log("\ntoken shape");
ok("tokens are prefixed and long enough to be unguessable",
   TOK_KAP.startsWith("u_") && TOK_KAP.length >= 30, TOK_KAP.length + " chars");
ok("two mints never collide", TOK_KAP !== TOK_JEFF);
ok("only a HASH is stored, never the token",
   !JSON.stringify(USERS).includes(TOK_KAP) && !JSON.stringify(USERS).includes(TOK_JEFF));
{
  // ⚠️ domain separation: the same string hashed as an invite must NOT match as MCP
  const asMcp = await W.mcpTokenHash(ENV, "abc");
  const asInvite = await (async () => {
    const m = SRC.match(/const inviteHash = \(env, token\) => hmac\(env\.BOZO_PEPPER, "invite\|" \+ token\);/);
    return m ? "found" : null;
  })();
  ok("invite and MCP hashes are domain-separated in the source", asInvite === "found");
  ok("an MCP hash of a known string is stable", (await W.mcpTokenHash(ENV, "abc")) === asMcp);
}

console.log("\nauthentication");
{
  const good = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, TOK_KAP);
  ok("a valid per-user token is accepted", good.status === 200);
  const shared = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ENV.DAWG_PASS);
  ok("the legacy shared passphrase still works (migration path)", shared.status === 200);
  const stale = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, TOK_STALE);
  ok("a token that was never stored is rejected", stale.status === 401);
  const junk = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "u_notatoken");
  ok("a forged u_ token is rejected", junk.status === 401);
  const empty = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "");
  ok("no credential is rejected", empty.status === 401);
  ok("the 401 points at how to get a real URL",
     /connect\.html/.test(JSON.stringify((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "u_x")).body)));

  // revocation
  const saved = USERS.Jeff.mcpToken;
  USERS.Jeff = { ...USERS.Jeff, mcpToken: null };
  const revoked = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, TOK_JEFF);
  ok("a revoked token stops working on the very next call", revoked.status === 401);
  USERS.Jeff.mcpToken = saved;
  ok("and works again once re-minted",
     (await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, TOK_JEFF)).status === 200);
}

console.log("\nwho am I");
{
  const me = (await tool("dd_whoami", {}, TOK_KAP)).data;
  ok("a per-user token knows who it is", me.player === "Kap" && me.anonymous === false);
  const jeff = (await tool("dd_whoami", {}, TOK_JEFF)).data;
  ok("a different token is a different person", jeff.player === "Jeff");
  const anon = (await tool("dd_whoami", {}, ENV.DAWG_PASS)).data;
  ok("the shared connector admits it is anonymous", anon.anonymous === true && anon.player === null);
  ok("and tells the model to ask rather than assume", /ask the user/i.test(anon.note));

  const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, TOK_KAP);
  ok("initialize names the caller in its instructions", /connected as Kap/.test(init.body.result.instructions));
  const initAnon = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, ENV.DAWG_PASS);
  ok("initialize warns when the connection is anonymous", /do NOT know which member/.test(initAnon.body.result.instructions));
}

console.log("\nisolation — A must never be told they are B");
{
  const asKap = (await tool("dd_bozo_week", {}, TOK_KAP)).data;
  const asJeff = (await tool("dd_bozo_week", {}, TOK_JEFF)).data;
  ok("Kap's own leg is marked as his", asKap.legs.find(l => l.player === "Kap").you === true);
  ok("Mo's leg is not marked as Kap's", asKap.legs.find(l => l.player === "Mo").you === false);
  ok("Jeff sees none of the legs as his", asJeff.legs.every(l => l.you === false));
  ok("Jeff is told his leg is still missing", asJeff.yourLegIn === false);
  ok("Kap is told his leg is in", asKap.yourLegIn === true);
  ok("the waiting list is derived from real members", asKap.stillWaitingOn.join(",") === "Jeff");
  ok("the same board is still in SUBMISSION order for everyone",
     asKap.legs.map(l => l.player).join(",") === "Kap,Mo");

  const anon = (await tool("dd_bozo_week", {}, ENV.DAWG_PASS)).data;
  ok("an anonymous caller gets NO `you` flags at all",
     anon.you === null || anon.you === undefined ? anon.legs.every(l => l.you === undefined) : false);
  ok("and is not told whose leg is missing as if it were theirs", anon.yourLegIn === null);

  const st = (await tool("dd_bozo_standings", {}, TOK_KAP)).data;
  ok("standings mark only the caller's row", st.players.Kap.you === true && st.players.Mo.you === undefined);
  ok("standings name the caller", st.you === "Kap");
  const stAnon = (await tool("dd_bozo_standings", {}, ENV.DAWG_PASS)).data;
  ok("anonymous standings mark nobody", stAnon.you === null && !stAnon.players.Kap.you);
}

console.log("\nemail as an identifier");
{
  ok("an email resolves to its player", (await W.emailToName(ENV, "jeff@example.com")) === "Jeff");
  ok("matching is case-insensitive", (await W.emailToName(ENV, "  JEFF@Example.com ")) === "Jeff");
  ok("an unknown address resolves to nobody", (await W.emailToName(ENV, "nope@example.com")) === null);
  ok("a non-address is refused", (await W.emailToName(ENV, "Jeff")) === null);
  ok("login accepts an email where a name goes",
     /name = String\(body\.name \|\| body\.email/.test(SRC) && /emailToName\(env, name\)/.test(SRC));
  /* Was: /Unverified — nothing is sent/. CEP-6 shipped, so "nothing is sent" became false
     and the note now names the reset path. The property under test is unchanged — saving an
     address must say out loud that it is NOT confirmed — only the true wording moved. */
  ok("email is documented as unconfirmed, and as where a reset goes",
     /Saved but unconfirmed/.test(SRC) && /reset link goes here/.test(SRC));
  ok("…and no longer claims nothing is sent to it",
     !/nothing is (ever )?sent/i.test(SRC));
}

console.log("\nguillotine odds");
{
  const g = (await tool("dd_guillotine_odds", { league_id: "999" }, TOK_KAP)).data;
  ok("the league resolves", g.league === "Chop Shop" && g.teamCount === 4);
  ok("three completed weeks are counted", g.completedWeeks === 3);
  ok("survival is computed", g.survivalAvailable === true);
  ok("survival probabilities sum to teams-1 (exactly one team is chopped per week)",
     Math.abs(g.teams.reduce((s, t) => s + t.survival, 0) - (g.teams.length - 1)) < 0.01,
     g.teams.reduce((s, t) => s + t.survival, 0).toFixed(3));
  ok("the consistently worst team is most at risk", g.mostAtRisk.team === "Salsa", g.mostAtRisk.team);
  ok("teams are sorted worst-survival first", g.teams.every((t, i, a) => i === 0 || a[i - 1].survival <= t.survival));
  ok("the chop line sits below the best team's mean and near the worst's",
     g.projectedChopLine < 120 && g.projectedChopLine > 50, String(g.projectedChopLine));
  {
    const salsa = g.teams.find(t => t.team === "Salsa");
    const xs = [78, 82, 71], m = xs.reduce((a, b) => a + b) / 3;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / 2);
    ok("mean and sd are computed exactly as guillotine.html does",
       Math.abs(salsa.mean - m) < 0.01 && Math.abs(salsa.sd - sd) < 0.01,
       `${salsa.mean}/${salsa.sd} vs ${m.toFixed(2)}/${sd.toFixed(2)}`);
  }
  ok("every model assumption is stated in the payload",
     g.caveats.some(c => /NORMAL and INDEPENDENT/.test(c)) &&
     g.caveats.some(c => /bye week|injury/.test(c)) &&
     g.caveats.some(c => /own completed weekly scores/.test(c)));
  ok("results are reproducible run to run (seeded)",
     (await tool("dd_guillotine_odds", { league_id: "999" }, TOK_KAP)).data.projectedChopLine === g.projectedChopLine);

  const hi = (await tool("dd_guillotine_odds", { league_id: "999", team: "tri hard" }, TOK_KAP)).data;
  ok("a named team is highlighted", hi.highlighted && hi.highlighted.team === "Tri Hard");
  const miss = (await tool("dd_guillotine_odds", { league_id: "999", team: "nobody" }, TOK_KAP)).data;
  // ⚠️ the failure this page was explicitly fixed for: never hand back someone else's number
  ok("an unmatched team returns NO highlight rather than defaulting to another team",
     miss.highlighted === null && /No team or manager matched/.test(miss.note));

  sleeperSet = SLEEPER_THIN;
  const thin = (await tool("dd_guillotine_odds", { league_id: "999" }, TOK_KAP)).data;
  ok("one completed week refuses to produce a probability", thin.survivalAvailable === false);
  ok("and explains why in the payload", /not a probability/.test(thin.why));
  ok("but still returns the league and its teams", thin.teams.length === 4 && thin.league === "Chop Shop");
  sleeperSet = SLEEPER;

  const bad = await tool("dd_guillotine_odds", { league_id: "abc" }, TOK_KAP);
  ok("a non-numeric league id is a readable tool error", bad.isError === true);
}

console.log("\nthe write-scope invariant still holds");
/* ⚠️ Until 2026-08-13 this section was "the read-only invariant". dd_submit_bozo_leg
   (cep-identity §4) retired that claim deliberately, so what these pin now is the
   precise scope: one named write tool, one route to Firebase (commitBozoLeg, exactly
   once), and KV writes only on the caller's own mcpconfirm: staging key. */
{
  const block = SRC.slice(SRC.indexOf("DD-MCP-BLOCK START"));
  ok("no fbPut in the MCP block", !/fbPut\s*\(/.test(block));
  ok("no fbPatch in the MCP block", !/fbPatch\s*\(/.test(block));
  ok("no fbDelete in the MCP block", !/fbDelete\s*\(/.test(block));
  ok("commitBozoLeg is called exactly once in the block",
     (block.match(/commitBozoLeg\s*\(/g) || []).length === 1);
  ok("every KV write in the block targets the caller's own mcpconfirm staging key",
     (block.match(/\.put\s*\(/g) || []).length === (block.match(/env\.RL\.put\(kvKey/g) || []).length);
  // Two namespaces, and nothing outside them: dd_* reads the league, sd_* reads and
  // writes the signed-in athlete's own training log.
  ok("every tool name is namespaced", W.MCP_TOOLS.every(t => /^(dd|sd)_/.test(t.name)));
  ok("exactly one tool is named like a write, and it is the one write tool",
     W.MCP_TOOLS.filter(t => /(submit|place|set|write|delete|grade|lock)_/.test(t.name))
       .map(t => t.name).join("|") === "dd_submit_bozo_leg");
  ok("the token minting route is OUTSIDE the block, where writes are allowed",
     SRC.indexOf("async function authMcpToken") < SRC.indexOf("DD-MCP-BLOCK START"));
  ok("minting requires a session", /authMcpToken[\s\S]{0,400}sessionAuth\(request, env\)/.test(SRC));
  ok("minting acts only on the caller's own record",
     /encodeURIComponent\(auth\.uid \|\| auth\.name\)/.test(SRC.slice(SRC.indexOf("async function authMcpToken"),
                                                       SRC.indexOf("async function authEmail"))));
}

/* ============================== open signup =============================== */
/* /auth/signup is the only unauthenticated write on the Worker, so it gets the
   same against-the-assembled-bundle treatment as the MCP layer: real handlers,
   real KDF and session code, only the network faked. The wrapper below teaches
   the fake network PUT/PATCH so signup's writes land somewhere login can read. */
console.log("\nopen signup");

const AUTHREC = {};                     // fake /bozoauth/<key> store
const EMAILINDEX = {};                  // fake /emailIndex/<sha256> unique index
const WRITES = [];                      // every write path, for the no-seat proof
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (u, opts = {}) => {
    const url = String(u);
    const method = (opts.method || "GET").toUpperCase();
    if (method === "PUT" || method === "PATCH" || method === "DELETE")
      WRITES.push(method + " " + url.replace(DB, "").split(".json")[0]);
    let ix = url.match(/\/emailIndex\/([a-f0-9]+)\.json/);
    if (ix) {
      const key = ix[1], headers = { ETag: '"' + (EMAILINDEX[key]?.version || 1) + '"' };
      if (method === "GET") return new Response(JSON.stringify(EMAILINDEX[key]?.value ?? null), { headers });
      if (method === "PUT") {
        EMAILINDEX[key] = { value: JSON.parse(opts.body), version: (EMAILINDEX[key]?.version || 1) + 1 };
        return new Response("null");
      }
      if (method === "DELETE") { delete EMAILINDEX[key]; return new Response("null"); }
    }
    /* ⚠️ A DEEP-PATH PATCH ON THE COLLECTION, not on one record: fbPatch(env, "/users",
       { "Kap/entitlement": {...} }). Both the invite reconciliation and the entitlement
       backfill write this shape. Without applying it here the write would look like a 200
       and change nothing, and every assertion about the backfill would be green against a
       Worker that had done nothing at all. */
    if (url.startsWith(DB + "/users.json") && method === "PATCH") {
      for (const [p, v] of Object.entries(JSON.parse(opts.body))) {
        const parts = p.split("/");
        const key = parts.shift();
        if (!parts.length) { USERS[key] = { ...(USERS[key] || {}), ...v }; continue; }
        let node = (USERS[key] = USERS[key] || {});
        while (parts.length > 1) node = (node[parts[0]] = node[parts.shift()] || {});
        node[parts[0]] = v;
      }
      return new Response("{}");
    }
    /* A DEEP write under one account: fbPut(env, "/users/<uid>/nameLog/<ts>", {...}).
       Without this the append-only rename log would look written and be absent, and the
       assertion about it would be green against a Worker that recorded nothing. */
    let deep = url.match(/\/users\/([^./]+)\/([^.]+)\.json/);
    if (deep && (method === "PUT" || method === "PATCH")) {
      const parts = deep[2].split("/");
      let node = (USERS[deep[1]] = USERS[deep[1]] || {});
      while (parts.length > 1) node = (node[parts[0]] = node[parts.shift()] || {});
      const val = JSON.parse(opts.body);
      node[parts[0]] = method === "PUT" ? val : { ...(node[parts[0]] || {}), ...val };
      return new Response("null");
    }
    let m = url.match(/\/users\/([^./]+)\.json/);
    if (m && method === "GET") return new Response(JSON.stringify(USERS[m[1]] ?? null));
    if (m && method === "PUT") { USERS[m[1]] = JSON.parse(opts.body); return new Response("null"); }
    if (m && method === "PATCH") {
      const key = m[1];
      USERS[key] = { ...(USERS[key] || {}), ...JSON.parse(opts.body) };
      return new Response("{}");
    }
    m = url.match(/\/bozoauth\/([^./]+)\.json/);
    if (m) {
      const key = m[1];
      if (method === "PUT") { AUTHREC[key] = JSON.parse(opts.body); return new Response("{}"); }
      if (method === "GET") return new Response(JSON.stringify(AUTHREC[key] ?? null));
    }
    return origFetch(u, opts);
  };
}

const CORS = {};
const signupReq = (body, ip) => new Request("https://w.example.com/auth/signup", {
  method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip || "1.2.3.4" },
  body: JSON.stringify(body),
});
const postReq = (path, body) => new Request("https://w.example.com" + path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const jbody = async r => { try { return await r.json(); } catch { return null; } };
const byDisplay = name => Object.values(USERS).find(u => u && u.name === name);

{
  const r = await W.bozoSignup(signupReq({ name: "Zed", email: "zed@example.com", password: "longenough1" }), ENV, CORS);
  const j = await jbody(r);
  ok("a stranger can create an account", r.status === 201 && j.ok === true, JSON.stringify(j));
  ok("the response carries a working UID session", !!j.session && (await W.readSession(ENV, j.session))?.u === j.uid);
  ok("the account is keyed by immutable UID", /^u_/.test(j.uid) && USERS[j.uid]?.src === "signup-v2");
  ok("the email landed normalized on the user record", USERS[j.uid].email === "zed@example.com");
  ok("a real pbkdf2 record is embedded in the private UID user", !!USERS[j.uid].passwordSalt && USERS[j.uid].passwordIters === 5000);
  ok("the response says plainly confirmation gates the connector", /confirm/i.test(j.note || ""));
  ok("signup wrote an account, NOT a league seat", !WRITES.some(w => w.includes("/bozo/leagues")), WRITES.join(" | "));
}

console.log("\nsignup rejects");
{
  const cases = [
    ["a duplicate display name", { name: "Kap", email: "new@example.com", password: "longenough1" }, 201, /./],
    ["a taken email",           { name: "Newguy", email: "jeff@example.com", password: "longenough1" }, 409, /already uses/i],
    ["a missing email",         { name: "Newguy", email: "", password: "longenough1" }, 400, /email/i],
    ["a syntactically bad email", { name: "Newguy", email: "not-an-email", password: "longenough1" }, 400, /email/i],
    ["a short password",        { name: "Newguy", email: "new@example.com", password: "short" }, 400, /8 characters/i],
    ["an empty name",           { name: "  ", email: "new@example.com", password: "longenough1" }, 400, /name/i],
    ["a control character in the display name", { name: "a\u0000b", email: "control@example.com", password: "longenough1" }, 400, /not valid/i],
    ["a 61-character name",     { name: "x".repeat(61), email: "longname@example.com", password: "longenough1" }, 400, /not valid/i],
  ];
  for (const [label, body, status, re] of cases) {
    const r = await W.bozoSignup(signupReq(body), ENV, CORS);
    const j = await jbody(r);
    ok(label + (status === 201 ? " is allowed" : " is refused"), r.status === status &&
       (status === 201 || re.test(j.error || "")), r.status + " " + JSON.stringify(j));
  }
  const g = await W.bozoSignup(new Request("https://w.example.com/auth/signup"), ENV, CORS);
  ok("GET is refused", g.status === 405);
  ok("email uniqueness is case-insensitive",
     (await W.bozoSignup(signupReq({ name: "Newguy", email: "ZED@example.com", password: "longenough1" }), ENV, CORS)).status === 409);
}

/* ======================= the entitlement field on /users ===================== */
/* ⚠️ WHY THE FIELD EXISTS BEFORE ANYONE CAN PAY. An ABSENT entitlement is ambiguous:
   nothing distinguishes a free account from one written before the field existed. Adding it
   after money has changed hands means migrating live accounts. So it goes in now, while
   every account holds the same value and a mistake costs nothing.
   plan: free|member · status: none|active|past_due|canceled|grace · period_end: ms|null */
console.log("\nentitlement — the read side");
{
  const free = W.freeEntitlement();
  ok("the free default is plan free, status none, no period end",
     free.plan === "free" && free.status === "none" && free.period_end === null, JSON.stringify(free));
  ok("status is NOT a boolean — a lapse needs a state that is neither on nor off",
     typeof free.status === "string");

  const absent = W.entitlementOf({ email: "x@example.com" });
  ok("an account with no entitlement field reads as the free default",
     absent.plan === "free" && absent.status === "none" && absent.period_end === null, JSON.stringify(absent));
  ok("a missing user reads as the free default rather than throwing",
     W.entitlementOf(undefined).plan === "free" && W.entitlementOf(null).plan === "free");

  const real = W.entitlementOf({ entitlement: { plan: "member", status: "active", period_end: 1788000000000 } });
  ok("a real member record passes through untouched",
     real.plan === "member" && real.status === "active" && real.period_end === 1788000000000, JSON.stringify(real));
  const grace = W.entitlementOf({ entitlement: { plan: "member", status: "past_due", period_end: 1788000000000 } });
  ok("past_due survives as its own state — a failed card is not the same as cancelled",
     grace.plan === "member" && grace.status === "past_due");

  /* ⚠️ IT FAILS CLOSED. A record that cannot be understood must not read as a customer,
     because the alternative is a garbled write granting paid access. */
  const junkPlan = W.entitlementOf({ entitlement: { plan: "administrator", status: "active", period_end: 1 } });
  ok("an unrecognised plan degrades to free instead of being passed through",
     junkPlan.plan === "free" && junkPlan.status === "active", JSON.stringify(junkPlan));
  const junkStatus = W.entitlementOf({ entitlement: { plan: "member", status: "definitely-paid" } });
  ok("an unrecognised status degrades to none", junkStatus.status === "none", JSON.stringify(junkStatus));
  const junkEnd = W.entitlementOf({ entitlement: { plan: "member", status: "active", period_end: "soon" } });
  ok("a non-numeric period_end degrades to null, so no comparison can silently succeed",
     junkEnd.period_end === null, JSON.stringify(junkEnd));
  ok("a non-object entitlement reads as the free default",
     W.entitlementOf({ entitlement: "member" }).plan === "free" &&
     W.entitlementOf({ entitlement: true }).plan === "free");
  ok("the plan vocabulary is NOT the tier vocabulary — pup and working_dawg grade tools, not people",
     !/pup|working_dawg|dawghouse/i.test(JSON.stringify([free, real])));
}

console.log("\nentitlement — signup writes it, the request body cannot");
{
  const r = await W.bozoSignup(signupReq({ name: "Enty", email: "enty@example.com", password: "longenough1" }), ENV, CORS);
  ok("a new signup succeeds", r.status === 201, String(r.status));
  const e = byDisplay("Enty")?.entitlement;
  ok("…and the account is created carrying the free default",
     !!e && e.plan === "free" && e.status === "none" && e.period_end === null, JSON.stringify(e));

  /* ⚠️ THE WHOLE POINT OF SERVER-SIDE CONSTRUCTION. Entitlement updates will come from the
     Stripe webhook and from nowhere else. This proves the client cannot pre-empt that, and
     it is provable NOW precisely because the webhook does not exist yet. */
  const forged = await W.bozoSignup(signupReq({
    name: "Forger", email: "forger@example.com", password: "longenough1",
    entitlement: { plan: "member", status: "active", period_end: 9999999999999 },
  }), ENV, CORS);
  ok("a signup carrying an entitlement in its body still succeeds", forged.status === 201, String(forged.status));
  const f = byDisplay("Forger")?.entitlement;
  ok("…and the account it created is FREE — the body was not read",
     !!f && f.plan === "free" && f.status === "none" && f.period_end === null, JSON.stringify(f));
  ok("no request-body key named entitlement is read anywhere in the Worker",
     !/body\s*(\.|\[["']?)entitlement/.test(SRC) && !/\bentitlement\b[^\n]*=\s*body/.test(SRC));
}

console.log("\nentitlement — the backfill for accounts that predate the field");
{
  /* Mo has never had one. So does a record written before today. */
  delete USERS.Mo.entitlement;
  USERS.Legacy = { email: "legacy@example.com", src: "seed" };
  USERS.Paid = { email: "paid@example.com", entitlement: { plan: "member", status: "active", period_end: 1788000000000 } };
  const before = WRITES.length;
  const res = await W.bozoRoster(ENV, CORS);
  ok("the roster route still answers", res.status === 200, String(res.status));
  ok("an account written before the field now carries it",
     !!USERS.Legacy.entitlement && USERS.Legacy.entitlement.plan === "free", JSON.stringify(USERS.Legacy));
  ok("…and so does one that only ever had a token", !!USERS.Mo.entitlement);
  ok("⚠️ an existing PAID entitlement is not touched by the backfill",
     USERS.Paid.entitlement.plan === "member" && USERS.Paid.entitlement.status === "active",
     JSON.stringify(USERS.Paid.entitlement));
  const writes = WRITES.slice(before).filter(w => w.startsWith("PATCH /users"));
  ok("the backfill rides ONE patch, not one per account",
     writes.length === 1, writes.join(" | "));

  /* A second call must be a no-op. A migration that rewrites the same records on every
     page load is a write amplification bug that looks like nothing. */
  const beforeAgain = WRITES.length;
  await W.bozoRoster(ENV, CORS);
  ok("a second roster read writes nothing — the backfill is genuinely one-time",
     WRITES.slice(beforeAgain).filter(w => w.startsWith("PATCH /users")).length === 0,
     WRITES.slice(beforeAgain).join(" | "));
}

console.log("\nentitlement — a re-invite must not downgrade a paying member");
{
  /* ⚠️ THIS IS THE ASSERTION THE isNew GUARD EXISTS FOR. authInvite PATCHes /users/<name>,
     and re-inviting someone who already has an account is ordinary — a lost join link gets
     re-minted. Writing the free default unconditionally there would set a paying member
     back to free, with a 200 and no error, the next time an admin re-sent them a link. */
  /* sessionAuth requires the session to match the password record on file, so the fixture
     needs one. Without it the invite is refused with "your password was reset" and every
     assertion below would be measuring the harness rather than the guard. */
  const pwSetAt = 1786000000000;
  AUTHREC.Kap = { v: 1, salt: "fixture", hash: "fixture", iters: 5000, setAt: pwSetAt };
  const session = await W.makeSession(ENV, "Kap", pwSetAt);
  const inviteAs = (player) => new Request("https://w.example.com/auth/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dawg-Session": session },
    body: JSON.stringify({ league: "main", player }),
  });

  USERS.Paid.entitlement = { plan: "member", status: "active", period_end: 1788000000000 };
  const again = await W.authInvite(inviteAs("Paid"), ENV, CORS);
  const againBody = await jbody(again);
  ok("re-inviting an existing member succeeds", again.status === 200 && againBody.isNew === false,
     again.status + " " + JSON.stringify(againBody));
  ok("⚠️ …and their paid entitlement is UNCHANGED",
     USERS.Paid.entitlement.plan === "member" && USERS.Paid.entitlement.status === "active" &&
     USERS.Paid.entitlement.period_end === 1788000000000, JSON.stringify(USERS.Paid.entitlement));

  const fresh = await W.authInvite(inviteAs("Newcomer"), ENV, CORS);
  const freshBody = await jbody(fresh);
  ok("inviting somebody brand new creates the account", fresh.status === 200 && freshBody.isNew === true,
     fresh.status + " " + JSON.stringify(freshBody));
  ok("…and that account is created carrying the free default, not left undefined",
     !!USERS.Newcomer.entitlement && USERS.Newcomer.entitlement.plan === "free",
     JSON.stringify(USERS.Newcomer && USERS.Newcomer.entitlement));
}

console.log("\nentitlement — what MCP sees, and what it must not do");
{
  /* ⚠️ THE BACKFILL IS DELIBERATELY NOT IN loadUsers. loadUsers is the funnel every path
     uses, INCLUDING mcpAuth, so a write there would let a read-only MCP tool trigger a
     Firebase write on its first call. "Every tool is read-only, asserted by test against
     the source" is a published claim on connect.html and in surfaces.json; a self-healing
     migration is not a good enough reason to make it need an asterisk. Nothing is lost:
     entitlementOf() defaults on read, so no read is ambiguous before the record catches up. */
  /* ⚠️ THIS HAS TO SET UP ITS OWN CONDITION, AND THE FIRST DRAFT DID NOT. A source-level
     check for "no entitlement write inside loadUsers" was written first and the mutation
     harness walked straight through it: the mutation put fbPatch and the word entitlement on
     different lines, and the regex only looked at one line. It was replaced by this, which
     is behavioural — but a behavioural no-write assertion is only worth anything if a write
     is actually DUE. The earlier /auth/roster assertions have already backfilled every
     record by this point, so asserting "nothing was written" here would pass trivially. The
     field is therefore removed again first, which is the state a real MCP-only caller would
     hit before ever loading the sign-on page. */
  delete USERS.Jeff.entitlement;
  const beforeMcpWrites = WRITES.length;
  const jeff = await tool("dd_whoami", {}, TOK_JEFF);
  ok("an MCP call against an account that still lacks the field reads as free",
     jeff.data && jeff.data.entitlement && jeff.data.entitlement.plan === "free", JSON.stringify(jeff.data));
  ok("⚠️ …and it writes NOTHING — the backfill is deliberately not on the MCP path",
     WRITES.slice(beforeMcpWrites).length === 0, WRITES.slice(beforeMcpWrites).join(" | "));
  ok("…and the stored record was not quietly mutated in memory either",
     USERS.Jeff.entitlement === undefined, JSON.stringify(USERS.Jeff));
  USERS.Jeff.entitlement = W.freeEntitlement();

  USERS.Kap.entitlement = { plan: "member", status: "active", period_end: 1788000000000 };
  const beforeWrites = WRITES.length;
  const mine = await tool("dd_whoami", {}, TOK_KAP);
  ok("dd_whoami reports the caller's own entitlement",
     mine.data && mine.data.entitlement && mine.data.entitlement.plan === "member" &&
     mine.data.entitlement.status === "active", JSON.stringify(mine.data));
  ok("⚠️ …and answering it wrote NOTHING", WRITES.length === beforeWrites,
     WRITES.slice(beforeWrites).join(" | "));

  USERS.Kap.entitlement = { plan: "member", status: "definitely-paid" };
  const degraded = await tool("dd_whoami", {}, TOK_KAP);
  ok("a garbled stored status reaches the caller as none, not as something paid-looking",
     degraded.data.entitlement.status === "none", JSON.stringify(degraded.data.entitlement));
  USERS.Kap.entitlement = W.freeEntitlement();

  const shared = await tool("dd_whoami", {}, ENV.DAWG_PASS);
  ok("an anonymous shared connection is given NO entitlement, not a free-looking one",
     shared.data.entitlement === null, JSON.stringify(shared.data));
  ok("…and is told in words that it has none, so a model cannot describe anyone's plan",
     /no entitlement/i.test(shared.data.note || ""), shared.data.note);
}

console.log("\nsignup accounts can actually sign in");
{
  const loginStore = new Map();
  const LOGIN_ENV = { ...ENV, RL: { async get(k) { return loginStore.get(k) ?? null; },
    async put(k, v) { loginStore.set(k, String(v)); } } };
  const byName = await W.bozoLogin(postReq("/auth/login", { name: "Zed", password: "longenough1" }), LOGIN_ENV, CORS);
  const j1 = await jbody(byName);
  ok("UID accounts do not authorize by mutable display name", byName.status === 401, JSON.stringify(j1));
  const byEmail = await W.bozoLogin(postReq("/auth/login", { name: "zed@example.com", password: "longenough1" }), LOGIN_ENV, CORS);
  const j2 = await jbody(byEmail);
  ok("by email, resolving to the display name and immutable UID", byEmail.status === 200 && j2.name === "Zed" && /^u_/.test(j2.uid), JSON.stringify(j2));
  const wrong = await W.bozoLogin(postReq("/auth/login", { name: "Zed", password: "wrongwrong" }), LOGIN_ENV, CORS);
  ok("a wrong password still fails", wrong.status === 401);
}

console.log("\nsignup rate limit");
{
  const store = new Map();
  const RL = { async get(k) { return store.get(k) ?? null; },
               async put(k, v) { store.set(k, v); } };
  const ENV_RL = { ...ENV, RL };
  let last = null;
  for (let i = 0; i < 6; i++) {
    last = await W.bozoSignup(signupReq(
      { name: "Flood" + i, email: "flood" + i + "@example.com", password: "longenough1" }, "9.9.9.9"), ENV_RL, CORS);
  }
  const j = await jbody(last);
  ok("the 6th account from one IP in a day is refused", last.status === 429, last.status + " " + JSON.stringify(j));
  ok("and told to come back tomorrow", /tomorrow/i.test(j.error || ""));
  const other = await W.bozoSignup(signupReq(
    { name: "Elsewhere", email: "elsewhere@example.com", password: "longenough1" }, "8.8.8.8"), ENV_RL, CORS);
  ok("a different IP is not caught in it", other.status === 201);
  ok("the counter keys by day and IP", [...store.keys()].some(k => /^signup:\d{4}-\d{2}-\d{2}:9\.9\.9\.9$/.test(k)));
  // A typo must not burn one of the day's five — only requests that reach the
  // database count. Five bad emails in a row would otherwise lock someone out.
  const before = [...store.entries()].find(([k]) => k.endsWith("8.8.8.8"))?.[1];
  await W.bozoSignup(signupReq({ name: "Typo", email: "not-an-email", password: "longenough1" }, "8.8.8.8"), ENV_RL, CORS);
  const after = [...store.entries()].find(([k]) => k.endsWith("8.8.8.8"))?.[1];
  ok("a syntactically invalid attempt does not count against the cap", before === after, before + " -> " + after);
  ok("but a duplicate-email probe does (it reached the database)", await (async () => {
    await W.bozoSignup(signupReq({ name: "Probe", email: "zed@example.com", password: "longenough1" }, "8.8.8.8"), ENV_RL, CORS);
    const probed = [...store.entries()].find(([k]) => k.endsWith("8.8.8.8"))?.[1];
    return Number(probed) === Number(after) + 1;
  })());
}

console.log("\nsignup source invariants");
{
  ok("the route is wired on /auth/* and /bozo/* via the AUTH map", /"\/signup": bozoSignup/.test(SRC));
  ok("signup lives OUTSIDE the read-only MCP block",
     SRC.indexOf("async function bozoSignup") < SRC.indexOf("DD-MCP-BLOCK START"));
  const fn = SRC.slice(SRC.indexOf("const SIGNUP_CAP"), SRC.indexOf("async function loadUsers"));
  ok("the IP cap is checked before any database work", fn.indexOf("env.RL") < fn.indexOf("loadUsers"));
  ok("signup never touches league membership", !/LG\(|\/members/.test(fn));
  ok("signup records unverified state and does not grant verification", /emailVerified:\s*false/.test(fn) && !/emailVerified:\s*true/.test(fn));
}

/* ================= display name: a mutable, NON-UNIQUE label ================= */
/* Email is the uniqueness key. The name is decoration, and the whole point of this
   route is that it can be changed and that two members may share one. */
console.log("\ndisplay name");
{
  const uid = Object.keys(USERS).find(k => /^u_/.test(k) && USERS[k].email === "zed@example.com");
  const pwSetAt = USERS[uid].passwordSetAt;
  const sess = await W.makeSession(ENV, USERS[uid].name, pwSetAt, uid);
  const renameAs = (session, name) => new Request("https://w.example.com/auth/name", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Dawg-Session": session },
    body: JSON.stringify({ name }),
  });

  ok("an anonymous rename is refused", (await W.authName(new Request("https://w.example.com/auth/name",
     { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), ENV, CORS)).status === 401);
  ok("GET is refused", (await W.authName(new Request("https://w.example.com/auth/name"), ENV, CORS)).status === 405);

  const r = await W.authName(renameAs(sess, "Zedediah"), ENV, CORS);
  const j = await jbody(r);
  ok("a member can change their own display name", r.status === 200 && j.name === "Zedediah", JSON.stringify(j));
  ok("the change lands on the account record", USERS[uid].name === "Zedediah" && !!USERS[uid].nameSetAt);
  ok("the previous name is recorded, append-only", !!USERS[uid].nameLog &&
     Object.values(USERS[uid].nameLog).some(e => e.from === "Zed" && e.to === "Zedediah"));
  ok("a renewed session comes back", !!j.session && (await W.readSession(ENV, j.session))?.n === "Zedediah");
  ok("⚠️ the account is still found by EMAIL, not by name", (await W.emailToName(ENV, "zed@example.com")) === "Zedediah");

  const dup = await W.authName(renameAs(await W.makeSession(ENV, "Zedediah", pwSetAt, uid), "Kap"), ENV, CORS);
  ok("⚠️ taking a name somebody else already uses is ALLOWED", dup.status === 200,
     dup.status + " " + JSON.stringify(await jbody(dup)));
  USERS[uid].name = "Zedediah";

  const s2 = await W.makeSession(ENV, "Zedediah", pwSetAt, uid);
  for (const [label, name, status, re] of [
    ["an empty name", "   ", 400, /name/i],
    ["a control character", "a\u0000b", 400, /not valid/i],
    ["a 61-character name", "x".repeat(61), 400, /not valid/i],
  ]) {
    const bad = await W.authName(renameAs(s2, name), ENV, CORS);
    ok(label + " is refused", bad.status === status && re.test((await jbody(bad)).error || ""));
  }
  const same = await W.authName(renameAs(s2, "Zedediah"), ENV, CORS);
  ok("renaming to the name you already have is a clean no-op", same.status === 200 && (await jbody(same)).unchanged === true);

  /* Current Bozo writes key both the member seat and standing leg by immutable uid.
     The deliberately name-keyed demo/history leagues are graded and never produce a
     standing leg. A rename therefore changes the account label without moving the pick. */
  LEAGUE.members[uid] = { name: "Zedediah" };
  LEAGUE.picks[uid] = { who: "Zedediah", label: "BUF -3.5", ts: 400 };
  const renamed = await W.authName(renameAs(s2, "Somebody Else"), ENV, CORS);
  const rj = await jbody(renamed);
  ok("⚠️ a rename is allowed while a uid-keyed leg is standing",
     renamed.status === 200 && rj.name === "Somebody Else",
     renamed.status + " " + JSON.stringify(rj));
  ok("…and the standing leg stays under the caller's immutable uid",
     LEAGUE.picks[uid]?.label === "BUF -3.5" && !LEAGUE.picks["Somebody Else"]);
  ok("…and the account carries the new display name", USERS[uid].name === "Somebody Else");
  delete LEAGUE.picks[uid];
  delete LEAGUE.members[uid];
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
