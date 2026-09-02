#!/usr/bin/env python3
"""dawg-bot-worker.js — DataDawg$ private valuation served per league.  Idempotent.

    python3 work/patch-worker-dd-values.py      # from the repo root
    node work/test-dd-values.mjs                # 44 assertions
    node --check dawg-bot-worker.js

WHAT THIS ADDS
  1. A DataDawg$ block (between DD$ markers, above the ESPN adapter) that loads a board
     from KV and attaches values to players the caller ALREADY HAS.
  2. /espn/warroom and /espn/share/<token> responses gain `dd` on each pool player that
     the league's board prices, plus a `dd` meta block (model, date, horizon, counts).
  3. POST /dd/values — for Sleeper (and later Yahoo) leagues, which the page loads
     straight from Sleeper and which therefore never pass through the Worker. The page
     posts the player keys it holds; the Worker answers with values for those keys only.

⚠️ THE ONE RULE: NO ROUTE EVER RETURNS A BOARD. DataDawg$ is ETR-derived paid content and
this repo is public. Values leave the Worker only attached to players the caller already
named, capped in number, to a signed-in caller (or a share-token holder for the league the
share belongs to). The board's own player list, ranks, and any row the caller did not ask
about stay inside the Worker. The test suite asserts every one of these.

LOADING A BOARD (Kap, once per league, never via git):
    npx wrangler kv key put --binding RL --remote 'dd$:espn:110404'  --path boards/datadawg-dollars-pfl.json
    npx wrangler kv key put --binding RL --remote 'dd$:yahoo:773763' --path boards/datadawg-dollars-ppn.json
    npx wrangler kv key put --binding RL --remote 'dd$:sleeper:1315018026927554560' --path boards/datadawg-dollars-kayfabe.json
    ... etc. Key = dd$:<provider>:<leagueId>            (SEASON horizon)
            dd$:<provider>:<leagueId>:dynasty    (DYNASTY horizon - the three dynasty leagues)
    Re-put to update; the meta block carries as_of.
"""
import pathlib, sys

W = pathlib.Path("dawg-bot-worker.js")
BEGIN = "/* ===== DD$ PRIVATE VALUATION (begin) ===== */"
END   = "/* ===== DD$ PRIVATE VALUATION (end) ===== */"

