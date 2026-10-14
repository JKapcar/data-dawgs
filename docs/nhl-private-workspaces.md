# Private NHL lineups and AI access

Use the existing Data Dawgs sign-in. Upload the actual **DFS CSV**, build a roster, choose a lineup name, and save. One named workspace holds one lineup plus its player pool, model, source receipt and overrides. Use another name for another lineup. Saving reads the workspace back before displaying confirmation. Reopen the saved URL or choose **My saved lineups**. Unsaved edits are not durable. Synthetic demo pools cannot be saved as real lineups.

## Existing authenticated API and MCP

Compatible MCP clients may use the site's already-authorized personal connector. This page does not issue credentials, add scopes or configure clients. Client compatibility varies. Shared credentials cannot access personal workspaces.

REST uses `POST https://toto.jkapcar4.workers.dev/api/dfs/{operation}` with JSON and the existing `X-Bozo-Session` header. Never put a session in a URL, source file or prompt. Responses are private/no-store. The server derives the account UID from authentication; arguments cannot choose another UID.

| REST operation | MCP tool | Arguments |
| --- | --- | --- |
| schema | dd_dfs_schema | `{}` |
| list | dd_dfs_list | `{}`; select site `nhl_dk` |
| get | dd_dfs_get | `{workspace_id}` |
| draft | dd_dfs_draft | `{workspace_id, expected_revision, draft}` |

Read schema first, then get an existing workspace. Edit the complete returned `draft` and save it with the exact returned revision. Revision zero creates a new name only. A conflict requires re-reading and reconciling changes, never blind overwrite. Always call get after a write and compare its draft and revision before claiming saved.

NHL draft fields: `sport: "nhl"`, `version: 1`, `platform: "dk"`, `players`, `roster`, `slate`, `model`, `receipt`, `synthetic: false`, optional `forecast` and `ownershipModel`. `roster` has nine nullable zero-based indexes in C/C/W/W/W/D/D/G/UTIL order. Players require unique string `id`, `name`, `team`, `opp`, `pos` array, positive integer `salary`, nullable ownership percent `own`, and `platform`. Preserve source fields, kickoff, NHL IDs and timestamped overrides. `slate` contains string `id`, string `date`, and `games` array. `model` may be null; otherwise preserve the returned historical model. `receipt` preserves CSV mapping and source provenance. The complete private draft limit is 550 KB; browser saves retain only model identities used in the pool.

The same validator runs in browser and server. It rejects duplicate/ineligible roster slots and locked-player changes. Incomplete and over-budget drafts can be saved for later editing; saving does not certify contest eligibility. Read `DDNHL.legality(players, roster, platform, slate)` in the published `dfs-nhl.js` for salary, minimum-three-skater-team and exact-slate diagnostics. No NFL solver/simulation/export operation supports NHL.

## Reviewed matchup projections

The builder can explicitly apply the published reviewed package only when platform-ID evidence or the dated source-row provenance described below, Eastern game dates and the exact game set match. Player matching requires unique normalized name, team, opponent and matching position; mismatches remain unprojected. Salaries and roster eligibility always come from the uploaded CSV, never placeholder prices. This checks consistency, not authenticity of a user-provided file.

The optional `forecast` is `{version:1, source, asOf, date, players:[{id, points, flag, line, pp}]}`. It stores conditional reviewed points separately from the historical `model`. Unknown playing/start probabilities and ownership stay unknown. Do not mix unmatched historical means into a reviewed-forecast total. Switching back to historical mode clears `forecast`. Refreshing an uploaded pool or exact-slate target invalidates the join.

AI clients may load and update the same complete draft through `dd_dfs_draft`; preserve provenance for any supplied forecast. These are user/model inputs, not server-certified predictions. No cash-rate, ROI or contest-entry claim follows from persistence. Actual October 14 salaries remain required for real October 14 lineups.

## Projection table schema

`get.nhl_projection_rows` (REST and MCP) is derived by the same `DDNHL.projectionRows` function as the browser table. CSV export includes id, name, team, position, salary, projectedPoints, projectionBasis, projectionAsOf, ceiling, ceilingPercentile, ceilingBasis, ceilingN, ceilingReason, estimatedOwnership, ownershipBasis, value and flag. Blank remains unknown. Salary/position come only from the uploaded CSV. Without an upload, the reviewed dataset is immediately available for filtering, sorting and research CSV export. Research rows expose sourcePosition and positionBasis separately; position (DK eligibility), salary and official IDs remain unverified/absent. Source position is displayed but must not be used as verified lineup eligibility. Research CSV is not a DK entry file. Historical partial-DK P90 remains separate from reviewed matchup points.

Ceiling means empirical historical **partial-DK P90**, with linear interpolation at sorted index `(n-1)*0.90`, using skater appearances or goalie starts. It is not a maximum, a simulated quantile, or a calibrated next-game forecast. It remains blank for fewer than 10 samples. See the historical scoring omissions and source cutoff; it is displayed separately even when the points column uses a matchup forecast.

Ownership remains null until supplied or explicitly generated using the gated **uncalibrated legal-lineup heuristic v1**. `ownershipModel` stores version, input fingerprint, asOf, seed, synthetic flag, confirmation, per-scenario percentages and per-player mean/low/high. Additional CSV fields: ownershipLow, ownershipHigh, ownershipSeed, ownershipAsOf. Uploaded `player.own` is preserved and used when no current heuristic exists. These are user/model assumptions, not server-certified field forecasts.

