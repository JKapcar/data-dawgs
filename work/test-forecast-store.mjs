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
/* A week whose games have ALL kicked off. Week 1 deliberately mixes an open game with a
   locked one — that mixture is what the grader's read must refuse — so proving the
   readable case needs a week with nothing still pending in it. */
const G_DONE = "2026_03_DEN_KC";

const scheduleEnvelope = (season, games) => ({
  as_of: "2026-08-10", source: "faked for test-forecast-store.mjs",
  data: { season, games },
});
const NFL_SCHEDULE = scheduleEnvelope(2026, [
  { game_id: G_OPEN, season: 2026, week: 1, kickoff_at: new Date(OPEN_KICK).toISOString(),
    home_team: "SEA", away_team: "NE" },
  { game_id: G_LOCK, season: 2026, week: 1, kickoff_at: new Date(LOCK_KICK).toISOString(),
    home_team: "LAR", away_team: "SF" },
  { game_id: G_DONE, season: 2026, week: 3, kickoff_at: new Date(LOCK_KICK).toISOString(),
    home_team: "KC", away_team: "DEN" },
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
const call = async (path, { method = "POST", body, session, bot } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (session) headers["X-Dawg-Session"] = session;
  if (bot) headers["X-DD-Bot"] = bot;
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
    session: JEFF, body: { sport: "nfl", game_id: G_OPEN, slider_value: 62, slider_side: "home", touched: true,
                            p_naive: 55, entry_method: "drive", hints_revealed: true },
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
  ok("optional Drive metadata is retained without changing the forecast", stored && stored.p_naive === 55 && stored.entry_method === "drive" && stored.hints_revealed === true, stored && JSON.stringify(stored));
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
            submitted_at: forged, ts: forged, revision: 99, entrant: "Kap", user: "Kap",
            entrant_kind: "agent", owner: "Kap", source: "forged" },
  });
  const stored = entryOf("nfl", 2026, 1, "Sam", G_OPEN);
  ok("a client-supplied submitted_at is ignored", stored && stored.submitted_at !== forged);
  ok("a client-supplied revision is ignored", stored && stored.revision === 1);
  ok("a client cannot write the entry under another entrant's name",
    stored && stored.entrant === "Sam" && !entryOf("nfl", 2026, 1, "Kap", G_OPEN));
  ok("a client-supplied source is ignored", stored && stored.source === "web");
  // ⚠️ entrant_kind decides whether a row is in the crowd line. A body that could set it
  // would let anyone remove themselves from the consensus, or add their bot to it.
  ok("a client-supplied entrant_kind is ignored", stored && stored.entrant_kind === "human");
  ok("owner is the authenticated human, not the body", stored && stored.owner === "Sam");
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
  ok("it returns only my entries", mine.j.entries.every(e => e.entrant === "Jeff"),
    JSON.stringify(mine.j.entries.map(e => e.entrant)));
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
const seed = (entrant, gameId, p, touched, submittedAt, kind = "human") => dbSet(
  `/forecast/entries/nfl/2026/1/${encodeURIComponent(entrant)}/${encodeURIComponent(gameId)}`,
  { v: 2, sport: "nfl", season: 2026, week: 1, game_id: gameId,
    entrant, entrant_kind: kind, owner: kind === "agent" ? "Kap" : entrant,
    home_team: "LAR", away_team: "SF", kickoff_at: new Date(LOCK_KICK).toISOString(),
    home_win_probability: p, slider_value: Math.round(p * 100), slider_side: "home",
    touched, submitted_at: submittedAt, revision: 1, source: kind === "agent" ? "api" : "web",
    idempotency_key: null });

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
      submitted_at: e.submitted_at, touched: e.touched, entrant: e.entrant });
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
    r.j && r.j.entries.some(e => e.entrant === "Kap") && r.j.entries.some(e => e.entrant === "Sam"));
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

/* ================= 10. FC-C — the entrant model =========================== */
console.log("\nbot entrants: registration");
/* Kap confirms an address; Jeff deliberately does not. Bot registration is the one thing
   gated on a confirmed email, and the suite has to hold both sides of that. */
