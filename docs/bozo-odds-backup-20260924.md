# Bozo odds capture repair — 2026-09-24

## Findings

Worker telemetry showed SGO HTTP 429 for submissions and hourly CFB collection. The
available error metadata does not establish whether the account hit a monthly object
quota or a shorter rate limit. Increasing retries does not repair that condition.

The paid The Odds API account and encrypted ODDS_API_KEY Worker binding already existed,
but Bozo never called them. A live request on September 24 returned 20,000 credits
remaining and zero used before this investigation. Live exact-event DraftKings requests
then succeeded for Buffalo, Detroit, and Clemson. The historical event endpoint also
worked. These provider responses are preserved in tests/fixtures/odds-api-*.json; no
credentials are present.

The remote browser could not load the public DraftKings menu and displayed Site
Unavailable. This does not establish why the owner's desktop can load it. Cloudflare's
dashboard challenge also looped; the already-authorized CI integration remained usable.

## Repair

- Prefer The Odds API for NFL/CFB full-game moneylines, spreads, and totals; request only
  DraftKings and the needed market family for the matched event.
- Include alternate spreads/totals and require both opposing prices at the exact selected
  number. Preserve Bozo's inverted spread representation.
- Keep SGO as the independent fallback, including props and period markets. Unsupported
  or absent quotes retain the existing unverified manual-entry path.
- Preserve provider, event id, and original provider timestamp in receipts and the ledger.
- Use a pre-kickoff historical snapshot when the closing cron arrives after kickoff.
  Reject in-play quotes, stale quotes, and mismatched numbers. Missing markets remain
  retryable during the existing capture window.
- Cache event discovery for 5 minutes and quotes for 30 seconds, without credentials in
  cache keys. Requests have bounded deadlines. Logs expose only status and numeric quota
  headers, never URLs containing keys.

Live event odds normally cost 1 credit for a moneyline or 2 for a main-plus-alternate
spread/total request with this single-book configuration. Historical requests cost more.
A simple 40-entry/week example, 2 credits per entry plus 2 per pregame close, is about
640 credits per four weeks before retries, validation previews, and historical recovery.
This is an illustration, not a guaranteed quota budget. The separate hourly CFB model
collector still uses SGO and is not changed by this repair.

Existing entries, manager verifications, submission times, and completed results are not
rewritten. The fallback improves future captures and upcoming closes.

## Verification and release

Seven new regression cases use captured provider fixtures, exercising exact alternate
pairs, CFB name mapping, source fallback, historical time boundaries, caching, and both
closing receipt destinations. All 25 local commands in the Worker deployment workflow
passed. The broader Bozo suite has eight pre-existing failing cases (16 repeated failure
lines), reproduced unchanged against the parent commit; they include missing test dependencies and pre-existing assertions for period markets,
standard deviations, and the page build gate.

Build from work/ with `node assemble.mjs`. The service-worker cache version accompanies
the page copy change. Deployment must follow docs/worker-deploy.md: upload and inspect a
version, then obtain the owner's explicit go-ahead before merging the live page changes
and promoting Worker traffic. No new subscription or secret rotation is required.
