const assert = require("assert");
const fs = require("fs");

const dashboard = fs.readFileSync("dashboard.html", "utf8");
const leagues = fs.readFileSync("draft-leagues.html", "utf8");
const shared = fs.readFileSync("draft-league.js", "utf8");

assert.doesNotMatch(dashboard, /class="dbsetup"[^>]*>Switch league/i);
assert.match(dashboard, /data-v="settings">League Settings/);
assert.match(dashboard, /settings:\s*\{src:"draft-leagues\.html\?embed=1"/);
assert.match(dashboard, /class="tierchip" data-tier="dawg" hidden/);

for (const field of ["settingsName", "settingsDraftType", "settingsBudget", "settingsSlots",
  "settingsScoring", "settingsPpr", "settingsTeams"]) {
  assert.match(leagues, new RegExp(`id="${field}"`), `${field} is missing`);
}
assert.match(leagues, /data-order/);
assert.match(leagues, /Existing picks stay attached to the correct team/);
assert.match(leagues, /\(state\.picks\|\|\[\]\)\.forEach\(p=>\{p\.ti=remap\(p\.ti\);\}\)/);
assert.match(leagues, /DDLeague\.publishLeague\(updated,state\|\|DDLeague\.stateFromLeague\(updated\)\)/);
assert.match(leagues, /const teams=effectiveTeams\(league,state\)/,
  "settings does not mirror the active draft team's names");
assert.match(leagues, /old\.config\.teams\.concat\(previousTeams\)/,
  "saving does not reconcile live team data back into the league definition");
assert.match(leagues, /id:team\.id\|\|durable\.id\|\|`team_\$\{index\+1\}`/,
  "legacy live teams without IDs do not receive stable league IDs");
assert.match(leagues, /parent\.postMessage\(\{dd:"height",h:Math\.ceil\(document\.documentElement\.scrollHeight\)\}/,
  "embedded settings never reports its full height to the dashboard");
assert.match(leagues, /event\.data\.dd!=="theme"/,
  "embedded settings does not accept the dashboard theme");
assert.match(leagues, /:root\[data-theme="light"\]/,
  "league settings has no light-theme palette");

assert.match(shared, /#ddLeagueIndicator,#ddbLaunch,#ddmeChip,\.udfoot\{display:none!important\}/);
assert.doesNotMatch(shared, /bar\.innerHTML=`<span class="ddli-name"/);

console.log("ok  league settings replaces draft-rig floating controls");
