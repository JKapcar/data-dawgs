# CFB data backbone (roadmap step 1)

This pipeline turns SportsDataverse's published cfbfastR-data schedule CSVs into the canonical College Football schedule surface at `/data/cfb-schedule.json`. It is the first shipped piece of the CFB roadmap (ideas `cfb-sportsdataverse` and `cfb-games` in `/data/pound-tools.json`) and follows the NFL backbone's discipline: facts only, gates that fail closed, and a snapshot hash every downstream consumer must record.

## Provenance and runtime

- Source: `sportsdataverse/cfbfastR-data` `schedules/csv/cfb_schedules_{season}.csv` on branch `main`.
- Pinning: the source repository HEAD at capture, via `git ls-remote` (no GitHub API dependency), plus a SHA-256 of the exact raw CSV bytes. Repository-level pinning is coarser than the NFL backbone's path-level commit lookup; the raw-bytes hash is what makes drift detectable and the load reproducible.
- Source data license: not independently verified for the cfbfastR-data repository; the envelope says so.
- Scope: FBS-involved games only. Lower-division games with no FBS side are dropped at ingest.
- Excluded on purpose: upstream modelled columns (post/pregame win probabilities, ESPN Elo, excitement index). They are model outputs, not schedule facts, and carry no methodology or observation metadata. Lab work may read them from the raw snapshot, never from the canonical rows.
- Python: standard library only for validation, so contract checks run without network access.

## Gates (all fail closed)

Required source columns present; single season per load; season type in {regular, postseason}; week in range; valid ISO kickoff timestamps; TRUE/FALSE flags well-formed; completed games may not carry a partial score; incomplete games have scores nulled rather than trusted; FBS teams must name a conference; canonical and upstream game IDs unique; FBS-involved game count within 400-1100; FBS team count within 120-145.

## Reproducibility

`integrity.snapshot_id` is a SHA-256 of canonical JSON for the ordered game rows. Git history retains every changed snapshot. Downstream models and receipts must reference the exact snapshot they consumed.

Run locally:

```
python3 scripts/cfb_data_backbone.py refresh --season 2025
node tools/data-manifest.js
python3 -m unittest tests.test_cfb_data_backbone
python3 scripts/cfb_data_backbone.py validate
node tools/validate-data.js
```

## Market surface (roadmap step 1, idea cfb-market)

`scripts/cfb_market.py refresh` joins SportsDataverse's `betting/csv/cfb_line_odds.csv.gz` to the canonical schedule and publishes `/data/cfb-market.json`: spreads, totals and moneylines from ESPN Bet, Bovada and DraftKings for all 934 games, with a devigged home win probability on 864 of them. Devig is proportional, matching `holdVig()` in `work/pound-core.js`.

The timing caveat governs every use of this file. The upstream `date_time` column is the kickoff time, not an observation time, and every row for a game, book and market shares it. There is no capture timestamp for any price. So these are not closing lines, no closing-line value may be computed from them, and no forecast receipt may cite them as a prospective market input. The build asserts this: if any game ever carries more than one `date_time`, the assumption has broken and the refresh stops.

The NFL backbone drops its upstream market columns entirely because they identify neither book nor observation time. This file clears the book bar and not the timestamp bar, so it ships labelled rather than suppressed. `provenance.observation_timestamp_available` is `false` and `provenance.price_timing` is `"unknown"` as machine-readable fields, not only prose.

Four Bovada moneyline quotes in 2025 are internally impossible (both sides priced the same way, implying a 34 to 60 percent hold). They are dropped from the priced rows and published in `data.rejected_quotes` with the reason, rather than silently discarded. If rejections ever exceed one percent of quotes the refresh fails instead of publishing a degraded feed.

## Elo baseline (roadmap step 2, idea cfb-elo)

`scripts/cfb_elo.py refresh` ingests seasons 2018-2025 through the same canonicalization and gates, runs a deliberately simple deterministic Elo (parameters fixed in the script before evaluation), and publishes `/data/cfb-elo.json`: end-of-2025 ratings plus a retrodictive 2025 backtest against reference points (always-pick-home, climatological Brier, ESPN pregame-Elo favorite accuracy from the raw snapshot). It is the interpretable floor future CFB models must beat, per the Baseline Requirement. It is modelled output, ungraded, and says nothing about 2026 until prospective receipts exist.

When the market file is present the backtest also scores the Elo against the market on the same games only, which is the comparison the Baseline Requirement actually asks for. On the 783 FBS-vs-FBS finals with a market probability, the market's median devigged price scored Brier 0.1814 and favorite accuracy 0.7241; the Elo scored 0.1917 and 0.6922 on those same games. The plain Elo losing to the market is the expected and correct result, and the timing caveat above means the comparison flatters the market. Both numbers are recorded so a future model can be judged against something real rather than against a straw baseline.

## Model cards (governance principle cfb-gov-model-cards)

`scripts/cfb_model_cards.py refresh` publishes `/data/cfb-model-cards.json`: the purpose, target, features, training window, validation design, limitations, calibration, performance, failure modes, version and retirement status the CFB governance section requires before a model is promoted past the lab. Every performance number is read from the model's own published output rather than typed into the card, and the calibration narrative is generated from the bins, so a card cannot drift away from the thing it describes.

The card reports the roadmap's lifecycle value read from `/data/pound-tools.json` instead of asserting its own. The roadmap still says `idea` for `cfb-elo`, which is accurate in the sense that nobody has advanced it; the card says so plainly rather than letting two files disagree. Advancing those entries is a governance decision, not a cleanup task.

## Known limits and next steps

- The 2026 season file does not exist upstream yet (checked 2026-08-08). When cfbfastR-data publishes it, `refresh --season 2026` produces the prospective schedule; until then the canonical surface is the completed 2025 season.
- CFBD API ingestion (`cfb-cfbd`) remains unstarted: it requires an API key, which belongs in the Cloudflare Worker, never in this public repo.
- Play-by-play (`cfb-plays`) is deliberately not in this step; the schedule surface had to exist first.
