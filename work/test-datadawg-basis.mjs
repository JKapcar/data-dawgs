/* DataDawg$ / PMV basis resolution. Lifts the shipped functions out of the page so the
   test cannot drift from what runs. Invented player names only - the repo is public. */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "fantasy-warroom.html"), "utf8");
const lift = (name) => {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) throw new Error(name + " not found in the page");
  let i = src.indexOf("{", at), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) { i++; break; } }
  return src.slice(at, i);
};
const mvKeySrc = /const mvKey=[\s\S]*?\.trim\(\);/.exec(src);
if (!mvKeySrc) throw new Error("mvKey not found");

let pass = 0, fail = 0;
const ok = (n, c) => c ? pass++ : (fail++, console.log("  FAIL " + n));

const mk = ({ dd, mv, horizonDynasty = false, slots = {}, teams = 12, rec = 0.5 }) => {
  const ctx = {
    /* DD is a per-horizon map now; these fixtures are season boards. */
    DD: (dd && dd.by) ? { season: dd, dynasty: null } : dd, MV: mv, DYNASTY_MV: null,
    state: { teams: Array.from({ length: teams }), slots, league: { scoring_settings: { rec } } },
  };
  const body = `${mvKeySrc[0]}
    const DD_KEY_TEAM_ALIAS={LAR:'LA',JAC:'JAX',WSH:'WAS',OAK:'LV',SD:'LAC',STL:'LA'};
    const DD_KEY_NAME_ALIAS={'kenneth gainwell':'kenny gainwell','cameron ward':'cam ward'};
    ${lift("ddKey")} ${lift("ddBoard")} ${lift("ddActive")} ${lift("ddAsOf")} ${lift("mvColumn")} ${lift("labelFor")} ${lift("mvOf")}
    return {mvOf, labelFor, ddActive, ddKey};`;
  return new Function("DD", "MV", "DYNASTY_MV", "state", body)(ctx.DD, ctx.MV, ctx.DYNASTY_MV, ctx.state);
};

const player = (name, pos = "RB", team = "") => ({ name, pos, team });
const ddBoard = (pairs, as_of = "2026-09-02") => ({ by: new Map(pairs), meta: { as_of, basis: "dd" } });
const pmv = (rows) => ({ by: new Map(rows), asOf: "2026-08-24" });

/* --- the real ESPN path must preserve the Worker's inline values + metadata --- */
{
  const fe = src.slice(src.indexOf("async function fetchLeagueEspn"), src.indexOf("async function connect("));
  ok("ESPN pool rows preserve inline dd values", /team:p\.team,dd:p\.dd}\)\);/.test(fe));
  ok("ESPN state preserves the feed dd metadata", /diagnostics:feed\.diagnostics\|\|null,dd:feed\.dd\|\|null};/.test(fe));
  ok("loadDD connects preserved feed metadata", /if\(got&&!got\.meta&&st\.dd\)got\.meta=st\.dd/.test(src));
  const fromFeed = new Function(`${mvKeySrc[0]}
    const DD_KEY_TEAM_ALIAS={LAR:'LA',JAC:'JAX',WSH:'WAS',OAK:'LV',SD:'LAC',STL:'LA'};
    const DD_KEY_NAME_ALIAS={'kenneth gainwell':'kenny gainwell','cameron ward':'cam ward'};
    ${lift("ddKey")} ${lift("ddFromFeed")} return ddFromFeed;`)();
  const got = fromFeed([{ name: "Grace Hopper", pos: "RB", team: "BUF", dd: { v: 0 } }]);
  ok("inline ESPN $0 survives into the DataDawg$ index", got.by.get("name:grace hopper") === 0);
}

/* --- caller-supplied Sleeper keys must be canonicalised exactly like the Worker --- */
{
  const m = mk({ dd: null, mv: pmv([]) });
  ok("Kenneth Gainwell uses the Worker's explicit alias", m.ddKey(player("Kenneth Gainwell")) === "name:kenny gainwell");
  ok("Cameron Ward uses the Worker's explicit alias", m.ddKey(player("Cameron Ward", "QB")) === "name:cam ward");
  ok("Sleeper JAC defense uses the Worker's team alias", m.ddKey(player("Jaguars", "DEF", "JAC")) === "dst:JAX");
}

