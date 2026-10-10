# Bozo backup close: nflverse (book unspecified)

Status: code in this PR. **Not deployed**: the Worker still needs the dispatch-only
`worker-deploy` run, and the owner has to approve that run explicitly.

## What it does

When the paid close sources (The Odds API, then SportsGameOdds) leave an NFL full-game
moneyline, spread or total leg **with no close at all**, the 5-minute close cron fills
it from nflverse/nfldata `data/games.csv`. Nothing new is fetched for this. The hourly
schedule refresh already downloads that file into `schedule:nfl:<season>`, and each
normalized row now carries `nflverseGameId` and `nflverseLines`.

Written to both `results/<key>` and the permanent `ledger/<row>`:

| field | value |
|---|---|
| `close` / `closeOpp` | nflverse price for the side taken / the other side |
| `closeBook` | `"unspecified"`. nflverse does not name the book |
| `closeSource` | `"nflverse"` |
| `closeObservedAt` | `fetchedAt` of the schedule document, i.e. when the Worker read that CSV content |
| `closeProviderEventId` | nflverse `game_id`, e.g. `2026_05_TB_DAL` |

Every surface labels these closes **"nflverse close (book unspecified)"** (`closeLabel` in
`/bozo/clv` and the MCP ledger read). They are never shown as "Circa", "DraftKings" or a
plain "closing line".

## Column mapping and sign

| nflverse column | meaning | Bozo use |
|---|---|---|
| `spread_line` | home team's expected margin (+ = home favoured) | stored line: home `+spread_line`, away `-spread_line` |
| `home_spread_odds` / `away_spread_odds` | price at that number | price / opp by side |
| `total_line`, `over_odds`, `under_odds` | total and prices (CSV order is `under_odds,over_odds`) | price / opp by direction |
| `home_moneyline` / `away_moneyline` | moneylines | price / opp by side |

Bozo stores a spread as the points the side **gives up**: `+9.5` renders `DAL -9.5`.
For 2026_05_TB_DAL, `spread_line` was 9.5 and Dallas was -535, so DAL is stored as
`9.5` (printed -9.5) and TB as `-9.5` (printed +9.5). The tests pin this. They also
check it against the real 24–16 Tampa Bay result and an away-favourite row
(2026_04_ARI_NYG, `spread_line` -2.5).

Join: canonicalKey `nfl|<teamA>~<teamB>|<UTC date>` (Monday night lands on Tuesday's
date). If that misses, the join falls back to the ESPN id, then to the `away @ home` text
plus kickoff (`bozoScheduleFindGame`).

## Rules (fail closed)

- Fills only an **empty** pair. A full close is never overwritten. A half close is left
  for the paid recovery or the manager.
- Runs only after kickoff, and only once the same CSV row has **both final scores** and
  the document was fetched after kickoff. Before that, the columns may be a pregame
  snapshot of unknown age.
- **Main line only.** A spread or total leg at a different (alternate) number gets one
  final reason, e.g. "No nflverse close: nflverse closing spread was DAL -9.5; this leg is
  DAL -7.5…". It is never interpolated and never copied from the entry price. That reason
  is written once and not re-read. Paid recovery can still replace it inside its 48h window.
- Props, period legs, `other` legs and CFB are untouched.
- Window: 10 days after kickoff (`BOZO_NFLVERSE_CLOSE_WINDOW_MS`), and only while the
  leg is still in the league's current `picks`.
- No credits, no new secret, one KV read per cron run.

## CFB

cfbfastR's `cfb_schedules_<season>.csv` (already pulled) has no spread, total or price
columns, so there is no free CFB close in data we already have. CFB is not built.

## Turning the paid Odds API down later (not changed here)

- Everything paid is gated on the `ODDS_API_KEY` Worker secret. Deleting it stops all
  Odds API calls: entry verification, closes, historical recovery and the score fallback.
  SGO (`SGO_KEY`) stays the live pregame source, and nflverse still backfills NFL
  ml/spread/total closes after games end. Submissions then verify through SGO only, and
  the Odds API score fallback (`bozoFallbackScores`) goes away. nflverse and cfbfastR
  still grade.
- Smaller levers: `BOZO_CLOSE_RECOVERY_MS` (48h) and `BOZO_CLOSE_RETRY_MS` (1h) bound
  historical spend. Alternate markets (`alternate_spreads` / `alternate_totals` in
  `bozoOddsApiMarkets`) cost 2 credits instead of 1.
- To make nflverse primary for closes, you would remove the kickoff-time Odds API close
  attempt in `runBozoCloseCapture`. Expect alternate-number legs to then show a reasoned
  "no nflverse close" instead of a DraftKings price.
