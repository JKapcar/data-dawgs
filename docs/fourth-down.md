# Fourth Down Lab implementation

`fourth-down.html` is a native Data Dawgs page. `fourth-down-engine.js` runs pinned
open models locally, with no hosted inference, account, API key or Worker release.
This is an attributed MIT port, not a claim to own the source bot or its brand.

## Pinned provenance

Export date: 2026-09-28. This is not a training-date or calibration claim.

| Repository / artifact | Version / SHA-256 |
|---|---|
| nflverse/nfl4th | `aca8c66fee105c1e5355c0daf962f64d4353e42b` |
| nflverse/nflfastR | `701bbf38bc1c030ff9f1f4825a23191287d3903c` |
| nflverse/fastrmodels | `75c7b68bc49535370236c38c9826265da075bd71` |
| nfl4th model_archive/fd_model.rds | `db1c1763e763df41e11e013088d77889ddf57f75025e8529e1f587e0c2c4c31a` |
| nfl4th model_archive/wp_model.rds | `80adad2eb8d5cfb1e9610a31e7b123f9d88f73ce6706fba1ebf9da1b1cc54483` |
| Browser gzip bundle | `7a016903daa1946e51484a3919e72b89c06ee0d49c51c9c731197cd6b8b8bde6` |

MIT notices are retained in `assets/fourth-down/LICENSES.txt`. The model bundle is
4,866,068 compressed bytes / 14,224,272 raw bytes. Load happens once per page; no
external inference service is called. The browser checks the compressed SHA-256
when Web Crypto is available and decompresses with DecompressionStream. Load
failure is visible and produces no fallback probabilities.

## Reproduce the export

Clone the three repositories as `nfl4th-upstream`, `nflfastr-upstream` and
`fastrmodels-upstream` in a scratch directory and check out the commits above.
Download the two RDS artifacts from
`https://github.com/nflverse/nfl4th/releases/download/model_archive/` and verify
their hashes. Source archives are not vendored into the site.

With R 4.3.3, mgcv 1.9-1, jsonlite 1.8.8 and their dependencies, run
`Rscript /path/to/data-dawgs/tools/export-fourth-models.R` from that scratch
directory. This extracts raw XGBoost bytes, punt distributions and field-goal GAM
probabilities. The GAM table is evaluated at every supported integer yardline;
it is not refitted. Use Python xgboost 3.4.1 to export each model to JSON:

```python
import xgboost as xgb
for name in ['fd', 'ep', 'wp', 'home_wp', 'two_pt']:
    model = xgb.Booster()
    model.load_model(name + '.ubj')
    model.save_model(name + '.json')
```

Run `python tools/export-fourth-models.py /path/to/scratch` from this repository.
The exporter preserves split/leaf float32 values and packs child indices and
feature/default-direction flags. Gzip uses a fixed timestamp. The manifest has
model offsets, tree roots, class IDs, base scores, kicking data and bundle hash.
Do not replace artifacts without checking published examples and provenance.

## Runtime behavior

The engine applies nfl4th's 76-class gain distribution, field-goal probability
model, empirical punt outcomes and extra-point/two-point choice. It averages the
nflfastR possession WP and nfl4th home WP models for hypothetical outcomes. It
preserves upstream feature ordering, including the home-WP EP call's original
possession timeout columns and the home-WP clock transforms from the original
state. Split comparisons use float32 inputs; accumulation uses JS doubles.

Intentional boundary handling: zero game time is terminal (lead 1, deficit 0,
tie 0.5); extra user-entered runoff applies per successful non-TD outcome. Default
runoff is zero beyond the modeled six-second play. Original 25-yard kickoff
assumption is default; optional own-35 is explicitly a scenario. No overtime.
Kneel boundaries, long-FG extension and punt field-range exclusions follow source.
These limits live both in page copy and Toto's DD_BOTCTX system instruction.

