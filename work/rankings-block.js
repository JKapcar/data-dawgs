/* The Dog Track — capture half (Stage A): entrants registry + Thursday snapshots.
 *
 * ⚠️ EDIT THIS FILE, NEVER THE ASSEMBLED WORKER. `node work/assemble.mjs` regenerates
 * the DD-RANKINGS-BLOCK region of ../dawg-bot-worker.js from this source; edits made to
 * the output are lost on the next build.
 *
 * ⚠️ WHY THIS BLOCK IS INJECTED *ABOVE* THE MCP BLOCK.
 * Both assemble.mjs and work/test-identity.mjs enforce "no Firebase write helper is ever
 * called inside the MCP block" by slicing from that block's opening marker to end of file.
 * This block legitimately calls fbPut/fbPost — it is a capture ledger — so it must live
 * before that marker or it would trip a guard written for a completely different reason.
 * assemble.mjs asserts the ordering rather than trusting it.
 *
 * ⚠️ AND THIS COMMENT MUST NOT SPELL THAT MARKER OUT. It did, once. test-identity.mjs
 * locates the block with a bare indexOf on the short marker text, so the sentence above
 * BECAME the earliest match: the guard sliced from this comment instead of from the real
 * marker, scanned this ledger, found fbPut and failed the deploy — a code comment breaking
 * a build by being quoted too accurately. Describe the marker; never reproduce it.
 *
 * WHAT THIS IS
 * Kap pastes each ranking service's positional ranks every Thursday BEFORE the first
 * kickoff of that NFL week. This block validates the paste, stamps captured_at with
 * SERVER time, refuses anything late, refuses to overwrite what was already captured,
 * and appends an audit row for every attempt — accepted or rejected.
 *
 * THE PRIVACY INVARIANT, WHICH IS THE WHOLE ARCHITECTURE (handoff §1)
 * Raw third-party ranks are paid content. They live at /rankings/snapshots/… behind the
 * Firebase secret and are readable ONLY by this Worker. Consequences, all load-bearing:
 *   · no route in this block returns a player name — not in a receipt, not in an error;
 *   · validation errors carry (line, pos, rank) coordinates so the admin page can point
 *     at the bad row in the paste box without the name making a round trip;
 *   · Stage A adds ZERO public routes. The only public read in this feature is
 *     GET /rankings/grades, which is Stage B and serves derived scores only.
 *
 * APPEND-ONLY, AND WHAT A "CORRECTION" MEANS (handoff §2, trap #10)
 * /rankings/snapshots/{season}/{week}/{entrant} is a MAP of capture_id → capture, not a
 * single record. Nothing in it is ever rewritten or deleted. At most one capture per
 * entrant/week is active (voided !== true); a bad paste is corrected by voiding the
 * original — which stays, flagged, forever — and pasting again before kickoff. After
 * kickoff the void still works but the replacement will not: that week then honestly
 * shows no active snapshot rather than a quietly-swapped one.
 */

const RANKINGS_POS = ["RB", "WR", "QB", "TE"];
const RANKINGS_DEPTHS = { RB: 36, WR: 48, QB: 24, TE: 24 };   // handoff §3, pre-registered

/* A four-position paste is legitimately bigger than any other body this Worker takes
 * (132 rows at the depth minimums, and services publish deeper), so it gets its own cap
 * rather than borrowing MAX_BODY = 24_000 and failing on a normal Thursday. */
const RANKINGS_MAX_BODY = 96_000;

/* Trap #12: a mid-season entrant must not shift anybody else's colour. Derived from a
 * hash of the entrant id, never from registry size or array index, so registering an
 * eighth service leaves the other seven exactly where they were. An explicit colour on
 * the create call always wins; this is only the default. */
const RANKINGS_PALETTE = [
  "#ff6a02", "#4aa3d6", "#e05555", "#2fbf3f",
  "#d19a30", "#9b7ede", "#3fbfb0", "#e0708f",
];

const RANKINGS_SCHEDULE_URL = "https://datadawgs216.com/data/nfl-schedule.json";

