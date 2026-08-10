# Stage FC-A — the forecasting challenge storage schema

Worklist item 6, first stage. **Storage only.** No page code, no HTML, no `sw.js` bump, and
no Worker deploy from this chat.

Written 2026-08-10 against `main` `b8df441`.

---

## What this stage settles, and why it goes first

Every decision below is about what gets WRITTEN DOWN. A page can be rebuilt; a season of
entries stored in the wrong shape cannot be re-collected, and a crowd consensus that was not
sealed before kickoff can never be made prospective afterwards. That is the whole reason
`forecast_challenge.md` calls these unrecoverable, and the reason no line of page code is in
this stage.

---

## Kap's three rulings, 2026-08-10

Asked before any code was written, because all three are expensive to reverse.

1. **Substrate: Firebase, not KV.** Worker-only Firebase, on the same default-DENY mechanism
   that already protects `/users` and `/bozoauth`.
2. **The crowd line is sealed now, displayed later.** The at-lock freeze ships this stage even
   though nothing renders it. Skipping it forfeits the 2026 crowd receipt permanently.
3. **Worker code is committed here and deployed by Chat C.** Nothing goes live from this chat.

## ⚠️ ONE CORRECTION TO RULING 1, MADE AFTER MEASUREMENT

Kap picked "Firebase under `/users/`". **Entries do not go under `/users/`.** They go under a
sibling root, `/forecast/`.

The reason is `loadUsers()` (worker line 1411): it reads the ENTIRE `/users` node with a single
`fbGet(env, "/users")`, and `sessionAuth()` calls it on **every authenticated request**. Nesting
a season of entries under `/users/<name>/` would make every signed-in request download every
user's whole forecast history, against a hard 10 ms CPU ceiling on the Workers free plan. The
choice was made from information that did not include this; the substrate is unchanged.

The privacy guarantee is identical, and this was **measured, not inferred**, from the browser on
2026-08-10 against the live database:

| path | unauthenticated GET |
|---|---|
| `/bozo` | **200** `{"leagues":true}` |
| `/users` | 401 Permission denied |
| `/bozoauth` | 401 Permission denied |
| **`/forecast`** | **401 Permission denied** |
| `/` (root) | 401 Permission denied |

`/forecast` is already closed to browsers under the live rules. No rules change is needed, and
none should be made.

⚠️ **Chat C must re-run that probe immediately before deploying.** If someone widens the RTDB
rules between now and then, these routes become the leak. It is one `fetch` and it is decisive.

---

## The layout

```
/forecast/entries/<sport>/<season>/<week>/<user>/<game_id>   → one entry
/forecast/sealed/<sport>/<season>/<week>/<game_id>           → one sealed crowd consensus
```

`<user>` is `encodeURIComponent(name)`. The account name is the identity key everywhere else in
this Worker — see the note at line 2266, which says so deliberately and explains that renames go
through a per-league display name precisely so a receipt can never be orphaned. Keying entries
any other way would be the only store in the system that disagreed.

**User-major, not game-major, and that is a privacy decision.** Serving a user their own week
touches exactly one node containing exactly their own data, so the route that runs most often
never holds another person's pre-lock pick in memory at all. A leak needs a bug in a rarely-run
route rather than a slip in the hot one. The cost is that sealing reads the whole week node; at
league scale that is one read per seal pass, and if it ever stops being cheap the fix is a
per-game index, which is additive.

**`sport` is both a path segment and a stored field.** CFB scores inflate against NFL — most
games are 90/10, so easy games are nearly free points — and the two leaderboards can never be
summed. With `sport` as a path segment there is no node whose children span both, so summing
them is not a discipline anyone has to remember.

---

## The entry record

```json
{
  "v": 1,
  "sport": "nfl",
  "season": 2026,
  "week": 1,
  "game_id": "2026_01_NE_SEA",
  "user": "Kap",
  "home_team": "SEA",
  "away_team": "NE",
  "kickoff_at": "2026-09-10T00:20:00Z",
  "home_win_probability": 0.62,
  "slider_value": 62,
  "slider_side": "home",
  "touched": true,
  "submitted_at": 1786400000000,
  "revision": 3,
  "source": "web"
}
```

### Rule 1 — every entry per user per game, never a running total

There is no `/forecast/standings` and no stored score of any kind, not even per game. Points,
Brier, weekly ranks, sport slices, model-vs-human splits and coverage are all queries over the
entry table. `forecast_challenge.md` says totals are a view; this stage stores no view.

