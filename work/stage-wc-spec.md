# Stage WC — the Worker batch (2026-08-10)

One deploy, two stages, both landing in `main` before the Worker moves.

Base: `origin/main` `b8df441`. Worker `toto` etag `e24980f19710ce87`, 43 tools live.
Kap's rulings, taken 2026-08-10 before he stepped away:

| # | Decision | Ruling |
|---|---|---|
| 1 | How far the `dd_find_cfb_*` consolidation goes | Merge the two latest/base pairs. 7 find tools become 5. |
| 2 | The retired names | **Remove cleanly.** 43 tools become 41. No aliases. |
| 3 | Entitlement vocabulary | `plan: free \| member`, `status: none \| active \| past_due \| canceled \| grace`, `period_end` epoch ms or null. |
| 4 | Codex | Not running. This session owns the Worker. |

Baseline at `b8df441`, every gate green before a single edit: verify-sw (28 HTML,
`15463857c2`), pound-contracts 63, machine-surfaces 31, mcp 343, backup 14, cep6-email 63,
cfb-market-capture 29, identity 93, league-join 47, sleeper-players 18, and
`DD_BUILD_DATE=2026-08-10 node tools/build-data.js` reproducing `data/` with an empty
porcelain.

⚠️ **`work/verify-sw.mjs` must run from the REPO ROOT.** `git ls-files "*.html"` is
path-relative, so from `work/` it matches nothing and the gate compares `sw.js` against the
md5 of no input at all (`d41d8cd98f`). It cannot pass from there, and the message names
`sw.js` rather than the cwd.

---

## WC-A — the `dd_find_cfb_*` consolidation

### What merges, and what does not

The seven `dd_find_cfb_*` tools read seven different files. Two of those files are derived
cross-sectional views of a parent:

| Tool | File | Shape |
|---|---|---|
| `dd_find_cfb_games` | `cfb-schedule.json` | the dated **2026** schedule |
| `dd_find_cfb_team_games` | `cfb-team-game.json` | one team's 2025 games (longitudinal) |
| ~~`dd_find_cfb_latest_games`~~ | `cfb-games-latest.json` | every team's last 2025 game (cross-sectional) |
| `dd_find_cfb_team_periods` | `cfb-team-week.json` | one team's 2025 periods (longitudinal) |
| ~~`dd_find_cfb_latest_team_periods`~~ | `cfb-team-week-latest.json` | every team's last 2025 period (cross-sectional) |
| `dd_find_cfb_record_divergence` | `cfb-record-divergence.json` | rank-gap descriptives |
| `dd_find_cfb_historical_market` | `cfb-market.json` | book-identified 2025 prices |

`dd_find_cfb_team_games` absorbs `latest_games`; `dd_find_cfb_team_periods` absorbs
`latest_team_periods`. Both keep their existing names, because both scopes return
per-team-perspective rows either way, so the name stays accurate.

`dd_find_cfb_games` stays separate on purpose. It covers the current dated 2026 schedule
while the team-game surface covers 2025 results. One tool spanning both invites a caller to
read 2025 form as 2026 form, which is the failure this whole registry is written to avoid.
Divergence and historical market stay separate because they are different questions, not
different views of one.

**No data file is removed.** Both derived files keep being built, keep their `data/index.json`
rows and keep their places on the Library shelf. This stage changes the tool surface, not the
data surface.

### The `scope` parameter

    scope: "team-games"      (default)  team REQUIRED   → the parent surface, one team
    scope: "latest-per-team"            team optional   → the derived surface, every team

and for periods:

    scope: "team-periods"    (default)  team REQUIRED   → the parent surface, one team
    scope: "latest-per-team"            team optional   → the derived surface, every team

### ⚠️ The hazard the merge creates, and how it is handled

Merging two tools with different filter sets into one flat schema means a caller can pass a
parameter that its chosen scope does not support. **Silently ignoring it is the dishonest
failure mode**: the caller gets a plausible answer to a question it did not ask.

Every scope-invalid parameter therefore **throws, naming the parameter and the scope**. This
is asserted, and mutation-proved by making the parser ignore the parameter instead and
watching the gate go red.

| | `team-games` | `latest-per-team` |
|---|---|---|
| accepts | `team` (required), `opponent`, `week`, `season_type`, `result`, `site`, `sort`, `limit` | `team` (optional), `conference`, `opponent_division`, `season_type`, `result`, `site`, `sort`, `offset`, `limit` |
| `sort` | `kickoff-asc` (default), `kickoff-desc` | `team-asc` (default), `kickoff-desc` |
| `limit` | 1-50, default 25 | 1-50, default 25 |

| | `team-periods` | `latest-per-team` |
|---|---|---|
| accepts | `team` (required), `week`, `season_type`, `sort`, `limit` | `team` (optional), `division`, `conference`, `season_type`, `period_outcome`, `sort`, `offset`, `limit` |
| `sort` | `period-asc` (default), `period-desc` | `team-asc` (default), `through-desc`, `conference-record-desc` |
| `limit` | 1-**25**, default 20 | 1-50, default 25 |

Consequences that are deliberate:

* `required: ["team"]` leaves the JSON Schema, because the requirement is now conditional.
  It is enforced in the parser with a named error instead. A schema that cannot express the
  rule must not pretend to.
* The `sort` enum is the **union**, and a value belonging to the other scope is rejected by
  name. Defaults differ per scope and are applied after the scope is known.
* The `limit` ceiling is the union maximum (50) in the schema and the per-scope ceiling in
  the parser, so `team-periods` still refuses 26. The bound exists because a period row is
  large; raising it silently would be a payload change disguised as a refactor.

