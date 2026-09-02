/* Per-horizon DataDawg$ resolution + the basis qualifier. Lifted from the page. */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "fantasy-warroom.html"), "utf8");
const lift = (n) => {
  const at = src.indexOf("function " + n + "(");
  if (at < 0) throw new Error(n + " not found");
  let i = src.indexOf("{", at), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) { i++; break; } }
  return src.slice(at, i);
};
const mvKeySrc = /const mvKey=[\s\S]*?\.trim\(\);/.exec(src)[0];
const aliasSrc = /const DD_KEY_TEAM_ALIAS=[\s\S]*?\n/.exec(src)[0] + /const DD_KEY_NAME_ALIAS=[\s\S]*?\n/.exec(src)[0];
let pass = 0, fail = 0;
const ok = (n, c) => c ? pass++ : (fail++, console.log("  FAIL " + n));

const board = (pairs, as_of) => ({ by: new Map(pairs), meta: { as_of } });
const mk = ({ season = null, dynasty = null, dynMv = null, mv = null, sf = false, teams = 12, rec = 0.5 }) => {
  const body = `${aliasSrc}${mvKeySrc}
    ${lift("ddKey")} ${lift("ddBoard")} ${lift("ddActive")} ${lift("ddAsOf")} ${lift("ddUnpriced")}
    ${lift("mvColumn")} ${lift("labelFor")} ${lift("asOfFor")} ${lift("basisQualifier")} ${lift("mvOf")}
    return {mvOf,labelFor,asOfFor,basisQualifier,ddActive,ddUnpriced};`;
  return new Function("DD", "DYNASTY_MV", "MV", "state", "hz", "usesDynasty",
    body)({ season, dynasty }, dynMv, mv,
      { teams: Array.from({ length: teams }), slots: sf ? { SUPERFLEX: 1 } : {}, league: { scoring_settings: { rec } } },
      (mod) => (dynasty || dynMv ? "dynasty" : "season"), () => !!(dynasty || dynMv));
};
const P = (name, pos = "RB", team = "") => ({ name, pos, team });
const dynMv = { by: new Map([["ada lovelace", { one_qb_auction: 11, two_qb_auction: 22 }]]), asOf: "2026-08-24" };

/* --- the structural bug: a dynasty league must reach its OWN board --- */
{
  const m = mk({ dynasty: board([["name:ada lovelace", 41]], "2026-09-02"), dynMv });
  ok("dynasty horizon uses the dynasty board, not dynasty PMV", m.mvOf(P("Ada Lovelace"), "dynasty") === 41);
  ok("dynasty label says DataDawg$", m.labelFor("dynasty") === "DataDawg$");
  ok("dynasty date comes from the board", m.asOfFor("dynasty") === "2026-09-02");
}
/* --- the two horizons never bleed into each other --- */
{
  const m = mk({ season: board([["name:ada lovelace", 405]], "2026-09-02"),
                 dynasty: board([["name:ada lovelace", 41]], "2026-09-02"), dynMv });
  ok("season asks the season board", m.mvOf(P("Ada Lovelace"), "season") === 405);
  ok("dynasty asks the dynasty board", m.mvOf(P("Ada Lovelace"), "dynasty") === 41);
}
{
  const m = mk({ season: board([["name:ada lovelace", 405]], "2026-09-02"), dynMv });
  ok("a season board must NOT serve the dynasty horizon", m.mvOf(P("Ada Lovelace"), "dynasty") === 11);  /* 1QB column: this room is not superflex */
  ok("dynasty falls back to dynasty PMV and says so", m.labelFor("dynasty") === "Overall dynasty value");
}
/* --- no mixing survives per horizon --- */
{
  const m = mk({ dynasty: board([["name:ada lovelace", 41]], "2026-09-02"), dynMv });
  ok("player off the dynasty board is unpriced, not dynasty PMV", m.mvOf(P("Alan Turing"), "dynasty") === null);
}
/* --- the crash --- */
{
  const m = mk({ mv: { by: new Map(), asOf: null } });
  ok("null PMV column does not throw", (() => { try { m.basisQualifier("money"); return true; } catch { return false; } })());
  ok("null column names nothing", mk({ teams: 18 }).basisQualifier("money") === "");
}
/* --- the qualifier --- */
{
  ok("PMV names its column", mk({ teams: 12, rec: 0.5 }).basisQualifier("money") === " (HALF)");
  ok("DataDawg$ cites no column", mk({ season: board([["name:x", 1]], "d") }).basisQualifier("money") === "");
  ok("dynasty DataDawg$ cites no column",
     mk({ dynasty: board([["name:x", 1]], "d"), dynMv }).basisQualifier("money") === "");
  ok("dynasty PMV keeps its 1QB/SF marker", mk({ dynMv }).basisQualifier("money") === " (1QB)");
}
/* --- structural --- */
ok("no bare mvColumn().toUpperCase() remains", !/mvColumn\(\)\.toUpperCase\(\)/.test(src));
ok("DD is a per-horizon map", /let DD=\{season:null,dynasty:null\}/.test(src));
ok("worker request carries the horizon", /horizon:horizon==='dynasty'\?'dynasty':'season'/.test(src));
ok("dynasty board is requested with the target league's teams", /ddFromWorker\(prov,st\.ref\.id,st\.pool,'dynasty',st\.teams\)/.test(src));
ok("off-screen loads use the target league type, not global state",
   /Number\(st&&st\.league&&st\.league\.settings&&st\.league\.settings\.type\)===2&&!feed/.test(src)
   && !/isDynastyLeague\.call\(null\)/.test(src));
console.log(`\npass ${pass}  fail ${fail}`);
process.exit(fail ? 1 : 0);
