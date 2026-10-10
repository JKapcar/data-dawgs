# DFS Labs Playbook

Updated October 9, 2026. Operating instructions for DraftKings NFL Classic and Showdown, for people and personal AIs. This guide describes the implemented workflow; simulation outputs remain model estimates. Read the live `dd_dfs_schema` for current fields and limits. The older DFS Labs Bible is a research archive, not proof of calibration or a list of shipped features.

## Start here

Sign in with your own account, upload your projections, name the workspace, and choose Save privately. Connect your own AI through the site's Connect your AI link. Give it the workspace name and your contest screenshots or entry list. The AI can then do the import checks, candidate generation, contest comparisons and exposure audit. Load saved brings its changes back to this device. Uploading alone does not share a slate with your AI.

Each person uses their own account and authorized projection files. A public guide gives an AI instructions, not access to someone else's private workspace. Never paste the personal connector URL into a chat, report or public page. A connected tool is not the same as a link the AI can only read.

## The short instruction to give your AI

Read https://datadawgs216.com/docs/dfs-playbook.md, discover my Data Dawgs tools, and call dd_dfs_schema. Use my saved DFS workspace and contest screenshots to build and compare lineups for each actual contest. Check the data before solving, use the actual field and payout settings, and give me a short menu of defensible game-script choices. Show the cost of weaker choices. I choose how many entries to play. Audit my combined exposure, refresh availability before lock, and provide a contest-to-lineup table. Ask only for missing inputs. Rank evidence by section 0 of the playbook and label anything else as a hypothesis. Do not claim a simulation ran unless it did, invent unavailable EV, or submit paid entries.

## Optional command words

Users can drive the workflow with one word plus their files. Ask for anything a command needs that is missing.

| Word | What the AI does |
| --- | --- |
| `screen` | Screens the listed contests (section 1): rake, payout shape, entry cap against the user's entry count, total buy-in against bankroll |
| `classic` or `showdown` | Runs sections 1–7 for that format. Showdown starts with a menu of captains and game scripts for the user to choose from |
| `sim` | Simulates the actual contests and ranks candidates without overclaiming (section 6) |
| `swap` | Late swap from the live state: unlocked slots only, with the remaining field in mind; says whether it protects position or chases |
| `results` | Builds the post-slate audit (section 8) |
| `review` | Summarizes the ledger by format, contest type and construction, with sample sizes |

## 0. Weigh evidence before using it

Rank evidence before acting on it. First, the user's own logged results (section 8). Second, the user's private research notes, whose confidence labels are binding. Third, published studies with a stated method and sample. Everything else, including podcasts, videos, social posts and your general knowledge, is a hypothesis: label it as one when it shapes a recommendation. Logged results outrank published research only once their interval excludes the published figure; until then, show the two side by side.

- Name the format first: Classic or Showdown, plus field size, buy-in and entry cap. Findings do not transfer between formats, or between a 1,500-entry contest and a 100,000-entry one.
- A rate among winners shows nothing about leverage without the field's rate for the same thing. State or ask for the comparator.
- When a number drives a decision, give its season, sample size and contest type. An old top-100 study gives a direction, not a current rule.
- Cash, top-10 and top-1% rates are not ROI. Say ROI is unknown until duplicate prize splits are accounted for.
- When credible sources disagree, show both sides and the test that would settle it. Do not average them.
- Label any figure computed from published numbers as derived.

| Label | Meaning | How to use it |
| --- | --- | --- |
| verified | Checked against its source; not contradicted by independent evidence | Default rule |
| challenged | Direction holds; size or currency disputed | Use the direction, never the exact number |
| vendor-only | One vendor's data, not reproduced elsewhere | Working rule or tiebreaker; retest in season |
| measured | A Data Dawgs estimate from public data, such as `dd_dfs_correlations` | League-average structure, not a forecast for a specific game |
| social | A number from a social post | Log it and test it; never change a rule because of one |
| hypothesis | Anything outside the ranks above | Test it before relying on it |
| own-data | The user's logged results | Top rank once the sample supports it; always state n |

Private notes may use their own names for these labels; map each to the closest row.

## 1. Establish the slate and each contest

Record the sport, date, timezone, site, format, slate or draft-group ID and lock time. Do not combine games, formats or vendor files just because the names look similar. For every contest, capture its ID/name, buy-in, field capacity and current entrants, maximum entries per person, the user's entry count, prize pool and full payout table when available. Record where and when these came from.

Ask for missing screenshots or exports once; prepare candidates while waiting. Never infer field size from a contest name, buy-in or prize pool alone. Distinguish projected final fill from current entrants. A default profile is a scenario, not the user's actual lobby. The user sets budget and entry count; a 150-entry cap is not a recommendation to buy 150 entries.

Screen each contest before building for it. Rake is 1 − prize pool ÷ (entries × entry fee). Lower rake, flatter payouts, smaller fields and an entry cap near the user's own entry count are friendlier. Contests full of max-entry players are a structural disadvantage for someone entering a few lineups. If the user asks for a bankroll rule, the house default is total weekly buy-ins at or under 1/40 of bankroll, with more cushion for larger, more top-heavy fields.