/* ---------------------------------------------------------------- name normalization --
 * THE SHARED SPEC (handoff §8.5 contract #1). These four rules are the contract between
 * this Worker and the local pipeline's normalize.py. Implement them identically in both
 * or trap #1 reappears as a cross-system divergence:
 *   1. lowercase
 *   2. strip punctuation and symbols
 *   3. strip a trailing generational suffix (jr, sr, ii, iii, iv, v), repeatedly
 *   4. collapse whitespace, trim
 * ⚠️ Punctuation is stripped by Unicode property (\p{P}\p{S}), NOT by deleting every
 * non-[a-z0-9] character. The naive version turns "André" into "andr" and "Amon-Ra" into
 * two tokens that no longer match the alias map — a silent corruption of exactly the
 * names this feature exists to line up.
 * Matching is on (normalized name + team + pos) — never on the name alone.
 */
function rankingsNormName(raw) {
  let s = String(raw == null ? "" : raw).toLowerCase();
  s = s.replace(/[\p{P}\p{S}]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  let parts = s.split(" ").filter(Boolean);
  while (parts.length > 1 && /^(jr|sr|ii|iii|iv|v)$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

/* --------------------------------------------------------------------------- admin ---
 * FAILS CLOSED. Until RANKINGS_ADMIN_KEY exists in the Cloudflare dashboard every admin
 * route here answers 403 — an unset secret must never mean an open door. The length floor
 * refuses a placeholder or a truncated paste for the same reason.
 */
const RANKINGS_KEY_MIN = 16;

function rankingsAdminOk(request, env) {
  const key = String((env && env.RANKINGS_ADMIN_KEY) || "");
  const got = String(request.headers.get("x-dd-admin") || "");
  if (key.length < RANKINGS_KEY_MIN) return false;
  if (got.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= got.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

async function rankingsReadBody(request) {
  const raw = await request.text();
  if (raw.length > RANKINGS_MAX_BODY) throw new Error("body too large");
  return JSON.parse(raw);
}

/* Every write AND every refusal appends here. Best-effort by design: losing the audit row
 * is bad, but failing a Thursday capture because the log write 500'd is worse. The caller
 * surfaces `logged:false` in the receipt so the admin strip can show that it happened
 * rather than the failure being invisible. */
async function rankingsLog(env, event) {
  try {
    await fbPost(env, "/rankings/log", { at: new Date().toISOString(), ...event });
    return true;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------------- kickoff ---
 * WHAT "BEFORE KICKOFF" IS CHECKED AGAINST, in order:
 *   1. data/nfl-schedule.json on the site — the canonical nflverse-derived schedule this
 *      repo already ships and already refuses survivor captures against.
 *   2. the ESPN scoreboard (handoff trap #5, the documented recovery path).
 *   3. nothing — accept with kickoff_check:"deferred" and re-verify at grade time.
 *
 * ⚠️ DEVIATION FROM THE HANDOFF, RAISED RATHER THAN TAKEN SILENTLY (rule 8).
 * The handoff names ESPN as the kickoff source. This Worker already documents, at the
 * /scores route, that ESPN answers 403 to Cloudflare egress and 200 to a browser on the
 * identical path — an IP/ASN block, three header shapes tested, "another permutation will
 * not fix it" (8/4/26). Taking that literally, tier 2 fails on every Thursday and every
 * capture lands in "deferred", which turns the pre-kickoff gate into a grade-time
 * post-mortem and quietly drops the property the handoff actually asks for. So the site's
 * own canonical schedule goes in front of ESPN, ESPN stays exactly where the handoff put
 * it, and deferred remains the last resort. Kap ratifies or reverts this at the checkpoint.
 *
 * A RESOLVED kickoff is cached at /rankings/kickoffs/{season}/{week} at the first snapshot
 * attempt of the week, so a Thursday outage cannot block a capture. A FAILURE is never
 * cached — poisoning the week with a transient 502 is the bug that cache is meant to prevent.
 */
async function rankingsFirstKickoff(env, season, week) {
  const cachePath = `/rankings/kickoffs/${season}/${week}`;
  try {
    const { data } = await fbGet(env, cachePath);
    if (data && data.at) return { at: data.at, source: data.source, cached: true };
  } catch (e) { /* a cache read failure just means we resolve again */ }

  let resolved = null;

  // 1. the canonical schedule this site already publishes
  try {
    const r = await fetch(RANKINGS_SCHEDULE_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (r.ok) {
      const doc = await r.json();
      const games = (doc && doc.data && doc.data.games) || [];
      const kicks = games
        .filter(g => Number(g.season) === Number(season) && Number(g.week) === Number(week) && g.kickoff_at)
        .map(g => Date.parse(g.kickoff_at))
        .filter(t => Number.isFinite(t));
      if (kicks.length) resolved = { at: new Date(Math.min(...kicks)).toISOString(), source: "site-schedule" };
    }
  } catch (e) { /* fall through to ESPN */ }

  // 2. ESPN — the handoff's documented path, kept even though Worker egress is blocked
  if (!resolved) {
    const src = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
      + `?dates=${encodeURIComponent(season)}&seasontype=2&week=${encodeURIComponent(week)}`;
    for (const shape of FETCH_SHAPES) {
      try {
        const r = await fetch(src, { cf: { cacheTtl: 300, cacheEverything: true }, headers: shape.headers });
        if (!r.ok) continue;
        const raw = await r.json();
        const kicks = (raw.events || [])
          .map(ev => Date.parse(ev.date))
          .filter(t => Number.isFinite(t));
        if (kicks.length) { resolved = { at: new Date(Math.min(...kicks)).toISOString(), source: "espn" }; break; }
      } catch (e) { /* try the next shape, then give up */ }
    }
  }

  if (!resolved) return { at: null, source: null, cached: false };

  try {
    await fbPut(env, cachePath, { at: resolved.at, source: resolved.source, cached_at: new Date().toISOString() });
  } catch (e) { /* an uncached but resolved kickoff is still a valid gate */ }
  return { ...resolved, cached: false };
}

/* ----------------------------------------------------------------------------- CSV ---
 * Format (handoff §4):   pos,rank,player,team
 * One paste per entrant covering all four positions; ranks restart at 1 per position.
 *
 * Returns { rows, canonical, counts } or { errors: [{line,pos,rank,code}] }. Errors carry
 * coordinates and a code — never a player name (see the privacy invariant at the top).
 */
function rankingsParseCsv(csv) {
  const errors = [];
  const text = String(csv == null ? "" : csv).replace(/^﻿/, "");
  const lines = text.split(/\r\n|\r|\n/);
  const rows = [];
  const seen = new Map();          // pos → Set(normalized name+team), for duplicate detection

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const t = line.trim();
    if (!t) return;
    // an optional header, tolerated because the admin page shows the format above the box
    if (i === 0 && /^pos\s*,\s*rank\s*,\s*player\s*,\s*team$/i.test(t)) return;

    const parts = t.split(",");
    if (parts.length < 4) { errors.push({ line: lineNo, code: "fields" }); return; }

    const pos = String(parts[0]).trim().toUpperCase();
    const rankRaw = String(parts[1]).trim();
    const team = String(parts[parts.length - 1]).trim().toUpperCase();
    const player = parts.slice(2, -1).join(",").trim();   // a name may legally contain a comma

    if (!RANKINGS_POS.includes(pos)) { errors.push({ line: lineNo, code: "pos" }); return; }
    if (!/^\d+$/.test(rankRaw)) { errors.push({ line: lineNo, pos, code: "rank" }); return; }
    const rank = Number(rankRaw);
    if (rank < 1) { errors.push({ line: lineNo, pos, rank, code: "rank" }); return; }
    if (!player) { errors.push({ line: lineNo, pos, rank, code: "player" }); return; }
    if (!/^[A-Z]{2,4}$/.test(team)) { errors.push({ line: lineNo, pos, rank, code: "team" }); return; }

    const key = rankingsNormName(player) + "|" + team;
    if (!seen.has(pos)) seen.set(pos, new Set());
    if (seen.get(pos).has(key)) { errors.push({ line: lineNo, pos, rank, code: "duplicate" }); return; }
    seen.get(pos).add(key);

    rows.push({ pos, rank, name: player, team });
  });

  if (errors.length) return { errors };

  // ranks contiguous 1..n per position, and deep enough to grade
  const counts = {};
  for (const pos of RANKINGS_POS) {
    const at = rows.filter(r => r.pos === pos).map(r => r.rank).sort((a, b) => a - b);
    counts[pos] = at.length;
    if (!at.length) { errors.push({ pos, code: "missing_position" }); continue; }
    for (let i = 0; i < at.length; i++) {
      if (at[i] !== i + 1) { errors.push({ pos, rank: at[i], code: "not_contiguous" }); break; }
    }
    if (at.length < RANKINGS_DEPTHS[pos])
      errors.push({ pos, code: "too_shallow", got: at.length, need: RANKINGS_DEPTHS[pos] });
  }
  if (errors.length) return { errors };

  /* The idempotency key. Sorting by (pos, rank) means re-pasting the same list with the
   * positions in a different order is correctly recognised as the same content rather
   * than rejected as a conflicting rewrite. Case and spacing are normalized; the player's
   * own capitalisation is preserved because it is what gets stored. */
  const canonical = rows
    .slice()
    .sort((a, b) => (RANKINGS_POS.indexOf(a.pos) - RANKINGS_POS.indexOf(b.pos)) || (a.rank - b.rank))
    .map(r => `${r.pos},${r.rank},${r.name.replace(/\s+/g, " ")},${r.team}`)
    .join("\n");

  return { rows, canonical, counts };
}

/* -------------------------------------------------------------------------- registry --*/
const RANKINGS_ID_RE = /^[A-Z0-9_]{2,16}$/;
const RANKINGS_TYPES = ["service", "house"];

function rankingsAutoColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return RANKINGS_PALETTE[h % RANKINGS_PALETTE.length];
}

async function rankingsEntrants(env) {
  const { data } = await fbGet(env, "/rankings/entrants");
  return data || {};
}

async function rankingsEntrantsList(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);
  return json({ ok: true, entrants: await rankingsEntrants(env) }, 200, cors);
}

async function rankingsEntrantCreate(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const id = String(body.id || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const type = String(body.type || "").trim().toLowerCase();
  const firstWeek = Number(body.first_week);

  if (!RANKINGS_ID_RE.test(id)) return json({ error: "bad id" }, 400, cors);
  if (!name || name.length > 40) return json({ error: "bad name" }, 400, cors);
  if (!RANKINGS_TYPES.includes(type)) return json({ error: "bad type" }, 400, cors);
  if (!Number.isInteger(firstWeek) || firstWeek < 0 || firstWeek > 18)
    return json({ error: "bad first_week" }, 400, cors);
  const color = body.color ? String(body.color).trim() : rankingsAutoColor(id);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: "bad color" }, 400, cors);

  const { data, etag } = await fbGet(env, "/rankings/entrants", true);
  const reg = data || {};
  if (reg[id]) return json({ error: "entrant exists", id }, 409, cors);

  reg[id] = { name, type, first_week: firstWeek, color, registered_at: new Date().toISOString() };
  const wrote = await fbPut(env, "/rankings/entrants", reg, etag);
  if (!wrote) return json({ error: "registry changed under us, retry" }, 409, cors);

  const logged = await rankingsLog(env, { action: "entrant_add", entrant: id, detail: { name, type, first_week: firstWeek, color } });
  return json({ ok: true, id, entrant: reg[id], logged }, 200, cors);
}

/* Only name and colour are mutable. id, type and first_week are what comparability is
 * computed from — changing first_week after the fact would silently rewrite which weeks
 * an entrant is judged on. */
async function rankingsEntrantUpdate(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const id = String(body.id || "").trim().toUpperCase();
  const { data, etag } = await fbGet(env, "/rankings/entrants", true);
  const reg = data || {};
  if (!reg[id]) return json({ error: "unknown entrant", id }, 404, cors);

  const next = { ...reg[id] };
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 40) return json({ error: "bad name" }, 400, cors);
    next.name = name;
  }
  if (body.color !== undefined) {
    const color = String(body.color).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: "bad color" }, 400, cors);
    next.color = color;
  }
  reg[id] = next;
  const wrote = await fbPut(env, "/rankings/entrants", reg, etag);
  if (!wrote) return json({ error: "registry changed under us, retry" }, 409, cors);

  const logged = await rankingsLog(env, { action: "entrant_update", entrant: id, detail: { name: next.name, color: next.color } });
  return json({ ok: true, id, entrant: next, logged }, 200, cors);
}

