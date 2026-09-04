/* Rebuild survivor.html's window.SV snapshot from the repo's own canonical data.
 *
 *   node work/build-survivor-snapshot.mjs --check    # regenerate and diff, write nothing
 *   node work/build-survivor-snapshot.mjs            # regenerate and write survivor.html
 *
 * ============================================================================
 * WHY THIS EXISTS
 *
 * There was no generator. window.SV was a hand-pasted blob inside survivor.html, and
 * tools/build-data.js produces /data/survivor.json by SCRAPING that blob back out of the
 * page (build-data.js:55). So "regenerate survivor.json" was not a thing anyone could
 * do: the JSON was downstream of a paste, the paste had no upstream, and the snapshot
 * sat at as_of 2026-08-06 with nothing in the repo able to move it.
 *
 * Every live input is derivable from data the repo already publishes:
 *   elo   <- data/nfelo.json          data.ratings[].nfelo
 *   games <- data/nfl-schedule.json   data.games[]
 *   mm    <- (elo_home - elo_away) / elo_per_pt + hfa
 *   mk    <- data/nfelo.json          data.games[].market spread-implied probability
 *
 * nfelo identifies when it observed each market row but not the book. That limitation is
 * carried explicitly as mk_book=null. Where the current mirror has no row, the original
 * 2026-08-06 probability is preserved with its own source and observation date. A refresh
 * that silently dropped captured lines back to model-only would make the board worse while
 * looking like an update, so market coverage may stay flat or rise but never fall.
 *
 * ============================================================================
 * TWO THINGS THIS FOUND IN THE SHIPPED SNAPSHOT, neither of which it changes
 *
 * 1. NEUTRAL-SITE GAMES CARRY FULL HOME-FIELD ADVANTAGE. Eight 2026 games are flagged
 *    neutral_site in the schedule, and all eight are priced in the shipped snapshot with
 *    the full +2.1. That is a modelling decision (or an oversight) baked into a dated
 *    snapshot, and correcting it is a MODEL CHANGE, not a refresh. Default behaviour
 *    here reproduces it exactly. `--neutral-hfa=0` applies the correction, and it is off
 *    by default so a routine data refresh can never quietly move numbers.
 *
 * 2. GAME IDS USE "LA" WHERE TEAM CODES USE "LAR". Sixteen Rams game ids in the snapshot
 *    read 2026_01_SF_LA while the canonical schedule says 2026_01_SF_LAR. Ids are joined
 *    on the canonical form and the snapshot's own id style is preserved, so nothing that
 *    quotes an id changes shape.
 * ============================================================================
 */
import fs from "fs";
import path from "path";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const WORK = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WORK, "..");
const PAGE = path.join(ROOT, "survivor.html");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const NEUTRAL_HFA = args.some(a => a === "--neutral-hfa=0") ? 0 : null;   // null = leave as-is

const die = m => { console.error("BUILD FAILED: " + m); process.exit(1); };
const readJSON = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

/* ---- locate the blob ------------------------------------------------------ */
const html = fs.readFileSync(PAGE, "utf8");
const MARK = "<script>window.SV=";
const start = html.indexOf(MARK);
if (start < 0) die("window.SV= not found in survivor.html");
if (html.indexOf(MARK, start + MARK.length) >= 0) die("window.SV= appears more than once");
const bodyStart = start + MARK.length;
const bodyEnd = html.indexOf("</script>", bodyStart);
if (bodyEnd < 0) die("window.SV block is not closed");
const oldRaw = html.slice(bodyStart, bodyEnd).trim().replace(/;$/, "");
let OLD;
try { OLD = JSON.parse(oldRaw); } catch (e) { die("existing window.SV is not JSON: " + e.message); }

/* ---- inputs --------------------------------------------------------------- */
const nfelo = readJSON("data/nfelo.json");
const sched = readJSON("data/nfl-schedule.json");
const ratings = nfelo.data && nfelo.data.ratings;
const nfeloGames = nfelo.data && nfelo.data.games;
const games = sched.data && sched.data.games;
if (!Array.isArray(ratings) || !ratings.length) die("data/nfelo.json has no data.ratings");
if (!Array.isArray(nfeloGames) || !nfeloGames.length) die("data/nfelo.json has no data.games");
if (!Array.isArray(games) || !games.length) die("data/nfl-schedule.json has no data.games");
if (sched.data.season !== OLD.meta.season)
  die(`schedule season ${sched.data.season} != snapshot season ${OLD.meta.season} — refusing to mix seasons`);