dbSet("/users/Kap/emailVerified", true);
let BOT_TOKEN = null;
{
  const noEmail = await call("/forecast/bot", {
    session: JEFF, body: { action: "register", bot_name: "JeffBot" },
  });
  ok("registering without a confirmed email is refused", noEmail.status === 403, noEmail.text);
  ok("…and no bot record is written", !dbGet("/forecast/bots/JeffBot"));

  const r = await call("/forecast/bot", {
    session: KAP, body: { action: "register", bot_name: "EloDawg", agent_note: "538-classic port" },
  });
  ok("a confirmed owner may register a bot", r.status === 200, r.text);
  BOT_TOKEN = r.j && r.j.token;
  ok("the token is returned exactly once, in the mint response", typeof BOT_TOKEN === "string" && BOT_TOKEN.startsWith("b_"));
  const rec = dbGet("/forecast/bots/EloDawg");
  ok("the record lands at /forecast/bots/<botname>", !!rec);
  ok("it stores the owner", rec && rec.owner === "Kap");
  /* ⚠️ Only the hash is stored — the same discipline invite and MCP tokens already get. */
  ok("the raw token is NOT stored anywhere", JSON.stringify(db).indexOf(BOT_TOKEN) === -1);
  ok("a hash is stored instead", rec && typeof rec.token_hash === "string" && rec.token_hash !== BOT_TOKEN);
  ok("it starts unrevoked", rec && rec.revoked === false);
}
{
  /* ⚠️ ONE NAMESPACE. A bot may not take a name a person already has, or the leaderboard
     has two rows that render identically and a receipt cannot say whose it is. */
  /* ⚠️ These assert on WHY the registration was refused, not merely that it was. Both the
     namespace check and the per-owner cap answer 409, so a status-only assertion passes
     when the namespace check is deleted and the cap happens to reject the same call — which
     is exactly what the mutation harness caught it doing. */
  const isClash = r => r.status === 409 && /one namespace/.test((r.j && r.j.error) || "");
  const clash = await call("/forecast/bot", {
    session: KAP, body: { action: "register", bot_name: "Jeff" },
  });
  ok("a bot may not take an existing account name", isClash(clash), clash.text);
  const caseClash = await call("/forecast/bot", {
    session: KAP, body: { action: "register", bot_name: "jeff" },
  });
  ok("…case-insensitively", isClash(caseClash), caseClash.text);
  const dup = await call("/forecast/bot", {
    session: KAP, body: { action: "register", bot_name: "EloDawg" },
  });
  ok("a bot may not take another bot's name", isClash(dup), dup.text);
  const junk = await call("/forecast/bot", {
    session: KAP, body: { action: "register", bot_name: "a" },
  });
  ok("a too-short bot name is refused", junk.status === 400, junk.text);
}
{
  const list = await call("/forecast/bots", { method: "GET", session: KAP });
  ok("an owner can list their bots", list.status === 200 && list.j.bots.length === 1, list.text);
  ok("the listing never carries the token or its hash",
    !/token_hash/.test(list.text) && (!BOT_TOKEN || list.text.indexOf(BOT_TOKEN) === -1), list.text);
  const other = await call("/forecast/bots", { method: "GET", session: JEFF });
  ok("and it shows nobody else's", other.status === 200 && other.j.bots.length === 0, other.text);
}

