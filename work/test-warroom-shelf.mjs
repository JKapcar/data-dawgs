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
ok(html.includes('.wr-up,.wr-card .wr-up{color:var(--good)}'),
  "table surplus cells outrank the generic table-cell color");
ok(html.includes('.wr-down,.wr-card .wr-down{color:var(--bad)}'),
  "table deficit cells outrank the generic table-cell color");
ok(html.includes('id="meName"'), "landing includes optional Sleeper identity");
ok(html.includes('id="sheetAll"'), "all-leagues portfolio sheet exists");
ok(html.includes("{id:'all',label:'All Leagues',panel:'#sheetAll'}"), "portfolio is registered in navigation");
ok(html.includes('function pickMyTeam(teams,ref,users)'), "team identity resolution is explicit");
ok(/function pickMyTeam[\s\S]*focusRosterId[\s\S]*display_name[\s\S]*return 0/.test(html),
  "team resolution prefers saved roster, then identity, then fallback");
ok(html.includes("SHEETS.show(s==='all'?'all':lastLeagueSheet)"),
  "the scope toggle opens the portfolio and returns to the view you left");
ok(html.includes("$('flowNav').classList.toggle('wr-hide',s==='all')"),
  "scope 'all' hides the per-league tabs rather than leaving dead ones on screen");
ok(html.includes('data-open="') && html.includes('openLeague(b.dataset.provider,b.dataset.open)'),
  "the league menu opens a league by provider+id, never by parsing a composite value");
ok(html.includes('function withState(st,fn)'), "portfolio isolates each league calculation state");
ok(html.includes('ALL LEAGUES is a cross-league portfolio view'), "Toto states portfolio boundaries");
/* The nav rebuild's core contract: every view is a visible tab, and nothing that
   is not a view sits in the view switcher. Regressing either is what made the old
   row unnavigable — three of six views were hidden inside a <select>. */
ok(html.includes('id="flowNav"'), "the view switcher exists");
["report","standings","rosters","money","trades","dynasty"].forEach(id=>
  ok(new RegExp('<button type="button" data-flow="'+id+'"').test(html),
    "view '"+id+"' is a visible tab, not a dropdown entry"));
ok(!/<select[^>]*id="flow(League|More)"/.test(html),
  "no view is buried in a grouped <select>");
ok(html.includes('id="gearMenu"') && html.includes('data-sheet="settings"') && html.includes('data-sheet="method"'),
  "settings and method live in the gear menu, not in the view switcher");
ok(html.includes('id="sheetLeagues"') && html.includes("{id:'leagues',label:'Leagues',panel:'#sheetLeagues'}"),
  "league admin is its own sheet so My Team can open on the team");
ok(!/data-flow="leagues"/.test(html),
  "league admin is deliberately NOT a tab");
ok(/id="reset"/.test(html),
  "#reset survives the move into the gear menu — the forget-a-league path clicks it");
ok(html.includes('.sheetbar{display:none!important}'), "legacy nine-tab wall is hidden behind the compact navigation");
ok(html.indexOf('id="meName"') > html.indexOf('id="sheetSettings"'), "identity controls live in settings, not the landing hub");
ok(!html.includes('A pairing survives three gates'), "trade methodology is removed from the human-facing trade intro");

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
