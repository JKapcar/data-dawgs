# Bozo final-score outage recovery

The score job now reports failure when live providers cannot answer a due score request, even if the static schedule downloaded successfully. A six-hour-old unresolved game also reports degraded health when a provider returns HTTP success without its final. This is an operational warning, never evidence to grade the game. Throttled checks retain the prior failure; verified finals clearing all due games permit recovery.

Static schedule `checkedAt` records a successful conditional check; `fetchedAt` retains the last changed payload time. A 304 cannot establish that a game's final exists. Existing source and refresh cadence remain unchanged:

- Worker source: https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/csv/cfb_schedules_2026.csv
- Worker implementation: `bozoRefreshOneSchedule` in `dawg-bot-worker.js`, hourly minute 9.
- Upstream publisher: https://github.com/sportsdataverse/cfbfastR-data/blob/main/.github/workflows/daily_cfb.yml (in season: Saturday 16:00/20:15 UTC; Sunday/Monday 06:30 UTC). Publication can lag a finished game.

Odds API refusals retain only documented allowlisted `error_code` values. Raw messages, URLs, credentials and bodies are never persisted by this change. Existing legacy 401 records cannot identify the cause; the next normally scheduled provider probe populates the code. No extra requests, quota consumption, credential changes or backoff changes are introduced.

Recovery remains the existing authenticated owner manager override for a verified historical result, or the separately proposed two-phase MCP interface in PR 357 once released and connected. Preserve manual grades. Never invoke full-week grading to perform a single historical correction: that path can change elimination and ledger state.

A stale Chrome debugger attachment can be recovered by opening a fresh tab at the existing site, retaining the signed-in profile and all user tabs. Read the result before writing; reload and read the exact result and board after writing. This has been exercised successfully in production. No browser restart or credential extraction is needed.

This patch fixes truthful outage reporting and diagnostic ambiguity. It does not promise uninterrupted provider availability. SportsGameOdds is an existing optional candidate, but automatic score polling is intentionally not added without verified current entitlement and remaining budget. Existing fallback remains the coverage path during provider outages.
