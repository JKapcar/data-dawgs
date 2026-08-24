/* The Dog Track, Stage A — the capture half, and mostly the refusals.
 *
 * Run: node work/test-rankings-snapshot.mjs
 *
 * ⚠️ WHAT THIS IS ACTUALLY GUARDING.
 * Two properties make a Thursday snapshot worth anything, and both are REFUSALS — the
 * failure mode of a refusal is that it quietly stops refusing and still looks like a
 * working feature:
 *   · it could not have been written after kickoff (server clock, not the client's);
 *   · it could not have been rewritten afterwards (immutable; a correction is a logged
 *     void plus a new paste, and the original never leaves the ledger).
 * A third property is legal rather than statistical: paid third-party ranks must not come
 * back out of any response, INCLUDING a validation error. Several assertions below do
 * nothing but scan response bodies for fixture player names.
 *
 * ⚠️ EVERY PLAYER NAME IN THIS FILE IS INVENTED (engagement rule 2 — no third-party ranks
 * in the repo, fixtures included). They are deliberately absurd so that a real name
 * arriving here later is obvious in review.
 *
 * The block is plain injected source, not a module, so it is evaluated in a vm context
 * with the Worker helpers it expects (json, fbGet/fbPut/fbPost, sha256hex, fetch,
 * FETCH_SHAPES) stubbed around an in-memory RTDB that models ETags — otherwise the
 * compare-and-swap paths would be tested against something that cannot fail a CAS.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createContext, runInContext } from "vm";
import { webcrypto } from "crypto";

const WORK = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(WORK, "rankings-block.js"), "utf8");

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};

/* ---------------------------------------------------------------- in-memory RTDB ---- */
function makeDb() {
  const tree = {};
  const etags = new Map();
  let etagSeq = 0;

  const parts = p => String(p).split("/").filter(Boolean);
  const read = p => {
    let n = tree;
    for (const k of parts(p)) { if (n == null || typeof n !== "object") return null; n = n[k]; }
    return n === undefined ? null : n;
  };
  const write = (p, v) => {
    const ks = parts(p);
    let n = tree;
    for (const k of ks.slice(0, -1)) { if (typeof n[k] !== "object" || n[k] === null) n[k] = {}; n = n[k]; }
    n[ks[ks.length - 1]] = v;
  };
  const etagOf = p => etags.get(p) || 'W/"null"';

  return {
    tree,
    calls: { get: 0, put: 0, post: 0 },
    async fbGet(env, path, withEtag) {
      this.calls.get++;
      const data = read(path);
      return { data: data === null ? null : structuredClone(data), etag: withEtag ? etagOf(path) : null };
    },
    async fbPut(env, path, value, etag) {
      this.calls.put++;
      if (etag !== undefined && etag !== null && etag !== etagOf(path)) return false;  // 412
      write(path, structuredClone(value));
      etags.set(path, 'W/"' + (++etagSeq) + '"');
      return true;
    },
    async fbPatch() { throw new Error("fbPatch is not used by the rankings block"); },
    async fbPost(env, path, value) {
      this.calls.post++;
      const id = "-ev" + String(++etagSeq).padStart(6, "0");
      const cur = read(path) || {};
      cur[id] = structuredClone(value);
      write(path, cur);
      return id;
    },
    read,
  };
}

/* ------------------------------------------------------------------- vm harness ---- */
function makeCtx({ schedule, espn, players } = {}) {
  const db = makeDb();
  const fetchLog = [];

  async function fetchStub(url) {
    fetchLog.push(String(url));
    if (String(url).includes("api.sleeper.app/v1/players")) {
      if (players === null) return { ok: false, status: 502 };
      return { ok: true, status: 200, json: async () => (players || {}) };
    }
    if (String(url).includes("datadawgs216.com/data/nfl-schedule.json")) {
      if (!schedule) return { ok: false, status: 502 };
      return { ok: true, status: 200, json: async () => schedule };
    }
    if (String(url).includes("site.api.espn.com")) {
      if (!espn) return { ok: false, status: 403 };          // the documented Worker-egress block
      return { ok: true, status: 200, json: async () => espn };
    }
    return { ok: false, status: 404 };
  }

  const sandbox = {
    console,
    fetch: fetchStub,
    Response,
    URL,
    TextEncoder,
    crypto: webcrypto,
    FETCH_SHAPES: [{ name: "browser", headers: {} }, { name: "ua-only", headers: {} }, { name: "bare", headers: {} }],
    SLEEPER_PLAYERS_URL: "https://api.sleeper.app/v1/players/nfl",
    json: (obj, status, cors) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    }),
    sha256hex: async str => {
      const buf = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    },
    fbGet: (...a) => db.fbGet(...a),
    fbPut: (...a) => db.fbPut(...a),
    fbPatch: (...a) => db.fbPatch(...a),
    fbPost: (...a) => db.fbPost(...a),
  };
  const ctx = createContext(sandbox);
  runInContext(SRC, ctx, { filename: "rankings-block.js" });
  return { ctx, db, fetchLog };
}