/* ⚠️ The calibration constants are NOT regenerated. elo_per_pt, hfa and sd are fitted
   model parameters, and the backtest figures (model_su / blend_su / market_su) are
   claims about a validation run. Neither is a weekly data fact, and silently refitting
   them from a schedule refresh would change what the page claims without anyone
   deciding to. They carry forward from the existing snapshot. */
const meta = {
  ...OLD.meta,
  captured: (nfelo.data.meta && nfelo.data.meta.captured) || nfelo.as_of || OLD.meta.captured,
  market_observed_at: (nfelo.data.meta && nfelo.data.meta.upstream_committed_at) || null,
  nfelo_sha: (nfelo.data.meta && nfelo.data.meta.sha) || OLD.meta.nfelo_sha,
};

/* ⚠️ nfelo's upstream still emits OAK for the Raiders; the canonical schedule, the
   snapshot and every other surface on this site say LV. The alias is deliberately a
   ONE-ENTRY map rather than a fuzzy matcher: an unrecognised code should stop the build
   loudly, because a silently-unmatched team is a team whose games get no rating and
   whose probabilities quietly become nonsense. */
const RATING_ALIAS = { OAK: "LV" };

const elo = {};
for (const r of ratings) {
  if (!r || typeof r.team !== "string" || typeof r.nfelo !== "number")
    die("a nfelo ratings row is missing team or nfelo");
  const code = RATING_ALIAS[r.team] || r.team;
  elo[code] = Math.round(r.nfelo * 10) / 10;   // the snapshot's own precision
}
const teamCount = Object.keys(elo).length;
if (teamCount !== 32) die(`expected 32 rated teams, got ${teamCount}`);
// every team the schedule plays must be rated, or the alias list is out of date
const scheduleTeams = new Set(games.flatMap(g => [g.home_team, g.away_team]));
const unrated = [...scheduleTeams].filter(t => elo[t] === undefined);
if (unrated.length)
  die(`the schedule plays ${unrated.join(", ")} but nfelo has no rating under that code — `
    + `check RATING_ALIAS against data/nfelo.json's team codes`);

/* ---- market prices: fresh nfelo mirror first, dated carry-forward second --- */
/* The fresh mirror joins to the canonical schedule id. The OLD snapshot still joins on
   canonical id AND on (week, home, away), because its ids use LA where the schedule uses
   LAR. Do not fuzzy-match either side. */
const oldByCanon = new Map(), oldByTeams = new Map();
for (const g of OLD.games) {
  oldByCanon.set(g.id, g);
  oldByTeams.set(`${g.wk}|${g.h}|${g.a}`, g);
}
const canonId = g => `${g.season}_${String(g.week).padStart(2, "0")}_${g.away_team}_${g.home_team}`;
const scheduleByCanon = new Map();
for (const g of games) {
  if (g.season_type && g.season_type !== "REG") continue;
  const id = canonId(g);
  if (scheduleByCanon.has(id)) die(`duplicate canonical schedule id ${id}`);
  scheduleByCanon.set(id, g);
}
const nfeloByCanon = new Map();
const NFELO_GAME_ALIAS = { OAK: "LV" };
const canonicalNfeloId = id => {
  const [season, week, away, home, ...rest] = id.split("_");
  if (rest.length || !season || !week || !away || !home) die(`malformed nfelo game id ${id}`);
  return `${season}_${week}_${NFELO_GAME_ALIAS[away] || away}_${NFELO_GAME_ALIAS[home] || home}`;
};
for (const g of nfeloGames) {
  if (!g || typeof g.id !== "string") die("a nfelo game row is missing id");
  const id = canonicalNfeloId(g.id);
  if (!scheduleByCanon.has(id)) die(`nfelo game id ${g.id} did not match the schedule`);
  if (nfeloByCanon.has(id)) die(`duplicate nfelo game id ${g.id}`);
  nfeloByCanon.set(id, g);
}

/* ⚠️ The game DATE is the Eastern local date, not a slice of the UTC timestamp.
   A Thursday 8:20pm ET kickoff is 00:20Z the NEXT day, so slicing the ISO string moves
   every night game forward a day — and the page prints this field. Caught by diffing a
   real write against the shipped snapshot; the --check tolerances below were not
   comparing `d` at all, which is why it looked clean. */
