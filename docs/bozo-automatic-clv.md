# Automatic CLV policy and repair

Effective policy: `selected-side-fallback-v1` (owner request, 2026-11-06).

`bozo-effective-clv.js` is the single calculation implementation. The assembler embeds
the same bytes into the Worker; the page loads that file. The canonical ledger retains
original entry and closing evidence. Current results remain a compatibility projection
for grading. No migration deletes or rewrites original prices, stakes, results or history.
Royale reads matching ledger closing evidence before the compatibility projection and
checks event, selection, entry price and submission time. Derived values are not another
editable table. The CLV endpoint exposes `effectiveClv` and `clvUsable`.

Precedence: explicit existing manager override; valid paired measured CLV; existing
non-stale sourced estimate/convention; selected-side approximation; missing.
Approximation is `100 * (implied(close) - implied(entry))`, in probability percentage
points. It includes bookmaker margin, is labeled estimated, and does not manufacture an
opposite price or mark an unverified entry as verified. A zero is calculated only from
equal selected prices or an existing explicit override/convention. A missing close is
not zero. A reached Royale CLV lever requires evidence for every losing leg, preventing
elimination based on a selectively covered subset. Existing terminal-result checks and
the pre-drawn lever order remain in force.

The manager agent-close workflow accepts an optional opposite price, exact player
props and custom markets. Props require the ledger's selection key, prop identity,
period, side and line; custom markets also require the exact ledger label. Free
cross-book observations retain their actual bookmaker and resolve as estimates.
The observed page, read time and kickoff remain evidence. Pregame reads are staged and
promoted by the existing five-minute Worker job. An existing single-sided close is
preserved. Agent observations are closing proxies, not a claim of final book close.

Bozo's Odds API gate is closed even if a key or old paid-enable flag exists. The existing
ESPN keyless source, staged agent observations, and configured SGO free-close route remain.
No account, subscription, credential or runtime configuration changes are part of this
release. The existing owner pregame capture automation now runs hourly on every day,
using the supported capture-only write and readback, with free public search and no SGO
calls from the automation. The separate Thursday job is paused to avoid duplicate runs.
Unsupported or unmatched market evidence remains missing, never invented.

Free ESPN reads are deduplicated by exact selection per run, and successful pregame
quotes get durable receipts before ledger updates. Failed/concurrent ledger writes can
replay those quotes for the existing 20-minute stale window after kickoff without fetching
in-play odds. Empty ticks update health. Per-leg database reads were removed; final
league writes still use the existing concurrency guard. Existing captured prices win.

## Why previous fixes did not complete this workflow

Confirmed in source and automation configuration:

- The prior estimate documentation explicitly excluded estimates from official decisions.
- Royale independently required paired, verified entry and closing prices.
- Pregame automation prompts explicitly prohibited ledger updates and saved artifacts only.
- The paid Odds API close caller bypassed the general paid-feed flag.
- Free captures were not durably replayable after a failed final write at kickoff.

These are separate gaps; adding a screenshot submission path or displaying a historical
estimate did not repair all of them. This does not establish that every prior deployment
failed or that every historical quote can now be recovered.

## Capacity and remaining limits

The deterministic test evaluates 100,000 synthetic CLV rows locally with zero network
requests (about 24–26 ms on the test host). This is a calculation benchmark, not a measured
100,000-user production capacity claim. Synthetic tests also cover shared free-source
lookup and replay after failed writes. No load was sent to third-party sources.

The current scheduler still reads whole league state and writes per league. It is not a
bounded queue architecture for 100,000 concurrent users. Free providers have no guaranteed
coverage/SLA, and ESPN does not cover every alternate or prop. Cross-isolate receipt
retention, indexed due-event queues, bounded batches, durable retries beyond the short
recovery window, production contention/load tests and alert delivery need further work
before a 100,000-user unattended reliability claim. No claim of flawless weekly operation.

No league was graded or eliminated by the development task. Current live data, real
authentication, deployment identity and post-deploy response must be verified separately.