⚠️ A **sealed consensus is not a total.** It is a per-game forecast whose inputs stopped existing
in mutable form at kickoff. That distinction is what makes it storable.

### Rule 2 — `touched` is stored separately from the value, and is never derived from it

An untouched slider and a slider deliberately set to 50 are identical in value and opposite in
meaning: both score 0, but the first is an ABSENCE and the second is a belief. If untouched
games enter the consensus at 50% then every lurker drags the crowd toward the middle and the
signal the ensemble exists to capture is gone.

So `touched` is its own field, and the aggregator filters on `touched === true` explicitly. It
is never computed from `slider_value !== 50`. The mutation harness proves this: deriving it turns
the suite red.

⚠️ **`touched` is client-asserted and is labelled as such**, exactly like `priceSource: "self"` on
a Bozo leg. The Worker cannot observe a drag. Records with `touched: false` are still stored,
because "was on the page and left this one alone" is real information for coverage and for
weighting, and discarding it would make an absent record ambiguous between two states.

### Rule 3 — the canonical probability is always P(home), and the raw slider is kept beside it

`home_win_probability` is the only number anything aggregates or scores. `slider_value` and
`slider_side` record what the user actually did, so a UI change can never silently reinterpret
stored history.

**The client may not send `home_win_probability`.** The Worker derives it from
`slider_value` and `slider_side`, so the raw and the canonical cannot disagree — there is no
code path in which they are two independent claims.

Scoring is unaffected by which side the user expressed: `25 − 100(p − r)²` is symmetric under
`p → 1−p, r → 1−r`, so the canonical home form scores identically. Worth stating because it
retires a whole class of side-confusion bug before anyone writes the grader.

### Rule 4 — server time, and no writes at or after kickoff

`submitted_at` is `Date.now()` inside the Worker. A client timestamp is ignored if sent.
`kickoff_at` comes from the canonical schedule surface (`/data/nfl-schedule.json`,
`/data/cfb-schedule.json`), never from the request.

A write at or after kickoff is refused **409**. This is what makes
`forecast_status: "prospective"` (`captured_at < kickoff_at`) true by construction rather than
by audit.

---

## Privacy — the assertion Kap asked for as a test

**Nobody but the owner can read an entry until that game's kickoff has passed.**

- `GET /forecast/entries` returns only the caller's own node. It never reads anyone else's.
- `GET /forecast/game` returns every entry for one game and **refuses 409 before kickoff**.
  This is the route the test attacks, with a real second session, asserting on the response body
  and not merely on the status code.

The equivalent CEP-7 reasoning stands: `/bozo` is world-readable, so anything private cannot
live there. The measurement above extends that to `/forecast` and closes it.

---

## The sealed crowd consensus

```
/forecast/sealed/<sport>/<season>/<week>/<game_id>
```

```json
{
  "v": 1,
  "model_id": "dd-crowd-nfl",
  "model_name": "Data Dawgs Crowd",
  "model_version": "crowd-1.0.0",
  "aggregation": "trimmed-mean-logit",
  "trim_fraction": 0.1,
  "clamp": [0.01, 0.99],
  "min_touch": 3,
  "n_touched": 6,
  "n_trimmed": 2,
  "n_used": 4,
  "home_win_probability": 0.615,
  "captured_at": "2026-09-10T00:11:42Z",
  "sealed_at": "2026-09-10T00:31:05Z",
  "kickoff_at": "2026-09-10T00:20:00Z",
  "forecast_status": "prospective",
  "contributors": ["Kap", "Jeff", "Sam", "Dana"],
  "contributors_sha256": "…"
}
```

### ⚠️ `captured_at` and `sealed_at` are two different facts and both are published

The receipt contract enforces `captured_at < kickoff_at`. But a consensus can only be computed
once its inputs stop changing, which is kickoff — so a naive `captured_at = now` would be at or
after kickoff and the row could never be prospective.

The honest construction:

- **`captured_at` = the latest `submitted_at` among contributing entries.** That is the instant
  the forecast became fully determined. It is `< kickoff_at` by construction, because Rule 4
  refuses every later write.
- **`sealed_at` = when the Worker wrote the row.** `>= kickoff_at`, always.

Both are stored. `captured_at` alone would be true but would invite the reading "we computed this
before kickoff", which is false. Publishing `sealed_at` beside it makes the claim exact: every
input predates kickoff, the arithmetic does not.