/* -------------------------------------------------------------------------- snapshot --*/
function rankingsActiveCapture(captures) {
  for (const [id, c] of Object.entries(captures || {})) {
    if (c && c.voided !== true) return { id, capture: c };
  }
  return null;
}

async function rankingsSnapshot(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const season = Number(body.season);
  const week = Number(body.week);
  const entrant = String(body.entrant || body.service || "").trim().toUpperCase();

  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  if (!Number.isInteger(week) || week < 1 || week > 18) return json({ error: "bad week" }, 400, cors);
  if (!RANKINGS_ID_RE.test(entrant)) return json({ error: "bad entrant" }, 400, cors);

  const reg = await rankingsEntrants(env);
  if (!reg[entrant]) return json({ error: "unknown entrant", entrant }, 404, cors);
  if (season !== 0 && week < Number(reg[entrant].first_week))
    return json({ error: "week precedes entrant first_week", entrant, first_week: reg[entrant].first_week }, 400, cors);

  const parsed = rankingsParseCsv(body.csv);
  if (parsed.errors) {
    await rankingsLog(env, { action: "snapshot_reject", entrant, season, week, detail: { reason: "invalid_csv", count: parsed.errors.length } });
    return json({ error: "invalid csv", errors: parsed.errors.slice(0, 25) }, 400, cors);
  }

  const sha256 = await sha256hex(parsed.canonical);
  const capturedAt = new Date().toISOString();          // SERVER time, never the client's

  /* Season 0 is the Stage E sandbox: it has no real kickoff and is excluded from the
   * public doc, so the gate does not apply to it. Every other season is gated. */
  let kickoffCheck = "sandbox";
  let kickoffAt = null;
  if (season !== 0) {
    const ko = await rankingsFirstKickoff(env, season, week);
    kickoffAt = ko.at;
    if (!ko.at) {
      kickoffCheck = "deferred";                        // trap #5 — verified again at grade time
    } else if (Date.parse(capturedAt) >= Date.parse(ko.at)) {
      await rankingsLog(env, { action: "snapshot_reject", entrant, season, week, detail: { reason: "late", kickoff_at: ko.at, captured_at: capturedAt } });
      return json({ error: "late — first kickoff has passed", kickoff_at: ko.at, captured_at: capturedAt }, 409, cors);
    } else {
      kickoffCheck = "verified";
    }
  }

  const path = `/rankings/snapshots/${season}/${week}/${entrant}`;
  const { data, etag } = await fbGet(env, path, true);
  const captures = data || {};
  const active = rankingsActiveCapture(captures);

  if (active) {
    /* Identical content is a no-op that returns the ORIGINAL receipt — re-pasting because
     * the phone lost signal must not look like a second capture. */
    if (active.capture.sha256 === sha256) {
      return json({
        ok: true, idempotent: true,
        receipt: {
          season, week, entrant, capture_id: active.id,
          captured_at: active.capture.captured_at, sha256: active.capture.sha256,
          kickoff_check: active.capture.kickoff_check, counts: active.capture.counts,
        },
      }, 200, cors);
    }
    await rankingsLog(env, { action: "snapshot_reject", entrant, season, week, detail: { reason: "immutable", existing: active.id } });
    return json({
      error: "a snapshot already exists for this entrant and week; void it first",
      capture_id: active.id, captured_at: active.capture.captured_at,
    }, 409, cors);
  }

  const captureId = "c" + Date.parse(capturedAt).toString(36) + "-" + sha256.slice(0, 8);
  captures[captureId] = {
    rows: parsed.rows,                                  // PRIVATE — never leaves this Worker
    captured_at: capturedAt,
    sha256,
    source_label: String(body.source_label || "").trim().slice(0, 60) || null,
    kickoff_check: kickoffCheck,
    kickoff_at: kickoffAt,
    counts: parsed.counts,
    voided: false,
  };

  const wrote = await fbPut(env, path, captures, etag);
  if (!wrote) return json({ error: "snapshot changed under us, retry" }, 409, cors);

  const logged = await rankingsLog(env, {
    action: "snapshot", entrant, season, week,
    detail: { capture_id: captureId, sha256, kickoff_check: kickoffCheck, counts: parsed.counts },
  });

  return json({
    ok: true, idempotent: false, logged,
    receipt: {
      season, week, entrant, capture_id: captureId, captured_at: capturedAt,
      sha256, kickoff_check: kickoffCheck, kickoff_at: kickoffAt,
      counts: parsed.counts, rows: parsed.rows.length,
    },
  }, 200, cors);
}

