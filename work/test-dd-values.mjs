/* DataDawg$ private-valuation block. Lifted from the shipped Worker by name so the test
   cannot drift from what runs. Player names here are INVENTED - the repo is public and
   the board is paid content. */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "dawg-bot-worker.js"), "utf8");

const B = "/* ===== DD$ PRIVATE VALUATION (begin) ===== */";
const E = "/* ===== DD$ PRIVATE VALUATION (end) ===== */";
if (!src.includes(B) || !src.includes(E)) throw new Error("DD$ block not found in the Worker");
const block = src.slice(src.indexOf(B), src.indexOf(E) + E.length);

/* the block must not reach for anything the Worker gives it elsewhere */
const mod = new Function(`${block}
return { ddPlayerKey, ddIndexBoard, ddDecorateBody, ddValuesFor, ddNameKey, DD_MAX_KEYS, DD_HORIZONS };`)();
const { ddPlayerKey, ddIndexBoard, ddDecorateBody, ddValuesFor, ddNameKey, DD_MAX_KEYS, DD_HORIZONS } = mod;

let pass = 0, fail = 0;
const ok = (n, c) => c ? pass++ : (fail++, console.log("  FAIL " + n));

const board = { as_of: "2026-09-02", tier: "labs", graded: false, data: {
  model_id: "test-model", as_of: "2026-09-02", horizon: "season", dynasty_league: true,
  league: "Test League", tier: "labs", graded: false, validation: { priced_players: 4 },
  players: [
    { id: "00-0011111", player: "Ada Lovelace",  pos: "RB", team: "DET", target: 55, low: 48, high: 61 },
    { id: "00-0022222", player: "Grace Hopper",  pos: "QB", team: "BUF", target: 40 },
    { id: "ROOKIE x",   player: "Alan Turing Jr.", pos: "WR", team: "LA", target: 12, low: 9, high: 15 },
    { id: "BAL DST",    player: "BAL DST",       pos: "DST", team: "BAL", target: 3 },
    { id: "00-0033333", player: "Katherine Johnson", pos: "TE", team: "KC", target: 0 },
  ] } };
const idx = ddIndexBoard(board);

/* ---- join keys -------------------------------------------------------- */
ok("name key strips suffix + punctuation", ddNameKey("Alan Turing Jr.") === "alan turing");
ok("player keys by name",  ddPlayerKey({ name: "Ada Lovelace", pos: "RB" }) === "name:ada lovelace");
ok("suffix variant joins", ddPlayerKey({ name: "Alan Turing", pos: "WR" }) === ddPlayerKey({ name: "Alan Turing Jr.", pos: "WR" }));
ok("ETR alias: Kenneth -> Kenny Gainwell", ddPlayerKey({ name: "Kenneth Gainwell", pos: "RB" }) === ddPlayerKey({ name: "Kenny Gainwell", pos: "RB" }));
ok("ETR alias: Cameron -> Cam Ward", ddPlayerKey({ name: "Cameron Ward", pos: "QB" }) === ddPlayerKey({ name: "Cam Ward", pos: "QB" }));
ok("DST by nickname (Yahoo shape)", ddPlayerKey({ name: "Ravens D/ST", pos: "DST" }) === "dst:BAL");
ok("DST by abbreviation (pool shape)", ddPlayerKey({ name: "BAL DST", pos: "DST", team: "BAL" }) === "dst:BAL");
ok("ESPN LAR normalises to ETR LA", ddPlayerKey({ name: "Rams D/ST", pos: "DST", team: "LAR" }) === "dst:LA");

/* ---- indexing --------------------------------------------------------- */
ok("board indexes by name and gsis", idx.by.get("name:ada lovelace").v === 55 && idx.by.get("gsis:00-0011111").v === 55);
ok("bands carried when present", idx.by.get("name:ada lovelace").low === 48 && idx.by.get("name:ada lovelace").high === 61);
ok("no bands invented when absent", idx.by.get("name:grace hopper").low === undefined);
ok("$0 is a real price, kept", idx.by.get("name:katherine johnson").v === 0);
ok("meta carries model + date + horizon", idx.meta.model_id === "test-model" && idx.meta.as_of === "2026-09-02" && idx.meta.horizon === "season");
ok("dynasty league is flagged in the note", /SEASON horizon only/.test(idx.meta.note) && idx.meta.dynasty_league === true);
ok("ungraded is stated", idx.meta.graded === false && /Not graded/.test(idx.meta.note));