console.log("\nbot entrants: writing a forecast");
{
  /* ⚠️ THE WHOLE POINT OF FC-C, set up explicitly rather than assumed: the OWNER puts a
     real forecast on the very same game FIRST, so the bot's write below has something it
     could plausibly clobber. Under the v1 shape it would have — same account name, same
     path, last write wins, and the human's slider silently gone. */
  const own = await call("/forecast/entry", {
    session: KAP,
    body: { sport: "nfl", game_id: G_OPEN, slider_value: 33, slider_side: "home", touched: true },
  });
  ok("the owner puts their own forecast on the same game", own.status === 200, own.text);
  const before = JSON.stringify(entryOf("nfl", 2026, 1, "Kap", G_OPEN));

  const r = await call("/forecast/entry", {
    bot: BOT_TOKEN,
    body: { sport: "nfl", game_id: G_OPEN, slider_value: 71, slider_side: "home", touched: true },
  });
  ok("a bot token writes an entry", r.status === 200, r.text);
  const stored = entryOf("nfl", 2026, 1, "EloDawg", G_OPEN);
  ok("it lands under the BOT's name, not its owner's", !!stored);
  ok("entrant_kind is agent", stored && stored.entrant_kind === "agent");
  ok("owner records the human answerable for it", stored && stored.owner === "Kap");
  ok("source is api, decided by the credential and not the body", stored && stored.source === "api");

  const after = JSON.stringify(entryOf("nfl", 2026, 1, "Kap", G_OPEN));
  ok("the owner's own entry on the same game is byte-for-byte untouched", before === after,
    `${before}\n  vs\n  ${after}`);
  ok("…and still holds the human's number, not the bot's",
    entryOf("nfl", 2026, 1, "Kap", G_OPEN).slider_value === 33);
  ok("so a human and their bot hold two distinct entries for one game",
    stored.entrant === "EloDawg" && stored.owner === "Kap" && stored.entrant !== stored.owner);
  ok("the record is v2", stored && stored.v === 2, stored && stored.v);
}
{
  const anon = await call("/forecast/entry", {
    body: { sport: "nfl", game_id: G_OPEN, slider_value: 50, slider_side: "home", touched: false },
  });
  ok("no credential at all is still 401", anon.status === 401, anon.text);
  const bogus = await call("/forecast/entry", {
    bot: "b_not_a_real_token",
    body: { sport: "nfl", game_id: G_OPEN, slider_value: 50, slider_side: "home", touched: false },
  });
  ok("an unknown bot token is 401", bogus.status === 401, bogus.text);
}
{
  /* ⚠️ A BOT TOKEN IS SCOPED TO ONE ROUTE. These must not authenticate anything. */
  const mine = await call("/forecast/entries?sport=nfl&season=2026&week=1", { method: "GET", bot: BOT_TOKEN });
  ok("a bot token is refused on /forecast/entries", mine.status === 401, mine.text);
  const game = await call(`/forecast/game?sport=nfl&game_id=${G_LOCK}`, { method: "GET", bot: BOT_TOKEN });
  ok("a bot token is refused on /forecast/game", game.status === 401, game.text);
  const bots = await call("/forecast/bots", { method: "GET", bot: BOT_TOKEN });
  ok("a bot token is refused on /forecast/bots", bots.status === 401, bots.text);
  const reg = await call("/forecast/bot", { bot: BOT_TOKEN, body: { action: "register", bot_name: "Sneaky" } });
  ok("a bot token cannot register another bot", reg.status === 401, reg.text);
  ok("…and no such bot exists", !dbGet("/forecast/bots/Sneaky"));
}

console.log("\nidempotency");
{
  const body = { sport: "nfl", game_id: G_OPEN, slider_value: 44, slider_side: "home",
                 touched: true, idempotency_key: "run-2026-08-11T15:00" };
  const first = await call("/forecast/entry", { bot: BOT_TOKEN, body });
  const revAfterFirst = entryOf("nfl", 2026, 1, "EloDawg", G_OPEN).revision;
  const tsAfterFirst = entryOf("nfl", 2026, 1, "EloDawg", G_OPEN).submitted_at;
  ok("a keyed submission is accepted", first.status === 200, first.text);
  /* ⚠️ Real elapsed time before the repeat, deliberately. Both calls otherwise land in the
     same millisecond, so submitted_at would be identical even if the idempotency
     short-circuit were deleted — the assertion below would pass for a reason that has
     nothing to do with the behaviour it names. The mutation harness caught this. */
  await new Promise(r => setTimeout(r, 5));
  const again = await call("/forecast/entry", { bot: BOT_TOKEN, body });
  const after = entryOf("nfl", 2026, 1, "EloDawg", G_OPEN);
  ok("a repeat with the SAME key is accepted", again.status === 200, again.text);
  ok("…and is reported as idempotent", again.j && again.j.idempotent === true, again.text);
  /* ⚠️ A retry after a timeout the agent never saw the answer to must not be recorded as
     a change of mind. Revision is the audit trail; moving it would be a lie. */
  ok("…and does NOT bump the revision", after.revision === revAfterFirst, `${revAfterFirst} -> ${after.revision}`);
  ok("…and does NOT move submitted_at", after.submitted_at === tsAfterFirst);
  const changed = await call("/forecast/entry", {
    bot: BOT_TOKEN, body: { ...body, slider_value: 45, idempotency_key: "run-2026-08-11T16:00" },
  });
  const afterNew = entryOf("nfl", 2026, 1, "EloDawg", G_OPEN);
  ok("a DIFFERENT key is a real revision", changed.status === 200 && afterNew.revision === revAfterFirst + 1,
    `${revAfterFirst} -> ${afterNew.revision}`);
  ok("…and the value actually changed", afterNew.slider_value === 45);
}