The weekly collector uses pre-play scores, tracks timeout calls with halftime
reset, fixes ESPN field orientation with possessionText, deduplicates current
and previous drives, and excludes non-decisions / no-plays / overtime / Q4 <15s.
Unparseable situations increment a per-game skipped count. Model errors produce
unavailable rows. A failed game's previous dated snapshot is retained with an
error. A completely failed refresh exits without writing data. Scheduled games
are not mislabeled as feed failures. ESPN can revise historical plays.

`tools/fourth-down-refresh.py` freezes the outgoing week into
`data/fourth-down-previous.json` when the week rolls forward (`archive()`; never
for an earlier hand-run week, never with an empty week). `tools/fourth-down-score.cjs`
scores both files and the workflow carries both across its reset to latest main.

`fourth-down.yml` runs verification on relevant PRs and refreshes the current
regular-season week every 15 minutes, best effort, on NFL game weekdays during
September–February. It fetches latest main before committing only snapshot and
manifest, and never force-pushes. If another writer wins a push race, the job fails
visibly and the next scheduled run retries. No social posts or push notifications.

## Verification and release

```sh
node --test tests/fourth-down.test.cjs
python -m unittest discover -s tests -p 'test_fourth_down_feed.py'
node tools/data-manifest.js
node tools/validate-data.js
```

The regression set checks eight separately observed rbsdm weekly decisions at
one-decimal display precision, including CLE–CAR 94.0% go versus 89.6% FG, +4.4 pp.
It also checks bundle integrity, conversion threshold arithmetic, invalid inputs,
a meaningful kickoff-position change, and finite probabilities across the dated
snapshot. The Python fixture checks pre-play scores, field orientation, timeouts
and deduplication. This verifies implementation, not prospective calibration.

Every page with the shared NFL nav and Toto MAP receives the new link. Eleven
standalone/redirect/admin pages do not contain that shared block and are unchanged.
The NFL hub discovers the new surface from surfaces.json. The data manifest,
sitemap, llms index and service-worker cache version travel in the same release.

Publishing main requires fresh owner approval under `docs/worker-deploy.md`.
This release changes no Worker code, credentials, private data or user accounts.
After approved deployment verify the public page, model hash, dated data and
scheduled workflow. Allow GitHub Pages / service-worker caches time to settle.

## Probability explorer (2026-09-28)

`fourth-down-analysis.js` supplies pure sensitivity and historical comparison
math. `fourth-down-explorer.js` renders both sliders, win-probability intersections,
and empirical distributions of smoothed team rates. Data provenance and smoothing
are documented in `data/fourth-down-method.md`. The nfl4th engine and pinned model
artifacts are unchanged. User scenarios are carried into copied text, links, and
Toto state; changing situation inputs hides stale scenario controls.

Rebuild history with `python tools/fourth-down-rates.py --rebuild-history` or use
`--pbp-dir /path` containing `{year}.csv.gz` files. The scheduled daily workflow
updates only current-season data, fails on coverage regression, and preserves
source hashes. CI tests the original published bot cases plus threshold switching,
zero/one probability endpoints, unavailable alternatives, historical aggregation
and smoothing arithmetic.

## Published model comparison (2026-09-28)

The explorer adds a separately labeled fourth-and-1 benchmark from Brill, Yurko
& Wyner (2025), *Analytics, Have Some Humility*. Source repository:
https://github.com/snoopryan123/fourth_down at
`2f4df27a1df102ad55b9983aa1e5b9daeb85ee74`, artifact
`2_Decision_Making/fitted_models/go_model_b1.rds` (original fit).
For fourth-and-1 all distance spline basis terms are zero, giving
`logit(p) = 0.6961039190652341 + 0.13230533049039203 * z`.
Reference predictions at z=-2,0,+2: .6062301882432214, .6673233955601306,
.7232648531411295. Only this verified distance slice is exposed.

