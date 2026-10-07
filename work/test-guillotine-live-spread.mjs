/* Live-blend spread regression: one unplayed QB must carry a QB's spread.
   Extracts liveCalibration/leftOf/applyLive from ../guillotine.html and runs them
   against stubbed Sleeper matchups + weekly feed + calibration. No network.
   Run: cd work && node test-guillotine-live-spread.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "../guillotine.html"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (d ? " — " + d : "")); } };

const a = html.indexOf("  var FEED_STALE = null;"), b = html.indexOf("  function projRows");
ok("live blend block found", a > 0 && b > a);
const block = html.slice(a, b);

const NOW = Date.parse("2026-10-05T23:00:00Z");           // Monday, before MNF kickoff
const done = "2026-10-04T17:00:00Z", mnf = "2026-10-06T00:15:00Z";
const QB = { pass_yd: 261, pass_td: 1.63, pass_int: 1.15, fum_lost: 0.21, rush_yd: 19.9, rush_td: 0.16 };
const scoring = { pass_yd: 0.04, pass_td: 4, pass_int: -1, fum_lost: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 };
const players = [{ id: "QB1", position: "QB", opponent: "ATL", kickoff: mnf, has_projection: true, stats: QB }];
for (let i = 2; i <= 8; i++) players.push({ id: "P" + i, position: "WR", opponent: "X", kickoff: done, has_projection: true, stats: { rec: 5, rec_yd: 60 } });
for (let i = 1; i <= 8; i++) players.push({ id: "C" + i, position: "WR", opponent: "X", kickoff: done, has_projection: true, stats: { rec: 5, rec_yd: 60 } });
const baler = { roster_id: 10, starters: ["QB1","P2","P3","P4","P5","P6","P7","P8"], players_points: { QB1: 0, P2: 7, P3: 7, P4: 7, P5: 7, P6: 7, P7: 5, P8: 3.3 } };
const coman = { roster_id: 18, starters: ["C1","C2","C3","C4","C5","C6","C7","C8"], players_points: { C1: 9, C2: 9, C3: 9, C4: 9, C5: 9, C6: 9, C7: 9, C8: 5.7 } };
const cal = { league_calibrations: { "1400972302392262656": { buckets: { "QB:high": { sd: 7.63 }, QB: { sd: 7.6 }, "WR:mid": { sd: 6.7 }, WR: { sd: 6.1 } } } } };

async function run(withCal, feed, week) {
  const fetch = async (u) => ({ ok: withCal, json: async () => ({ data: cal }) });
  const jget = async () => [baler, coman];
  const weekRows = async () => (feed || { season: 2026, week: 4, players });
  const scoreWeekly = (st, sc) => { let t = 0; for (const k in st) t += (st[k] || 0) * (sc[k] || 0); return t; };
  const PROJ_SD = 21;
  const AbortSignal = { timeout: () => undefined };
  const fn = new Function("fetch","jget","weekRows","scoreWeekly","PROJ_SD","AbortSignal","Date",
    block + "\nreturn {applyLive, stale: () => FEED_STALE};");
  const D = class extends Date {}; D.now = () => NOW;
  const { applyLive, stale } = fn(fetch, jget, weekRows, scoreWeekly, PROJ_SD, AbortSignal, D);
  const rows = [{ rid: 10, sd: 16.4 }, { rid: 18, sd: 25.3 }];
  const live = await applyLive({ season: "2026", scoring_settings: scoring }, "1400972302392262656", week || 4, rows);
  return { live, rows, stale: stale() };
}
const Phi = z => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z ** 3)));
{
  const { live, rows } = await run(true);
  const [B, C] = rows;
  ok("blend applied", live && B.live && C.live);
  ok("Baler mean = banked 43.3 + QB projection", Math.abs(B.mean - (43.3 + 18.7)) < 0.6, "mean=" + B.mean.toFixed(2));
  ok("finished team has no spread left", C.sd <= 0.1001, "sd=" + C.sd);
  ok("one unplayed QB carries the QB spread (7.63), not 16.4/8", Math.abs(B.sd - 7.63) < 0.01, "sd=" + B.sd);
  const surv = 1 - Phi((68.7 - B.mean) / B.sd);
  ok("Baler's survival is a real number, not ~0%", surv > 0.10 && surv < 0.30, (100 * surv).toFixed(1) + "%"); console.log("     Baler survival:", (100*surv).toFixed(1)+"%", " old-formula sd:", (16.4/8).toFixed(2), " old survival:", (100*(1-Phi((68.7-B.mean)/(16.4/8)))).toFixed(2)+"%");
}
{
  const { rows } = await run(false);
  ok("no calibration: falls back to sd*sqrt(left)", Math.abs(rows[0].sd - 16.4 * Math.sqrt(1 / 8)) < 0.01, "sd=" + rows[0].sd);
}
/* Stale feed: Tuesday after Sleeper rolls to week 5, the daily file is still week 4 and
   every kickoff in it is in the past. The blend must REFUSE, not flatten everyone to sd 0.1. */
{
  const { live, rows, stale } = await run(true, { season: 2026, week: 4, players }, 5);
  ok("stale feed (week 4 vs week 5): no blend applied", live === null);
  ok("stale feed: rows left on pre-kickoff basis", rows[0].sd === 16.4 && rows[1].sd === 25.3 && rows[0].live !== true, "sd=" + rows[0].sd + "," + rows[1].sd);
  ok("stale feed: FEED_STALE says which week it is", stale && stale.feedWeek === 4 && stale.want === 5, JSON.stringify(stale));
}
{
  const { live } = await run(true, { season: 2025, week: 4, players }, 4);
  ok("wrong season: no blend applied", live === null);
}
{
  const { live } = await run(true, { players }, 4);
  ok("unlabeled feed (no week): no blend applied", live === null);
}
{
  const { live, stale } = await run(true, { season: 2026, week: 4, players }, 4);
  ok("matching feed: blend applied, nothing flagged stale", live && live.week === 4 && stale === null);
}
console.log("\nlive-spread: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