console.log("\nrotate and revoke");
{
  const rot = await call("/forecast/bot", { session: KAP, body: { action: "rotate", bot_name: "EloDawg" } });
  ok("an owner can rotate a bot token", rot.status === 200 && typeof rot.j.token === "string", rot.text);
  const NEW = rot.j.token;
  ok("the rotated token differs from the original", NEW !== BOT_TOKEN);
  const oldTok = await call("/forecast/entry", {
    bot: BOT_TOKEN, body: { sport: "nfl", game_id: G_OPEN, slider_value: 60, slider_side: "home", touched: true },
  });
  ok("the OLD token stops working immediately", oldTok.status === 401, oldTok.text);
  const newTok = await call("/forecast/entry", {
    bot: NEW, body: { sport: "nfl", game_id: G_OPEN, slider_value: 60, slider_side: "home", touched: true },
  });
  ok("the new token works", newTok.status === 200, newTok.text);

  const notMine = await call("/forecast/bot", { session: JEFF, body: { action: "revoke", bot_name: "EloDawg" } });
  ok("somebody else cannot revoke your bot", notMine.status === 404, notMine.text);
  ok("…and the same answer is given for a bot that does not exist, so the route is not a probe",
    (await call("/forecast/bot", { session: JEFF, body: { action: "revoke", bot_name: "NoSuchBot" } })).status === 404);

  const rev = await call("/forecast/bot", { session: KAP, body: { action: "revoke", bot_name: "EloDawg" } });
  ok("an owner can revoke their bot", rev.status === 200, rev.text);
  const dead = await call("/forecast/entry", {
    bot: NEW, body: { sport: "nfl", game_id: G_OPEN, slider_value: 60, slider_side: "home", touched: true },
  });
  ok("a revoked token is refused 403", dead.status === 403, dead.text);
  /* ⚠️ The record survives revocation so the NAME stays reserved. Freeing it would let
     someone else register it and inherit a leaderboard row of another person's forecasts. */
  ok("the bot record is NOT deleted by revoking", !!dbGet("/forecast/bots/EloDawg"));
  const retake = await call("/forecast/bot", { session: JEFF, body: { action: "register", bot_name: "EloDawg" } });
  ok("and the revoked name cannot be re-registered by anyone else", retake.status !== 200, retake.text);
}

console.log("\nagents are excluded from the crowd line");
{
  /* ⚠️ The crowd line exists to be an INDEPENDENT signal to grade the models against.
     Bots are model-driven, so admitting them would make it an average of the very models
     it is meant to check. This is the touched rule one level up. */
  resetDb();
  dbSet("/forecast/entries/nfl/2026/1", null);
  seed("Kap", G_LOCK, 0.10, true, LOCK_KICK - 9e5);
  seed("Jeff", G_LOCK, 0.20, true, LOCK_KICK - 8e5);
  seed("Sam", G_LOCK, 0.30, true, LOCK_KICK - 7e5);
  /* ⚠️ THREE agents, not one, and all at the ceiling. With three humans the aggregator
     takes the median of 3; admitting agents makes it 6 and trims one from each end, and
     the number moves a long way. One agent would only have turned a 3-median into a
     4-median — still landing between the same two human values — so the assertion below
     would have passed even with the exclusion removed. A test that cannot fail is not a
     test, and the mutation harness is what caught that. */
  seed("EloBot", G_LOCK, 0.99, true, LOCK_KICK - 6e5, "agent");
  seed("MarketBot", G_LOCK, 0.98, true, LOCK_KICK - 55e4, "agent");
  seed("NfeloBot", G_LOCK, 0.97, true, LOCK_KICK - 5e5, "agent");
  const r = await call("/forecast/seal", { session: KAP, body: { sport: "nfl", season: 2026, week: 1 } });
  const row = dbGet(`/forecast/sealed/nfl/2026/1/${encodeURIComponent(G_LOCK)}`);
  ok("the week seals", r.status === 200, r.text);
  ok("only the three humans are counted", row && row.n_touched === 3, row && row.n_touched);
  ok("no agent is in the contributor list",
    row && !row.contributors.some(c => /Bot$/.test(c)), row && JSON.stringify(row.contributors));
  /* The humans alone median to 0.20. Admitting the three agents would trim to the middle
     four of [.10 .20 .30 .97 .98 .99] and land far above 0.5. */
  ok("and the agents' numbers did not move the consensus",
    row && close(row.home_win_probability, 0.2), row && row.home_win_probability);
}

