/* PMV column resolution. Lifted from the page so the test cannot drift from what ships.
   Fixtures use real league SHAPES (team count / rec / superflex), never player data. */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "fantasy-warroom.html"), "utf8");
const at = src.indexOf("function mvColumn(");
if (at < 0) throw new Error("mvColumn not found in the page");
let i = src.indexOf("{", at), d = 0, end = i;
for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) { end = i + 1; break; } }
const body = src.slice(at, end);

let pass = 0, fail = 0;
const ok = (n, c) => c ? pass++ : (fail++, console.log("  FAIL " + n));
const col = (teams, rec, sf) => {
  const state = { teams: Array.from({ length: teams }), slots: sf ? { SUPERFLEX: 1 } : {},
                  league: { scoring_settings: { rec } } };
  return new Function("state", body + "; return mvColumn();")(state);
};

/* the two live bugs this replaces */
ok("PFL 12-team superflex half -> sfhalf12, not sf", col(12, 0.5, true) === "sfhalf12");
ok("14-team half -> half14, not half",              col(14, 0.5, false) === "half14");
/* the rest of the published columns */
ok("12-team superflex PPR -> sf",  col(12, 1, true) === "sf");
ok("12-team half -> half",         col(12, 0.5, false) === "half");
ok("12-team PPR -> full",          col(12, 1, false) === "full");
ok("12-team standard -> std",      col(12, 0, false) === "std");
ok("10-team PPR -> ppr10",         col(10, 1, false) === "ppr10");
ok("14-team PPR -> ppr14",         col(14, 1, false) === "ppr14");
/* abstain rather than mis-price: no published column for these rooms */
ok("14-team superflex -> null",      col(14, 0.5, true) === null);
ok("superflex standard -> null",     col(12, 0, true) === null);
ok("13-team half -> null",           col(13, 0.5, false) === null);
ok("10-team half -> null",           col(10, 0.5, false) === null);
ok("unknown reception -> null",      col(12, NaN, false) === null);
/* ---- the real ESPN path -------------------------------------------------
   ⚠️ THE ASSERTIONS ABOVE ALL BUILD state BY HAND WITH rec ALREADY SET, which is why
   they passed while every ESPN league was about to read as unpriced. fetchLeagueEspn()
   constructs scoring_settings itself from the Worker's feed, so these lift THAT code and
   run mvColumn() on its real output. A fixture that supplies the field under test is not
   a test of the code that supplies it. */
const fe = src.indexOf("async function fetchLeagueEspn");
if (fe < 0) throw new Error("fetchLeagueEspn not found");
const seg = src.slice(fe, src.indexOf("async function connect(", fe));
const ssMatch = /scoring_settings:(\(\(\)=>\{[\s\S]*?\}\)\(\)|\{\})/.exec(seg);
if (!ssMatch) throw new Error("scoring_settings initialiser not found in fetchLeagueEspn");
const espnScoringSettings = (L) => new Function("L", "return " + ssMatch[1] + ";")(L);

/* the Worker's espnWarroomFeed sends league.scoring = espnScoring(settings) */
const feedPFL  = { scoring: { mode: "sf",   ppr: 0.5, superflex: true  } };
const feedFull = { scoring: { mode: "full", ppr: 1,   superflex: false } };
const feedStd  = { scoring: { mode: "std",  ppr: 0,   superflex: false } };
const feedNone = {};

ok("ESPN feed reception value reaches scoring_settings", espnScoringSettings(feedPFL).rec === 0.5);
ok("ESPN standard (0 rec) is carried, not dropped",       espnScoringSettings(feedStd).rec === 0);
ok("ESPN with no scoring block stays empty",              Object.keys(espnScoringSettings(feedNone)).length === 0);

const espnCol = (feed, teams, slots) => {
  const state = { teams: Array.from({ length: teams }), slots,
                  league: { scoring_settings: espnScoringSettings(feed) } };
  return new Function("state", body + "; return mvColumn();")(state);
};
/* PFL as the Worker actually reports it: 12 teams, superflex OP slot, 0.5 reception */
ok("PFL via the real ESPN path -> sfhalf12",
   espnCol(feedPFL, 12, { QB:1, RB:2, WR:2, TE:1, SUPERFLEX:1, DST:1, BN:7, FLEX:2 }) === "sfhalf12");
ok("12-team ESPN full PPR via the real path -> full", espnCol(feedFull, 12, { QB:1 }) === "full");
ok("12-team ESPN standard via the real path -> std",  espnCol(feedStd, 12, { QB:1 }) === "std");

/* the shipped columns all exist in the data file */
const pool = JSON.parse(fs.readFileSync(path.join(ROOT, "data/pool.json"), "utf8"));
const keys = Object.keys(pool.scoring_keys || {});
for (const k of ["full","half","half14","std","sf","sfhalf12","ppr10","ppr14"])
  ok("pool.json publishes column " + k, keys.includes(k));
console.log(`\npass ${pass}  fail ${fail}`);
process.exit(fail ? 1 : 0);
