/* Stage FC-A — the forecasting challenge storage schema.
   Exercises the assembled Worker with Firebase RTDB, KV and the schedule surface faked.

   Run:  cd work && node test-forecast-store.mjs

   ⚠️ WHAT THIS SUITE IS ACTUALLY FOR. Everything here is about what gets WRITTEN DOWN.
   A page can be rebuilt; a season of entries stored in the wrong shape cannot be
   re-collected, and a crowd consensus that was not sealed before kickoff can never be
   made prospective afterwards. Four guarantees carry that weight, and each one has a
   mutation in work/forecast_mutations.py that must turn it red:

     1. Nobody but the owner reads an entry until that game kicks off.
     2. `touched` is stored separately from the value and is never derived from it.
     3. No running total is stored anywhere.
     4. The consensus averages LOG-ODDS, and its captured_at precedes kickoff.
*/
import { webcrypto } from "crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from "../dawg-bot-worker.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail === undefined ? "" : " — " + detail)); }
};
const close = (a, b, eps = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= eps;

/* ------------------------------ fake KV --------------------------------- */
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

/* --------------------- fake RTDB: generic deep paths ---------------------
   The league-join suite hand-rolls an `at()` for the three nodes it needs. The
   forecast tree is six levels deep and its shape is the thing under test, so this
   one addresses any path — a fake that only understood the paths I expected would
   pass a schema it had been taught in advance. */
let db;
const resetDb = () => {
  db = {
    users: { Kap: { pw: "x" }, Jeff: { pw: "x" }, Sam: { pw: "x" },
             Dana: { pw: "x" }, Nia: { pw: "x" }, Rue: { pw: "x" }, Bea: { pw: "x" } },
    bozoauth: { Kap: { setAt: 0 }, Jeff: { setAt: 0 }, Sam: { setAt: 0 },
                Dana: { setAt: 0 }, Nia: { setAt: 0 }, Rue: { setAt: 0 }, Bea: { setAt: 0 } },
  };
};
resetDb();

const parts = path => path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
const dbGet = path => {
  let node = db;
  for (const key of parts(path)) {
    if (node === null || typeof node !== "object" || !(key in node)) return null;
    node = node[key];
  }
  return node === undefined ? null : node;
};
const dbSet = (path, value) => {
  const p = parts(path);
  if (!p.length) { db = value; return; }
  let node = db;
  for (const key of p.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== "object") node[key] = {};
    node = node[key];
  }
  const last = p[p.length - 1];
  if (value === null) delete node[last]; else node[last] = value;
};

/* --------------------------- fake schedule ------------------------------- */
const NOW = Date.now();
const OPEN_KICK = NOW + 3 * 3600e3;      // still open for writes
const LOCK_KICK = NOW - 3 * 3600e3;      // kicked off three hours ago
const G_OPEN = "2026_01_NE_SEA";
const G_LOCK = "2026_01_SF_LAR";
const G_CFB = "2026_01_ALA_UGA";

const scheduleEnvelope = (season, games) => ({
  as_of: "2026-08-10", source: "faked for test-forecast-store.mjs",
  data: { season, games },
});
const NFL_SCHEDULE = scheduleEnvelope(2026, [
  { game_id: G_OPEN, season: 2026, week: 1, kickoff_at: new Date(OPEN_KICK).toISOString(),
    home_team: "SEA", away_team: "NE" },
  { game_id: G_LOCK, season: 2026, week: 1, kickoff_at: new Date(LOCK_KICK).toISOString(),
    home_team: "LAR", away_team: "SF" },
]);
const CFB_SCHEDULE = scheduleEnvelope(2026, [
  { game_id: G_CFB, season: 2026, week: 1, kickoff_at: new Date(OPEN_KICK).toISOString(),
    home_team: "UGA", away_team: "ALA" },
]);

let scheduleHits = 0;
const ENV = { FB_SECRET: "fbsecret", BOZO_PEPPER: "pepper", BOZO_ADMIN: "Kap", RL: makeKV() };

