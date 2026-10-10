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

## Points vs the nflverse main close (alternate numbers)

nflverse publishes only the main closing number. A spread or total leg on any other
number keeps `close` / `closeOpp` **null** with its reason, and no price is ever made
up for it. The number comparison goes in separate fields instead. These are written once,
to both receipts for the current week and to the ledger row for past weeks:

| field | meaning |
|---|---|
| `closeLineRef` | nflverse closing number in the leg's own stored convention (same units as `line`) |
| `closePointsVsClose` | points vs that close. **Positive = the leg got a better number** |
| `closeLineRefSource` | `"nflverse"` |
| `closeLineRefObservedAt` | schedule document `fetchedAt` |
| `closeLineRefEventId` | nflverse `game_id` |

Signs: spread `closeLineRef - line`, over `closeLineRef - line`, under `line - closeLineRef`.
Examples:
- DAL -7.5 vs a -9.5 close: stored 7.5 vs 9.5, so +2.
- TB +10.5 vs +9.5: stored -10.5 vs -9.5, so +1.
- Over 47.5 vs 49.5: +2.
- Under 51.5 vs 49.5: +2.

A leg on the main number gets 0. Moneylines get none. `/bozo/clv` and the MCP ledger read
expose these fields next to the close fields, with `closeLineRefLabel`:
**"points vs nflverse main close (book unspecified)"**. The CLV chart and tooltip are
unchanged.

## Precedence

1. **Any existing full pair is final for every automatic source.** `bozoCloseTargets`
   skips complete pairs before any paid or free call, and the ledger backfill skips any row
   with a close. That covers nflverse, Odds API, SGO and manual closes.
   Manual fills (`POST /bozo/close`):
   - A complete **book** close (Odds API or SGO DraftKings, i.e. `closeObservedAt` set) is
     refused with 409, exactly as before.
   - A complete **nflverse** close is the one exception (see below).
2. Before kickoff: Odds API (DraftKings), then SGO.
3. After kickoff, current week: if the paid historical retry gate allows it, the Odds API
   historical pregame snapshot is tried first on that tick. If it misses, nflverse fills
   **immediately** once the row is final. There's no wait for the 48h paid recovery.
4. After an nflverse full pair lands, later paid recovery never targets the leg (rule 1).
   After an nflverse **reasoned miss** (alternate number), paid recovery may still fill a
   real DraftKings price inside its 48h window. That clears the reason and leaves
   `closeLineRef*` in place.
5. A half close is left alone by nflverse in every path.

## Manual replacement of an nflverse close

A manager with the real slip or book price may **replace** an nflverse close once, using
the ledger close-fill route with both prices (`close`, `closeOpp`, and optionally
`closeBook`).
- **What's written** (ledger, plus results for the current week): `closeSource: "manual"`,
  `closeBook` as entered (lowercased, default `draftkings`), `closeObservedAt` = entry
  time, `closeProviderEventId: null`.
- **Nothing is lost.** `closeReplaced` keeps the nflverse `close`, `closeOpp`,
  `closeBook`, `closeSource`, `closeObservedAt` and `closeProviderEventId`, plus
  `replacedAt` and `replacedBy`. The audit row also records `from` / `to`.
- **`closeLineRef*` stays as it was**, because the points-vs-close comparison is still
  against the nflverse main number.
- **Write-once.** The replacement sets `closeObservedAt`, so the row re-locks. A later
  manual fill or clear is refused: "That leg already has a manual DraftKings close entered
  at <ET time> (it replaced the nflverse close) and can't be overwritten."
- **Refused on nflverse rows:** clearing, or sending only one side. The message is "That
  leg has an nflverse close (book unspecified) read at <ET time>. It can be replaced with
  a real two-sided book price, but not cleared."
- **Book-close refusals name the source**, e.g. "That leg already has a DraftKings close
  captured at Oct 4, 2026, 12:58 PM ET via The Odds API and can't be overwritten." The old
  "captured at kickoff from the book" wording is gone.
- CLV-only saves (`clvPts`) are still allowed on every row.
- `/bozo/close-gaps` now marks nflverse closes `locked: false, replaceable: true` and
  includes `closeSource`, so the existing fill boxes reach them.
- `/bozo/clv` and the MCP ledger read add `closeReplaced`, and set `closeLabel: "manual close
  (replaced nflverse close)"` on those rows.
- The **grade card** (re-grade) path still treats any complete captured pair, nflverse
  included, as locked and doesn't touch it. The close-fill route is the only way to
  replace a close.

## Past-week ledger backfill

Past weeks exist only in `ledger/<season-wN-key>`. `results/<key>` is cleared at
`bozoNext`, so the live path never reaches them. `runBozoNflverseLedgerBackfill` runs on
the 5-minute close cron with its own 30-minute gate in RL KV (`bozo:nflverse-ledger:last`).
- **Writes:** ledger rows only, never `results/`.
- **Rows it skips:** the current week (the live path owns that), synthetic leagues, other
  seasons, rows with any close, rows with an nflverse reason and a line ref already set,
  and props, `other` and period legs.
- **Period:** the ledger has no `period` column. The period comes from `selectionKey`'s
  suffix, and a row without a `selectionKey` or with a half/quarter label is skipped
  (fail closed).
- **Bounded:** at most 25 rows written and 2,000 rows examined per run, one PATCH per
  league. Written rows drop out of the filter, so repeated runs converge and never write
  a row twice.
- **Window:** the whole current season, not 10 days. nflverse closing values don't age,
  the schedule document only holds this season, and every write is write-once. The
  10-day window still bounds the live path, which also drives paid recovery decisions.

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
  The points-vs-close fields above carry the number comparison.
- Props, period legs, `other` legs and CFB are untouched.
- Window: 10 days after kickoff (`BOZO_NFLVERSE_CLOSE_WINDOW_MS`) for the live path. Past
  weeks are covered by the ledger backfill below.
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
