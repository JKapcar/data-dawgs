# Prospective survivor receipts — spec

**Status:** design only. **No write path in this commit, deliberately.**
Written 2026-08-23 · Stage E of the Survivor v2 handoff

---

## What this is, and why it is the differentiator

Every survivor optimizer on the market tells you what to pick. None of them keeps a
dated record of what it told you *before the games were played*, resolves it afterwards,
and publishes the score. ClevAnalytics ships a better decision UX than we do; nobody in
this space ships receipts.

The claim we would be able to make — and the only claim worth making — is narrow:

> Here is every week's number-one recommendation, stamped before kickoff, with the win
> probability it was stated at. Here is whether it survived. Here is the Brier score on
> those stated probabilities across the season.

That is a *calibration* claim about our stated probabilities, not a claim that the tool
beats a pool. It cannot become the second thing by accident, and the surfaces that carry
it must be worded so it cannot be read as the second thing either.

## Prospective by construction, not by assertion

The one property that makes a receipt worth anything is that it could not have been
written after the fact. This design gets that from structure rather than from a promise:

- **`captured_at < kickoff_at` is enforced on write, not checked on read.** A capture
  attempted after the earliest kickoff in its week is refused, not stored-and-flagged.
  A ledger that contains late rows marked "late" is a ledger someone will eventually
  quote without the flag.
- **A receipt is write-once.** A second POST for the same `(season, week, entry_id)`
  is refused with a conflict, never an overwrite. If a recommendation genuinely changes
  because lines moved, that is a *new* receipt with its own `captured_at` and a
  `supersedes` pointer — both rows stay, and grading uses the last one captured before
  kickoff. Editing a dated call is the failure mode this whole site exists to avoid.
- **The inputs are pinned.** `input_snapshot_id` records the exact `survivor.json`
  the recommendation was computed from (its `as_of` plus a hash), so a receipt can be
  recomputed and shown to be what the tool actually said, rather than what the tool
  would say now. ⚠️ Today that snapshot is a hand-pasted blob with no generator — see
  the I-2 note in the handoff. **A receipt pinned to an unreproducible input is weaker
  than it looks, and this spec should not ship before that is fixed.**

## Payload schema

One receipt = one week's recommendation from one configuration. Configuration matters:
the number-one pick for a 20-entry pool is not the number-one pick for a 5,000-entry
pool, and a ledger that mixes them is unreadable.

```jsonc
{
  "receipt_id":        "survivor-2026-w01-default",   // stable, derivable, unique
  "season":            2026,
  "week":              1,
  "entry_id":          "default",        // which configuration this is a call for

  // --- the call, exactly as the board stated it -------------------------------
  "recommended":       ["LAC"],          // ARRAY: a double-pick week states two
  "stated_win_probability": [0.7849],    // per leg, in the same order
  "stated_leg_source":      ["market"],  // market | model, per leg
  "stated_equity_index":    100,         // the board's own 0-100 index for the pick
  "stated_run_the_table":   0.0021837,   // the card's full-season number
  "alternatives":      [                 // the other two cards, so "we got lucky" is checkable
    { "team": "JAX", "win_probability": 0.7411, "equity_index": 94 },
    { "team": "DET", "win_probability": 0.7170, "equity_index": 91 }
  ],

  // --- what produced it ---------------------------------------------------------
  "objective":         "winnings",       // winnings | survival
  "ownership_source":  "modelled",       // posted | modelled
  "ownership_adjustment": "alive-count projection; pick mix assumed independent of survival",
  "config": {                            // everything that changes the answer
    "entries": 200, "lives": 1, "reuse": false,
    "double_pick_weeks": [], "week18_mode": "normal",
    "blend_market": 0.75, "chalk": 2.4,
    "used_teams": []
  },

  // --- provenance ---------------------------------------------------------------
  "input_snapshot_id": "sha256:…",       // the survivor.json this was computed from
  "input_as_of":       "2026-08-06",
  "engine_version":    "survivor-path-engine@<git sha>",
  "captured_at":       "2026-09-09T15:02:11Z",
  "kickoff_at":        "2026-09-10T00:20:00Z",   // EARLIEST kickoff among the legs
  "forecast_status":   "prospective",     // prospective | resolved | void
  "supersedes":        null,

  // --- filled in after the games, never before ----------------------------------
  "resolved": null
  // {
  //   "resolved_at": "2026-09-15T04:00:00Z",
  //   "leg_results": ["win"],            // win | loss | push-equivalent
  //   "survived": true,                  // ALL legs won
  //   "brier": 0.0463,                   // mean over legs of (p - outcome)^2
  //   "result_source": "espn"
  // }
}
```

### Field notes worth arguing about now rather than later

- **`recommended` is an array from day one.** Double-pick weeks are modelled as of
  Stage B, so a scalar would need migrating within the same season it shipped.
- **`survived` is AND over the legs.** A double week where one leg won and one lost is
  `survived: false` with `leg_results: ["win","loss"]`. Reporting "half survived" would
  be reporting something the game does not have.