const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
function etDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) die(`unparseable kickoff_at: ${iso}`);
  return ET.format(d);
}
// fail loudly rather than silently emitting UTC dates on a runtime without full ICU
if (etDate("2026-09-10T00:20:00Z") !== "2026-09-09")
  die("this Node has no America/New_York timezone data — install full ICU before rebuilding");

let fresh = 0, carried = 0, neutralAdjusted = 0;
const out = [];
for (const g of games) {
  if (g.season_type && g.season_type !== "REG") continue;
  const h = g.home_team, a = g.away_team;
  if (elo[h] === undefined || elo[a] === undefined)
    die(`no nfelo rating for ${elo[h] === undefined ? h : a} (game ${g.game_id})`);

  const hfa = (g.neutral_site && NEUTRAL_HFA !== null) ? NEUTRAL_HFA : meta.hfa;
  if (g.neutral_site && NEUTRAL_HFA !== null) neutralAdjusted++;
  const mm = Math.round(((elo[h] - elo[a]) / meta.elo_per_pt + hfa) * 1000) / 1000;

  const canonical = canonId(g);
  const prior = oldByTeams.get(`${g.week}|${h}|${a}`) || oldByCanon.get(canonical);
  const mirrored = nfeloByCanon.get(canonical);
  const mirrorMk = mirrored && mirrored.market &&
    (mirrored.market.p_home_implied_close ?? mirrored.market.p_home_implied_open);
  const mk = mirrorMk ?? (prior && prior.mk != null ? prior.mk : null);
  const mk_src = mirrorMk != null
    ? "nfelo-mirror"
    : (mk != null ? (prior.mk_src || `carried:${String(prior.mk_obs || OLD.meta.captured).slice(0, 10)}`) : null);
  const mk_obs = mirrorMk != null
    ? (mirrored.market.observed_at || meta.market_observed_at)
    : (mk != null ? (prior.mk_obs || OLD.meta.captured) : null);
  if (mirrorMk != null) fresh++;
  else if (mk != null) carried++;

  out.push({
    // keep the snapshot's own id where one exists, so nothing quoting an id changes
    id: prior ? prior.id : canonId(g),
    wk: g.week, h, a,
    d: etDate(g.kickoff_at),
    mm,
    mk,
    mk_src,
    mk_obs,
    mk_book: null,
    // p and src are what the PAGE recomputes at the configured blend; the stored values
    // are the 0.75 default, which is what /data/survivor.json publishes.
    p: null, src: mk == null ? "model" : "market",
  });
}

/* p at the published 0.75 blend, using the page's own ncdf/nppf so the file and the
   page can never disagree about what 0.75 means. Lifted rather than re-derived. */
const lift = name => {
  const m = new RegExp(`\\nfunction ${name}\\s*\\(`).exec(html);
  if (!m) die(`could not lift ${name} from survivor.html — it was renamed`);
  const from = m.index + 1;
  let depth = 0, started = false;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) return html.slice(from, i + 1); }
  }
  die(`could not find the end of ${name}`);
};
const { ncdf, nppf } = new Function(lift("ncdf") + "\n" + lift("nppf") + "\nreturn {ncdf,nppf};")();
const BLEND = 0.75;
for (const g of out) {
  if (g.mk == null) { g.p = Math.round(ncdf(g.mm / meta.sd) * 10000) / 10000; continue; }
  const mkm = nppf(Math.min(Math.max(g.mk, 1e-6), 1 - 1e-6)) * meta.sd;
  g.p = Math.round(ncdf((BLEND * mkm + (1 - BLEND) * g.mm) / meta.sd) * 10000) / 10000;
}

const SV = { meta, elo, teams: OLD.teams, games: out };