globalThis.fetch = async (input, init = {}) => {
  const href = String(input instanceof URL ? input.href : (input && input.url) || input);
  const url = new URL(href);

  if (url.hostname === "datadawgs216.com") {
    scheduleHits++;
    if (url.pathname === "/data/nfl-schedule.json")
      return new Response(JSON.stringify(NFL_SCHEDULE), { status: 200 });
    if (url.pathname === "/data/cfb-schedule.json")
      return new Response(JSON.stringify(CFB_SCHEDULE), { status: 200 });
    return new Response("no", { status: 404 });
  }
  if (!/firebaseio|firebasedatabase/.test(url.hostname)) throw new Error("unexpected fetch " + href);

  const path = decodeURIComponent(url.pathname.replace(/\.json$/, ""));
  const method = (init.method || "GET").toUpperCase();
  if (method === "GET") {
    if (url.searchParams.get("auth") !== ENV.FB_SECRET)
      return new Response(JSON.stringify({ error: "Permission denied" }), { status: 401 });
    return new Response(JSON.stringify(dbGet(path)), { status: 200 });
  }
  const body = init.body ? JSON.parse(init.body) : null;
  if (method === "PUT") { dbSet(path, body); return new Response("{}", { status: 200 }); }
  if (method === "PATCH") {
    const cur = dbGet(path) || {};
    for (const [k, v] of Object.entries(body || {})) { if (v === null) delete cur[k]; else cur[k] = v; }
    dbSet(path, cur);
    return new Response("{}", { status: 200 });
  }
  if (method === "DELETE") { dbSet(path, null); return new Response("{}", { status: 200 }); }
  return new Response("{}", { status: 200 });
};