`contributors_sha256` is SHA-256 over the canonical contributing rows in append order — the same
device the receipt ledger already uses — so the consensus is recomputable by anyone once entries
become readable at lock.

### Aggregation, pre-registered

Trimmed mean of LOGITS, back-transformed. Probability averaging is systematically underconfident
and costs most where forecasters agree, which is where points are earned.

- Clamp `p` to `[0.01, 0.99]` before the logit. Sliders reach 0 and 100 — the scoring floor of
  −75 is exactly `p=0` on a winner — so an unclamped logit is infinite and one certain entry
  would swallow the mean.
- `n >= 5`: drop `ceil(0.1n)` from each end by logit, then mean the rest.
- `3 <= n < 5`: median.
- `n < 3` (`min_touch`): **no row at all.** A "crowd" of two is not a crowd, and an empty node is
  honest where a row built on one person is not.
- **Do NOT extremize.** The literature's case for it assumes partially independent forecasters.
  Ours will not be: model numbers are visible on the site before you pick, so copying is expected
  and is handled by MEASURING correlation against each model, not by hiding numbers.

### Sealing is idempotent and append-only

`POST /forecast/seal` reads the week node once and writes a row for every past-kickoff game that
has no row yet. **An existing sealed row is never overwritten, even if it is wrong.** A ledger
that can be corrected in place is not a ledger.

---

## Deviations from 538, recorded rather than left silent

| 538 | Data Dawgs | Why |
|---|---|---|
| Playoff games score double | No multiplier | Kap: pure noise |
| Ties resolve `r = 0.5` | Ties VOID for everyone, models included | `r = 0.5` hands an untouched 50 slider a free +25 |
| Weekly lock | **Per game at kickoff** | Thu and Mon games bracket the Sunday block |

⚠️ 538's own rules page and leaderboard now redirect to abcnews.com. The formula was recovered
from nflgamedata.com's game, which states it replicates 538's. Do not go looking for the
original again.

---

## Files this stage touches

| File | Change |
|---|---|
| `dawg-bot-worker.js` | the forecast block: 4 routes + the aggregator. **Committed, not deployed.** |
| `tools/build-data.js` | `model-contracts.json` gains a `forecast_challenge` section |
| `data/model-contracts.json`, `data/index.json` | regenerated by the builder |
| `work/test-forecast-store.mjs` | new suite |
| `work/forecast_mutations.py` | new mutation harness |

**No HTML.** Therefore no `sw.js` bump — `verify-sw` hashes staged HTML and none moves.

### ⚠️ Why the contract extends `model-contracts.json` instead of getting its own data file

`work/test-data-library.mjs` asserts **one open book per manifest entry**. A new `data/*.json`
adds a manifest entry, which requires a book in `data.html`, which is a page change, which pulls
in the `sw.js` bump and the whole browser gate list — for a stage that is supposed to touch no
pages. `model-contracts.json` already exists to stop incompatible models and missing values being
normalized into false agreement, which is exactly what an entry contract does.

`llms.txt` is untouched. It sits at 5,101 of 5,120 bytes and is graded against the tool registry,
not against every data file; line 21 stays true.

---

## Gates

Run individually, never in a loop — suites that bind servers collide back to back and the failure
reads like a broken suite.

**Because `dawg-bot-worker.js` moves, all eight importers run:** `assemble.mjs`, `test-backup`,
`test-cep6-email`, `test-cfb-market-capture`, `test-identity`, `test-league-join`, `test-mcp`,
`test-sleeper-players`.

**Plus the two gates that are in no suite loop:** `work/verify-sw.mjs` and
`work/test-pound-contracts.js`. Both have gone red under hundreds of green assertions.

**Plus:** `tools/validate-data.js`, and `DD_BUILD_DATE=<ship date> node tools/build-data.js`
followed by `git status --porcelain` — the cheapest proof that the change is the only change.

---

## Deliberately NOT in this stage

- Any page. No slider UI, no leaderboard, no challenge route in the nav.
- Grading. No result join, no points column, no standings. The scoring formula is published in
  the contract and computed nowhere yet.
- Registering `dd-crowd-*` as a board line in `model-receipts.json`. Kap chose seal-now,
  display-later; the ledger row is a later stage and needs sealed data to exist first.
- The Worker deploy. Chat C.
