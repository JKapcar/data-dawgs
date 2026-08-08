/* Per-user identity, isolation, and the first compute tool — against the ASSEMBLED
   Worker with its real helpers (loadUsers, hmac, timingSafeEqual, mcpAuth) and only the
   network faked. The Worker cannot be deployed from here, so this is where the identity
   layer has to prove itself before Kap pastes it.

   Run:  cd work && node test-identity.mjs
*/
import fs from "fs";
import { webcrypto } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const SRC = fs.readFileSync("../dawg-bot-worker.js", "utf8");
const BUNDLE = join(tmpdir(), "worker-identity.mjs");
fs.writeFileSync(BUNDLE, SRC + "\nexport { handleMcp, MCP_TOOLS, mcpAuth, mcpTokenHash, newMcpToken, emailToName, bozoSignup, bozoLogin, readSession };\n");

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
  ok("email is documented as unverified", /Unverified — nothing is sent/.test(SRC));
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

console.log("\nthe read-only invariant still holds");
{
  const block = SRC.slice(SRC.indexOf("DD-MCP-BLOCK START"));
  ok("no fbPut in the MCP block", !/fbPut\s*\(/.test(block));
  ok("no fbPatch in the MCP block", !/fbPatch\s*\(/.test(block));
  ok("no fbDelete in the MCP block", !/fbDelete\s*\(/.test(block));
  ok("no KV writes in the MCP block", !/\.put\s*\(/.test(block));
  ok("every tool name is namespaced", W.MCP_TOOLS.every(t => t.name.startsWith("dd_")));
  ok("no tool is named like a write",
     W.MCP_TOOLS.every(t => !/(submit|place|set|write|delete|grade|lock)_/.test(t.name)));
  ok("the token minting route is OUTSIDE the block, where writes are allowed",
     SRC.indexOf("async function authMcpToken") < SRC.indexOf("DD-MCP-BLOCK START"));
  ok("minting requires a session", /authMcpToken[\s\S]{0,400}sessionAuth\(request, env\)/.test(SRC));
  ok("minting acts only on the caller's own record",
     /encodeURIComponent\(auth\.name\)/.test(SRC.slice(SRC.indexOf("async function authMcpToken"),
                                                       SRC.indexOf("async function authEmail"))));
}

/* ============================== open signup =============================== */
/* /auth/signup is the only unauthenticated write on the Worker, so it gets the
   same against-the-assembled-bundle treatment as the MCP layer: real handlers,
   real KDF and session code, only the network faked. The wrapper below teaches
   the fake network PUT/PATCH so signup's writes land somewhere login can read. */
console.log("\nopen signup");

const AUTHREC = {};                     // fake /bozoauth/<key> store
const WRITES = [];                      // every write path, for the no-seat proof
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (u, opts = {}) => {
    const url = String(u);
    const method = (opts.method || "GET").toUpperCase();
    if (method === "PUT" || method === "PATCH" || method === "DELETE")
      WRITES.push(method + " " + url.replace(DB, "").split(".json")[0]);
    let m = url.match(/\/users\/([^./]+)\.json/);
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

{
  const r = await W.bozoSignup(signupReq({ name: "Zed", email: "zed@example.com", password: "longenough1" }), ENV, CORS);
  const j = await jbody(r);
  ok("a stranger can create an account", r.status === 200 && j.ok === true, JSON.stringify(j));
  ok("the response carries a working session", !!j.session && (await W.readSession(ENV, j.session))?.n === "Zed");
  ok("the account is keyed by NAME, same data model as claim", !!USERS.Zed && USERS.Zed.src === "signup");
  ok("the email landed on the user record", USERS.Zed.email === "zed@example.com");
  ok("a real pbkdf2 record was written", AUTHREC.Zed && AUTHREC.Zed.v === 1 && !!AUTHREC.Zed.salt && AUTHREC.Zed.iters === 5000);
  ok("the response says plainly the email is unverified", /nothing is ever sent/i.test(j.note || ""));
  ok("signup wrote an account, NOT a league seat", !WRITES.some(w => w.includes("/bozo/leagues")), WRITES.join(" | "));
}

console.log("\nsignup rejects");
{
  const cases = [
    ["a taken name",            { name: "Kap", email: "new@example.com", password: "longenough1" }, 409, /taken/i],
    ["a taken email",           { name: "Newguy", email: "jeff@example.com", password: "longenough1" }, 409, /already uses/i],
    ["a missing email",         { name: "Newguy", email: "", password: "longenough1" }, 400, /email/i],
    ["a syntactically bad email", { name: "Newguy", email: "not-an-email", password: "longenough1" }, 400, /email/i],
    ["a short password",        { name: "Newguy", email: "new@example.com", password: "short" }, 400, /8 characters/i],
    ["an empty name",           { name: "  ", email: "new@example.com", password: "longenough1" }, 400, /name/i],
    ["a name with Firebase-breaking chars", { name: "a.b#c", email: "new@example.com", password: "longenough1" }, 400, /can't contain/i],
    ["a 41-character name",     { name: "x".repeat(41), email: "new@example.com", password: "longenough1" }, 400, /too long/i],
  ];
  for (const [label, body, status, re] of cases) {
    const r = await W.bozoSignup(signupReq(body), ENV, CORS);
    const j = await jbody(r);
    ok(label + " is refused", r.status === status && re.test(j.error || ""), r.status + " " + JSON.stringify(j));
  }
  const g = await W.bozoSignup(new Request("https://w.example.com/auth/signup"), ENV, CORS);
  ok("GET is refused", g.status === 405);
  ok("email uniqueness is case-insensitive",
     (await W.bozoSignup(signupReq({ name: "Newguy", email: "ZED@example.com", password: "longenough1" }), ENV, CORS)).status === 409);
}

console.log("\nsignup accounts can actually sign in");
{
  const byName = await W.bozoLogin(postReq("/auth/login", { name: "Zed", password: "longenough1" }), ENV, CORS);
  const j1 = await jbody(byName);
  ok("by name", byName.status === 200 && j1.ok === true && !!j1.session, JSON.stringify(j1));
  const byEmail = await W.bozoLogin(postReq("/auth/login", { name: "zed@example.com", password: "longenough1" }), ENV, CORS);
  const j2 = await jbody(byEmail);
  ok("by email, resolving to the roster name", byEmail.status === 200 && j2.name === "Zed", JSON.stringify(j2));
  const wrong = await W.bozoLogin(postReq("/auth/login", { name: "Zed", password: "wrongwrong" }), ENV, CORS);
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
  ok("a different IP is not caught in it", other.status === 200);
  ok("the counter keys by day and IP", [...store.keys()].some(k => /^signup:\d{4}-\d{2}-\d{2}:9\.9\.9\.9$/.test(k)));
  // A typo must not burn one of the day's five — only requests that reach the
  // database count. Five bad emails in a row would otherwise lock someone out.
  const before = [...store.entries()].find(([k]) => k.endsWith("8.8.8.8"))?.[1];
  await W.bozoSignup(signupReq({ name: "Typo", email: "not-an-email", password: "longenough1" }, "8.8.8.8"), ENV_RL, CORS);
  const after = [...store.entries()].find(([k]) => k.endsWith("8.8.8.8"))?.[1];
  ok("a syntactically invalid attempt does not count against the cap", before === after, before + " -> " + after);
  ok("but a duplicate-name probe does (it reached the database)", await (async () => {
    await W.bozoSignup(signupReq({ name: "Kap", email: "probe@example.com", password: "longenough1" }, "8.8.8.8"), ENV_RL, CORS);
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
  ok("no verification is claimed anywhere in the handler", !/verif/i.test(fn.replace(/UNVERIFIED|Unverified|unverified|verification is out/g, "")));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
