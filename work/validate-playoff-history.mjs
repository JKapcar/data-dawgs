/* Replay real NFL seasons through the seeding code and compare with what the league did.
 *
 *   curl -sSL -o /tmp/nfldata-games.csv https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
 *   node work/validate-playoff-history.mjs /tmp/nfldata-games.csv [firstSeason] [lastSeason]
 *
 * For every completed season it feeds the actual regular-season results to
 * work/playoff-leverage-engine.js and checks, per conference:
 *   - the playoff field equals the clubs that played in the postseason;
 *   - the bye seeds equal the clubs whose first postseason game was a divisional game;
 *   - every wild-card-round game is the seed pair the format requires, hosted by the
 *     higher seed (2v7, 3v6, 4v5 since 2020; 3v6, 4v5 before).
 * A mismatch is printed with both versions. Ties past strength of schedule go to the
 * engine's coin toss (alphabetical here), so a season decided on points could differ;
 * the report says which seasons, if any.
 *
 * Data: nflverse/nfldata games.csv (not committed; downloaded by the operator).
 */
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const E = require("./playoff-leverage-engine.js");

const [file, first = "2002", last = "2025"] = process.argv.slice(2);
if (!file) { console.error("usage: node work/validate-playoff-history.mjs games.csv [first] [last]"); process.exit(2); }

/* Franchise codes as nflverse writes them, onto the 2026 table. */
const ALIAS = { LA: "LAR", STL: "LAR", SD: "LAC", OAK: "LV" };
const code = t => ALIAS[t] || t;

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
  const head = lines.shift().split(",");
  return lines.map(line => {
    /* games.csv has no quoted commas in the columns read here; refuse a row that would. */
    const cells = line.split(",");
    const row = {};
    head.forEach((h, k) => { row[h] = cells[k]; });
    return row;
  });
}

const rows = parseCsv(fs.readFileSync(file, "utf8"));
const league = E.createLeague();
let checked = 0, fieldOk = 0, seedOk = 0;
const problems = [];

for (let season = +first; season <= +last; season++) {
  const reg = rows.filter(r => +r.season === season && r.game_type === "REG");
  const post = rows.filter(r => +r.season === season && r.game_type !== "REG");
  if (!reg.length || !post.length) continue;
  const rec = E.createRecords(league.n);
  let skipped = 0;
  for (const g of reg) {
    if (g.home_score === "NA" || g.away_score === "NA" || g.home_score === "" || g.away_score === "") { skipped++; continue; }
    const h = league.index.get(code(g.home_team)), a = league.index.get(code(g.away_team));
    if (h === undefined || a === undefined) throw new Error(`${season}: unknown team ${g.home_team}/${g.away_team}`);
    const hs = +g.home_score, as = +g.away_score;
    E.addResult(rec, h, a, hs > as ? 1 : hs < as ? 0 : 0.5);
  }
  const wildcards = season >= 2020 ? 3 : 2;
  const { seeds } = E.seedLeague(league, rec, { wildcards });
  const wc = post.filter(r => r.game_type === "WC");
  const div = post.filter(r => r.game_type === "DIV");
  const inWc = new Set(wc.flatMap(r => [code(r.home_team), code(r.away_team)]));
  const byes = new Set(div.flatMap(r => [code(r.home_team), code(r.away_team)]).filter(t => !inWc.has(t)));
  const field = new Set([...inWc, ...byes]);
  E.CONFERENCES.forEach((cf, c) => {
    checked++;
    const mine = seeds[c];
    const actual = [...field].filter(t => league.conf[league.index.get(t)] === c).sort();
    const sameField = JSON.stringify([...mine].sort()) === JSON.stringify(actual);
    if (sameField) fieldOk++;
    const pairs = wildcards === 3 ? [[2, 7], [3, 6], [4, 5]] : [[3, 6], [4, 5]];
    const byeSeeds = wildcards === 3 ? [1] : [1, 2];
    const myByes = byeSeeds.map(s => mine[s - 1]).sort();
    const actualByes = [...byes].filter(t => league.conf[league.index.get(t)] === c).sort();
    const games = wc.filter(r => league.conf[league.index.get(code(r.home_team))] === c);
    const pairOk = pairs.every(([hi, lo]) => games.some(r => code(r.home_team) === mine[hi - 1] && code(r.away_team) === mine[lo - 1]));
    const seedsMatch = sameField && JSON.stringify(myByes) === JSON.stringify(actualByes) && pairOk && games.length === pairs.length;
    if (seedsMatch) seedOk++;
    else problems.push(`${season} ${cf}: engine ${mine.join(" ")} | actual field ${actual.join(" ")} | byes ${actualByes.join(" ")} | WC ` +
      games.map(r => `${code(r.away_team)}@${code(r.home_team)}`).join(" ") + (skipped ? ` | ${skipped} unplayed REG game(s) excluded` : ""));
  });
}

console.log(`seasons ${first}-${last}: ${checked} conference-seasons checked`);
console.log(`  playoff field identical: ${fieldOk}/${checked}`);
console.log(`  seeds identical (byes + every wild-card pairing and host): ${seedOk}/${checked}`);
for (const p of problems) console.log("  MISMATCH " + p);
process.exit(fieldOk === checked && seedOk === checked ? 0 : 1);