## 2. Audit the inputs before choosing players

- Check source and source time separately from upload time; if the original timestamp is unknown, say so. Refresh player availability, salaries, ownership and projections when stale. Known injury news may already be included in projections: avoid counting it twice.
- Check all import matches and dropped rows, aliases, teams, opponents, game IDs, eligible positions, missing values and duplicate players. Missing projection is not zero. Never silently remove a player's eligibility or invent official IDs.
- Classic has nine roster spots; DK Showdown has one 1.5x captain and five FLEX under $50,000, with both teams represented. Validate against the current contest rules and official salaries. Do not apply Classic construction rules to Showdown by accident.
- For a Showdown file whose Total Own includes captain, FLEX ownership = Total Own minus CPT Own. Expected totals are about 600%, 100% and 500%. Inspect the vendor's convention first. MCP ownership fields use percentage points, while some settings use fractions; schema is authoritative.
- Preserve source CPT projections and explain any 1.5x normalization or rounding reconciliation. Official FLEX and CPT IDs are needed for export. A third-party projection CSV may not contain them.
- Keep article opinions, usage measurements and projections separate. Weekly snaps are not season route participation. A different game's optimal-lineup rates do not apply to this slate. Low ownership alone is not positive leverage.

## 3. Use the app and tools in this order

| Job | In the app | Personal AI tools and checks |
| --- | --- | --- |
| Find the correct data | Private workspace: Find saved / Load saved | `dd_dfs_schema`, `dd_dfs_list`, `dd_dfs_get`; verify account, format, source, revision and pool |
| Import and save | Upload or replace your CSV; Save privately | `dd_dfs_create` if needed; `dd_dfs_upload` with commit=false, inspect diagnostics, then commit=true; keep returned revision |
| Set constraints | Slate and Solver sheets | `dd_dfs_players`, `dd_dfs_settings`; preserve user locks/exclusions and use live schema units |
| Generate candidates | Solver and Lineup lab | `dd_dfs_solve`, `dd_dfs_explore`; record objective, filters, timeout/cap and best projection found |
| Evaluate the actual contest | Simulator | `dd_dfs_settings` for simulation, then `dd_dfs_simulate`; inspect full results using `dd_dfs_get` with include_results=true |
| Explore broad contest types | Contest comparisons | `dd_dfs_compare` supports cash/3x/5x/GPP profiles; these do not replace an arbitrary lobby's full payout table |
| Choose the entries | Exposure and selected lineups | `dd_dfs_exposure`, `dd_dfs_select`; selection retains chosen indexes and invalidates the old simulation |
| Finish | Export; Save privately / Load saved | Revalidate selected rosters and use `dd_dfs_export`; exported rosters do not submit or automatically assign entries to contest IDs |

Every mutation that requires expected_revision must use the latest returned revision. On conflict, re-read and reconcile. Input/settings changes can clear candidates or results; another solve/explore replaces the stored pool. Preserve chosen roster contents and a run receipt before changing settings or selecting. Lineup indexes can change; never carry an index into a different pool. Use separate named workspaces when retaining alternatives, and paginate get when needed. Browser and remote changes are explicit save/load, not automatic synchronization. Browser loading refuses unsupported MCP-only player groups rather than silently dropping them.

If tools are not callable, say so and use the browser workflow when available. Public docs cannot grant private access. The older `dd_solve_dfs_lineup` is transient; it does not replace the persistent workspace suite. Do not claim remote work was done from a local calculation.

## 4. Build for each lobby

| Contest situation | Candidate construction | Evaluation and selection |
| --- | --- | --- |
| Cash / double-up / head-to-head | Strong projection and reliable opportunity; benchmark unrestricted mean projection | Cash probability against the appropriate field when supported. Do not sacrifice points simply to lower ownership |
| Small-field single-entry GPP | Strong projection with credible ceiling; compare modest differentiation and alternate stacks | Actual payout-aware evaluation when credible; disclose the projection cost of uniqueness. Small field does not imply weak opponents |
| Large or very top-heavy GPP | Generate several captain/stack families, popular-core alternatives and plausible ceiling outcomes | Modelled tail performance, correlation and prize splitting. If first-place EV is unresolved, report supported proxies and sensitivity, not invented precision |
| Several entries / 3-max / 20-max / 150-max | Start with the best individual candidates, then inspect shared players, stacks and failure modes | Respect the user's actual entry count. Exposure caps and min-uniques are constraints, not proof of an optimal portfolio; measure their cost |
| Same lineup considered for several lobbies | Reuse it as a candidate rather than automatically forcing a new roster | Compare against each lobby's field and payout. Repetition may be justified; disclose total dollar exposure and correlated losses |

