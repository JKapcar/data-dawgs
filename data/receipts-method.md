<!-- mirror of https://datadawgs216.com/receipts.html -->
---
title: Receipts — method and pre-registration
as_of: 2026-08-06
source: receipts.html on datadawgs216.com
canonical_url: https://datadawgs216.com/data/receipts-method.md
data: https://datadawgs216.com/data/receipts.json
---

# Receipts

Every call gets a date, a number and a benchmark — written down **before** the games, so
neither the result nor the story can be edited afterwards. Locked **2026-08-06**, 272 calls,
SHA-256 `4b87fe0e0790a1e6196fbbcad9b444e00735d5c7035ad1c7f9b476a55fc2716a`.

**Nothing is graded yet.** The 2026 season has not started. Any claim about how these calls
performed is wrong on its face.

## What the calls are

Predictions come from nfelo, snapshot `0d3f8418`, model `v4.3.0`. For the 16 games nfelo
published directly, its own number is used. For the rest, the probability is derived from its
power ratings through a margin model fitted on 4,108 historical games: 23.58 Elo per point,
2.10 points of home-field advantage, residual SD 13.18.

The benchmark is the **devigged closing moneyline**, taken at lock. It exists for 51 of 272
games; the rest had no line on 2026-08-06 and therefore have **no benchmark and never will**.
Those games test calibration only.

## What is being tested

**Primary, resolvable this season — calibration.** Are the stated probabilities calibrated:
do the games called at 70% land about 70% of the time? 272 games is enough to catch a real
miscalibration.

**Secondary, NOT resolvable this season — does nfelo beat the closing line?** One season
cannot settle it, and that is being said now rather than in January. Measured on 4,096
historical games, the paired per-game spread between nfelo and the closing line is so wide
relative to the edge that a 272-game season gives:

- a minimum detectable straight-up difference of **±1.60 pp** — the advertised +0.14 pp is
  **9%** of that
- a minimum detectable Brier gap of **0.0034** — the observed edge is **19%** of that
- only about **five games a season where the two even disagree**

At the observed effect sizes that takes roughly **26 seasons** on Brier and **130** straight
up. **Any 2026 result on this axis is noise, whichever way it falls.** It is logged because
season one of twenty-six still has to be season one.

## What would change our mind

On calibration — the resolvable question — a miss of more than about **8 points** in any bin
holding 30+ resolved games, in the same direction across the 70–90% range, is a real failure
and not sampling noise. That is the finding this page is built to catch. A single
wrong-looking week is not evidence of anything.

On the benchmark comparison, nothing that happens in 2026 changes our mind, by construction.
Stated in advance so it cannot be reinterpreted later.

## Scoring

Brier score (lower is better) as the headline, because it grades the *number* rather than the
pick. Straight-up accuracy alongside it, paired against the benchmark on the identical game
set. Calibration by bin. Every figure recomputed from resolved games only — nothing is
projected, nothing is back-filled.

Grading is idempotent: a game already scored is never re-scored, a game not yet final is
skipped rather than guessed, and a tie stores no straight-up result. Finals come from ESPN's
public scoreboard.

## Integrity — verify it yourself

The call sheet is hashed. If a prediction is ever quietly edited, the hash changes and the
receipt is void.

Canonical string: take the rows of `data` in `receipts.json` **in the order stored** (the
locked order — do not re-sort). For each row emit

```
${id}|${p.toFixed(4)}|${mk == null ? "" : mk.toFixed(4)}
```

and join the rows with `\n` (LF, no trailing newline). SHA-256 the UTF-8 bytes, lowercase
hex. The string is 6,697 bytes over 272 rows and begins:

```
2026_01_ARI_LAC|0.8060|0.8271
```

That must equal `4b87fe0e0790a1e6196fbbcad9b444e00735d5c7035ad1c7f9b476a55fc2716a`.

The reason the spec is published is so you don't have to trust this site. Recompute it.

## Provenance

Forecasts from [nfelo](https://github.com/greerreNFL/nfelo) (MIT), snapshot `0d3f8418`.
Schedule and closing lines from [nflverse/nfldata](https://github.com/nflverse/nfldata).
Finals from ESPN. Call sheet locked 2026-08-06.

## Material changes

Changes to how this site names or frames its claims, recorded rather than applied
silently. The forecast rows are covered by the hash above; this list covers what the
hash cannot see.

- **2026-08-09 — The Pound is renamed The DawgHouse.** Human-facing labels only:
  /pound.html forwards to /dawghouse.html. Stored machine values did not move — `tier`
  stays `pound` and /data/pound-tools.json keeps its name. No forecast, probability or
  benchmark changed. The same day the shelf was reduced to genuinely blocked work; the
  complete NFL tools left it. Full inventory: /data/pound-tools.json.