- **Brier is the mean over legs**, so a double week contributes two scored predictions.
  That is the right unit: two probability statements were made.
- **`entry_id`** exists so several configurations can be tracked without pooling them.
  Grading must never aggregate across `entry_id` without saying so.
- **`alternatives`** is what makes the ledger honest in the other direction. Without it,
  a season where the top pick survives 15 of 18 looks like skill even if the second and
  third cards would have gone 15 of 18 too. It is also what allows an eventual
  "did ranking add anything over taking the biggest favourite" question.
- **`void`** covers a week where no legal pick existed, or where the underlying game was
  cancelled. A void row stays in the ledger and is excluded from Brier with its reason
  recorded, rather than being deleted.

## Capture trigger

**Not automatic on page load.** A receipt written every time someone opens the page
produces hundreds of near-duplicate rows and makes `captured_at` meaningless.

The recommended trigger is a scheduled Worker cron, once per week, at a fixed offset
before the week's earliest kickoff (e.g. Thursday 16:00 UTC):

1. Read the current `survivor.json`.
2. Compute `rankWeek(week)` for each registered `entry_id` configuration.
3. Refuse and log if `now >= kickoff_at` for that week.
4. Write the receipt, write-once.

A manual `POST /survivor-receipt` under `DAWG_PASS` should exist too, for the week the
cron misfires — with the same `captured_at < kickoff_at` enforcement, no exceptions.

**Registered configurations** are the open sub-question: a cron cannot read a reader's
localStorage, so the ledger can only ever grade configurations the *site* declares. One
public default (200 entries, single life, no reuse, winnings objective) is the honest
minimum and probably the whole thing. Grading a per-reader config would need those
configs stored server-side, which is a different feature with a privacy conversation
attached.

## Grading join

Resolution reuses the existing weekly results path rather than adding a second source of
truth about who won:

- join on `(season, week, team)` against the same graded results the board already reads
- run after the week is fully final, not per-game
- write `resolved` in place — this is the **one** legal mutation of a receipt row, and it
  may only ever go from `null` to a value, never from a value to a different value

⚠️ **Brier is only meaningful once there are enough rows, and 18 weeks is not enough.**
A single season yields at most 18 scored predictions for one entry. The surface must
print `n` next to every Brier and must not draw a calibration curve on a season. This is
the same discipline the CLV chart's luck band already applies, and for the same reason.

## Where it surfaces

`receipts.html` already has the right shape: sections for registered receipts, grading,
calibration and week-by-week. Survivor receipts become one more registered ledger there:

- a row in **"Every receipt this site has registered"** naming the survivor ledger, its
  count, and `n`
- a **week-by-week** table: week, pick, stated probability, result
- **no calibration curve** until `n` justifies one, with the reason printed in place of
  the chart rather than the section being hidden

`surfaces.json` gains a machine entry for the ledger, and `llms.txt` points at it —
**both in the same commit that ships the write path, never before.** Until then the
survivor surface's `gap` stays as it is.

## ⚠️ The open decision — storage family — is Kap's

This is the reason Stage E stops at a spec.

The repo has two established patterns and the choice between them is not cosmetic:

| | KV family | Published ledger |
|---|---|---|
| **Shape** | `survivor:receipt:{season}:{week}:{entry_id}` in `DD_KV`, beside the existing `survivor:{season}:{week}` ownership keys | a `/data/survivor-receipts.json` envelope built by a script, like `model-receipts.json` |
| **Reads** | Worker only; needs a route and an MCP tool to be visible | free — it is a static file, already in `surfaces.json`, already fetched by `llms.txt` consumers |
| **Integrity** | write-once enforced in code | the file is in git; every change is a diff with an author and a date |
| **Prospective proof** | `captured_at` is a field the writer sets | the commit timestamp is independent corroboration of `captured_at` |
| **Cost** | one more key family in a namespace that is mid-migration | a build step, and a commit per week |

**The published-ledger option is stronger on exactly the property that makes this
feature worth building** — a git commit dated before kickoff is evidence a self-reported
`captured_at` field is not. The KV option is cheaper and matches where the ownership
data already lives.

⚠️ **This collides with the DD_KV migration plan and that is why it is not being decided
here.** The handoff points at `claude/data-dawgs-dd-kv-migration-plan.md`; **that file is
not in this repo** — `claude/` does not exist on `main` as of 2026-08-23. Whatever it
says about the five key families needs reading before a sixth is added. If the migration
is consolidating families, adding `survivor:receipt:` now is work that gets redone.

**Question for Kap, stated plainly:** KV family or published ledger? If the answer is
"published ledger", Stage E's write path is a build script plus a cron that commits, and
it does not touch DD_KV at all.

## What is explicitly not in scope here

- The write path. Not built, by instruction.
- Backfilling receipts for weeks already played. There is no honest way to do it; a
  backfilled receipt is not prospective and would poison the ledger's only claim.
- Grading anything other than survival and Brier on the stated probability. "Would you
  have won the pool" depends on the rest of the field and is not ours to score.