/* ------------------------------------------------------------------------------ void --
 * Flags a capture; never removes one. Permitted after kickoff (a wrong capture should be
 * markable as wrong whenever it is noticed) — but the replacement paste is still gated,
 * so voiding late leaves the week with no active snapshot rather than a swapped one.
 */
async function rankingsVoid(request, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  let body;
  try { body = await rankingsReadBody(request); }
  catch (e) { return json({ error: "bad body" }, 400, cors); }

  const season = Number(body.season);
  const week = Number(body.week);
  const entrant = String(body.entrant || "").trim().toUpperCase();
  const captureId = String(body.capture_id || "").trim();
  const reason = String(body.reason || "").trim().slice(0, 200);

  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  if (!Number.isInteger(week) || week < 1 || week > 18) return json({ error: "bad week" }, 400, cors);
  if (!RANKINGS_ID_RE.test(entrant)) return json({ error: "bad entrant" }, 400, cors);
  if (!captureId) return json({ error: "capture_id required" }, 400, cors);
  if (!reason) return json({ error: "reason required" }, 400, cors);

  const path = `/rankings/snapshots/${season}/${week}/${entrant}`;
  const { data, etag } = await fbGet(env, path, true);
  const captures = data || {};
  if (!captures[captureId]) return json({ error: "unknown capture", capture_id: captureId }, 404, cors);
  if (captures[captureId].voided === true) return json({ error: "already voided", capture_id: captureId }, 409, cors);

  captures[captureId] = {
    ...captures[captureId],
    voided: true,
    voided_at: new Date().toISOString(),
    void_reason: reason,
  };
  const wrote = await fbPut(env, path, captures, etag);
  if (!wrote) return json({ error: "snapshot changed under us, retry" }, 409, cors);

  const logged = await rankingsLog(env, { action: "void", entrant, season, week, detail: { capture_id: captureId, reason } });
  return json({ ok: true, capture_id: captureId, voided_at: captures[captureId].voided_at, logged }, 200, cors);
}