BLOCK = BEGIN + r"""
/* DataDawg$ is Kap's private, league-specific valuation (ETR-derived). It is NEVER in the
   repo and NEVER returned whole. A board sits in KV under dd$:<provider>:<leagueId>; the
   helpers below attach a value to a player the caller already holds, and nothing else.
   PMV (data/pool.json) is the public fallback and is not touched here. */
const DD_KV_PREFIX = "dd$:";
/* ⚠️ A league has TWO boards and they answer different questions. The season board prices
   this year; the dynasty board prices the asset (and its draft picks). Mixing them in one
   number is the single most misleading thing this code could do, so the horizon is part of
   the KV key and part of every response. */
const DD_HORIZONS = { season: "", dynasty: ":dynasty" };
const DD_MAX_KEYS = 700;                 // a 12-team league's whole pool is ~500
const DD_SHARE_INCLUDE = true;           // share-link readers see the same grades as the owner
/* team abbreviations differ by source: ETR says LA/JAX/WAS, ESPN says LAR/JAX/WSH */
const DD_TEAM_ALIAS = { LAR:"LA", JAC:"JAX", WSH:"WAS", OAK:"LV", SD:"LAC", STL:"LA" };
const DD_NICK = { ravens:"BAL", bills:"BUF", bengals:"CIN", browns:"CLE", broncos:"DEN", texans:"HOU",
  colts:"IND", jaguars:"JAX", chiefs:"KC", raiders:"LV", chargers:"LAC", dolphins:"MIA", patriots:"NE",
  jets:"NYJ", steelers:"PIT", titans:"TEN", cardinals:"ARI", falcons:"ATL", panthers:"CAR", bears:"CHI",
  cowboys:"DAL", lions:"DET", packers:"GB", rams:"LA", vikings:"MIN", saints:"NO", giants:"NYG",
  eagles:"PHI", "49ers":"SF", seahawks:"SEA", buccaneers:"TB", commanders:"WAS" };

/* the page's mvKey, ported: suffixes, punctuation and accents stripped, lowercase */
function ddNameKey(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}
/* the two names ETR and the providers spell differently; extend, never loosen the matcher */
const DD_NAME_ALIAS = { "kenneth gainwell":"kenny gainwell", "cameron ward":"cam ward" };
function ddTeamAbbr(t) { const u = String(t || "").toUpperCase(); return DD_TEAM_ALIAS[u] || u; }
/* A join key for any player row from any source: {name, pos, team}. Defenses key by team
   because they have no shared id anywhere; "Ravens D/ST" and "BAL DST" both -> dst:BAL. */
function ddPlayerKey(row) {
  if (!row) return null;
  const pos = String(row.pos || "").toUpperCase();
  const name = String(row.name || row.player || "");
  if (pos === "DST" || pos === "DEF" || /\bd\/st\b|\bdst\b/i.test(name)) {
    const nick = name.toLowerCase().replace(/\s*d\/st.*$/, "").replace(/\s*dst.*$/, "").trim();
    const byNick = DD_NICK[nick] || DD_NICK[nick.split(" ").pop()];
    const abbr = byNick || (/^[A-Z]{2,3}$/i.test(String(row.team || "")) ? ddTeamAbbr(row.team) : null);
    return abbr ? "dst:" + abbr : null;
  }
  const k = ddNameKey(name);
  return k ? "name:" + (DD_NAME_ALIAS[k] || k) : null;
}
/* Board JSON -> lookup index. Only the fields a caller may receive are kept. */
function ddIndexBoard(board) {
  const d = (board && board.data) || {};
  const by = new Map();
  for (const p of (d.players || [])) {
    if (!p || !Number.isFinite(Number(p.target))) continue;
    const k = ddPlayerKey({ name: p.player, pos: p.pos, team: p.team });
    if (!k || by.has(k)) continue;
    const v = { v: Number(p.target) };
    if (Number.isFinite(Number(p.low)))  v.low  = Number(p.low);
    if (Number.isFinite(Number(p.high))) v.high = Number(p.high);
    by.set(k, v);
    if (p.id && /^\d{2}-\d{7}$/.test(String(p.id))) by.set("gsis:" + p.id, v);
  }
  /* Draft picks are dynasty ASSETS, priced at ROUND level by the source. They are carried
     separately from players and must be shown BESIDE roster value, never folded into it
     silently - a team can be mid-table on roster and first on capital. */
  const picks = (d.picks || []).map(p => ({ pick: p.pick, season: p.season, round: p.round, v: Number(p.target) }))
                               .filter(p => Number.isFinite(p.v));
  const capital = d.draft_capital_by_team || null;
  return { by, picks, capital, meta: {
    basis: "dd", model_id: d.model_id || null, as_of: d.as_of || board.as_of || null,
    horizon: d.horizon || "season", dynasty_league: !!d.dynasty_league,
    has_picks: picks.length > 0,
    tier: d.tier || board.tier || "labs", graded: !!(d.graded || board.graded),
    league: d.league || null, priced: (d.validation && d.validation.priced_players) || null,
    note: "DataDawg$: private league-specific valuation, " + (d.as_of || board.as_of || "undated") +
          ". Not graded. " +
          ((d.horizon || "season") === "dynasty"
            ? "DYNASTY horizon: asset value including draft capital. Picks are priced by ROUND, not by slot. "
            : (d.dynasty_league ? "SEASON horizon only - dynasty value is NOT in this board. " : "")) +
          "low/high are conversion-assumption bounds, not bid ceilings.",
  } };
}
async function ddLoadBoard(env, provider, leagueId, horizon) {
  const kv = env && env.RL;
  const suffix = DD_HORIZONS[horizon || "season"];
  if (!kv || !provider || !leagueId || suffix === undefined) return null;
  let raw = null;
  try { raw = await kv.get(DD_KV_PREFIX + String(provider) + ":" + String(leagueId) + suffix); } catch { raw = null; }
  if (!raw) return null;
  try { return ddIndexBoard(JSON.parse(raw)); } catch { return null; }
}
/* Attach values to a warroom feed body IN PLACE. Only players already in body.pool are
   touched; the board's remaining rows never leave this function. */
function ddDecorateBody(index, body) {
  if (!index || !body) return body;
  let matched = 0;
  const pool = Array.isArray(body.pool) ? body.pool : [];
  for (const p of pool) {
    const hit = index.by.get(ddPlayerKey(p));
    if (hit) { p.dd = hit; matched++; }
  }
  body.dd = Object.assign({}, index.meta, { matched, unmatched: pool.length - matched });
  return body;
}
/* Values for a caller-supplied key list. Same rule: answers only what was asked. */
function ddValuesFor(index, keys) {
  const out = {};
  let matched = 0;
  for (const k of keys) {
    const hit = index.by.get(String(k));
    if (hit) { out[k] = hit; matched++; }
  }
  return { dd: Object.assign({}, index.meta, { matched, unmatched: keys.length - matched }), values: out };
}
/* POST /dd/values  {provider, leagueId, keys:[...]}  -> {ok, dd, values}
   Signed-in callers only. Keys are the page's own ddPlayerKey() strings ("name:..." or
   "dst:XXX" or "gsis:..."). Capped so the route cannot be used to walk a board. */
async function handleDdValues(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only." }, 405, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  let body = {};
  try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400, cors); }
  const provider = String(body.provider || "").toLowerCase();
  const leagueId = String(body.leagueId || "").trim();
  if (!/^(sleeper|espn|yahoo)$/.test(provider)) return json({ error: "Unknown provider." }, 400, cors);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(leagueId)) return json({ error: "That is not a league id." }, 400, cors);
  const horizon = String(body.horizon || "season");
  if (!(horizon in DD_HORIZONS)) return json({ error: "horizon must be season or dynasty." }, 400, cors);
  const keys = Array.isArray(body.keys) ? body.keys.filter(k => typeof k === "string" && k.length < 80) : [];
  if (!keys.length) return json({ error: "Send the player keys you hold." }, 400, cors);
  if (keys.length > DD_MAX_KEYS) return json({ error: "Too many keys." }, 413, cors);
  const index = await ddLoadBoard(env, provider, leagueId, horizon);
  if (!index) return json({ ok: true, dd: null, values: {} }, 200, cors);   // no board: page falls back to PMV
  const out = Object.assign({ ok: true }, ddValuesFor(index, keys));
  if (index.picks && index.picks.length) out.picks = index.picks;
  if (index.capital) out.draftCapital = index.capital;
  return json(out, 200, cors);
}
""" + END + "\n\n"