const KEY = "test-admin-key-0123456789abcdef";
const ENV = { RANKINGS_ADMIN_KEY: KEY };

function req(method, path, { body, key, } = {}) {
  return {
    method,
    headers: { get: h => (String(h).toLowerCase() === "x-dd-admin" ? (key === undefined ? null : key) : null) },
    text: async () => JSON.stringify(body === undefined ? {} : body),
  };
}

async function call(ctx, method, path, opts = {}) {
  const url = new URL("https://toto.example" + path);
  const res = await ctx.handleRankings(req(method, path, opts), url, opts.env || ENV, {});
  const text = await res.text();
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) { /* non-JSON is itself a failure the caller asserts on */ }
  return { status: res.status, body: obj, text };
}

/* ------------------------------------------------------------------- fixtures ------ */
/* Invented names, deliberately silly. NAMES collects every one of them so the privacy
 * assertions can scan any response body for all of them at once. */
const NAMES = new Set();
function fixtureName(pos, i) {
  const first = ["Rusty", "Barnaby", "Quill", "Mortimer", "Cletus", "Dweezil", "Fitzwilliam", "Orbison"];
  const last = ["Kettleman", "Pinwheel", "Blunderbuss", "Fettuccine", "Wobblesworth", "Grimsby", "Twizzler", "Haddock"];
  const n = `${first[i % first.length]} ${last[(i * 3 + pos.length) % last.length]}${i}`;
  NAMES.add(n);
  return n;
}
const TEAMS = ["ATL", "BUF", "CHI", "DEN", "GB", "KC", "LAR", "MIA", "NYJ", "SEA"];

function makeRows(depths = { RB: 36, WR: 48, QB: 24, TE: 24 }) {
  const rows = [];
  for (const [pos, n] of Object.entries(depths)) {
    for (let i = 1; i <= n; i++) rows.push({ pos, rank: i, name: fixtureName(pos, i), team: TEAMS[i % TEAMS.length] });
  }
  return rows;
}
const toCsv = rows => rows.map(r => `${r.pos},${r.rank},${r.name},${r.team}`).join("\n");
const CSV = toCsv(makeRows());

const schedFor = iso => ({
  as_of: "2026-08-07", source: "test fixture",
  data: { season: 2026, games: [
    { season: 2026, week: 1, kickoff_at: iso, home_team: "SEA", away_team: "NE" },
    { season: 2026, week: 1, kickoff_at: "2099-09-13T17:00:00Z", home_team: "GB", away_team: "CHI" },
    { season: 2026, week: 2, kickoff_at: "2099-09-17T00:20:00Z", home_team: "KC", away_team: "BUF" },
  ] },
});
const FUTURE = schedFor("2099-09-10T00:20:00Z");
const PAST = schedFor("2020-09-10T00:20:00Z");

const leaks = text => [...NAMES].filter(n => text.includes(n));

async function registerEntrant(ctx, id, extra = {}) {
  return call(ctx, "POST", "/rankings/entrants", {
    key: KEY, body: { id, name: id + " Ranks", type: "service", first_week: 1, ...extra },
  });
}

