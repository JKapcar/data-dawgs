# Shared Sleeper context and clear ESPN setup

Release state: implemented and locally verified; **not deployed**. Production's
`dd_war_room` already supports Yahoo/ESPN. The new Sleeper path and
`dd_fantasy_leagues` remain staged until the Worker and a personal connection are verified.

## Why this release exists

The War Room could load Sleeper while the external AI explicitly refused it.
The account already saves Sleeper league IDs and selected roster IDs through
`/auth/guillotine-state`; this release reads that shelf instead of adding a second
connection store. A roster choice is a viewing preference, not proof of ownership.

Matt's private ESPN screenshot also exposed a usability problem: auto-focusing
`espn_s2` on a phone could hide the explanation behind a keyboard. Setup now focuses
the explanation, gives a computer/finish-later choice, and shows ordered instructions
before the fields. A resumable link contains only provider and league ID. It contains
no cookies or account token. Failed clipboard access offers a selectable link.
Sign-in links preserve the league being connected; the next step is choosing a team.
AI connection is separately labeled optional.

## Shared data path

`warroom-sleeper.js` loads and normalizes public Sleeper data. The Worker assembles
that exact source, `warroom-weekly.js`, and `datadawg-default.js` with private roots.
There are no maintained forks of either calculation engine.

The website calls `GET /sleeper/warroom?leagueId=…&refresh=1`; the authenticated AI
calls the same `wrSleeperFeed`. The browser only hydrates Sets, Maps and player
references. Season default dollar inputs and custom board joins happen in the Worker.
Missing prices do not trigger an independent browser calculation for this feed.
The published default dollars currently cover 2026 only.

Anonymous requests can read public Sleeper context and default values. Supplying an
expired session never falls back to anonymous access. Custom dollar boards require
a valid session, as on the existing `/dd/values` route. Account-specific results
are not cached in public HTTP caches. Response headers say `private, no-store`.

The bounded memory cache keys include caller/public, provider, league, resolved
season and week. Context lasts at most 30 seconds. Opening or explicitly refreshing
a league bypasses that cache. Player metadata has its own five-minute cache;
season projections and default price inputs have one-hour caches. Every source
reports its actual fetch time separately. Errors never serve expired context as fresh.
The page discards in-flight results after league/account changes and clears account
results on sign-out or account change. Returning to Sleeper reloads its context.

## AI flow

1. Sign in to Data Dawgs, connect a league in the War Room, and choose a team.
2. For Sleeper, confirm the shelf reports it saved to the account.
3. Open the optional AI setup at `signon.html#connect` and use a personal connection.
4. `dd_fantasy_leagues` lists only that caller's saved Sleeper and connected ESPN/Yahoo
   records. It never returns credentials. Multiple ESPN scoped connections are included.
5. `dd_war_room` accepts `provider`, `league_id`, `season`, and `team_id` to select
   those saved records. It refuses ambiguity and an invalid team. A league ID does
   not provide a way to select another account's private connection.
6. Default scope returns rostered players. `scope: available` or `full` supports
   position filtering and bounded `limit`/`offset` pages. Available players sort by
   weekly projected points, with missing projections last; this is not a claim
   eligibility check or a waiver recommendation.

Sleeper's optional `week` must match its current week. Historical roster
reconstruction is not supported. Weekly points remain distinct from season dollars.
A selected team's candidate lineup uses the same optimizer as the Money sheet,
excluding IR/taxi. Actual starter slots, including empty slots, remain separate.
Game locks and injury availability are **not enforced**; these candidates are not
safe-to-submit instructions. The tools never submit lineups or claims.

## Provider coverage for this release

| Context | Sleeper shared feed | ESPN/Yahoo existing feeds |
|---|---|---|
| Rosters and actual starters | Included; bench, IR and taxi distinct | Existing provider roster/start-slot mapping |
| Weekly matchups and actual scores | Current provider rows, including playoff weeks | Expanded weekly context unavailable |
| Standings | Wins/losses/ties and points; official tiebreak order not reconstructed | Expanded standings coverage not claimed |
| Scoring and eligibility | Raw scoring, exact roster slots and positions | Existing normalized scoring/slots |
| Available players | Unrostered pool, paginated; claims/locks unknown | Existing pool minus rostered players |
| Transactions | Current week, with timestamps | Expanded transaction coverage unavailable |
| FAAB | Initial budget and used amount; spendable balance unknown after transfers | Not claimed |
| Waiver rules and deadlines | Raw settings and trade deadline week; exact timestamps unknown | Not claimed |
| Injury and bye context | Provider fields when reported; null means unknown | Not claimed |
| Season dollars | Shared custom/default joins with source dates and match counts | Existing custom-board joins; full default parity remains future work |
| Weekly lineup calculation | Existing shared optimizer; IR/taxi excluded; locks not enforced | Future work |

Guillotine survival, authoritative remaining FAAB, legal claim timing, automatic
injury substitutions, weekly ESPN/Yahoo analysis, dynasty future-value integration
in this AI result, and Fantrax are not delivered in this slice.

## Verification

- `work/test-sleeper-context.mjs`: assembled Worker and actual browser loader against
  shared fixtures; caller/league/season/week isolation, explicit selection, actual
  zero scores, missing/negative/zero projections, restricted flex, IR/taxi exclusions,
  page/AI price and projection parity, refresh/rollover/failures, available players,
  argument validation, private-board boundary, and sealed scoped ESPN discovery.
- `work/test-espn-setup.mjs`: explanation focus, instructions before inputs, safe
  resume link, clipboard fallback, and clearing sensitive values on dismissal.
- Existing ESPN, shelf, default valuation, weekly optimizer, UI isolation, MCP,
  identity, backup, capture and SwoleDawg regressions.
- Live public Sleeper adapter check on 2026-09-09: league 1400972302392262656,
  2026 week 1, 18 teams, 252 rostered players, 462 scored weekly projections and
  four current-week transactions. 26 source requests, approximately 17 seconds.
  This verifies provider data loading, not an authenticated production AI session.
- The cloud browser blocked the local preview URL. No successful visual preview or
  real personal AI call is claimed.

## Release gate

Deploy the Worker from the reviewed branch before merging the website change: the
new page depends on `/sleeper/warroom`. Verify actual tools/list and a personal
account's discovery/read path, plus website/AI league and price agreement. Test
private ESPN setup with the account holder, including expiry. Then remove
`dd_fantasy_leagues` from `MCP_STAGED`, update production coverage in
`tools/build-data.js` and `llms.txt`, rebuild `surfaces.json` and its manifest, bump
`sw.js`, and merge the Pages release. Never announce this expansion as live based
only on the source tree. Retain existing deployment bindings and secrets.

Public source references: [Sleeper API](https://docs.sleeper.com/) and
[Chrome cookie instructions](https://developer.chrome.com/docs/devtools/application/cookies).
