# Local descriptive WR audit method

`wr_audit.py` performs a descriptive audit, not a fitted baseline. The fixed source
archive SHA-256 and byte size are verified before reading. Production defaults
cannot select a different source; test fixtures use explicit function overrides.
Outputs must reside outside Git. The report pins source, script and development.py dependency hashes; its
canonical JSON is named by SHA-256, with a separate receipt. No data is uploaded.

Population: players whose source `nfl_position` is exactly `WR`, draft year 2023
or 2024. NFL observations require `games.season_type == REG` and
`games.season == players.draft_year`. This excludes sophomore seasons and PRE/POST.
Eligible athletes without player-play records remain represented with zero
observations, not invented outcomes. Distinct game-play counts and player-play
counts are separate: multiple WRs can share a play.

Separation is the source `separation_at_pass_forward`, not reconstructed defender
separation. Empty/NA tokens are missing. Nonmissing values must parse as finite
numbers; invalid strings/infinities are separately counted. No physical bounds
or units are inferred. Negative finite values remain in the raw distribution.
Quantiles use linear interpolation at `(n-1)*p`. Year summaries pool observed
player-play values; athlete summaries preserve differing observation counts.
Missingness is not evidence of poor performance, and no value is imputed.

Combine tracking retains source drill_type/drill_name tags verbatim. A trial is
an observed `(event_id, nfl_id, attempt)` within year/type/name; it is not evidence
of a completed or valid trial. Missing and nonfinite kinematic values are counted
by athlete/year/drill and year/drill. These tags do not establish turn angles,
cut phases, standardized protocols, units or timing definitions. Join coverage
counts athletes with rookie REG player-play and finite source separation values.

NFL tracking uses exact `(game_id, play_id, nfl_id)` joins. Unmatched trajectories
and rows remain explicit counts, and player-play records without tracking are
reported. The audit does not drop unmatched observations into an outcome table.
Only explicitly allowed development tracking files are opened; 2025 tracking
and career-success measurements are never read. Mixed CSVs are parsed only to
apply their draft/season eligibility before measurement processing.

Unresolved: authoritative unit dictionary, contextual defender/ball coverage,
source separation definition and missingness mechanism, complete snap-share
denominator, and valid scientific outcome construction. This report does not
establish baseline readiness, causal effects, predictive quality or live access.

Per-drill raw numeric minima/maxima are descriptive only. The report counts
cohort athletes without each observed drill; absence is not a failed trial.
Official NFL overview confirms selected-player tracking, but is not a column
dictionary: https://operations.nfl.com/programs-initiatives/innovation/big-data-bowl
The official Kaggle data page could not be read in the available lookup; no
participant notebook or older competition dictionary was substituted.