/* --------------------------- session minting ----------------------------- */
const te = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = s => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sessionFor(name) {
  const payload = b64url(JSON.stringify({ n: name, e: Date.now() + 864e5, p: 0 }));
  const key = await crypto.subtle.importKey("raw", te.encode(ENV.BOZO_PEPPER),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(payload));
  return payload + "." + b64(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ORIGIN = "https://toto.jkapcar4.workers.dev";
const call = async (path, { method = "POST", body, session } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (session) headers["X-Dawg-Session"] = session;
  const r = await worker.fetch(new Request(ORIGIN + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), ENV);
  let j = null, text = "";
  try { text = await r.text(); j = JSON.parse(text); } catch { /* keep the raw text */ }
  return { status: r.status, j, text };
};

const KAP = await sessionFor("Kap");     // BOZO_ADMIN
const JEFF = await sessionFor("Jeff");
const SAM = await sessionFor("Sam");

/* The suite is worthless if every call is silently anonymous. Prove a session
   authenticates before asserting anything about what sessions may do. */
{
  const probe = await call("/forecast/entries?sport=nfl&season=2026&week=1", { method: "GET", session: KAP });
  if (probe.status !== 200) {
    console.log("  FAIL could not authenticate a session against the Worker — " + probe.status + " " + probe.text);
    process.exit(1);
  }
  const anon = await call("/forecast/entries?sport=nfl&season=2026&week=1", { method: "GET" });
  ok("an anonymous read is refused", anon.status === 401, String(anon.status));
}

const entryOf = (sport, season, week, user, gameId) =>
  dbGet(`/forecast/entries/${sport}/${season}/${week}/${encodeURIComponent(user)}/${encodeURIComponent(gameId)}`);

/* ====================== 1. the entry write path ========================== */
console.log("\nthe entry write path");
{
  const r = await call("/forecast/entry", {
    session: JEFF, body: { sport: "nfl", game_id: G_OPEN, slider_value: 62, slider_side: "home", touched: true },
  });
  ok("a forecast before kickoff is accepted", r.status === 200, r.text);
  const stored = entryOf("nfl", 2026, 1, "Jeff", G_OPEN);
  ok("it lands at entries/<sport>/<season>/<week>/<user>/<game_id>", !!stored,
    JSON.stringify(Object.keys(dbGet("/forecast/entries/nfl/2026/1") || {})));
  ok("season and week come from the schedule, not the request",
    stored && stored.season === 2026 && stored.week === 1);
  ok("home_win_probability is derived as P(home)", stored && close(stored.home_win_probability, 0.62));
  ok("the raw slider is kept beside the canonical number",
    stored && stored.slider_value === 62 && stored.slider_side === "home");
  ok("teams and kickoff are stamped from the canonical schedule",
    stored && stored.home_team === "SEA" && stored.away_team === "NE" &&
    stored.kickoff_at === new Date(OPEN_KICK).toISOString());
  ok("submitted_at is server time and precedes kickoff",
    stored && stored.submitted_at >= NOW && stored.submitted_at < OPEN_KICK, stored && stored.submitted_at);
  ok("the first write is revision 1", stored && stored.revision === 1, stored && stored.revision);
}
{
  const r = await call("/forecast/entry", {
    session: JEFF, body: { sport: "nfl", game_id: G_OPEN, slider_value: 30, slider_side: "away", touched: true },
  });
  const stored = entryOf("nfl", 2026, 1, "Jeff", G_OPEN);
  ok("editing before kickoff is allowed", r.status === 200, r.text);
  ok("an away-side slider is converted to P(home)", stored && close(stored.home_win_probability, 0.70),
    stored && stored.home_win_probability);
  ok("the raw side is preserved, not normalized away", stored && stored.slider_side === "away" && stored.slider_value === 30);
  ok("editing increments revision rather than replacing history-free",
    stored && stored.revision === 2, stored && stored.revision);
}
{
  const r = await call("/forecast/entry", {
    session: JEFF,
    body: { sport: "nfl", game_id: G_OPEN, slider_value: 62, slider_side: "home", touched: true,
            home_win_probability: 0.99 },
  });
  ok("a client-asserted home_win_probability is REFUSED", r.status === 400, r.text);
  const stored = entryOf("nfl", 2026, 1, "Jeff", G_OPEN);
  ok("...and did not overwrite the derived number", stored && close(stored.home_win_probability, 0.70));
}
{
  const forged = NOW - 5 * 86400e3;
  await call("/forecast/entry", {
    session: SAM,
    body: { sport: "nfl", game_id: G_OPEN, slider_value: 55, slider_side: "home", touched: true,
            submitted_at: forged, ts: forged, revision: 99, user: "Kap", source: "forged" },
  });
  const stored = entryOf("nfl", 2026, 1, "Sam", G_OPEN);
  ok("a client-supplied submitted_at is ignored", stored && stored.submitted_at !== forged);
  ok("a client-supplied revision is ignored", stored && stored.revision === 1);
  ok("a client cannot write the entry under another user's name",
    stored && stored.user === "Sam" && !entryOf("nfl", 2026, 1, "Kap", G_OPEN));
  ok("a client-supplied source is ignored", stored && stored.source === "web");
}
{
  const bad = [
    ["an unknown sport", { sport: "xfl", game_id: G_OPEN, slider_value: 50, slider_side: "home", touched: true }, 400],
    ["a game not in the canonical schedule", { sport: "nfl", game_id: "2026_01_XXX_YYY", slider_value: 50, slider_side: "home", touched: true }, 404],
    ["a fractional slider", { sport: "nfl", game_id: G_OPEN, slider_value: 62.5, slider_side: "home", touched: true }, 400],
    ["a slider above 100", { sport: "nfl", game_id: G_OPEN, slider_value: 101, slider_side: "home", touched: true }, 400],
    ["a slider below 0", { sport: "nfl", game_id: G_OPEN, slider_value: -1, slider_side: "home", touched: true }, 400],
    ["a missing side", { sport: "nfl", game_id: G_OPEN, slider_value: 50, touched: true }, 400],
    ["a non-boolean touched", { sport: "nfl", game_id: G_OPEN, slider_value: 50, slider_side: "home", touched: "yes" }, 400],
  ];
  for (const [what, body, want] of bad) {
    const r = await call("/forecast/entry", { session: JEFF, body });
    ok(what + " is refused " + want, r.status === want, r.status + " " + r.text);
  }
}

/* ================ 2. the lock — prospective by construction =============== */
console.log("\nthe lock");
{
  const r = await call("/forecast/entry", {
    session: JEFF, body: { sport: "nfl", game_id: G_LOCK, slider_value: 70, slider_side: "home", touched: true },
  });
  ok("a write at or after kickoff is refused 409", r.status === 409, r.text);
  ok("...and nothing was stored for it", !entryOf("nfl", 2026, 1, "Jeff", G_LOCK));
  /* This refusal is the whole mechanism behind forecast_status "prospective". If it
     can be bypassed then captured_at < kickoff_at is an audit rather than a fact. */
}

/* ========================= 3. privacy before lock ======================== */
console.log("\nprivacy — nobody but the owner reads an entry before kickoff");
{
  const mine = await call("/forecast/entries?sport=nfl&season=2026&week=1", { method: "GET", session: JEFF });
  ok("my own week reads back", mine.status === 200 && Array.isArray(mine.j.entries), mine.text);
  ok("it returns only my entries", mine.j.entries.every(e => e.user === "Jeff"),
    JSON.stringify(mine.j.entries.map(e => e.user)));
  /* Assert on the BODY, not the count. Sam has a live entry on this same game in this
     same week, so a route that returned the whole week node would pass a length check
     against a single-user fixture and fail this one. */
  ok("no other user appears anywhere in the response body", !/\bSam\b/.test(mine.text), mine.text.slice(0, 300));
}
{
  const r = await call(`/forecast/game?sport=nfl&game_id=${G_OPEN}`, { method: "GET", session: JEFF });
  ok("the per-game route refuses 409 before kickoff", r.status === 409, r.text);
  ok("...and leaks no name in the refusal", !/\bSam\b/.test(r.text), r.text);
  ok("...and leaks no probability in the refusal", !/0\.\d/.test(r.text), r.text);
}
{
  /* Sam's forecast on the open game is live and Jeff must not be able to reach it by any
     route this Worker exposes. */
  const sam = entryOf("nfl", 2026, 1, "Sam", G_OPEN);
  ok("the other user's entry does exist to be leaked", !!sam && close(sam.home_win_probability, 0.55));
}

/* ======================= 4. no running total, anywhere =================== */
console.log("\nno running total is stored");
{
  const banned = /total|standing|leaderboard|points|score|rank|cumulative/i;
  const found = [];
  (function walk(node, path) {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (banned.test(k)) found.push(path + "/" + k);
      walk(v, path + "/" + k);
    }
  })(dbGet("/forecast"), "/forecast");
  ok("the forecast tree contains no total, standing, score or rank node",
    found.length === 0, found.join(", "));
  /* Totals are a VIEW. Every slice — weekly, by sport, humans vs models, coverage — is a
     query over the entry table, and a stored total is the copy that goes stale. */
}

/* ===================== 5. touched, stored separately ===================== */
console.log("\ntouched is stored separately from the value");
{
  await call("/forecast/entry", {
    session: SAM, body: { sport: "nfl", game_id: G_OPEN, slider_value: 50, slider_side: "home", touched: false },
  });
  const stored = entryOf("nfl", 2026, 1, "Sam", G_OPEN);
  ok("an untouched entry is stored rather than discarded", !!stored);
  ok("touched is its own field and is false here", stored && stored.touched === false, stored && stored.touched);
  ok("its value is still 50, which is why the flag has to exist",
    stored && stored.slider_value === 50 && close(stored.home_win_probability, 0.5));
}
{
  await call("/forecast/entry", {
    session: SAM, body: { sport: "nfl", game_id: G_OPEN, slider_value: 50, slider_side: "home", touched: true },
  });
  const stored = entryOf("nfl", 2026, 1, "Sam", G_OPEN);
  ok("a DELIBERATE 50 is stored with touched true", stored && stored.touched === true && stored.slider_value === 50);
  /* The pair above is the whole argument: identical value, opposite meaning. Anything
     that derives touched from the value cannot tell them apart. */
}

/* ========================= 6. sport is scoped ============================ */
console.log("\nsport scoping");
{
  const r = await call("/forecast/entry", {
    session: JEFF, body: { sport: "cfb", game_id: G_CFB, slider_value: 80, slider_side: "home", touched: true },
  });
  ok("a CFB forecast is accepted", r.status === 200, r.text);
  ok("it lands in the cfb subtree", !!entryOf("cfb", 2026, 1, "Jeff", G_CFB));
  ok("the nfl week node does not contain the cfb game",
    !entryOf("nfl", 2026, 1, "Jeff", G_CFB));
  const roots = Object.keys(dbGet("/forecast/entries") || {});
  ok("no node has children spanning both sports", roots.includes("nfl") && roots.includes("cfb"),
    roots.join(","));
  /* CFB scores inflate against NFL — most games are lopsided, so easy games are nearly
     free points — and the two boards can never be summed. Path scoping means nobody has
     to remember that. */
}

/* ===================== 7. the sealed crowd consensus ===================== */
console.log("\nthe sealed crowd consensus");

/* Entries on a game that has already kicked off cannot be written through the route —
   that is the point of the lock — so they are seeded directly, which is also how the
   exact probabilities below get chosen. */
const seed = (user, gameId, p, touched, submittedAt) => dbSet(
  `/forecast/entries/nfl/2026/1/${encodeURIComponent(user)}/${encodeURIComponent(gameId)}`,
  { v: 1, sport: "nfl", season: 2026, week: 1, game_id: gameId, user,
    home_team: "LAR", away_team: "SF", kickoff_at: new Date(LOCK_KICK).toISOString(),
    home_win_probability: p, slider_value: Math.round(p * 100), slider_side: "home",
    touched, submitted_at: submittedAt, revision: 1, source: "web" });

const LATEST = LOCK_KICK - 60e3;
{
  seed("Kap", G_LOCK, 0.05, true, LOCK_KICK - 9e5);
  seed("Jeff", G_LOCK, 0.60, true, LOCK_KICK - 6e5);
  seed("Sam", G_LOCK, 0.90, true, LATEST);
  seed("Dana", G_LOCK, 0.97, true, LOCK_KICK - 3e5);
  seed("Nia", G_LOCK, 0.99, true, LOCK_KICK - 12e5);
  /* ⚠️ Bea DELIBERATELY set 50, and Rue never moved the slider off it. Identical value,
     opposite meaning. Without Bea in this fixture, deriving touched from the value would
     change nothing here and the exclusion assertions below would pass vacuously — which
     is the whole trap this fixture exists to avoid. */
  seed("Bea", G_LOCK, 0.50, true, LOCK_KICK - 4e5);
  seed("Rue", G_LOCK, 0.50, false, LOCK_KICK - 2e5);

  const denied = await call("/forecast/seal", { session: JEFF, body: { sport: "nfl", season: 2026, week: 1 } });
  ok("sealing is admin only", denied.status === 403, denied.text);

  const r = await call("/forecast/seal", { session: KAP, body: { sport: "nfl", season: 2026, week: 1 } });
  ok("the admin seal succeeds", r.status === 200, r.text);
  const row = dbGet(`/forecast/sealed/nfl/2026/1/${encodeURIComponent(G_LOCK)}`);
  ok("a sealed row exists for the kicked-off game", !!row);
  ok("no row was sealed for the game that has not kicked off",
    !dbGet(`/forecast/sealed/nfl/2026/1/${encodeURIComponent(G_OPEN)}`));

  /* THE LOG-ODDS ASSERTION. Six touched entries, trim one from each end, keep
     0.50 / 0.60 / 0.90 / 0.97. The mean of their logits back-transforms to 0.820494; the
     LINEAR mean of the same four is 0.742500. Nearly eight percentage points apart, so
     this assertion cannot survive a probability average. */
  ok("the consensus is the trimmed mean of LOG-ODDS, not of probabilities",
    row && close(row.home_win_probability, 0.820494, 5e-6), row && row.home_win_probability);
  ok("...and is nowhere near the linear mean of the same kept values",
    row && Math.abs(row.home_win_probability - 0.742500) > 0.05, row && row.home_win_probability);
  ok("it trims one from each end once n >= 5",
    row && row.n_touched === 6 && row.n_trimmed === 2 && row.n_used === 4,
    row && `${row.n_touched}/${row.n_trimmed}/${row.n_used}`);

  /* THE UNTOUCHED-EXCLUSION ASSERTION. Rue's untouched 50 is in the same node. Had it
     counted, n would be 6 and the number would move visibly. */
  ok("the untouched entry is excluded from the crowd", row && row.n_touched === 6, row && row.n_touched);
  ok("...and its owner is not listed as a contributor",
    row && !row.contributors.includes("Rue"), row && row.contributors.join(","));
  /* And the mirror of it: the DELIBERATE 50 must still be in there. Excluding both is how
     a derived flag would fail, and only this pair can tell the two apart. */
  ok("the deliberate 50 IS counted as a contributor",
    row && row.contributors.includes("Bea"), row && row.contributors.join(","));

  /* THE PROSPECTIVE ASSERTION. captured_at and sealed_at are different facts. */
  ok("captured_at is the LATEST contributing submitted_at, not the seal time",
    row && row.captured_at === new Date(LATEST).toISOString(), row && row.captured_at);
  ok("captured_at strictly precedes kickoff", row && Date.parse(row.captured_at) < LOCK_KICK);
  ok("sealed_at is at or after kickoff", row && Date.parse(row.sealed_at) >= LOCK_KICK, row && row.sealed_at);
  ok("the two are not the same value", row && row.captured_at !== row.sealed_at);
  ok("the row declares itself prospective", row && row.forecast_status === "prospective");
  ok("the row declares it was not extremized", row && row.extremized === false);
  ok("the row names its aggregation and clamp",
    row && row.aggregation === "trimmed-mean-logit" && row.clamp[0] === 0.01 && row.clamp[1] === 0.99);
  ok("the model id is sport-scoped", row && row.model_id === "dd-crowd-nfl", row && row.model_id);

  /* Recomputable by anyone once entries are readable. */
  const canonical = ["Bea", "Dana", "Jeff", "Kap", "Nia", "Sam"].map(u => {
    const e = entryOf("nfl", 2026, 1, u, G_LOCK);
    return JSON.stringify({ game_id: e.game_id, home_win_probability: e.home_win_probability,
      submitted_at: e.submitted_at, touched: e.touched, user: e.user });
  }).join("\n");
  const want = [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(canonical)))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
  ok("contributors_sha256 recomputes from the entries", row && row.contributors_sha256 === want,
    row && row.contributors_sha256);
}
{
  /* Immutability. Rewrite the inputs and seal again; a ledger that can be corrected in
     place is not a ledger. */
  const before = JSON.stringify(dbGet(`/forecast/sealed/nfl/2026/1/${encodeURIComponent(G_LOCK)}`));
  seed("Kap", G_LOCK, 0.50, true, LOCK_KICK - 9e5);
  seed("Jeff", G_LOCK, 0.50, true, LOCK_KICK - 6e5);
  const r = await call("/forecast/seal", { session: KAP, body: { sport: "nfl", season: 2026, week: 1 } });
  const after = JSON.stringify(dbGet(`/forecast/sealed/nfl/2026/1/${encodeURIComponent(G_LOCK)}`));
  ok("a second seal does not overwrite an existing row", before === after, r.text);
  ok("...and says so rather than silently doing nothing",
    r.j && r.j.skipped.some(s => s.game_id === G_LOCK && /already sealed/.test(s.why)),
    JSON.stringify(r.j && r.j.skipped));
}
{
  /* Below the minimum-touch threshold no row is written at all. */
  const G2 = G_LOCK;
  dbSet("/forecast/sealed/nfl/2026/1", null);
  dbSet("/forecast/entries/nfl/2026/1", null);
  seed("Kap", G2, 0.70, true, LOCK_KICK - 9e5);
  seed("Jeff", G2, 0.80, true, LOCK_KICK - 6e5);
  seed("Sam", G2, 0.50, false, LOCK_KICK - 3e5);
  const r = await call("/forecast/seal", { session: KAP, body: { sport: "nfl", season: 2026, week: 1 } });
  ok("two touched entries produce NO row rather than a thin one",
    !dbGet(`/forecast/sealed/nfl/2026/1/${encodeURIComponent(G2)}`), r.text);
  ok("...and the reason is reported", r.j && r.j.skipped.some(s => /fewer than 3/.test(s.why)),
    JSON.stringify(r.j && r.j.skipped));
}
{
  /* An entry that somehow postdates kickoff must never be laundered into a prospective
     row by the aggregator. */
  dbSet("/forecast/sealed/nfl/2026/1", null);
  dbSet("/forecast/entries/nfl/2026/1", null);
  seed("Kap", G_LOCK, 0.70, true, LOCK_KICK - 9e5);
  seed("Jeff", G_LOCK, 0.80, true, LOCK_KICK - 6e5);
  seed("Sam", G_LOCK, 0.60, true, LOCK_KICK + 60e3);
  const r = await call("/forecast/seal", { session: KAP, body: { sport: "nfl", season: 2026, week: 1 } });
  ok("a contributor that postdates kickoff blocks the seal",
    !dbGet(`/forecast/sealed/nfl/2026/1/${encodeURIComponent(G_LOCK)}`), r.text);
  ok("...and the reason names it", r.j && r.j.skipped.some(s => /not prospective/.test(s.why)),
    JSON.stringify(r.j && r.j.skipped));
}
{
  /* The clamp. Sliders reach 0 and 100 — the -75 floor is exactly p=0 on a winner — so an
     unclamped logit is infinite and one certain entry swallows the mean. */
  dbSet("/forecast/sealed/nfl/2026/1", null);
  dbSet("/forecast/entries/nfl/2026/1", null);
  seed("Kap", G_LOCK, 1, true, LOCK_KICK - 9e5);
  seed("Jeff", G_LOCK, 1, true, LOCK_KICK - 6e5);
  seed("Sam", G_LOCK, 0, true, LOCK_KICK - 3e5);
  await call("/forecast/seal", { session: KAP, body: { sport: "nfl", season: 2026, week: 1 } });
  const row = dbGet(`/forecast/sealed/nfl/2026/1/${encodeURIComponent(G_LOCK)}`);
  ok("a certainty of 1.0 is clamped to 0.99 rather than passed through",
    row && close(row.home_win_probability, 0.99, 1e-6), row && row.home_win_probability);
  ok("the result is finite", row && Number.isFinite(row.home_win_probability));
}

