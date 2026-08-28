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

assert.match(shared, /#ddLeagueIndicator,#ddbLaunch,#ddmeChip,\.udfoot\{display:none!important\}/);
assert.doesNotMatch(shared, /bar\.innerHTML=`<span class="ddli-name"/);

console.log("ok  league settings replaces draft-rig floating controls");
