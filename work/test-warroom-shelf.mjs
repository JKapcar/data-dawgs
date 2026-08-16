import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../fantasy-warroom.html", import.meta.url), "utf8");
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };

ok(html.includes('id="shelfState"'), "landing shows persistence status");
ok(html.includes('id="savedList"'), "landing shows the league shelf");
ok(html.indexOf('id="connectForm"') < html.indexOf('class="wr-grid wr-needs-league"'),
  "add-league form precedes the generic empty-state explanation");
ok((html.match(/id="connectForm"/g) || []).length === 1, "one add-league form");
ok((html.match(/id="savedList"/g) || []).length === 1, "one saved-league shelf");
ok(html.includes("SHARED_SHELF='dd-guillotine-leagues-v1'"), "War Room shares the fantasy shelf");
ok(html.includes("/auth/guillotine-state"), "signed-in shelf uses the deployed account route");
ok(/rememberLeague[\s\S]*saveAccountShelf\(\)/.test(html), "connecting queues account persistence");
ok(/data-forget[\s\S]*saveAccountShelf\(\)/.test(html), "removing queues account persistence");
ok(/teamPicker[\s\S]*focusRosterId[\s\S]*saveAccountShelf\(\)/.test(html), "focus team persists");
ok(html.includes("addEventListener('dd-auth',loadAccountShelf)"), "sign-in refreshes the shelf");
ok(!html.includes('SAVED LEAGUES LIVE IN THIS BROWSER ONLY'), "Toto no longer claims device-only storage");
ok(!html.includes('account sync of the saved league list'), "Method no longer calls sync unbuilt");
ok(html.includes('sync privately through the Worker and follow the account across devices'),
  "Toto states the signed-in persistence boundary");

const start = html.indexOf("function cleanShelf(raw)");
const end = html.indexOf("function stored(key)", start);
ok(start >= 0 && end > start, "cleanShelf implementation is extractable");
const cleanShelf = new Function(html.slice(start, end) + ";return cleanShelf;")();
const cleaned = cleanShelf([
  { leagueId: "111111111111111111", name: "Alpha", focusRosterId: 3, savedAt: 5 },
  { leagueId: "222222222222222222", name: "222222222222222222", focusRosterId: null, savedAt: 9 },
  { leagueId: "111111111111111111", name: "111111111111111111", focusRosterId: null, savedAt: 8 },
  { leagueId: "bad", name: "Invalid" },
]);
assert.equal(cleaned.length, 2); checks++;
assert.equal(cleaned[0].leagueId, "222222222222222222"); checks++;
assert.equal(cleaned[1].name, "Alpha"); checks++;
assert.equal(cleaned[1].focusRosterId, 3); checks++;

console.log(`warroom shelf contract: ${checks} passed`);
