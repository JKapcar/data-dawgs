// Run after tools/nfelo-refresh.mjs: test the actual upstream-derived snapshot.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const nf = JSON.parse(fs.readFileSync('data/nfelo.json')).data;
const schedule = JSON.parse(fs.readFileSync('data/nfl-schedule.json')).data.games;
const teams = new Set(schedule.flatMap(g => [g.home_team, g.away_team]));
const builder = fs.readFileSync('work/build-survivor-snapshot.mjs', 'utf8');
for (const [name, codes] of [
  ['RATING_ALIAS', nf.ratings.map(r => r.team)],
  ['NFELO_GAME_ALIAS', nf.games.flatMap(g => g.id.split('_').slice(2))],
]) {
  const literal = builder.match(new RegExp(`const ${name} = (\\{[^;]+\\});`));
  assert(literal, `Missing ${name}`);
  const aliases = Function(`return (${literal[1]})`)();
  for (const code of new Set(codes)) assert(teams.has(aliases[code] || code), `${name} missing ${code}`);
  console.log(`${name}: all ${new Set(codes).size} upstream codes covered (${nf.meta.sha_full})`);
}
// Also exercise exact game-id matching and every schedule team's rating.
execFileSync(process.execPath, ['work/build-survivor-snapshot.mjs', '--check'], {stdio:'inherit'});