/* ---- decoration: only what the caller already had ---------------------- */
const body = { pool: [
  { id: "1", name: "Ada Lovelace", pos: "RB", team: "DET" },
  { id: "2", name: "Someone Unpriced", pos: "WR", team: "NYJ" },
  { id: "3", name: "Ravens D/ST", pos: "DST", team: "BAL" },
] };
ddDecorateBody(idx, body);
ok("value attached to a player the caller held", body.pool[0].dd.v === 55);
ok("unmatched player gets NO dd and no zero", body.pool[1].dd === undefined);
ok("counts reported", body.dd.matched === 2 && body.dd.unmatched === 1);
/* ⚠️ the whole point of the block */
const leaked = JSON.stringify(body);
ok("board rows the caller did not hold never appear", !leaked.includes("Grace Hopper") && !leaked.includes("Katherine Johnson"));
ok("no player list or ranks in the response", !("players" in body.dd) && !leaked.includes("\"rank\""));

/* ---- key-list route --------------------------------------------------- */
const r = ddValuesFor(idx, ["name:ada lovelace", "name:nobody at all"]);
ok("answers only the keys asked for", Object.keys(r.values).length === 1 && r.values["name:ada lovelace"].v === 55);
ok("key route reports unmatched too", r.dd.matched === 1 && r.dd.unmatched === 1);
ok("key route leaks no other row", !JSON.stringify(r).includes("Grace Hopper"));
ok("key cap is bounded", Number.isFinite(DD_MAX_KEYS) && DD_MAX_KEYS <= 1000);

/* ---- the route itself is authenticated and capped ---------------------- */
const route = src.slice(src.indexOf("async function handleDdValues"), src.indexOf("async function handleDdValues") + 1800);
ok("/dd/values requires a session", /sessionAuth\(request, env\)/.test(route));
ok("/dd/values rejects oversized key lists", /DD_MAX_KEYS/.test(route) && /413/.test(route));
ok("/dd/values is POST only", /POST only/.test(route));
ok("no board is returned when none exists", /dd: null, values: \{\}/.test(route));
/* the block must contain no Firebase write helper - it is a read path */
ok("DD$ block performs no writes", !/\bfbPut\b|\bfbPost\b|\bkv\.put\b|\bkv\.delete\b/.test(block));


/* ---- horizon: two boards per league, never mixed ---------------------- */
ok("season and dynasty are separate KV keys", DD_HORIZONS.season === "" && DD_HORIZONS.dynasty === ":dynasty");
ok("an unknown horizon is not a key", DD_HORIZONS.redraft === undefined && DD_HORIZONS.keeper === undefined);
const load = src.slice(src.indexOf("async function ddLoadBoard"), src.indexOf("async function ddLoadBoard") + 700);
ok("board key includes the horizon suffix", /DD_HORIZONS\[horizon/.test(load) && /\+ suffix/.test(load));
ok("unknown horizon loads nothing", /suffix === undefined\) return null/.test(load));
ok("/dd/values rejects an unknown horizon", /horizon must be season or dynasty/.test(route));
ok("ESPN warroom asks for the season board", /ddLoadBoard\(env, "espn", cred\.leagueId, "season"\)/.test(src));

/* ---- dynasty: draft picks are assets, priced by round ------------------ */
const dyn = { as_of: "2026-09-02", data: { model_id: "dyn", as_of: "2026-09-02", horizon: "dynasty",
  dynasty_league: true, tier: "labs", graded: false,
  players: [{ id: "00-0044444", player: "Ada Lovelace", pos: "RB", team: "DET", target: 50 }],
  picks: [{ pick: "2027 round 1", season: "2027", round: 1, target: 15 },
          { pick: "2027 round 5", season: "2027", round: 5, target: 0 }],
  draft_capital_by_team: { "The B Team": { draft_capital: 138, picks: 13 },
                           "Defending Champs": { draft_capital: 13, picks: 7 } } } };
const di = ddIndexBoard(dyn);
ok("dynasty board carries priced picks", di.picks.length === 2 && di.picks[0].v === 15);
ok("a $0 round is kept, not dropped", di.picks[1].v === 0);
ok("per-team draft capital carried", di.capital["The B Team"].draft_capital === 138);
ok("meta says dynasty and flags picks", di.meta.horizon === "dynasty" && di.meta.has_picks === true);
ok("dynasty note warns picks are round-level", /priced by ROUND, not by slot/.test(di.meta.note));
ok("season board of a dynasty league says so", /SEASON horizon only/.test(idx.meta.note));
ok("dynasty note does NOT claim season-only", !/SEASON horizon only/.test(di.meta.note));
ok("picks never leak into player values", ddValuesFor(di, ["name:ada lovelace"]).values["name:ada lovelace"].v === 50);
ok("route returns picks + capital only for a dynasty board", /out\.picks = index\.picks/.test(route) && /out\.draftCapital = index\.capital/.test(route));

console.log(`\npass ${pass}  fail ${fail}`);
process.exit(fail ? 1 : 0);