Single-entry describes entry limits, not field size. Expensive contests are not automatically small or soft. Cash and tournaments do not share one universal sorting objective. Top-10 and top-1% are different thresholds and neither automatically maximizes payout EV. Use explicit actual payout rows when available; if approximating, label the assumed curve. Rake and payout concentration inform contest choice, but do not by themselves prove a profitable entry.

## 5. Generate options before telling a story

First compute a raw-projection benchmark with discretionary construction restrictions removed; preserve legality and user requirements and state those conditions. Then generate baseline, alternative game-script and popular-core-fade candidates. Classic QB stacks and Showdown receiver-CPT/QB pairings are useful hypotheses, not universal locks. Evaluate rushing-QB and salary exceptions. Leaving salary unused, two same-team tight ends, kickers or D/ST should be judged on the slate and contest rather than prohibited by folklore.

Do not force every suggested three-player stack if its best completion loses too much projection. A punt's playing time does not ensure targets. Vary cheap-player roles and ownership, and compare alternative field strength/salary assumptions. Use common score worlds for candidate comparisons where supported, then report held-out results. Repeatedly optimizing against the holdout turns it into training; fresh evaluation is preferable after final selection.

Give the user a small menu of the strongest defensible scripts. Quantify weaker options. Different captain names with the same five FLEX players do not provide much diversification. Portfolio diversification can reduce shared downside, but it does not automatically increase expected profit; increasing the chance of one high finish is a different objective.

## 6. Read results without overclaiming

- Inspect the current engine/mode. The contest simulator's correlated score worlds are not a vendor's play-by-play simulations. Its historical variance is not derived from the uploaded Ceiling column. Summing player ceilings does not produce a lineup ceiling. Classic score-tail thresholds are not contest placements or payout EV.
- Check ownership reconciliation, field-strength diagnostics, correlation fallback and CPT scoring. A softer modelled field can make every lineup look profitable. A passed numerical gate is not external calibration.
- Ownership product and analytic expected-copy adjustments are uncalibrated priors. Zero matches in a sampled field does not prove uniqueness. Verify tie handling before applying any extra duplication haircut.
- Sampled opponents may not resolve first-place probability or top-heavy ROI. Approximate numeric output is not a workaround. Top-10 means literal positions 1–10. Win-lineup player rate means inclusion in the best sampled opponent, not inclusion in an exact optimal lineup.
- Report timeouts, pool caps and incomplete frontiers. Do not call partial search exhaustive or treat a timeout as proof of infeasibility. Final exposure bounds can fail because generation is heuristic; audit actual counts.
- Punt/no-touch outcomes and kicker correlations are model-sensitive. Monte Carlo intervals cover simulation noise conditional on assumptions, not projection or field-model error. Three weeks of results alone cannot establish calibration or justify a claim of professional equivalence.

## 7. Deliver a usable entry plan

Return one row per purchased or intended entry: contest ID/name, entry fee, roster and captain where applicable, salary used/left, projected points, game script, reason for this contest, main failure condition and metrics actually computed. Include the source time, workspace/revision, simulation settings and seed. If candidate ranking uses proxies, label them. Keep private projections and account credentials out of public reports.

Before export, recheck official inactives, slate, eligibility, salary cap, unique players, team/game constraints, slot IDs, existing locked players, entry count and current exposures. Never re-optimize a locked entry as if every slot were open. Re-run affected comparisons after fresh news. Preserve the selected rosters and their evaluation receipt before selection invalidates prior results. The user reviews and submits entries.

## 8. Close the loop after the slate

- Build the post-lock audit from DraftKings contest-standings files: sign in, open dfs.html#standings, choose the slate's saved workspace, enter the DraftKings username and add the standings CSVs. The ledger joins each entry to the pre-lock workspace and refuses snapshots saved after lock unless overridden. Command line: `node tools/dfs-ledger.mjs`. Reference: https://datadawgs216.com/docs/dfs-results-ledger.md
- Check the three ownership misses that sink lineups after lock: the stack's correlated pieces owned more than projected, chalk players owned together more often than their individual ownerships imply, and the intended differentiator becoming popular.
- Compare pre-lock and post-lock expectations. One slate never changes a rule.
- The ledger is the user's own-data rank (section 0). Report sample sizes. ROI needs hundreds of entries in a bucket before it can outrank published research; cash and top-10 rates settle sooner.

## Maintenance and evidence

This is the reusable operating guide; current-slate research belongs in the user's private workspace or dated report. Technical reference: https://datadawgs216.com/docs/dfs-mcp-workspace.md. Historical research: https://datadawgs216.com/docs/DFS_LABS_BIBLE.md. Live schema and deployed behavior take precedence for capabilities. Historical findings do not establish this tool's calibration.

When a tool, workflow or material model limit changes, update this guide, its app rendering, the schema guidance and discovery links in the same release. Source: docs/dfs-playbook.md; render with node tools/sync-dfs-playbook.mjs. Public instructions must never embed subscriber projections, subscriber research figures, user lineups or connector credentials. Evidence rules here stay generic; numbers from subscriber research belong in each user's private notes.
