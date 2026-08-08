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

## Ratings registry (roadmap step 2, idea cfb-ratings-registry)

`scripts/cfb_ratings_registry.py refresh` publishes `/data/cfb-ratings.json`, the canonical normalization boundary for dated rating systems. Its first version contains the 136 end-of-2025 teams from the shipped Elo baseline and locks the exact `/data/cfb-elo.json` snapshot it consumed. Native Elo points become `team_strength`; expected margin, win probability and predicted total remain null because those are not team-level fields in the source output.

The schema is ready to add independently dated systems, but the data is not padded to make the registry look fuller than it is. It currently contains one retrodictive, ungraded system. `data.consensus.status` is therefore `not-built`, with no weights. Multiple systems may be registered later; a blend still requires prospective error histories and correlation analysis.

## Results-only team layers (roadmap step 1)

`scripts/cfb_team_results.py refresh` publishes `/data/cfb-team-game.json` and
`/data/cfb-team-week.json` from the exact canonical schedule snapshot. Every game
becomes two mirrored team rows. Team-period rows then aggregate observed opponents,
venue, record, scoring and season-to-date totals while keeping regular-season week 1
distinct from postseason week 1. The upstream week label can contain multiple games,
so `scheduled_games_this_period` is explicit rather than silently assuming one.

These are useful partial foundations, not the completed analytical layers. Both files
declare `scope: results-only` and enumerate the absent EPA, success, explosiveness,
havoc, garbage-time, opponent-adjusted and market-performance families. Those fields
are not filled with null-looking guesses. The roadmap entries remain `building` until
canonical play-by-play and timestamped market inputs make the full contracts possible.

`scripts/cfb_team_profiles.py refresh` adds `/data/cfb-teams.json`, a compact 136-team
read surface. It joins each FBS team's observed season-to-date record and scoring facts
to the separately nested end-of-2025 Elo registry row, locking both input snapshots.
The observed and modelled objects are never blended. It remains retrodictive, ungraded,
not a consensus and not a 2026 forecast; current roster, availability, talent, portal,
play-efficiency, opponent-adjusted and timestamped-market inputs are explicitly absent.

## Record-divergence baseline (roadmap step 7)

`scripts/cfb_record_divergence.py refresh` publishes
`/data/cfb-record-divergence.json`, the first evaluable substrate for the Fraud
Detector. It compares observed win-percentage rank with observed point-differential-
per-game rank and reports each team's one-score record. Competition ranks keep ties on
the same 136-team scale; the raw signed gap is published instead of a thresholded label.

This is intentionally a descriptive baseline. Every `predictive_label` is null,
`forward_value_claimed` is false, and the file names the missing opponent adjustment,
play efficiency, turnover/decision variance and timestamped market context. The next
gate is prospective: freeze the metric by week and test whether it predicts later games
beyond Elo and the market before calling any team overrated, underrated or a fraud.

`scripts/cfb_record_divergence_validation.py` performs the first challenge of that
hypothesis and publishes aggregate-only evidence at
`/data/cfb-record-divergence-validation.json`. Every feature is reconstructed from
results completed before kickoff; games sharing a kickoff are evaluated as one batch
before any of their outcomes update state. The first 60 percent of 582 qualified games
fit one coefficient on top of Elo's fixed log-odds, and the final 233 games are held out
at a whole-kickoff boundary. The coefficient had the expected negative sign. On holdout,
the adjusted model improved Brier by 0.001123 and log loss by 0.002277, with favorite
accuracy moving from 0.7082 to 0.7253.

That is a small retrodictive held-out signal, not a current-team verdict. No game rows,
team identities or predictions are published in the validation artifact; no prospective
value is claimed, and the Fraud Detector remains `evaluating`. Team labels still require
prospective confirmation and comparison against timestamped pregame market observations.

## Model cards (governance principle cfb-gov-model-cards)

`scripts/cfb_model_cards.py refresh` publishes `/data/cfb-model-cards.json`: the purpose, target, features, training window, validation design, limitations, calibration, performance, failure modes, version and retirement status the CFB governance section requires before a model is promoted past the lab. Every performance number is read from the model's own published output rather than typed into the card, and the calibration narrative is generated from the bins, so a card cannot drift away from the thing it describes.

The card reports the roadmap's lifecycle value read from `/data/pound-tools.json` instead of asserting its own. The Elo entry is now `live`, and refreshing the card carries that value through automatically rather than maintaining a second status by hand.

## Prospective model receipts (roadmap step 3, idea cfb-model-receipts)

`/data/cfb-model-receipts.json` is an append-only ledger and is currently empty by design. `scripts/cfb_model_receipts.py` rejects backtest rows, post-kickoff issue times, completed games, schedule or input-snapshot drift, late market observations, conflicting duplicate IDs, and any attempt to mutate or remove prior history. Optional market context must name its provider, capture time and immutable receipt hash. Outcomes never mutate a forecast row; grading belongs in a separate derived surface.

Building the contract does not manufacture evidence. The current 2025 schedule contains only final games, so the append path refuses every one of them. The first real row requires a 2026 game whose canonical status is `scheduled`, an Elo forecast issued before kickoff, and exact schedule, ratings-registry and model-card snapshots. Until then the ledger's zero rows are the honest result.

## Disagreement probe (roadmap step 3, idea cfb-disagreement-lab)

`scripts/cfb_disagreement.py refresh` publishes `/data/cfb-disagreement.json`, which asks step 3's question directly: when the Elo and the market disagree, does either side systematically win?

