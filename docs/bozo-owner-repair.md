# Owner pick ruling (first release)

This is a separate, explicit administrative ruling, not a quote capture or an
alternative way to mark a quote verified. It repairs the line and American price
of one existing placed spread or total. Event, market, side and member
remain fixed. The owner explicitly chooses `preserve` or `confirm_time` for the
pick timestamp. The confirmation time is always recorded separately.

## Authority and protocol

`GET /bozo/owner-repair` reports capability only to the pinned verified owner UID
with the existing `user.roles.site_admin === true` authority, resolved by the
normal signed HTTP session. A matching name, a nonowner administrator, legacy
name-only session, or top-level MCP role shape does not qualify. No roles,
credentials, security configuration or MCP permissions are changed.

`POST /bozo/owner-repair` proposal accepts only:

- `league`, exact member UID `forUid`
- numeric posted `line` (positive spread gets points, negative gives points), integer
  signed American `price`. The server converts a spread to the existing inverse
  required-margin storage convention; totals remain literal. Moneyline repair fails before preview because an unverified entry can block Worst Beat settlement.
- `timestampMode`: `preserve` or `confirm_time`
- `reason` (5–300 characters), `evidenceReference` (5–500 characters)
- `observedAt`: ISO timestamp with timezone, or null when unknown

Evidence is an owner-supplied reference or description of the ruling. It is never
fetched or treated as provider evidence. Do not enter credentials or sensitive
material: the action audit is visible with the league state.

Proposal returns old/new values, consequences, a five-minute confirmation code and
expiry. Confirmation accepts **only** `league`, `forUid`, `confirm`. It rechecks
session authority, full league version, schedule and eligibility; then atomically
replaces one pick and its canonical ledger entry projection, archives the original ledger version, and appends complete before/after receipts under both `audit`
and `admin/actions`, using a root ETag compare-and-swap. Retry the same code after
an uncertain response. Its durable receipt makes retries idempotent even after
the proposal expires. Old receipt replay never restores an older pick.

The page preserves pending proposals in tab-local session storage and reloads the
durable action history from league state. The UI never grants authority. Explicit
confirmation remains necessary after reload; discarding a preview does not write.

## Consequences and boundaries

- Preserving time keeps the recorded Last In timestamp. New confirmation time can
  change Last In exposure. Line and price affect future grading and shortest odds.
- `ledger/<rowKey>` is the current analytical projection, carrying the repaired
  selection, unverified entry and `entryRevision` equal to the ruling ID. Existing
  close and grade writers therefore append only to the matching current entry.
  `ledgerEntryHistory/<rowKey>/original` preserves the exact original row. Later
  repairs archive each preceding projection under its revision ID; these records
  are append-only and are not read as current CLV inputs. The audit carries both
  ledger versions. Unknown financial fields (stake, funding, wager references)
  are retained on the projection; only entry/analytical fields are replaced.
  `/bozo/clv` exposes the revision, history reference and owner-ruling provenance,
  including after week rollover. Old supplemental entryCapture and verification
  evidence survive only in the archived originals, never on the repaired pick.
- For a season/week containing an owner ruling, rank, Last In and shortest-odds
  exposure are derived at read time from **all** current ledger entry projections.
  The player sheet, CLV API and MCP standings use the same calculation. It does
  not overwrite other members' stored ranks, original receipts or financial rows.
  Timestamp ties share competition rank and Last In exposure; price ties share
  shortest-odds exposure. Missing group inputs leave the corresponding derived
  values unknown. Legacy weeks retain their original semantics. The player sheet
  labels the revised basis and uses that historical week's entries, not today's
  roster size, to count Last In.
- The repaired pick has `priceSource: owner_ruling`, `verificationStatus:
  unverified`, `clvEligible: false`, and no opposite entry price, no-vig facts,
  provider quote timestamp or inherited entry-verification receipt. Owner-entered,
  observed and confirmed times remain distinct. Future genuine close capture is
  still possible, but cannot invent a verified entry pair.
- Draw, lock, other picks, other ledger rows, stakes, funding, existing results and
  elimination decisions are untouched. Original picks remain in every audit
  generation; financial and settlement fields cannot be supplied in the request.
- First release requires a placed, unsettled ticket, original ledger receipt,
  active member and future verified schedule for **every** ticket game. Existing
  grading, close data, eliminated members and unsupported prop markets fail closed.
  No paid odds calls, provider receipts, purchases or external wagers occur.
- This owner ruling does not apply normal entry price-band or duplicate-selection
  rules. It accepts posted lines with absolute value up to 10,000 and whole
  American prices with absolute value 100–100,000. These are explicit owner
  overrides for a game record, not a claim that a sportsbook would accept the pick.
- The existing provider-verified `/bozo/correct-pick` HTTP/MCP route is unchanged.

Broader controls (post-kickoff rulings, different events/sides, props, settlement
repairs, ledger reconciliation or rule changes) require separately scoped designs
and explicit consequences. This capability is not arbitrary database access.

## Verification and release

Run `node --test tests/bozo-owner-repair.test.cjs tests/bozo-correction.test.cjs`.
Run `node tests/bozo-owner-repair.browser.cjs` with `PLAYWRIGHT_MODULE` pointing to
an installed Playwright module and, if necessary, `CHROMIUM_PATH` to a browser.
The browser harness extracts the actual panel and controller with synthetic state;
all requests are intercepted. It is not an end-to-end production session test.

Worker assembly (`cd work; node assemble.mjs`), syntax, relevant Bozo regressions
and service-worker stamping/verification must pass. Review the exact capability
before merging or deploying; a draft PR does not activate it. No live repair is
part of these tests. After approved release, verify both deployed surfaces before
performing any separately approved live ruling through the owner UI.

Validation on 2026-10-29 against `b1f4b9a2`: 53 owner-repair tests passed (including repair → close → grade → CLV → week rollover);
browser fixture passed at 390px and 1280px; identity 144/144 and MCP 466/466 passed.
The broad Bozo suite with jsdom available passed 469/476. The same seven failures
reproduced on untouched main (416/423): two lever-standings expectations, one
period-market capture source expectation and four roster-anytime tests whose
requests omit the required client build. Initial runs also lacked jsdom (three
load failures); installing the local dependency resolved those in both checkouts.
Data validation passed with 42 existing warnings. No live account or ticket was
used in testing.

Review follow-up: moneylines fail closed at preview; spread/total projections remain unverified through real close mutation, grade commit and CLV read-model functions. Diagnostics browser QA passed locally at 390/1280px in both light/dark themes; the prior GitHub Linux trend-disclosure timeout is tracked separately, not claimed fixed by these data changes.

The follow-up focused repair/correction/service-worker run passed 100/100. The exact diagnostics test also passed on untouched main in all four viewport/theme combinations; the Linux CI-only timeout is not claimed resolved. Pending proposals carry protocolVersion 2 so a preview from the earlier ledger semantics cannot confirm under this revision.

Historical-analytics follow-up: 53 owner-repair tests, 111 focused checks and 466 MCP checks passed. Tests execute the actual player-sheet renderer and MCP standings after a three-pick timestamp/price repair, including historical roster changes, immutable other rows, ties and missing inputs. CI on prior head 910a65c6 completed successfully (Worker validation and both site-check jobs), including the previously failing Linux diagnostics step. Fresh CI is required for this read-projection follow-up.
