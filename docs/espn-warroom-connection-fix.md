# ESPN War Room connection repair — 2026-09-09

## Confirmed failure

The deployed War Room parsed Matt’s ESPN URL correctly but called the account’s saved `/espn/warroom` feed without connecting or transmitting the requested league ID. Numeric input was classified as Sleeper. An existing ESPN connection could consequently be displayed under a different requested league ID.

ESPN’s unauthenticated settings endpoint returned HTTP 401 and `AUTH_LEAGUE_NOT_VISIBLE` for league 1396311343 in season 2026. This verifies that this league needs authorized access; it does not verify its rosters or a successful private import.

League Loom documents the same ESPN access method: public URL access and private `espn_s2` / `SWID` cookies. Reference: https://leagueloom.com/espn and https://leagueloom.com/espn-s2-swid . This patch implements that connection sequence in the existing War Room; it does not copy or depend on League Loom server code.

## Changes

- Connect and authorize ESPN inside the War Room, then select your team through the existing team gate.
- Preserve saved ESPN credentials, retry using only the caller’s existing session where available, and request replacement credentials only when access requires them.
- Key War Room connections and share pointers by account, league and season. Read legacy connections only when their league and season match. Preserve the draft room’s original default connection when adding another league.
- Validate ESPN response identity both at the upstream boundary and in the browser adapter. Reject mismatches before rendering or saving a league.
- Keep existing Sleeper URL and long numeric-ID handling. Require a platform choice for ambiguous short numeric IDs. Accept short ESPN IDs on the device shelf.
- Clear cookie fields on submission; store credentials encrypted on the Worker. The legacy Disconnect control removes all account ESPN connections, while scoped disconnect removes only the selected league and its shares.
- Scope new share links and guard against a delayed share-status response repainting a different league.
- Keep the War Room on its existing 2026 pricing/projection season; reject an explicitly different ESPN season.

## Verification

`node work/test-espn-connections.mjs` exercises the actual Worker routes and browser adapter with synthetic upstream fixtures, including public/private setup, session reuse, encryption, account/league/season isolation, mismatch rejection, shares, revocation, and URL/ID routing. It also parses every executable inline War Room script.

Existing provider, ESPN, shelf, stale-response isolation, weekly valuation, Worker identity/MCP/backup/SwoleDawg/CFB, and data-validation checks pass locally. The new regression suite is included in Worker PR and deployment CI gates.

Live Sleeper checks returned DawgPound Royale settings, 18 users and 18 rosters. No authenticated browser import of Matt’s private ESPN league was performed.

## Release ordering

The Worker changes must serve before the frontend changes are published. An old Worker ignores the new query parameters; do not publish only the page/provider changes. Upload and verify the branch Worker with the full production manifest, then promote it under the Worker deployment runbook before merging the frontend release. Preserve concurrent changes on main and regenerate the service-worker stamp if rebasing changes root HTML/JS.

No production traffic or account credentials were changed during preparation.