/* =========================================================================== tests == */
async function main() {

  /* ---------------------------------------------------------------- admin auth ----- */
  {
    const { ctx } = makeCtx({ schedule: FUTURE });
    const noKeyEnv = {};
    ok((await call(ctx, "GET", "/rankings/entrants", { key: KEY, env: noKeyEnv })).status === 403,
      "unset RANKINGS_ADMIN_KEY fails closed");
    ok((await call(ctx, "GET", "/rankings/entrants", { key: "short", env: { RANKINGS_ADMIN_KEY: "short" } })).status === 403,
      "a too-short secret is refused rather than trusted");
    ok((await call(ctx, "GET", "/rankings/entrants", { key: "wrong-key-wrong-key-wrong-key!!" })).status === 403,
      "wrong admin key is 403");
    ok((await call(ctx, "GET", "/rankings/entrants", {})).status === 403, "missing admin header is 403");
    ok((await call(ctx, "GET", "/rankings/entrants", { key: KEY })).status === 200, "correct admin key is admitted");
  }

  /* ------------------------------------------------------------------ registry ----- */
  {
    const { ctx, db } = makeCtx({ schedule: FUTURE });
    const r = await registerEntrant(ctx, "ETR");
    ok(r.status === 200 && r.body.ok, "registry add succeeds");
    ok(db.read("/rankings/entrants/ETR").type === "service", "entrant persisted to the registry");
    ok(typeof db.read("/rankings/log") === "object" && Object.keys(db.read("/rankings/log")).length === 1,
      "registry add appends exactly one log row");

    ok((await registerEntrant(ctx, "ETR")).status === 409, "duplicate entrant id is refused");
    ok((await registerEntrant(ctx, "no lower")).status === 400, "malformed entrant id is refused");
    ok((await registerEntrant(ctx, "PFF", { type: "vendor" })).status === 400, "unknown entrant type is refused");
    ok((await registerEntrant(ctx, "PFF", { color: "orange" })).status === 400, "non-hex colour is refused");
    ok((await registerEntrant(ctx, "PFF", { first_week: 99 })).status === 400, "out-of-range first_week is refused");

    const list = await call(ctx, "GET", "/rankings/entrants", { key: KEY });
    ok(Object.keys(list.body.entrants).length === 1, "registry lists what was added");

    // trap #12 — colour comes from the id, so a later entrant cannot shift an earlier one
    const etrColor = db.read("/rankings/entrants/ETR").color;
    await registerEntrant(ctx, "PFF");
    await registerEntrant(ctx, "ESPN");
    ok(db.read("/rankings/entrants/ETR").color === etrColor,
      "registering later entrants does not shift an existing entrant's colour");
    const fresh = makeCtx({ schedule: FUTURE });
    await registerEntrant(fresh.ctx, "ESPN");
    ok(fresh.db.read("/rankings/entrants/ESPN").color === db.read("/rankings/entrants/ESPN").color,
      "entrant colour is derived from the id, not from registration order");

    const up = await call(ctx, "PATCH", "/rankings/entrants", { key: KEY, body: { id: "ETR", name: "ETR Weekly", color: "#123456" } });
    ok(up.status === 200 && db.read("/rankings/entrants/ETR").name === "ETR Weekly", "entrant name/colour update applies");
    await call(ctx, "PATCH", "/rankings/entrants", { key: KEY, body: { id: "ETR", type: "house", first_week: 7 } });
    const after = db.read("/rankings/entrants/ETR");
    ok(after.type === "service" && after.first_week === 1,
      "update cannot change type or first_week — comparability is computed from those");
    ok((await call(ctx, "PATCH", "/rankings/entrants", { key: KEY, body: { id: "NOPE" } })).status === 404,
      "updating an unknown entrant is 404");
  }

  /* ------------------------------------------------- name normalization (§8.5) ----- */
  {
    const { ctx } = makeCtx({});
    const n = ctx.rankingsNormName;
    ok(n("Kenneth Walker III") === "kenneth walker", "generational suffix stripped");
    ok(n("Marvin Harrison Jr.") === "marvin harrison", "Jr. stripped with its punctuation");
    ok(n("Amon-Ra St. Brown") === "amon ra st brown", "hyphen and period become word breaks");
    ok(n("  DeVonta   Smith  ") === "devonta smith", "whitespace collapsed and trimmed");
    ok(n("André Iguodala") === "andré iguodala",
      "an accented letter survives punctuation stripping (naive [^a-z] would give 'andr')");
    ok(n("Gabe Davis") !== n("Gabriel Davis"),
      "normalization never guesses — Gabe/Gabriel stay distinct and go to the alias map");
    ok(n("Player V") === "player", "trailing V is treated as a suffix per the spec");
  }

  /* ------------------------------------------------------------ CSV validation ----- */
  {
    const { ctx } = makeCtx({ schedule: FUTURE });
    await registerEntrant(ctx, "ETR");
    const snap = (csv, extra = {}) => call(ctx, "POST", "/rankings/snapshot",
      { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv, ...extra } });

    const shallow = await snap(toCsv(makeRows({ RB: 10, WR: 48, QB: 24, TE: 24 })));
    ok(shallow.status === 400 && shallow.body.errors.some(e => e.code === "too_shallow" && e.pos === "RB"),
      "a list shallower than the pre-registered depth is refused");

    const rows = makeRows();
    const gap = rows.filter(r => !(r.pos === "RB" && r.rank === 5));
    const g = await snap(toCsv(gap));
    ok(g.status === 400 && g.body.errors.some(e => e.code === "not_contiguous" || e.code === "too_shallow"),
      "a gap in the rank sequence is refused");

    const dup = makeRows();
    dup.find(r => r.pos === "WR" && r.rank === 7).name = dup.find(r => r.pos === "WR" && r.rank === 3).name;
    dup.find(r => r.pos === "WR" && r.rank === 7).team = dup.find(r => r.pos === "WR" && r.rank === 3).team;
    const d = await snap(toCsv(dup));
    ok(d.status === 400 && d.body.errors.some(e => e.code === "duplicate"), "the same player twice in one position is refused");

    const badPos = await snap("K,1,Somebody Kicker,ATL\n" + CSV);
    ok(badPos.status === 400 && badPos.body.errors.some(e => e.code === "pos"), "an unknown position tag is refused");

    const missing = await snap(toCsv(makeRows({ RB: 36, WR: 48, QB: 24 })));
    ok(missing.status === 400 && missing.body.errors.some(e => e.code === "missing_position" && e.pos === "TE"),
      "a paste missing a whole position is refused");

    // THE PRIVACY ASSERTION: an error tells the admin page WHERE, never WHO.
    for (const bad of [shallow, g, d, badPos, missing]) {
      ok(leaks(bad.text).length === 0, "validation error carries no player name", leaks(bad.text).join(", "));
    }
    ok(g.body.errors.every(e => e.line === undefined || typeof e.line === "number"),
      "validation errors carry line/pos/rank coordinates instead");

    // tolerated shapes
    ok((await snap("pos,rank,player,team\n" + CSV)).status === 200, "a header row is tolerated");
  }
  {
    const { ctx } = makeCtx({ schedule: FUTURE });
    await registerEntrant(ctx, "ETR");
    const crlf = CSV.replace(/\n/g, "\r\n") + "\r\n";
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: crlf } });
    ok(r.status === 200, "CRLF line endings and a trailing newline are tolerated");
  }
  {
    const { ctx, db } = makeCtx({ schedule: FUTURE });
    await registerEntrant(ctx, "ETR");
    const rows = makeRows();
    rows.find(r => r.pos === "QB" && r.rank === 2).name = "Bartholomew Fizz, Jr.";
    NAMES.add("Bartholomew Fizz, Jr.");
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: toCsv(rows) } });
    const stored = Object.values(db.read("/rankings/snapshots/2026/1/ETR"))[0];
    ok(r.status === 200 && stored.rows.some(x => x.name === "Bartholomew Fizz, Jr."),
      "a comma inside a player name is parsed as part of the name, not as a field break");
  }

  /* -------------------------------------------------------------- the snapshot ----- */
  {
    const { ctx, db } = makeCtx({ schedule: FUTURE });
    await registerEntrant(ctx, "ETR");
    const body = { season: 2026, week: 1, entrant: "ETR", csv: CSV, captured_at: "1999-01-01T00:00:00Z" };
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body });

    ok(r.status === 200 && r.body.ok === true, "a valid snapshot is accepted");
    ok(r.body.receipt.kickoff_check === "verified", "a pre-kickoff capture is marked verified");
    ok(!r.body.receipt.captured_at.startsWith("1999"), "a client-supplied captured_at is ignored");
    ok(Math.abs(Date.parse(r.body.receipt.captured_at) - Date.now()) < 60_000, "captured_at is server time");
    ok(/^[0-9a-f]{64}$/.test(r.body.receipt.sha256), "the receipt carries a sha256 of the normalized CSV");
    ok(r.body.receipt.counts.RB === 36 && r.body.receipt.counts.WR === 48, "the receipt reports per-position depths");
    ok(leaks(r.text).length === 0, "the snapshot receipt carries no player name", leaks(r.text).join(", "));

    const stored = Object.values(db.read("/rankings/snapshots/2026/1/ETR"))[0];
    ok(stored.rows.length === 132, "the rows ARE stored — privately, behind the Firebase secret");
    ok(stored.voided === false, "a fresh capture is active");

    const logRows = Object.values(db.read("/rankings/log"));
    ok(logRows.some(l => l.action === "snapshot" && l.entrant === "ETR"), "an accepted snapshot appends a log row");
    ok(leaks(JSON.stringify(logRows)).length === 0, "the audit log carries no player name");

    // idempotency — the phone lost signal and Kap pasted again
    const again = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    ok(again.status === 200 && again.body.idempotent === true, "an identical re-paste is a no-op");
    ok(again.body.receipt.captured_at === r.body.receipt.captured_at, "the no-op returns the ORIGINAL captured_at");
    ok(again.body.receipt.capture_id === r.body.receipt.capture_id, "the no-op returns the original capture id");
    ok(Object.keys(db.read("/rankings/snapshots/2026/1/ETR")).length === 1, "the no-op did not append a second capture");

    // row order must not change identity
    const shuffled = toCsv(makeRows().slice().reverse());
    const rev = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: shuffled } });
    ok(rev.body.idempotent === true, "the same list pasted in a different row order is still the same content");

    // immutability
    const changed = makeRows();
    changed.find(x => x.pos === "RB" && x.rank === 1).name = "Somebody Else Entirely";
    const c = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: toCsv(changed) } });
    ok(c.status === 409, "different content for the same entrant and week is refused");
    ok(Object.keys(db.read("/rankings/snapshots/2026/1/ETR")).length === 1, "the refusal wrote nothing");
    ok(Object.values(db.read("/rankings/log")).some(l => l.action === "snapshot_reject"), "a refusal is logged too");
  }

  /* ----------------------------------------------------------- the kickoff gate ---- */
  {
    const { ctx, db } = makeCtx({ schedule: PAST });
    await registerEntrant(ctx, "ETR");
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    ok(r.status === 409 && /late/i.test(r.body.error), "a snapshot after the first kickoff is refused, not accepted ungraded");
    ok(db.read("/rankings/snapshots/2026/1/ETR") === null, "the late refusal wrote no capture");
    ok(Object.values(db.read("/rankings/log")).some(l => l.detail && l.detail.reason === "late"), "the late refusal is logged");
  }
  {
    // trap #5 — both sources down on a Thursday must not block the capture
    const { ctx, db } = makeCtx({ schedule: null, espn: null });
    await registerEntrant(ctx, "ETR");
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    ok(r.status === 200 && r.body.receipt.kickoff_check === "deferred",
      "both kickoff sources failing accepts the capture and flags it deferred");
    ok(db.read("/rankings/kickoffs/2026/1") === null, "a failed resolution is NOT cached — a transient 502 must not poison the week");
  }
  {
    // ESPN is still the documented fallback, and is reached when the schedule is down
    const espn = { events: [{ date: "2099-09-10T00:20:00Z" }, { date: "2099-09-13T17:00:00Z" }] };
    const { ctx, db, fetchLog } = makeCtx({ schedule: null, espn });
    await registerEntrant(ctx, "ETR");
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    ok(r.status === 200 && r.body.receipt.kickoff_check === "verified", "ESPN resolves the kickoff when the site schedule is down");
    ok(db.read("/rankings/kickoffs/2026/1").source === "espn", "the resolving source is recorded");
    ok(fetchLog.some(u => u.includes("site.api.espn.com")), "the ESPN fallback was actually attempted");
  }
  {
    // the site schedule is tier 1, and the resolved answer is cached for the week
    const { ctx, db, fetchLog } = makeCtx({ schedule: FUTURE, espn: { events: [{ date: "2099-01-01T00:00:00Z" }] } });
    await registerEntrant(ctx, "ETR");
    await registerEntrant(ctx, "PFF");
    await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    ok(db.read("/rankings/kickoffs/2026/1").source === "site-schedule", "the site schedule is consulted before ESPN");
    ok(Date.parse(db.read("/rankings/kickoffs/2026/1").at) === Date.parse("2099-09-10T00:20:00Z"),
      "the FIRST kickoff of the week is the gate, not any later game");
    ok(!fetchLog.some(u => u.includes("espn")), "ESPN is not called when the schedule answers");
    const n = fetchLog.length;
    await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "PFF", csv: CSV } });
    ok(fetchLog.length === n, "the week's kickoff is cached — the second entrant's paste refetches nothing");
  }
  {
    // season 0 is the Stage E sandbox: no real kickoff to gate against
    const { ctx } = makeCtx({ schedule: PAST });
    await registerEntrant(ctx, "TEST");
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 0, week: 1, entrant: "TEST", csv: CSV } });
    ok(r.status === 200 && r.body.receipt.kickoff_check === "sandbox", "season 0 bypasses the kickoff gate for the dry run");
  }

  /* ------------------------------------------------- the Thursday OUT list (G1) ---- */
  {
    const players = {
      hurt1: { position: "RB", injury_status: "Out", full_name: "Grievous Hamstring" },
      hurt2: { position: "WR", injury_status: "IR", full_name: "Longterm Clavicle" },
      fine1: { position: "RB", injury_status: "Questionable", full_name: "Maybe Toe" },
      fine2: { position: "QB", injury_status: "", full_name: "Healthy Fellow" },
      kick1: { position: "K", injury_status: "Out", full_name: "Legless Kicker" },
    };
    const { ctx, db, fetchLog } = makeCtx({ schedule: FUTURE, players });
    await registerEntrant(ctx, "ETR");
    await registerEntrant(ctx, "PFF");
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    ok(r.status === 200, "a snapshot with a live OUT source succeeds");
    const cap = Object.values(db.read("/rankings/snapshots/2026/1/ETR"))[0];
    ok(Array.isArray(cap.out_at_capture) && cap.out_at_capture.includes("hurt1") && cap.out_at_capture.includes("hurt2"),
      "the capture carries the ids ruled Out and IR at capture time", JSON.stringify(cap.out_at_capture));
    ok(!cap.out_at_capture.includes("fine1"), "Questionable is NOT hygiene — ranking him is a judgement call");
    ok(!cap.out_at_capture.includes("kick1"), "non-graded positions stay off the list");
    const pulls = fetchLog.filter(u => u.includes("v1/players")).length;
    await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "PFF", csv: CSV } });
    ok(fetchLog.filter(u => u.includes("v1/players")).length === pulls,
      "the OUT list is resolved ONCE per week — the second paste reuses the cache");
    ok(Array.isArray(db.read("/rankings/out/2026/1").players), "the week's OUT list is cached in Firebase");
  }
  {
    // the source being down must cost the annotation, never the capture
    const { ctx, db } = makeCtx({ schedule: FUTURE, players: null });
    await registerEntrant(ctx, "ETR");
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    ok(r.status === 200, "an OUT-source failure never blocks a Thursday capture");
    const cap = Object.values(db.read("/rankings/snapshots/2026/1/ETR"))[0];
    ok(cap.out_at_capture === null, "the capture records null — an unknown OUT list is not an empty one");
    ok(db.read("/rankings/out/2026/1") === null, "a failed OUT fetch is NOT cached — the next paste retries");
  }

  /* ------------------------------------------------------------- registry gating --- */
  {
    const { ctx } = makeCtx({ schedule: FUTURE });
    const r = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "GHOST", csv: CSV } });
    ok(r.status === 404, "a snapshot for an unregistered entrant is refused");
    await registerEntrant(ctx, "LATE", { first_week: 6 });
    const e = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 2, entrant: "LATE", csv: CSV } });
    ok(e.status === 400, "a week before the entrant's first_week is refused");
  }

  /* -------------------------------------------------------------- the void flow ---- */
  {
    const { ctx, db } = makeCtx({ schedule: FUTURE });
    await registerEntrant(ctx, "ETR");
    const first = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    const id = first.body.receipt.capture_id;

    ok((await call(ctx, "POST", "/rankings/void", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", capture_id: id } })).status === 400,
      "a void without a reason is refused");
    ok((await call(ctx, "POST", "/rankings/void", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", capture_id: "nope", reason: "x" } })).status === 404,
      "voiding an unknown capture is 404");

    const v = await call(ctx, "POST", "/rankings/void", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", capture_id: id, reason: "pasted last week's list" } });
    ok(v.status === 200, "the void succeeds");
    const voided = db.read("/rankings/snapshots/2026/1/ETR")[id];
    ok(voided.voided === true && voided.void_reason === "pasted last week's list", "the capture is flagged, with its reason");
    ok(voided.rows.length === 132, "APPEND-ONLY: the voided original keeps its rows, it is not deleted");
    ok(voided.captured_at === first.body.receipt.captured_at, "the voided original keeps its original captured_at");

    ok((await call(ctx, "POST", "/rankings/void", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", capture_id: id, reason: "again" } })).status === 409,
      "voiding an already-voided capture is refused");

    const changed = makeRows();
    changed.find(x => x.pos === "RB" && x.rank === 1).name = "Replacement Fellow";
    NAMES.add("Replacement Fellow");
    const second = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: toCsv(changed) } });
    ok(second.status === 200, "after a void, a corrected paste before kickoff is accepted");
    const all = db.read("/rankings/snapshots/2026/1/ETR");
    ok(Object.keys(all).length === 2, "the ledger now holds BOTH captures — nothing was replaced");
    ok(Object.values(all).filter(c => c.voided !== true).length === 1, "exactly one capture is active");
    ok(Object.values(db.read("/rankings/log")).some(l => l.action === "void"), "the void is logged");
  }
  {
    // voiding after kickoff is allowed; the replacement is not — the week shows nothing
    const { ctx, db } = makeCtx({ schedule: FUTURE });
    await registerEntrant(ctx, "ETR");
    const first = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    const late = makeCtx({ schedule: PAST });
    /* Move the ledger — the registry and the captures — under a context whose kickoff has
     * passed. ⚠️ Deliberately NOT the whole /rankings subtree: that carries the cached
     * future kickoff with it, the gate then reads the stale cache, and this test passes
     * while proving nothing. Caught exactly that way on first run. */
    late.db.tree.rankings = { entrants: db.tree.rankings.entrants, snapshots: db.tree.rankings.snapshots };
    const v = await call(late.ctx, "POST", "/rankings/void", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", capture_id: first.body.receipt.capture_id, reason: "wrong week" } });
    ok(v.status === 200, "a capture can be voided after kickoff — noticing late is not a reason to keep a wrong row");
    const replace = await call(late.ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    ok(replace.status === 409, "but the replacement paste is still gated, so the week honestly shows no active snapshot");
  }

  /* ------------------------------------------------------------------- the strip --- */
  {
    const { ctx } = makeCtx({ schedule: FUTURE });
    await registerEntrant(ctx, "ETR");
    await registerEntrant(ctx, "PFF");
    await registerEntrant(ctx, "ESPN");
    const first = await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "ETR", csv: CSV } });
    await call(ctx, "POST", "/rankings/snapshot", { key: KEY, body: { season: 2026, week: 1, entrant: "PFF", csv: CSV } });
    await call(ctx, "POST", "/rankings/void", { key: KEY, body: { season: 2026, week: 1, entrant: "PFF", capture_id: (await call(ctx, "GET", "/rankings/status?season=2026&week=1", { key: KEY })).body.entrants.find(e => e.id === "PFF").capture_id, reason: "bad paste" } });

    const s = await call(ctx, "GET", "/rankings/status?season=2026&week=1", { key: KEY });
    const by = Object.fromEntries(s.body.entrants.map(e => [e.id, e]));
    ok(s.status === 200, "the capture strip renders for the week");
    ok(by.ETR.state === "captured" && by.ETR.capture_id === first.body.receipt.capture_id, "a captured entrant shows captured");
    ok(by.ESPN.state === "missing", "an entrant with no paste shows missing");
    ok(by.PFF.state === "voided" && by.PFF.voided_count === 1, "an entrant whose only capture was voided shows voided");
    ok(Date.parse(s.body.first_kickoff) === Date.parse("2099-09-10T00:20:00Z"), "the strip reports the week's first kickoff");
    ok(leaks(s.text).length === 0, "the capture strip carries no player name", leaks(s.text).join(", "));
    ok(!/"rows"/.test(s.text), "the capture strip carries no rows array at all");
    ok((await call(ctx, "GET", "/rankings/status?season=2026&week=1", {})).status === 403, "the capture strip is admin-only");
  }

  /* ------------------------------------------------------------------ dispatcher --- */
  {
    const { ctx } = makeCtx({ schedule: FUTURE });
    ok((await call(ctx, "GET", "/rankings/nope", { key: KEY })).status === 404, "an unknown rankings path is 404");
    ok((await call(ctx, "DELETE", "/rankings/entrants", { key: KEY })).status === 405, "an unsupported method is 405");
    ok((await call(ctx, "GET", "/rankings/snapshot", { key: KEY })).status === 404, "GET on the snapshot route is not a capture");
  }

  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
