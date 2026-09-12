# Bozo — Merged CLV Section with Manual Close Entry

**For:** Codex, `github.com/JKapcar/data-dawgs`
**Owner:** Kap (commissioner / god admin)
**Date:** 2026-09-12
**Supersedes:** the two separate blocks on `bozo.html` — `CLV SUMMARY` and `MISSING CLOSING PRICES`
**Baseline:** `ef70e13` (PR #110 merged and deployed)

Where this document disagrees with `AGENTS.md`, `AGENTS.md` wins — flag it, don't guess.
Where it disagrees with the code, §9 is the list of known disagreements; anything not in
§9 that you find, add to §9 rather than picking a side silently.

---

## 0. Scope

Replace two sections with one. The merged section is roster-complete at the top level and
per-leg on expand, with manual closing-price entry on any leg the capture pipeline did not
fully lock.

**In scope:** read contract for the merged view, write path for manual close pairs,
two-phase confirm, audit trail, mobile layout, tests.

**Out of scope:** the capture pipeline itself (Phase 3), placement entry (§3.6 of the
workplan), lever-walk changes.

**Non-negotiable:** CLV is never typed. The operator types a **closing price pair**;
`clvPoints` is recomputed server-side from `(fairEntry, fairClose)`. There is no route
that accepts a CLV number.

> ⚠️ This non-negotiable conflicts with shipped behaviour. See §9.1 before writing
> anything — it needs Kap's ruling, and the ruling changes the size of this job.

---

## 1. Two calls, now signed off

### 1.1 A manual close is not the placed-ticket price

The current `MISSING CLOSING PRICES` copy says "Read them off the placed ticket." That
instruction is wrong and is removed with this change.

The placed ticket carries the **placement** price — the price at the moment the parlay was
filed, at or before lock, not at kickoff. Entering it as `close` turns every CLV number
into deadline drift measured against itself. Workplan §3.6 already says placed − entry is
a separate chart and is *never* mixed into CLV, so this does not merely mismeasure CLV: it
computes the exact quantity §3.6 quarantines and files it under the wrong name.

Correct source for a manual close: a DK screenshot of that leg's straight market taken at
or near kickoff, or an equivalent timestamped DK price. The UI copy must say that, and
must say what is *not* acceptable — the current copy actively instructs the wrong action,
so stating only the correct source leaves the habit in place.

Replacement copy:

> Read both sides off a DraftKings screenshot taken at kickoff. **Not the placed ticket** —
> that carries the price you got at placement, and entering it here computes deadline
> drift, not CLV.

### 1.2 Manual closes get their own basis and their own line on the chart

D9 restricts the headline mean to `draftkings` and `draftkings_live`. D9 is a rule about
**basis** — whose price — not about transport. A DK screenshot at kickoff has basis
`draftkings` and source `manual`; `self` means a price with no book behind it. So a
correctly-sourced manual close is not excluded outright by D9, and the question is
evidentiary weight rather than admissibility.

Resolution: `basis: manual` is a **third reported series**, shown alongside the captured
mean, never folded into it.

```
CLV (captured)      −1.8 pts   n = 2/8
CLV (incl. manual)  −0.9 pts   n = 7/8   ← stamped, secondary styling
```

Both numbers on screen, coverage on both. Not peer series: captured is the headline and
solid, incl.-manual is secondary and dashed, labelled as manager-read at kickoff. Equal
weight in the legend would imply equal evidence.

A blended single number with a provenance badge was considered and rejected: the blend is
irreversible — you cannot recover the captured-only number from it, and captured-only is
the number D9 exists to protect. A badge says the mean is contaminated without saying by
how much.

If captured `n` is 0, the captured series renders an explicit `0 of N captured — nothing
to plot`. A hidden line and a line with no legs look identical, which is the failure this
screen keeps having.

---

## 2. Data model deltas

`Result` (this week) and ledger `Row` gain:

```
closeSource:        oddsapi | sgo | manual          # 'manual' is new
basis:              draftkings | draftkings_live | manual | consensus | none
closeState:         ... existing ... | manual       # terminal, mutable only via override
closeEnteredBy:     uid                             # who typed it
closeEnteredTs:     server ts
closeAssumedOpp:    boolean                         # opp left blank → opposite assumed
closeOverrodeCapture: boolean                       # typed over a complete captured pair
closeManualNote:    string | null                   # required when overriding a capture
priorClose:         { price, priceOpp, source, observedAt, state } | null
```

`priorClose` is written once, on the first override of a captured pair. It is never
overwritten by a second edit — the original machine capture is the thing worth preserving.

`league/admin/actions/{ts}` gains action type `close_manual` with: `byUid`, `legUid`,
`week`, `before`, `after`, `assumedOpp`, `overrodeCapture`, `note`, `leverImpact`.

---

## 3. Read contract — `/bozo/clv` and `dd_bozo_clv`

One response drives the whole merged section.

> ⚠️ Not additive. See §9.6 — this renames the payload and moves CLV computation to the
> server, reversing a documented decision. Version it or budget the migration.

```jsonc
{
  "members": [                        // EVERY member, always. No filtering.
    {
      "uid": "...",
      "displayName": "Kap",
      "legs": 1,
      "graded": 0,
      "onChart": 0,                   // legs with a usable close pair
      "noUsableClose": 1,
      "clvCaptured":  { "mean": null, "n": 0 },
      "clvWithManual":{ "mean": null, "n": 0 },
      "zeroStateReason": "no legs graded yet"   // rendered, not hidden
    }
  ],
  "legs": [
    {
      "uid": "...", "displayName": "Kap", "week": 1,
      "label": "CHI @ CAR u53.5", "mkt": "total",
      "entry":  { "price": -240, "priceOpp": 174, "fairEntry": 0.6812,
                  "priceSource": "captured" },
      "close":  { "price": null, "priceOpp": null, "source": null,
                  "state": "unmeasured", "reason": "book_absent",
                  "assumedOpp": false, "enteredBy": null },
      "clvPoints": null,
      "clvEligible": true,
      "editable": true,               // server decides, not the client
      "requiresOverride": false,      // true only when state === 'captured'
      "basis": "none"
    }
  ],
  "coverage": { "captured": "2/8", "withManual": "7/8", "assumedOpp": "1/8" }
}
```

`editable` and `requiresOverride` are computed server-side from `closeState` and re-checked
on write. The client never decides who may edit.

`coverage.assumedOpp` is not optional: without it the incl.-manual line silently contains
legs whose other side was synthesised, and the label would be false. See §9.5.

---

## 4. Write path — extend `POST /bozo/close`

Reuse the existing write route rather than adding a second manual path; a split route
splits the audit trail. `/bozo/close-gaps` is the GET read list and stays that way — see
§9.2.

Auth: session → `uid`; require `league.managerUid === uid`. The commissioner may write on
behalf of any member; the write is stamped with `closeEnteredBy`, never silently
attributed to the member.

### Phase 1 — echo (no write)

```
POST /bozo/close
{ "mode": "echo", "week": 1,
  "edits": [ { "legUid": "...", "close": -115, "closeOpp": -105 } ] }
```

Response per edit:

- `before` / `after` pair
- implied probability delta in points
- `fairClose` after de-vig, and resulting `clvPoints`
- `hold` implied by the typed pair
- `leverImpact`: current Worst CLV holder → holder after this write
- warnings array (see §4.2)
- `confirm_code`, TTL 5 minutes

### Phase 2 — commit

```
POST /bozo/close
{ "mode": "commit", "confirm_code": "...", "note": "optional / required on override" }
```

Writes `results/{uid}` **and** the ledger row (dual-write, both carrying `uid` and
`player`), then `admin/actions/{ts}`.

### 4.1 Validation — reject

| Condition | Reason code |
|---|---|
| Non-integer American odds, or `abs(price) < 100` | `bad_price` |
| Price outside `−10000 … +10000` | `insane_price` |
| Pair implies hold < −0.5% (arb at one book) | `impossible_pair` |
| `closeState === 'captured'` and no `override: true` + `note ≥ 20 chars` | `capture_locked` |
| Leg has `mkt === 'other'` | `not_measurable` |
| Session uid ≠ `league.managerUid` | `403` |

### 4.2 Validation — warn, require acknowledgment, do not block

| Condition | Warning |
|---|---|
| Typed pair exactly equals the entry pair | "This is the entry price, not a close. CLV will be 0.00 by construction." |
| Implied hold > 12% | "Hold of X% is high for a DK straight market — check the pair." |
| `closeOpp` blank | "Opposite side assumed at standard juice. Leg will be stamped `assumed`." |
| Move > 15 probability points from entry | "Large move — confirm the market and side." |

The entry-price tripwire in row 1 is the one that matters most. It is the single most
likely operator error and it silently produces a chart full of zeros. It is also the
machine-readable half of §1.1.

### 4.3 Blank-opp rule

`closeOpp` blank → **derive** the opposite with the shipped `bozoAssumedOpposite()`, which
solves for a standard two-way overround (1.047619). Do not store a flat `−110`: that is
only correct when the close itself is ≈ −110, and for a close of −300 it implies a 27%
hold, tripping the §4.2 warning on every favourite and de-vigging to a badly wrong fair.
See §9.3.

Store `close` as typed, the derived opposite, and `closeAssumedOpp = true`. If **both**
sides are blank the edit is a no-op, not a write. Badge reads `assumed` everywhere the leg
appears, including the ledger.

Typing over either side of a partially captured pair converts the **whole pair** to
`closeSource: manual`, `basis: manual` — a half-machine, half-human pair is not a
provenance anyone can reason about.

---

## 5. State → affordance matrix

| `closeState` | Edit button | Override required | Basis after manual write |
|---|---|---|---|
| `captured` (both sides) | hidden behind "Unlock" | yes — reason ≥ 20 chars | `manual`, `priorClose` archived |
| `captured` (one side only) | shown | no | `manual` |
| `retryable` | shown | no | `manual` |
| `unmeasured` | shown | no | `manual` |
| `pending` | shown, with "capture may still land" note | no | `manual` |
| `late_entry` | shown | no | `manual` |
| `unmatched` (`mkt: other`) | hidden | — | stays `none` |
| `void` | hidden | — | stays `none` |

A manual write sets `closeState: manual`. Once manual, the cron never touches the leg
again — `bozoCloseTargets` must exclude `manual` alongside `captured`.

> ⚠️ Most of these states are design, not data. See §9.7 — you are building this state
> machine, not reading it, and the interim derivation is specified there.

---

## 6. UI spec

### 6.1 Structure

Single section, heading `CLOSING LINE VALUE`. One caption line plus a `?` link to Docs.
Every existing paragraph in both blocks moves to Docs per workplan §3.8.

**Level 1 — member cards.** All members, always, sorted by captured-CLV descending with
null-CLV members last but present.

```
Kap                                    ▸
1 leg · 0 graded
CLV —  ·  on chart 0  ·  no usable close 1
```

**Level 2 — leg rows inside the expand.** Stacked, not tabular.

```
WK 1 · CHI @ CAR u53.5
took    −240 / 174
close   [     ] / [     ]      ⟵ two inputs
        no close captured yet
                              [ Save ]
```

### 6.2 Mobile is the constraint, not an afterthought

The current 5-column `MISSING CLOSING PRICES` table clips the CLOSE column off the right
edge on a 1080px-wide phone — the edit control is literally unreachable. The merged view
has more fields, so a wide table is not an option.

- No horizontal scroll anywhere in this section.
- Close inputs on their own line, full width, `inputmode="numeric"`, minus sign accessible.
- Save is a full-width button inside the expanded leg, not an icon in a row.
- The Phase-1 echo renders as a sheet, not a `confirm()` dialog: before → after, Δ in
  points, resulting CLV, lever impact, warnings, then Confirm.
- Every user-supplied string via `textContent` (Phase 8.5).

### 6.3 What must not be lost in the merge

Both of these are the reason the section exists, and both are easy to drop while
consolidating:

1. **Zero-state rows render.** "1 leg, 0 graded" beats a member vanishing from the list.
2. **Every off-chart leg shows its reason.** `no close captured yet`, `one side only`,
   `assumed`, `manual`, `excluded — market not measurable`.

---

## 7. Acceptance tests

| Area | Test |
|---|---|
| Roster completeness | Member with 0 legs renders with a zero-state row; member with legs but 0 graded renders a CLV of `—`, not `0.00` |
| Basis separation | A manual close moves `clvWithManual` and leaves `clvCaptured` byte-identical |
| Capture lock | Manual write against `closeState: captured` without override → 400 `capture_locked`; with override → writes, sets `closeOverrodeCapture`, archives `priorClose` |
| Partial capture | Typing one side of a one-sided capture flips both sides to `basis: manual` |
| Blank opp | Blank opp stores the **derived** opposite, sets `closeAssumedOpp`, badge renders in board **and** ledger; both blank → no write |
| Assumed coverage | `coverage.assumedOpp` counts exactly the `closeAssumedOpp` legs, and the incl.-manual legend names them |
| Entry tripwire | Typing the entry pair returns the warning and requires acknowledgment; CLV computes to 0.00 and is stamped |
| Slip prohibition | No code path writes `close` from `placedPrice`, **and** no user-facing string instructs reading a close off the ticket — including Worker comments. See §9.8 |
| Two-phase | No write without a live `confirm_code`; expired code → 400; replayed code → 400 |
| Auth | Non-manager → 403; commissioner write on another member's leg stamps `closeEnteredBy` |
| Cron interaction | Leg with `closeState: manual` is never selected by `bozoCloseTargets` on a later tick — assert the **reason**, not just the outcome (§9.8) |
| Dual-write | Ledger row carries `uid` **and** `player` (Bug C regression) |
| Audit | Every manual write produces an `admin/actions` entry and renders on the Board the same week |
| Math | −115 / −105 de-vigs to the documented fair; `clvPoints` sign is correct (entry better than close → positive) |
| Mobile | 360px viewport: no horizontal scroll, Save reachable, close inputs fully visible |

---

## 8. Handoff notes

- Ship the read contract and the write path in the same PR as the MCP schema updates for
  `dd_bozo_clv` (workplan §9).
- The two prose blocks are deleted from `bozo.html` in this PR, not left orphaned — their
  content lands in Docs, rewritten to drop the "read them off the placed ticket"
  instruction.
- `sw.js` VERSION bump ships with the page change (AGENTS.md rule 3).

---

## 9. Conflicts with shipped code at `ef70e13`

Audited against the merged tree. Items 1–3 block; 4–6 need a ruling; 7–9 will trip you
mid-build. Anything you find that is not here, append it rather than choosing a side.

### 9.1 §0's non-negotiable is already false, and it decides eliminations — BLOCKING

`clvPts` is a shipped manager CLV override. It is written by the grade card
(`dawg-bot-worker.js:7477`), carried into the ledger (`:8224`), counted in coverage as
`clvOverridden` (`:8251`), honoured by `clvPair()` on the page, and **read by the Royale
elimination lever** (`:8495-8497`):

```js
const manual = r.clvPts != null && Number.isFinite(Number(r.clvPts))
  ? Number(r.clvPts) / 100 : null;
if (manual != null) { v = -manual; break; }
```

A typed CLV outranks the derived one when deciding who gets chopped.

Worse, the lever's own comment at `:8490` reads *"clvPts … **is read off the placed
slip**, which is the same evidence the capture would have snapped."* That is §1.1's error,
encoded in the Worker, justifying a live elimination rule. §1.1 fixes the UI copy and
leaves its twin in the lever.

**Needs Kap's ruling before code.** Either:

- **(a) Delete `clvPts`** — removal across the grade card, `clvPair()`, lever case 3, the
  ledger and coverage, *plus* a decision about values already stored, which are
  contaminated by the slip-read belief and cannot simply be carried forward; or
- **(b) Narrow §0** to "no *new* route accepts a CLV number", keep `clvPts` as a fourth
  provenance class with its own count, and fix the `:8490` comment.

Read literally, §0 sends you down (a). Do not start it without the ruling: (a) silently
rewrites the basis of past chop decisions.

### 9.2 §4 originally named the wrong route — FIXED ABOVE, noted for traceability

`/bozo/close-gaps` is GET-only (`bozoCloseGaps`, `:8830`). The write path already exists:
`POST /bozo/close` → `bozoCloseFill`, which already implements capture-lock on a *complete*
pair, the assumed opposite, provenance stamping, and `closeEnteredBy` / `closeEnteredTs`
(`:8158-8161`), and carries a 25-assertion suite (`work/test-bozo-close-fill.mjs`).
Extending `close-gaps` for writes would split the audit trail §4 exists to keep whole.
§4 above now says `/bozo/close`.

### 9.3 The flat −110 blank-opp rule is wrong — FIXED ABOVE

The shipped `bozoAssumedOpposite()` (`:8718`) derives the opposite against overround
1.047619. A literal `−110` is only right when the close is ≈ −110: for a close of −300,
0.750 + 0.524 = 1.274 → a 27% hold, tripping §4.2's own >12% warning on every favourite.
§4.3 above now says derive.

### 9.4 §1.2's premise contradicts its own example — NEEDS A NUMBER

"Zero legs have ever produced a CLV number" sits beside `CLV (captured) … n = 2/8`, and
`clvOverridden` exists in the coverage payload, implying the override path has been
exercised. `GET /bozo/clv?league=<id>` answers this in one request. The empty-state design
in §1.2 and §6.3 depends on the real figure.

### 9.5 D8/D9 versus the assumed hold — NEEDS A RULING

`docs/bozo-execution-plan.md:51`: *"Never assume a hold. No −110/−110 default, no `.022`,
no 'standard juice.' A leg without a real `priceOpp` is `clvEligible: false`. Missing beats
wrong."*

The shipped `bozoAssumedOpposite()` does assume one, and `work/test-bozo-close-fill.mjs`
records that the invariant was *deliberately* reversed. Both documents cannot be
authoritative. Until Kap rules, §3 requires `coverage.assumedOpp` so the incl.-manual line
at least declares what is inside it.

### 9.6 §3 is a rename plus an architectural reversal, not an addition — NEEDS A RULING

Shipped `/bozo/clv` returns `players` (not `members`) and `legs[].entryPrice` /
`closePrice` (not nested `entry` / `close`), and computes **no** CLV server-side by design
— `bozoClv`'s header (`:8169`): *"RAW INPUTS ONLY … Persisting a derived CLV would freeze
today's formula into last year's rows"*, with `devig: "proportional"` declared so an old
payload stays reproducible.

§3 adds `fairEntry` and `clvPoints` to the payload, which reverses that. Defensible, but
it is a reversal, and the page, the diagnostics explorer, the Royale simulation and the
MCP surface all read the current shape. Version the payload (`/bozo/clv?v=2`) or budget
the migration across all four.

### 9.7 §5's state machine mostly does not exist yet

`closeState` is written at three sites, with two values: `pending`
(`:6741, :8056`) and `unmatched` (`:7988`). `captured`, `retryable`, `unmeasured`,
`late_entry` and `void` are design, not data.

Until the machine exists, derive the affordance from what is actually stored — the same
test both write paths already use for a complete captured pair:

```js
closeObservedAt != null && close != null && closeOpp != null
```

Anything else is editable. Deriving from `closeState` alone returns the wrong affordance
for every leg.

### 9.8 Two acceptance tests would pass vacuously

- **Cron exclusion.** `bozoCloseTargets` already skips on
  `r.close != null || r.closeUnavailableReason` (`:7880`), so a manual close excludes
  itself by having `close` set. The §7 test passes before you implement anything. Assert
  the reason (`closeState === 'manual'` is what excluded it), not the outcome.
- **The slip prohibition.** A grep for `placedPrice → close` only covers the data path.
  The instruction is the bug: assert that no user-facing string, and no Worker comment
  (`:8490`), tells anyone to read a close off the ticket.

### 9.9 `D20` is not in the repo

No hit for `D20` in `docs/*.md`. The on-behalf-of rule cited for commissioner writes lives
somewhere else or the citation is wrong. §4 above states the rule inline so you are not
blocked looking for it.