### Response

`query.scope` echoes the scope. The **top-level `scope` field keeps its existing meaning** —
the data surface's own coverage string — so no current consumer's parsing changes. The payload
key stays what each surface already used: `games` under `team-games`, `rows` under
`latest-per-team`. A new top-level `response_shape` names which one it is, so a consumer
branches on a declared field instead of probing for a key.

### Blast radius

| File | Change |
|---|---|
| `work/mcp-block.js` | the merge; the two names deleted; registry 43 → 41 |
| `dawg-bot-worker.js` | regenerated by `cd work && node assemble.mjs`, never hand-edited |
| `tools/build-data.js` | `MCP_CFB_LIVE` drops both names (16 → 14); the `MCP_STAGED` note re-dated |
| `tools/cfb-roadmap.js` | two `candidate_mcp_tools` lists name the removed tools |
| `work/patch-mcp-annotations.py` | its title table would reintroduce them if re-run |
| `work/test-mcp.mjs` | 43 → 41, plus the merged-scope and scope-rejection assertions |
| `llms.txt` | `43` → `41` in three places; "Sixteen production CFB tools" → "Fourteen" |
| `docs/mcp-catalogs.md` | the counts, and the sentence saying this family has *not* been consolidated |
| `data/*` | regenerated with the date pinned to the ship date |

**No `*.html` changes**, so `sw.js` `VERSION` does not move and `verify-sw` stays green on
`15463857c2`. Confirmed: no page carries a typed tool count.

### ⚠️ The deploy order is REVERSED from the runbook, on purpose

`docs/mcp-catalogs.md` says to deploy first and flip the coverage map second. That order is
right for an **addition**, where the conservative direction is for the repo to under-claim
until the endpoint catches up (that is what `MCP_STAGED` expresses).

For a **removal** the conservative direction flips, and there is no `MCP_STAGED` equivalent
for it. So: **commit first, deploy minutes later.**

* Commit-then-deploy, if the deploy fails: the repo lists 41 while the endpoint serves 43.
  The map under-claims, and every caller of an old name keeps working. Nothing lies.
* Deploy-then-commit, if the commit fails: the repo claims two tools are live that now
  return `-32602` on the endpoint. The map over-claims, which is the one thing
  `data/surfaces.json` exists to prevent.

No repo test reads the deployed endpoint, so nothing goes red in the window between them.

---

## WC-B — the entitlement field on `/users`

**It belongs in this deploy.** The user record is `/users/<name>` in Firebase RTDB and no
RTDB rule covers it, so it default-denies every browser; only the Worker, holding
`FB_SECRET`, can read or write it. There is no client-side path to split out.

### Shape

    /users/<name>/entitlement = { plan, status, period_end }

    plan       "free" | "member"
    status     "none" | "active" | "past_due" | "canceled" | "grace"
    period_end epoch ms, or null

Every existing and new account is `{ plan:"free", status:"none", period_end:null }`.

`status` is not a boolean because subscriptions lapse and cards fail, and a lapse needs a
grace state that is not simply off. `plan` deliberately does **not** reuse the Pup / Working
Dawg words: those grade whether a *tool* has been validated, and a person's billing state is
not a validation verdict. Once money changes hands, conflating the two makes the tier labels
unreadable.

**Not added now, deliberately:** `stripe_customer_id`, `updated_at`. The argument for adding
`entitlement` early is that an absent field is *ambiguous* — nothing can tell a free account
from an unmigrated one. An absent `stripe_customer_id` is not ambiguous, it means not a
customer, so it can be added the day the webhook lands at zero migration cost.

### Where it is written

1. **Read-side default.** `entitlementOf(user)` returns the free default when the field is
   absent, so no read is ever ambiguous, including mid-backfill.
2. **Account creation** — signup, seed, and invite-of-a-new-person — writes the default.
   ⚠️ `authInvite` PATCHes `/users/<player>` for **existing** people too (re-inviting is
   supported). Writing the default there unconditionally would downgrade a paying member to
   free on a re-invite. It is written only when `isNew`. This gets its own assertion and its
   own mutation.
3. **A one-time backfill** in `loadUsers`, following the `fix`-object idiom `bozoRoster`
   already uses for invite-hash reconciliation: deep paths, one PATCH, errors swallowed
   because the next read retries. A no-op after the first call.

Nothing else. There is no Stripe webhook yet, so today the field has exactly one value and
exactly one writer, which makes the no-client-write property provable **before** the webhook
exists rather than after.

### Reads

`dd_whoami` reports the identified caller's own entitlement. An anonymous connection is told
it has none rather than being handed a default that looks like an account.

### What is asserted

* An untouched account reads `free / none / null`.
* A signup body carrying `entitlement` cannot set it.
* A re-invite of an existing member does not overwrite an existing entitlement.
* `dd_whoami` on an anonymous connection reports no entitlement rather than a free one.
* No request-body parse path anywhere in the Worker reads an `entitlement` key.

---

## Discipline

* Reconcile `origin/main` immediately before the write and again right before it lands.
* `git add -A` is the checkpoint. **Never `git checkout -- .`** — it destroyed a finished
  stage on 8/10.
* One mutation per assertion under test, each graded against a baselined gate. A mutation
  that leaves a gate green is information about the test, not about the code.
* Ship via `file_upload` from `/mnt/user-data/outputs/`. No chunked payload.
* Verify the Worker by reading `/content/v2` back and hashing it, not by trusting the PUT.
* Report the final `main` commit and the Worker version so Codex can resync.
