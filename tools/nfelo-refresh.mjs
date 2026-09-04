/* Refresh the nfelo mirror from greerreNFL/nfelo's published output.
 *
 *   node tools/nfelo-refresh.mjs --check            # fetch, build, diff — write nothing
 *   node tools/nfelo-refresh.mjs                    # fetch, build, write nfelo.html blob + data/nfelo.json
 *   node tools/nfelo-refresh.mjs --from=DIR         # use an already-cloned upstream checkout (tests)
 *
 * ============================================================================
 * WHY THIS EXISTS
 *
 * data/nfelo.json was a one-time copy of upstream output at commit 0d3f8418 (2026-08-06).
 * Nothing in the repo ever went back for more. The daily nfl-data.yml cron installs
 * `nfelodcm`, which is Greer's SCHEDULE LOADER, not the model — so the repo looked like
 * it refreshed nfelo daily while the ratings and lines sat frozen. Upstream itself
 * auto-commits output_data/ every few hours.
 *
 * SOURCE OF TRUTH CHAIN (unchanged — this script feeds the top of it):
 *   upstream output_data/*.csv → window.NF blob in nfelo.html → tools/build-data.js
 *   scrapes the blob into data/nfelo.json. build-data.js is still the only writer of
 *   data/nfelo.json; this script rewrites the blob and then calls build-data.js.
 *
 * WHAT MOVES, WHAT DOES NOT
 *   ratings  <- output_data/elo_snapshot.csv (moves after each played week)
 *   games    <- output_data/nfelo_games.csv, current season rows
 *               (market lines move continuously; nfelo lines move with them)
 *   backtest (headline, calibration, seasons, ats) is PRESERVED from the existing blob.
 *            It is a dated 2009-2025 artifact computed once; recomputing it is a model
 *            change, not a refresh. Its own capture date is carried in meta.backtest_captured.
 *
 * PROVENANCE
 *   meta.sha / meta.upstream_committed_at pin the exact upstream state.
 *   meta.captured_at is when WE observed it. Every game row carries observed_at = the
 *   upstream commit time, because that is the last moment the line is known to have been
 *   current. This is the book+timestamp standard the survivor board did not meet.
 *
 * FAIL CLOSED: 32 ratings, every team code known, every game row has both teams and a
 * numeric nfelo probability, upstream SHA is a real 40-hex string. Any miss aborts with
 * nothing written.
 * ============================================================================ */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(ROOT, "nfelo.html");
const UPSTREAM = "https://github.com/greerreNFL/nfelo.git";
const SEASON = Number(process.env.NFELO_SEASON || 2026);

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const FROM = (args.find(a => a.startsWith("--from=")) || "").slice(7) || null;

const die = m => { console.error("NFELO REFRESH FAILED: " + m); process.exit(1); };