/* --- DataDawg$ is league state, never a cross-league global leak --- */
ok("loadDD caches the resolved boards on its league state", /st\.ddValues=boards/.test(src));
ok("restoring a league restores its own DataDawg$ board", /state=entry\.state;DD=state\.ddValues\|\|null/.test(src));
ok("portfolio calculations swap DataDawg$ with state", /keepDD=DD,keepPicks=DDPICKS;state=st;DD=st\.ddValues\|\|null;DDPICKS=st\.ddPicks\|\|null/.test(src));
ok("portfolio loading dispatches by provider before resolving each league board",
  /x\.provider==='espn'\?await fetchLeagueEspn\(x\.leagueId\):x\.provider==='yahoo'\?await fetchLeagueYahoo\(x\.leagueId\):await fetchLeague\(x\.leagueId\);\s*await loadDD\(st\)/.test(src));

/* --- DataDawg$ wins when a board is loaded --- */
{
  const m = mk({ dd: ddBoard([["name:ada lovelace", 405]]), mv: pmv([["ada lovelace", { sfhalf12: 99, half: 99 }]]),
                 slots: { SUPERFLEX: 1 } });
  ok("DataDawg$ beats PMV for the same player", m.mvOf(player("Ada Lovelace"), "season") === 405);
  ok("label names the resolved basis", m.labelFor("season") === "DataDawg$");
}
/* --- $0 is a real price in a floored board, not a missing value --- */
{
  const m = mk({ dd: ddBoard([["name:grace hopper", 0]]), mv: pmv([["grace hopper", { half: 42 }]]) });
  ok("$0 on the board is honoured, not treated as absent", m.mvOf(player("Grace Hopper"), "season") === 0);
}
/* --- no mixing: a player the board does not carry is UNPRICED, never PMV --- */
{
  const m = mk({ dd: ddBoard([["name:ada lovelace", 405]]), mv: pmv([["alan turing", { half: 42 }]]) });
  ok("player absent from the board is unpriced, not PMV", m.mvOf(player("Alan Turing"), "season") === null);
}
/* --- PMV stands when no board is loaded --- */
{
  const m = mk({ dd: null, mv: pmv([["alan turing", { half: 42 }]]) });
  ok("no board -> PMV resolves", m.mvOf(player("Alan Turing"), "season") === 42);
  ok("no board -> label says PMV", m.labelFor("season") === "PMV (Public Market Value)");
}
/* --- an empty board must not count as a board --- */
{
  const m = mk({ dd: { by: new Map(), meta: {} }, mv: pmv([["alan turing", { half: 42 }]]) });
  ok("empty board falls through to PMV", m.mvOf(player("Alan Turing"), "season") === 42);
}
/* --- defenses key by team on both sides --- */
{
  const m = mk({ dd: ddBoard([["dst:BAL", 12]]), mv: pmv([]) });
  ok("DST joins by team abbreviation", m.mvOf(player("Ravens", "DST", "BAL"), "season") === 12);
  ok("DST with no team is unpriced", m.mvOf(player("Ravens", "DST", ""), "season") === null);
}
/* --- name normalisation matches PMV's own --- */
{
  const m = mk({ dd: ddBoard([["name:katherine johnson", 7]]), mv: pmv([]) });
  ok("suffixes and punctuation normalise", m.mvOf(player("Katherine Johnson Jr."), "season") === 7);
}
/* --- dynasty horizon is NOT served by a season DataDawg$ board --- */
{
  const m = mk({ dd: ddBoard([["name:ada lovelace", 405]]), mv: pmv([]) });
  ok("dynasty horizon ignores the season board", m.mvOf(player("Ada Lovelace"), "dynasty") === null);
  ok("dynasty label unchanged", m.labelFor("dynasty") === "Overall dynasty value");
}
/* --- the explicit-horizon guard survives --- */
{
  const m = mk({ dd: null, mv: pmv([]) });
  let threw = false; try { m.mvOf(player("X"), undefined); } catch (e) { threw = true; }
  ok("mvOf still refuses an unnamed horizon", threw);
}
console.log(`\npass ${pass}  fail ${fail}`);
process.exit(fail ? 1 : 0);