/* ================== 8. reading a game AFTER it locks ==================== */
console.log("\nafter the lock, the game becomes auditable");
{
  const r = await call(`/forecast/game?sport=nfl&game_id=${G_LOCK}`, { method: "GET", session: JEFF });
  ok("the per-game route opens once the game has kicked off", r.status === 200, r.text);
  ok("it returns every entry for that game", r.j && r.j.entries.length === 3, r.j && r.j.entries.length);
  ok("including other people's, which is what makes the consensus checkable",
    r.j && r.j.entries.some(e => e.user === "Kap") && r.j.entries.some(e => e.user === "Sam"));
  ok("and it carries the sealed row beside them", r.j && !!r.j.sealed);
}
{
  const r = await call(`/forecast/game?sport=nfl&game_id=${G_OPEN}`, { method: "GET", session: JEFF });
  ok("the still-open game is still refused", r.status === 409, r.text);
}

/* ========================= 9. the schedule source ======================== */
console.log("\nthe schedule is the source of kickoff, and it is cached");
{
  const before = scheduleHits;
  await call("/forecast/entry", {
    session: JEFF, body: { sport: "nfl", game_id: G_OPEN, slider_value: 51, slider_side: "home", touched: true },
  });
  ok("a repeat write does not refetch the schedule every time", scheduleHits === before,
    `${before} -> ${scheduleHits}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