/* ---- 1. get upstream ------------------------------------------------------ */
function git(cwd, ...a) {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) die(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
let up = FROM;
if (!up) {
  up = fs.mkdtempSync(path.join(os.tmpdir(), "nfelo-"));
  const r = spawnSync("git", ["clone", "-q", "--depth", "1", UPSTREAM, up], { encoding: "utf8" });
  if (r.status !== 0) die("clone failed: " + r.stderr);
}
const sha = git(up, "rev-parse", "HEAD");
if (!/^[0-9a-f]{40}$/.test(sha)) die("upstream sha malformed: " + sha);
const upstreamCommittedAt = new Date(git(up, "log", "-1", "--format=%cI")).toISOString();
const capturedAt = new Date().toISOString();

const changelog = fs.readFileSync(path.join(up, "CHANGELOG.md"), "utf8");
const modelVersion = (changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
if (!modelVersion) die("could not read model version from CHANGELOG.md");

/* ---- 2. parse csv ---------------------------------------------------------- */
function csv(file) {
  const text = fs.readFileSync(path.join(up, "output_data", file), "utf8").replace(/\r/g, "");
  const [head, ...lines] = text.split("\n").filter(Boolean);
  const cols = head.split(",");
  return lines.map(l => {
    const cells = l.split(",");
    const o = {};
    cols.forEach((c, i) => { o[c] = cells[i] === undefined || cells[i] === "" ? null : cells[i]; });
    return o;
  });
}
const num = v => (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
const r1 = v => v === null ? null : Math.round(v * 10) / 10;
const r2 = v => v === null ? null : Math.round(v * 100) / 100;
const r4 = v => v === null ? null : Math.round(v * 10000) / 10000;

/* ratings — same shape the page already renders */
const KNOWN = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
  "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS", "OAK", "SD", "STL", "WSH", "LA",
]); // page normalises the legacy codes for display
const snap = csv("elo_snapshot.csv");
const ratings = snap.map(r => ({
  team: r.team,
  base: r1(num(r.nfelo_base)),
  qb: r1(num(r.qb_adj)),
  nfelo: r1(num(r.nfelo)),
  pts: r2(num(r.pts_vs_avg)),
})).sort((a, b) => b.nfelo - a.nfelo);
if (ratings.length !== 32) die(`elo_snapshot has ${ratings.length} rows, expected 32`);
for (const r of ratings) {
  if (!KNOWN.has(r.team)) die("unknown team code in elo_snapshot: " + r.team);
  if (r.nfelo === null || r.base === null) die("non-numeric rating for " + r.team);
}
const ratingsWeek = Number(snap[0].week);
const ratingsSeason = Number(snap[0].season);

/* games — current season only. Everything is carried as upstream names it,
   plus the compat fields nfelo.html already reads (h, a, spread, hwp, pick, p). */
const gamesRaw = csv("nfelo_games.csv").filter(g => g.game_id && g.game_id.startsWith(SEASON + "_"));
if (!gamesRaw.length) die(`no ${SEASON} rows in nfelo_games.csv`);
const games = gamesRaw.map(g => {
  const [season, week, a, h] = g.game_id.split("_");
  const nfeloClose = num(g.nfelo_home_line_close), nfeloOpen = num(g.nfelo_home_line_open);
  const mktClose = num(g.home_line_close), mktOpen = num(g.home_line_open);
  const hwp = num(g.nfelo_home_probability_close) ?? num(g.nfelo_home_probability_open);
  if (!KNOWN.has(h) || !KNOWN.has(a)) die("unknown team in game id " + g.game_id);
  if (hwp === null) die("no nfelo probability for " + g.game_id);
  const spread = mktClose ?? mktOpen ?? nfeloClose;
  return {
    id: g.game_id, week: Number(week), h, a,
    /* compat: what the page renders */
    spread: r1(spread),
    hwp: r4(hwp),
    pick: hwp >= 0.5 ? h : a,
    p: r4(hwp >= 0.5 ? hwp : 1 - hwp),
    /* structurally separate: model vs market */
    nfelo: {
      line_open: r1(nfeloOpen), line_close: r1(nfeloClose),
      p_home_open: r4(num(g.nfelo_home_probability_open)), p_home_close: r4(hwp),
      cover_home_close: r4(num(g.nfelo_home_cover_prob_close)),
    },
    market: {
      source: "as republished by greerreNFL/nfelo output_data/nfelo_games.csv; book not identified upstream",
      observed_at: upstreamCommittedAt,
      line_open: r1(mktOpen), line_open_price: [num(g.home_line_open_price), num(g.away_line_open_price)],
      line_close: r1(mktClose), line_close_price: [num(g.home_line_close_price), num(g.away_line_close_price)],
      total_open: r1(num(g.total_line_open)), total_close: r1(num(g.total_line_close)),
      p_home_implied_open: r4(num(g.home_implied_win_probability_open)),
      p_home_implied_close: r4(num(g.home_implied_win_probability_close)),
    },
  };
}).sort((x, y) => x.week - y.week || y.p - x.p);
const upcomingWeek = Math.max(...games.map(g => g.week));
const upcoming = games.filter(g => g.week === upcomingWeek);

/* ---- 3. read existing blob, preserve the backtest ------------------------- */
const html = fs.readFileSync(PAGE, "utf8");
const m = html.match(/<script>window\.NF=(\{[\s\S]*?\});<\/script>/);
if (!m) die("window.NF blob not found in nfelo.html");
const prev = JSON.parse(m[1]);
for (const k of ["headline", "calibration", "seasons", "ats"])
  if (!prev[k]) die("existing blob missing " + k);

const NF = {
  headline: prev.headline, calibration: prev.calibration, seasons: prev.seasons, ats: prev.ats,
  ratings,
  week1: upcoming, // compat key: the page's "projections" table reads this
  upcoming_week: upcomingWeek,
  games,
  meta: {
    sha: sha.slice(0, 8), sha_full: sha, repo: "greerreNFL/nfelo",
    captured: capturedAt.slice(0, 10), captured_at: capturedAt,
    upstream_committed_at: upstreamCommittedAt,
    model_version: modelVersion,
    ratings_as_of: { season: ratingsSeason, week: ratingsWeek },
    backtest_captured: prev.meta && prev.meta.backtest_captured || prev.meta && prev.meta.captured || null,
    refresh: "tools/nfelo-refresh.mjs, scheduled daily by .github/workflows/nfelo-refresh.yml",
  },
};

/* ---- 4. diff + write ------------------------------------------------------- */
const strip = o => { const c = JSON.parse(JSON.stringify(o)); delete c.meta; return JSON.stringify(c); };
const contentChanged = strip(prev) !== strip(NF);
const prevSha = prev.meta && (prev.meta.sha_full || prev.meta.sha) || "";
console.log(`upstream ${sha.slice(0, 8)} committed ${upstreamCommittedAt} (was ${prevSha.slice(0, 8) || "none"})`);
console.log(`ratings: ${ratingsSeason} W${ratingsWeek}; games: ${games.length} rows; upcoming week ${upcomingWeek} (${upcoming.length} games)`);
console.log(contentChanged ? "content CHANGED" : "content unchanged (meta only)");
if (CHECK) {
  const diffs = [];
  const prevG = new Map((prev.games || prev.week1 || []).map(g => [g.id || `${g.a}@${g.h}`, g]));
  for (const g of upcoming) {
    const o = prevG.get(g.id) || prevG.get(`${g.a}@${g.h}`);
    if (o && (o.spread !== g.spread || o.hwp !== g.hwp))
      diffs.push(`${g.a}@${g.h} spread ${o.spread}→${g.spread} hwp ${o.hwp}→${g.hwp}`);
  }
  console.log(diffs.length ? diffs.join("\n") : "no line/probability moves in upcoming week");
  process.exit(0);
}
if (!contentChanged && prevSha === sha) { console.log("nothing to write"); process.exit(0); }

let out = html.replace(m[0], "<script>window.NF=" + JSON.stringify(NF) + ";</script>");
out = out.replace(/(<h2>Power ratings &mdash; )\d{4} Week \d+(<\/h2>)/,
  `$1${ratingsSeason} Week ${ratingsWeek}$2`)
  .replace(/(<h2>)Week \d+ projections(<\/h2>)/, `$1Week ${upcomingWeek} projections$2`);
/* idempotent copy fix: the page used to describe itself as a frozen snapshot */
out = out.replace(
  "- ⚠️ IT IS A SNAPSHOT, NOT A FEED. Ratings are frozen at capture and will not move for an injury or a transaction until the next pull.",
  "- ⚠️ IT IS A DAILY MIRROR, NOT A LIVE FEED. tools/nfelo-refresh.mjs pulls upstream output once a day (meta.captured_at says when); lines can move after that, and ratings move only after games are played.",
);
fs.writeFileSync(PAGE, out);
console.log("wrote nfelo.html blob");

const bd = spawnSync("node", ["tools/build-data.js", "nfelo.json"], { cwd: ROOT, encoding: "utf8" });
if (bd.status !== 0) die("build-data.js failed:\n" + bd.stderr + bd.stdout);
console.log("wrote data/nfelo.json via tools/build-data.js");
