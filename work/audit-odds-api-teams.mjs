// Usage: ODDS_API_KEY from the environment; optional --fixtures=tests/fixtures/odds-api-teams-YYYYMMDD
// Offline: --offline=<directory containing nfl-participants.json and cfb-participants.json>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {BOZO_ESPN_TEAM_SEED} from '../bozo-team-registry.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'dawg-bot-worker.js'), 'utf8');
const ctx = {BOZO_ESPN_TEAM_SEED};
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('const bzNorm ='), src.indexOf('/* ---------------- period markets')) + '\nthis.registry=bozoBuildTeamRegistry;this.norm=bozoTeamNorm;', ctx);
const option = name => process.argv.find(a => a.startsWith(name+'='))?.slice(name.length+1);
const offline = option('--offline'), out = option('--fixtures');
if (!offline && !process.env.ODDS_API_KEY) throw Error('Set ODDS_API_KEY in the environment, or use --offline.');
let missing = 0;
for (const [sport, provider] of [['cfb','americanfootball_ncaaf'], ['nfl','americanfootball_nfl']]) {
  let participants;
  if (offline) participants = JSON.parse(fs.readFileSync(path.join(offline, sport+'-participants.json')));
  else {
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${provider}/participants`);
    url.searchParams.set('apiKey', process.env.ODDS_API_KEY);
    const response = await fetch(url, {signal:AbortSignal.timeout(10000)}).catch(() => {throw Error('Participants request failed');});
    if (!response.ok) throw Error(`Participants HTTP ${response.status}`);
    participants = await response.json();
    if (out) {fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,sport+'-participants.json'),JSON.stringify(participants,null,2)+'\n');}
  }
  if (!Array.isArray(participants)) throw Error('Expected participants array');
  const aliases = ctx.registry(sport).aliases, canonical = new Set(Object.values(aliases));
  for (const row of participants) {
    const name = typeof row === 'string' ? row : row.full_name || row.name;
    if (!name || !canonical.has(ctx.norm(name, aliases))) {missing++;console.log(JSON.stringify({sport,name:name || row}));}
  }
}
console.log(`${missing} unresolved provider names (explicit aliases required; no fuzzy matching)`);
process.exitCode = missing ? 1 : 0;