Generation requires a user-confirmed complete DK Classic pool from a platform CSV or the dated salary/eligibility source workflow below; an exact slate ID/date/game set; future Eastern-date-matching game starts; and available-player projections. Every player needs a named availability source stamped within six hours, without future timestamps. Skaters must be active/confirmed, goalies confirmed starters. Out/scratched/not-starting players are excluded; uncertain starters block generation. This validates consistency of user assertions, not authenticity of CSV/news. Synthetic examples remain labeled and cannot be saved to real workspaces.

Three scenarios each draw 300 legal lineups using a fixed seed. Within overlapping eligible positions, rank percentiles use midranks. Projection weights: exp(2 * (0.8 * projectionRank + 0.2 * valueRank)); value weights use 0.25/0.75. Stack preference uses projection weights, doubled for a non-goalie sharing a supplied line or PP unit with a selected teammate. These are explicit assumptions, not fitted coefficients. Weighted random ordering and bounded backtracking enforce nine unique player identities, slot eligibility, $50,000 maximum and three skater teams. This is not an exact uniform/Gibbs sampler. Repeated rosters across independent draws are allowed. Minimum salary spend, contest duplication and actual field behavior are not modeled.

Raw inclusion percentages sum to 900% overall, 100% goalie and 800% skater. The displayed mean equally mixes scenarios, with scenario extrema as the range: not a confidence/prediction interval. Whole-percent rounding can change sums. Monte Carlo sampling noise is not predictive validation. Incomplete/budget-exhausted searches return no percentages and do not prove infeasibility. Same inputs/seed/version are reproducible. Salary, eligibility, identity, role/status, projection or slate edits invalidate the receipt; expired availability/game lock suppress it. Zero only describes excluded/unselected players in a completed conditional sample, never missing ownership. No observed contest-field calibration or cash/ROI claims.

The collapsible pair matrix is qualitative. Same-line/PP shared scoring, own-goalie mixed drivers, and opposing-goalie conflicts are hypotheses. No paired-game empirical study, sample size, numeric coefficient or shrinkage model is claimed. The matrix is not a joint simulator and does not predict cash rates.

P90 is never availability-weighted or summed into a lineup ceiling. Legitimate zero-score appearances, negative goalie scores and pulled starts remain in the empirical history. The ownership sampler uses legal nine-slot lineups: marginal inclusion rates sum to 900%, with goalies 100% and skaters 800%; UTIL changes C/W/D totals. Scenario sensitivity would describe assumptions, not cash probabilities. Marginal historical summaries cannot supply covariance; numerical correlations need joint game histories, contemporaneous roles, joint sample sizes and a defensible shrinkage/positive-semidefinite treatment.


## Normalized salary-source imports

The same DFS CSV input accepts normalized rows from a permitted, independently checked current salary/eligibility source; original DraftKings file bytes are not required for manual lineup research. Required columns: Name, Position (DK eligibility verified in source), Team, Opponent, Salary, SlateID, Date, Kickoff (ISO timezone), SalarySource (HTTPS URL), SalaryAsOf (ISO timestamp), EligibilitySource (HTTPS URL), EligibilityAsOf (ISO timestamp). Use the exact source slate identifier/date/game set; never invent an official draft-group ID. Provenance timestamps must be nonfuture and within 36 hours for the reviewed join/ownership gate. The tool validates consistency, not authenticity or publication rights; checking the cited source remains required.

Omit ID when an official DK ID is unavailable. The importer creates an internal name/team key while retaining platformId:null. This is not a fabricated DK ID. Numeric IDs from unrelated providers must not be placed in ID. Manual roster legality does not require official IDs. Research CSV exports carry nullable platformId and source URLs. No DK entry exporter is implemented; missing IDs must never be filled from internal keys. Exact name/team/opponent/position matching can apply reviewed projections to sourced rows. Availability/news Source and SourceAt are separate from salary/eligibility provenance and still required for ownership sampling.


## Private ten-lineup sets

The page accepts `{version:1,lineups:[{label,draft}]}` with 1–10 complete NHL drafts sharing one exact slate. The draft matches the API schema above; `sport:"nhl"` is optional in local import and required in API writes. Imported sets stay local until explicit Save. Each lineup saves to an existing private workspace named `<set-name>-01` through `-10`; no new backend endpoint, permission, public dataset or shared-account store exists. Saves are sequential, revision-checked and read back individually; partial failures preserve already verified saves and report progress, rather than claiming an atomic save. A new name uses expected_revision 0; loaded sets retain current revisions. A name conflict never silently overwrites another workspace. `?set=<set-name>` reloads the matching private workspaces after sign-in. Account changes clear local set data.

Generation samples 900 legal rosters across the same three documented preference scenarios, deduplicates player sets, and greedily ranks candidates by conditional projected points minus two points per shared player against the most-overlapping selected candidate. Ten candidates must each share at most seven players with every earlier candidate. This is a transparent diversity heuristic, not a global optimizer or a model of paid-cutoff likelihood. Insufficient diversity returns an explicit error. Current source/availability gates apply; imported drafts instead display their gaps for review.

The interactive chart plots salary against the sum of conditional player points; selection reveals roster, salary remaining, projection as-of, sourced status warnings and qualitative stack diagnostics. Pairwise overlap is a count out of nine. Player/goalie exposure is fraction of this set; team inclusion is the fraction containing at least one player from that team. These are not contest ownership, uniqueness, cash probabilities or joint ceilings. Missing projections remain unknown. Private JSON export is for review/backup, not a DK entry CSV. Synthetic sets cannot be saved as real account lineups.