/* ---- report and guard ------------------------------------------------------ */
const oldMarket = OLD.games.filter(g => g.mk != null).length;
const marketTotal = out.filter(g => g.mk != null).length;
const sourceCounts = out.reduce((acc, g) => {
  const key = g.mk_src === null ? "null" : g.mk_src;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
console.log(`teams        ${teamCount}`);
console.log(`games        ${out.length} (was ${OLD.games.length})`);
console.log(`market lines ${marketTotal}: ${fresh} nfelo mirror, ${carried} carried (snapshot had ${oldMarket})`);
console.log(`mk sources   ${Object.entries(sourceCounts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`captured     ${OLD.meta.captured} -> ${meta.captured}`);
if (neutralAdjusted) console.log(`neutral      ${neutralAdjusted} games rebuilt with hfa=0`);

if (out.length !== OLD.games.length)
  console.warn(`⚠️  game count changed — the schedule moved, which is real but worth eyeballing`);
/* ⚠️ A refresh must never LOSE captured market prices. That is the one way this script
   could quietly make the board worse while reporting success. */
if (marketTotal < oldMarket)
  die(`${oldMarket - marketTotal} captured market lines would be lost — refusing to write. `
    + `A schedule change moved a game the snapshot had a price for; reconcile by hand.`);

const upcomingWeek = nfelo.data.upcoming_week ?? Math.min(...nfeloGames.map(g => g.week));
console.log(`\nweek ${upcomingWeek} market/blend changes:`);
for (const g of out.filter(g => g.wk === upcomingWeek)) {
  const prior = oldByTeams.get(`${g.wk}|${g.h}|${g.a}`) || oldByCanon.get(g.id);
  console.log(`  ${g.a}@${g.h} mk ${prior && prior.mk != null ? prior.mk : "null"} -> ${g.mk ?? "null"}; `
    + `p ${prior && prior.p != null ? prior.p : "null"} -> ${g.p}; ${g.mk_src ?? "null"}`);
}

/* ---- diff against what is on the page -------------------------------------- */
/* ⚠️ EVERY field, exactly, and counted by field. The first version of this compared
   only mm and p, on loose tolerances, and reported "no differences" for a write that
   changed 247 of 272 rows — every game's date was moving by a day and nothing looked at
   it. A check that does not compare a field cannot report that field regressing. */
const diffs = [], byField = {};
const note = (f, msg) => { byField[f] = (byField[f] || 0) + 1; diffs.push(msg); };
for (const g of out) {
  const prior = oldByTeams.get(`${g.wk}|${g.h}|${g.a}`);
  if (!prior) { note("new", `NEW ${g.id}`); continue; }
  for (const f of ["id", "wk", "h", "a", "d", "src", "mk_src", "mk_obs", "mk_book"])
    if (prior[f] !== g[f]) note(f, `${f} ${g.id}: ${JSON.stringify(prior[f])} -> ${JSON.stringify(g[f])}`);
  if (Math.abs((prior.mm ?? 0) - (g.mm ?? 0)) > 0.005) note("mm", `mm ${g.id}: ${prior.mm} -> ${g.mm}`);
  if ((prior.mk ?? null) !== (g.mk ?? null)) note("mk", `mk ${g.id}: ${prior.mk} -> ${g.mk}`);
  if (Math.abs((prior.p ?? 0) - (g.p ?? 0)) > 0.0005) note("p", `p  ${g.id}: ${prior.p} -> ${g.p}`);
}
for (const g of OLD.games)
  if (!out.some(x => x.wk === g.wk && x.h === g.h && x.a === g.a)) note("gone", `GONE ${g.id}`);
for (const t of Object.keys(elo)) {
  if (OLD.elo[t] === undefined) diffs.push(`NEW TEAM ${t}`);
  else if (Math.abs(OLD.elo[t] - elo[t]) > 0.05) diffs.push(`elo ${t}: ${OLD.elo[t]} -> ${elo[t]}`);
}
console.log(diffs.length
  ? `\n${diffs.length} field(s) differ from the page  [` + Object.entries(byField).map(([k, v]) => `${k}:${v}`).join(" ") + `]`
  : `\nno differences — the page matches the inputs`);
diffs.slice(0, 25).forEach(d => console.log("  " + d));
if (diffs.length > 25) console.log(`  … and ${diffs.length - 25} more`);
/* ⚠️ mm carries a ~0.003 drift against the shipped snapshot because that blob was built
   from unrounded ratings while data/nfelo.json publishes them to one decimal. It moves
   no probability by more than 0.0001 and is reported rather than hidden, but it is why a
   rebuild is never byte-identical and should not be run as a no-op. */

if (CHECK) { console.log("\n--check: nothing written"); process.exit(0); }

const next = html.slice(0, bodyStart) + JSON.stringify(SV) + html.slice(bodyEnd);
fs.writeFileSync(PAGE, next);
console.log("\nwrote survivor.html");
console.log("NEXT: node tools/build-data.js survivor.json && node tools/data-manifest.js");
console.log("      and bump sw.js VERSION in the same commit.");