ESPN_MARK = "/* ======================= ESPN fantasy league adapter ====================== */"

OLD_WARROOM = "    const r = await espnWarroomFeed(cred);\n    if (!r.ok) return json({ error: r.reason, needsCredentials: r.status === 401 || r.status === 403 }, 400, cors);\n    return json({ ok: true, ...r.body }, 200, cors);"
NEW_WARROOM = "    const r = await espnWarroomFeed(cred);\n    if (!r.ok) return json({ error: r.reason, needsCredentials: r.status === 401 || r.status === 403 }, 400, cors);\n    /* DataDawg$ rides along for THIS league's players only - see the DD$ block */\n    ddDecorateBody(await ddLoadBoard(env, \"espn\", cred.leagueId, \"season\"), r.body);\n    return json({ ok: true, ...r.body }, 200, cors);"

OLD_SHARE = "  const r = await espnWarroomFeed(cred);\n  if (!r.ok) return json({ error: r.reason }, 502, cors);\n  return json({ ok: true, shared: true, readOnly: true, sharedAt: rec.at || null, ...r.body }, 200, cors);"
NEW_SHARE = "  const r = await espnWarroomFeed(cred);\n  if (!r.ok) return json({ error: r.reason }, 502, cors);\n  /* ⚠️ Deliberate addition to the unauthenticated share body: `dd` on pool players and a `dd`\n     meta block. The token holder is a member of the league the board prices, and the grades\n     must match the owner's or the two views disagree about the same roster. Still no cookie,\n     no uid, no board rows beyond the pool. Flip DD_SHARE_INCLUDE to withhold. */\n  if (DD_SHARE_INCLUDE) ddDecorateBody(await ddLoadBoard(env, \"espn\", cred.leagueId, \"season\"), r.body);\n  return json({ ok: true, shared: true, readOnly: true, sharedAt: rec.at || null, ...r.body }, 200, cors);"

OLD_ROUTE = "    if (url.pathname === \"/espn\" || url.pathname.startsWith(\"/espn/\")) return handleEspn(request, url, env, cors);"
NEW_ROUTE = "    if (url.pathname === \"/dd/values\") return handleDdValues(request, env, cors);\n" + OLD_ROUTE

def once(s, old, new, what):
    if new in s: return s
    n = s.count(old)
    if n != 1: sys.exit(f"{what}: expected 1 anchor, found {n}. Worker has drifted; re-read before patching.")
    return s.replace(old, new)

def main():
    if not W.exists(): sys.exit("run from the repo root (dawg-bot-worker.js not found)")
    s = W.read_text(encoding="utf-8")
    # block: replace between markers if present, else insert above the ESPN adapter
    if BEGIN in s and END in s:
        a, b = s.index(BEGIN), s.index(END) + len(END)
        s = s[:a] + BLOCK.rstrip("\n") + s[b:]
    else:
        if s.count(ESPN_MARK) != 1: sys.exit("ESPN adapter marker not found exactly once")
        s = s.replace(ESPN_MARK, BLOCK + ESPN_MARK)
    s = once(s, OLD_WARROOM, NEW_WARROOM, "/espn/warroom")
    s = once(s, OLD_SHARE, NEW_SHARE, "/espn/share read")
    s = once(s, OLD_ROUTE, NEW_ROUTE, "route dispatch")
    W.write_text(s, encoding="utf-8", newline="\n")
    print("patched dawg-bot-worker.js: DD$ block, /espn/warroom + share decoration, POST /dd/values")
    print("NEXT: node work/test-dd-values.mjs && node --check dawg-bot-worker.js")

if __name__ == "__main__": main()