/* ---------------------------------------------------------------------------- status --
 * Feeds the admin page's per-week capture strip (captured ✓ / missing / voided). Derived
 * counts and hashes only — no rows, so the strip can render without the paid content ever
 * being sent to a browser.
 */
async function rankingsStatus(request, url, env, cors) {
  if (!rankingsAdminOk(request, env)) return json({ error: "forbidden" }, 403, cors);

  const season = Number(url.searchParams.get("season"));
  const week = Number(url.searchParams.get("week"));
  if (!Number.isInteger(season) || season < 0) return json({ error: "bad season" }, 400, cors);
  if (!Number.isInteger(week) || week < 1 || week > 18) return json({ error: "bad week" }, 400, cors);

  const reg = await rankingsEntrants(env);
  const { data } = await fbGet(env, `/rankings/snapshots/${season}/${week}`);
  const byEntrant = data || {};

  const entrants = Object.entries(reg).map(([id, e]) => {
    const captures = byEntrant[id] || {};
    const active = rankingsActiveCapture(captures);
    const voided = Object.values(captures).filter(c => c && c.voided === true).length;
    return {
      id, name: e.name, type: e.type, color: e.color, first_week: e.first_week,
      state: active ? "captured" : (voided ? "voided" : "missing"),
      capture_id: active ? active.id : null,
      captured_at: active ? active.capture.captured_at : null,
      sha256: active ? active.capture.sha256 : null,
      kickoff_check: active ? active.capture.kickoff_check : null,
      counts: active ? active.capture.counts : null,
      voided_count: voided,
    };
  });

  const ko = season === 0 ? { at: null, source: "sandbox" } : await rankingsFirstKickoff(env, season, week);
  return json({ ok: true, season, week, first_kickoff: ko.at, kickoff_source: ko.source, entrants }, 200, cors);
}

