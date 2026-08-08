# MCP tool annotations and the core/full catalogs

**Status: in the repo and in the committed Worker source. NOT deployed.** The live
endpoint still serves 42 tools on one path with no annotations. `/mcp/core/<credential>`
does not answer. `data/surfaces.json` reports the catalogs under `mcp.catalogs_staged`
for exactly that reason.

Shipped in `e99ddf1`. Base `c3f7250`. Worker `toto` unchanged at
`5445f0d9-793c-4ee7-9805-ff0db7f64cbc`.

## What it does

Every tool in `work/mcp-block.js` carries three new fields: `title` (a short display
name), `readOnlyHint` (`true` for all 43 today) and `catalog` (`core` or `full`).
`tools/list` projects the first two into the MCP annotation shape — top-level `title`
plus `annotations: { title, readOnlyHint }`. `catalog` is ours and never crosses the wire.

Three paths, and the catalog segment is stripped before the credential is read:

| Path | Catalog | Tools |
|---|---|---|
| `/mcp/<credential>` | full | 43 — unchanged from today |
| `/mcp/full/<credential>` | full | 43 |
| `/mcp/core/<credential>` | core | 16 |

Core is the everyday league surface: `dd_whoami`, `dd_league_overview`, `dd_bozo_week`,
`dd_bozo_standings`, `dd_draft_bozo_leg`, `dd_draft_board`, `dd_draft_pool`,
`dd_survivor_week`, `dd_survivor_ev`, `dd_analyze_matchup`, `dd_convert_odds`,
`dd_price_parlay`, `dd_calculate_bet_ev`, `dd_scores`, `dd_guillotine_odds`,
`dd_site_map`. Everything else — the sixteen college-football evidence tools, the DFS and
survivor solvers, the model scoreboard, the less common price math — is full only.

## Three decisions worth knowing

**The default stayed `full`.** `/mcp/<credential>` serves all 43 exactly as before.
Making core the default would silently remove tool names a live connector may already be
calling. That is the same breaking change as renaming a tool, which is also why the
`dd_find_cfb_*` family has not been consolidated.

**The catalog is the surface, not a listing hint.** A full-only tool called on
`/mcp/core` returns `-32602` naming the catalog and the full URL. If only `tools/list`
were filtered, `core` would be a suggestion a model steps around by remembering a name it
saw in another conversation, and the context saving would be fictional.

**Only two annotations.** `title` and `readOnlyHint`. `destructiveHint` is defined only
when `readOnlyHint` is false. `idempotentHint` and `openWorldHint` would have been a
guess repeated 43 times. An annotation a client trusts and nobody checked is worse than
no annotation.

## ⚠️ DAWG_PASS must never be literally `core` or `full`

A first path segment matching a catalog name is consumed as the catalog, so a passphrase
of `core` or `full` would be unreachable. Per-user tokens start with `u_` and cannot
collide. The same warning is in the header of `work/mcp-block.js`.

## Deploy checklist

⚠️ **A Worker deploy needs Kap's fresh explicit approval every time.** Nothing below is
authorised in advance.

The order matters. Deploying without step 3 leaves `data/surfaces.json` claiming 42 live
tools and a staged catalog block, while the endpoint serves 43 and answers on
`/mcp/core/`. That is the coverage map lying, which is the one thing that file exists to
prevent.

1. Reconcile `origin/main`. Kap runs manual Codex on this repo and it deploys the Worker.
2. Deploy `dawg-bot-worker.js` (see `docs/worker-deploy.md`). Do NOT hand-edit the
   assembled MCP region — edit `work/mcp-block.js` and run `node assemble.mjs` from
   `work/`.
3. In the SAME follow-up commit to `main`:
   - `tools/build-data.js`: empty `MCP_STAGED` (`dd_draft_bozo_leg` is live once the
     Worker carries it). `MCP_LIVE` needs no edit — it is derived from the registry.
   - `tools/build-data.js`: move the catalog and annotation blocks out of
     `catalogs_staged` / `annotations_staged` into live claims, and update
     `MCP_ENDPOINT.path` to name the catalog routes.
   - Re-run `DD_BUILD_DATE=<the committed date> node tools/build-data.js`. Pin the date
     or every envelope's `built` field moves and the diff explodes.
   - `work/test-pound-contracts.js`: the staged assertions become live assertions. The
     suite currently asserts `tools_staged === ['dd_draft_bozo_leg']` and that
     `catalogs_staged.status` starts with `STAGED`, so it goes red until this is done —
     which is the point.
   - `work/test-mcp.mjs`: the tool count assertion moves from "43 in the staged Worker
     source" to 43 live.
4. Verify against the deployed endpoint, not the repo: `GET /mcp/<credential>` should
   list both catalog paths, `tools/list` on `/mcp/core/<credential>` should return 16
   with annotations, and a full-only tool on the core path should return `-32602`.

## What is not proved

Nothing in this repo touches the deployed endpoint. The live tool count, the catalog
routes and the annotations on the wire are unverified in production until step 4 above
actually runs against `toto`.