/* ============ 11. FC-F — the grader's read of a finished week ============= */
console.log("\nthe admin week read, for grading");
{
  /* The fixture week holds G_LOCK (kicked off) and G_OPEN (still open), so the week as a
     whole is NOT finished — which is exactly the state the route must refuse. */
  const early = await call(`/forecast/week?sport=nfl&season=2026&week=1`, { method: "GET", session: KAP });
  ok("a week with an unkicked game is refused 409", early.status === 409, early.text);
  /* ⚠️ ASSERT ON THE BODY, NOT THE STATUS. The whole point of the refusal is that no
     entry crosses the wire; a route that returned 409 with the week attached would pass
     a status check and still have leaked every pre-lock forecast in it. */
  ok("…and no entry is in the refusal body", !/home_win_probability/.test(early.text), early.text.slice(0, 200));
  ok("…and it names which games it is waiting on",
    early.j && Array.isArray(early.j.pending) && early.j.pending.includes(G_OPEN), early.text);

  const anon = await call(`/forecast/week?sport=nfl&season=2026&week=1`, { method: "GET" });
  ok("it is refused without a session at all", anon.status === 401 || anon.status === 403, String(anon.status));
  const notAdmin = await call(`/forecast/week?sport=nfl&season=2026&week=1`, { method: "GET", session: JEFF });
  ok("…and to a signed-in non-admin", notAdmin.status === 403, notAdmin.text);
  const bot = await call(`/forecast/week?sport=nfl&season=2026&week=1`, { method: "GET", bot: BOT_TOKEN });
  ok("…and a bot token buys nothing here either", bot.status === 401 || bot.status === 403, String(bot.status));
}
{
  /* A week whose games have ALL kicked off is readable, which is what makes grading
     possible without ever touching a live forecast. Seeded directly, because the route
     that writes entries refuses a game that has already started — which is the point. */
  const seedDone = (entrant, p) => dbSet(
    `/forecast/entries/nfl/2026/3/${encodeURIComponent(entrant)}/${encodeURIComponent(G_DONE)}`,
    { v: 2, sport: "nfl", season: 2026, week: 3, game_id: G_DONE,
      entrant, entrant_kind: "human", owner: entrant,
      home_team: "KC", away_team: "DEN", kickoff_at: new Date(LOCK_KICK).toISOString(),
      home_win_probability: p, slider_value: Math.round(p * 100), slider_side: "home",
      touched: true, submitted_at: LOCK_KICK - 6e5, revision: 1, source: "web",
      idempotency_key: null });
  seedDone("Kap", 0.71);
  seedDone("Jeff", 0.44);

  const r = await call(`/forecast/week?sport=nfl&season=2026&week=3`, { method: "GET", session: KAP });
  ok("a fully kicked-off week reads back for the grader", r.status === 200, r.text);
  ok("…and carries entries from every entrant, not just the caller",
    r.j && r.j.entries.length >= 2 &&
    new Set(r.j.entries.map(e => e.entrant)).size >= 2,
    r.j && JSON.stringify(r.j.entries.map(e => e.entrant)));
  ok("…each carrying the number the grader scores",
    r.j && r.j.entries.every(e => typeof e.home_win_probability === "number"));
  ok("…and the sealed crowd row beside them", r.j && Array.isArray(r.j.sealed));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