The measured pattern is clean. Bucketing the 783 paired games by the size of the disagreement, the market's Brier advantage over the Elo runs 0.0000, then 0.0011, then 0.0075, then 0.0565 as the gap widens. The finding is nonetheless published as **blocked**, because two explanations fit that shape equally well and this data cannot separate them: either the Elo is worst exactly where it is most confidently wrong, or the market simply had a later look at the same world. Untimestamped prices make the second explanation unfalsifiable here.

What unblocks it is small and specific: market prices with a capture timestamp established before kickoff, from any book. One timestamped snapshot per game at a fixed pregame hour is enough, and a full line history is not required. Until that exists, step 3's headline question and the step 4 consensus engine that depends on it are gated on data rather than on modelling. That is a real finding about the roadmap order, and it is worth more than a confounded verdict would have been.

## Known limits and next steps

- The 2026 season file does not exist upstream yet (checked 2026-08-08). When cfbfastR-data publishes it, `refresh --season 2026` produces the prospective schedule; until then the canonical surface is the completed 2025 season.
- CFBD API ingestion (`cfb-cfbd`) remains unstarted: it requires an API key, which belongs in the Cloudflare Worker, never in this public repo.
- Play-by-play (`cfb-plays`) is deliberately not in this step; the schedule surface had to exist first.

## Prospective 24-hour market receipts

The Worker source now contains the missing prospective price-capture path. Its hourly
`9 * * * *` trigger queries SportsGameOdds only for NCAAF games scheduled in the
half-open window 24 to 25 hours ahead, then freezes every valid paired bookmaker
moneyline in KV. The existing `SGO_KEY` remains an encrypted Worker secret. The
credential is sent only in an HTTP header and never enters a URL, stored receipt,
log message or public response.

The timing contract is intentionally about **our observation**, not a provider's idea
of a close. Each receipt carries `captured_at`, scheduled `kickoff`, `lead_seconds`,
the provider's per-book quote-update timestamps when supplied, a canonical SHA-256
snapshot ID and `observation_timestamp_available: true`. A game with no usable paired
moneyline still produces an explicit `unpriced` receipt. Impossible holds, missing
opposing sides and unavailable prices are retained under `rejected_quotes` with reasons.

Receipts are immutable and keyed by season, scheduled kickoff and provider event ID.
The kickoff component matters: a rescheduled game earns a new receipt rather than
rewriting the old observation. The read-only export is paginated at:

```
GET https://toto.jkapcar4.workers.dev/cfb/market-snapshots?season=2026
```

This does **not** unblock the 2025 disagreement finding retroactively. It creates the
prospective evidence needed to answer that question on 2026 games. It also does not
authorize a consensus model: the receipts must first accumulate, join cleanly to the
canonical schedule and be graded against outcomes.

The quota math is predeclared. SportsGameOdds counts top-level events rather than
markets or books; empty responses count as one object. Hourly narrow-window queries
therefore cost about 720 empty-response objects per 30-day month plus roughly one object
per scheduled game, before rare reschedules or pagination. That fits the current
2,500-object Amateur allowance without turning a full line-history collector into an
accidental requirement.

Focused verification:

```
node work/test-cfb-market-capture.mjs
node work/test-backup.mjs
python3 scripts/cfb_ratings_registry.py validate
python3 scripts/cfb_model_receipts.py validate
python3 scripts/cfb_model_receipts.py verify-history --base-ref origin/main
wrangler deploy --dry-run --config wrangler.jsonc
```

Deployment and activation are separate actions. The source and trigger configuration
can be reviewed and tested without uploading a Worker version or changing traffic.

## Staged CFB MCP read tool

`dd_cfb_team_profile` is the first implemented CFB-side MCP tool. It performs one
bounded, cached read of `/data/cfb-ratings.json`, resolves an exact team name or slug,
and returns that team's registered ratings with the envelope date, source and integrity
receipt. It is read-only and stores neither the query nor the result.

The response fails closed on malformed registry metadata and explicitly says what the
current data cannot support: the sole Elo row is end-of-2025, retrodictive and ungraded;
it is not a 2026 forecast, a consensus, or a betting recommendation. The tool is staged
in source and `/data/surfaces.json`, but remains non-callable in production until a
separately approved Worker version is uploaded, inspected and activated.

`dd_compare_cfb_teams` is staged beside it. It resolves two exact names or slugs on the
same compact snapshot and reports observed record/scoring differences plus per-system
rating and rank deltas. It deliberately returns no matchup probability, spread or edge:
the results are not opponent-adjusted, and one retrodictive rating is not a consensus.

`dd_project_cfb_matchup` is the first staged CFB computation rather than a lookup. The
ratings registry publishes the Elo scale, venue adjustment and exact logistic formula;
the Worker reads those dated parameters and calculates home/away win probabilities for
two exact teams. Neutral site removes the +55 Elo adjustment. The result is a
hypothetical end-of-2025 rating-period calculation, not a scheduled 2026 forecast, and
expected margin, spread and total stay null rather than being reverse-engineered.

`dd_project_cfb_schedule_path` extends that same published transform across one
caller-supplied hypothetical path of up to 20 matchups. It calculates every game
probability and the complete Poisson-binomial distribution for zero through all wins,
including expected wins, variance, undefeated/winless probability and an optional
minimum-wins threshold. The result is exact conditional on its inputs; it uses no Monte
Carlo and stores nothing.

This is only the first, bounded part of roadmap step 9. Ratings remain fixed at the
end-of-2025 snapshot and games are treated as independent. The caller supplies every
opponent and venue; the tool does not claim those rows are the 2026 schedule. Conference
standings, tiebreakers, championship qualification, playoff selection, seeding and game
leverage remain unbuilt. The tool is staged and non-callable in production until a
separately approved Worker release.