The user chooses z in [-2,2], standardized market-implied offensive scoring
against the defense. It is not inferred from current lines, EPA, or team name;
zero means the original model's average strength input. A new situation resets
z to zero. Preview holds current FG probability and nfl4th conditional outcome
values fixed. Apply explicitly substitutes conversion in the main scenario;
Restore both model estimates retains its original behavior. Shared scenarios
carry applied conversion, not an implied claim of a fitted team rating.

This is not a latent talent distribution, median conversion estimate, published
WP implementation, post-training validation, or empirical estimate of the
frequency of true conversion probabilities below a cutoff. Model agreement is
not statistical independence. Source and limits appear in the panel and Toto
system instructions; preview values are in `scenario.publishedComparison`.

## Goal lens (2026-10-10)

`fourth-down-objectives.js` is a pure registry of objectives; `fourth-down-lens.js`
renders the panel. The nfl4th numbers are unchanged: `calculate()` now also returns
`lots` (every modelled outcome of each choice: probability, win probability after
it, game seconds left, success flag) and `secondsLeft`. Both are **non-enumerable**
so they stay out of `data/fourth-down.json`, object spreads and Toto's context.
Touchdown lots split on the same extra-point/two-point choice the average assumes.

All time-based goals are built from `share(clock, p, x, T, H)`. Adding a goal is
an entry in `GOALS`: `{label, blurb, unit, path, weigh, params, score(lot, P, path,
ref), describe(P)}`. `path.share(x)` and `path.shortfall(ref)` are the only two
primitives a score needs. `weigh: 'time'` combines lots by the seconds they leave
(occupancy goals); `'outcome'` by probability. `evaluate()` returns
`available: false` with a reason instead of a number when the clock is missing or
fewer than `abstain_below_seconds` remain, and `tooClose` when the edge is inside
the held-out error.

`tools/fourth-down-paths.py` measures realised clock shares from nflverse
play-by-play, fits the information clock on 2016–2022, tests on 2023–2025 and
writes `data/fourth-down-paths.json` (envelope, knots, errors by clock, horizon
tests, calibration table, source hashes, reference integrals). It needs numpy,
pandas and scipy, downloads about 185 MB, and is not scheduled or run in CI.
`tests/test_fourth_down_paths.py` checks the measurement on a synthetic game and
skips when those packages are absent. The node suite checks the JS integrals
against the Python references to 1e-4.

Page wiring is applied by the idempotent `work/patch-fourth-down-goal-lens.py`,
which also restamps the page's asset keys, updates the css link pinned in
`work/build_explore.py`, and rewrites the Fourth Down sentence in Toto's pasted
MAP on every page that carries it. Shared links carry `goal`, `gp` and `gh`.

Deliberately not built: a lens column on the weekly board (62 ms per decision in
the browser is too slow to recompute a slate; it belongs in
`tools/fourth-down-score.cjs` as stored per-goal calls), a fit of goals to
observed coach decisions, a two-point calculator, and any score-based goal.

## Game and play picker (2026-10-10)

The page opens on a real fourth down instead of hand-picked preset cards.
`fourth-down-picker.js` renders step 1 (week tabs, game chips) and step 2 (the
game's fourth downs, in game order or by coach-versus-model gap), and replaces the
weekly board that used to sit at the bottom: same rows, same decision cost. Its
pure helpers (`phase`, `spot`, `cost`, `verdict`, `order`, `games`, `defaultPick`,
`find`, `field`) are exported for the node suite.

The form survives as the "Edit the situation" tab. Selecting a play fills it;
editing any field marks the result as a custom situation and drops the game
attribution (`DDFourthState.play` becomes null). Reset returns to the last real
play. The three hypothetical presets moved into that tab; the Browns case is the
fallback when no feed loads. Share links carry `play=<ESPN play id>` plus the full
situation, so a link still opens (as a custom situation) after the play rolls out
of both files. On phones the plays are a horizontal swipe strip and tapping one
scrolls to the call; on desktop they are a scrolling list beside it.

Page wiring is applied by the idempotent `work/patch-fourth-down-picker.py`.