async function handleRankings(request, url, env, cors) {
  const p = url.pathname;
  if (p === "/rankings/entrants") {
    if (request.method === "GET")   return rankingsEntrantsList(request, env, cors);
    if (request.method === "POST")  return rankingsEntrantCreate(request, env, cors);
    if (request.method === "PATCH") return rankingsEntrantUpdate(request, env, cors);
    return json({ error: "method not allowed" }, 405, cors);
  }
  if (p === "/rankings/snapshot" && request.method === "POST") return rankingsSnapshot(request, env, cors);
  if (p === "/rankings/void"     && request.method === "POST") return rankingsVoid(request, env, cors);
  if (p === "/rankings/status"   && request.method === "GET")  return rankingsStatus(request, url, env, cors);
  if (p === "/rankings/grade"    && request.method === "POST") return rankingsGrade(request, env, cors);
  if (p === "/rankings/aliases"  && request.method === "POST") return rankingsAliasAdd(request, env, cors);
  // ⚠️ THE ONLY PUBLIC ROUTE IN THIS FEATURE. Everything above is admin-gated; this one
  // serves derived scores to the page and to nobody's detriment. Adding a second public
  // route here means re-reading spec §1 first — assemble.mjs keeps an explicit allowlist.
  if (p === "/rankings/grades"   && request.method === "GET")  return rankingsGrades(request, url, env, cors);
  return json({ error: "not found" }, 404, cors);
}
