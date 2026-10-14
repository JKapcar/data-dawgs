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

NHL draft fields: `sport: "nhl"`, `version: 1`, `platform: "dk"`, `players`, `roster`, `slate`, `model`, `receipt`, `synthetic: false`, optional `forecast`. `roster` has nine nullable zero-based indexes in C/C/W/W/W/D/D/G/UTIL order. Players require unique string `id`, `name`, `team`, `opp`, `pos` array, positive integer `salary`, nullable ownership percent `own`, and `platform`. Preserve source fields, kickoff, NHL IDs and timestamped overrides. `slate` contains string `id`, string `date`, and `games` array. `model` may be null; otherwise preserve the returned historical model. `receipt` preserves CSV mapping and source provenance. The complete private draft limit is 550 KB; browser saves retain only model identities used in the pool.

The same validator runs in browser and server. It rejects duplicate/ineligible roster slots and locked-player changes. Incomplete and over-budget drafts can be saved for later editing; saving does not certify contest eligibility. Read `DDNHL.legality(players, roster, platform, slate)` in the published `dfs-nhl.js` for salary, minimum-three-skater-team and exact-slate diagnostics. No NFL solver/simulation/export operation supports NHL.

## Reviewed matchup projections

The builder can explicitly apply the published reviewed package only when uploaded numeric platform IDs, Eastern game dates and the exact game set match. Player matching requires unique normalized name, team, opponent and matching position; mismatches remain unprojected. Salaries and roster eligibility always come from the uploaded CSV, never placeholder prices. This checks consistency, not authenticity of a user-provided file.

The optional `forecast` is `{version:1, source, asOf, date, players:[{id, points, flag, line, pp}]}`. It stores conditional reviewed points separately from the historical `model`. Unknown playing/start probabilities and ownership stay unknown. Do not mix unmatched historical means into a reviewed-forecast total. Switching back to historical mode clears `forecast`. Refreshing an uploaded pool or exact-slate target invalidates the join.

AI clients may load and update the same complete draft through `dd_dfs_draft`; preserve provenance for any supplied forecast. These are user/model inputs, not server-certified predictions. No cash-rate, ROI or contest-entry claim follows from persistence. Actual October 14 salaries remain required for real October 14 lineups.
