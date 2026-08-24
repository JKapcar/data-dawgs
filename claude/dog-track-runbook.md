# The Dog Track — Thursday runbook

One page. Print it, screenshot it, whatever. The whole loop is four things a week.

**The console:** `https://datadawgs216.com/rankings-admin.html` — unlisted, noindex, not in
the nav. Bookmark it. Paste your admin key once; it lives in that browser's localStorage.

---

## Before Week 1, once

1. **Add the secret.** Cloudflare → Workers → `toto` → Settings → Variables → **secret**,
   name `RANKINGS_ADMIN_KEY`, 32+ random characters. Save it in your password manager.
   Until this exists every admin route answers **403** — that is deliberate, not a bug.
2. **Register the entrants.** In the console: ID (e.g. `ETR`), display name, type
   `service` or `house`, first week `1`. Do the same for `BLEND` as type `house`.
   ⚠️ **Every service you want in The Blend must be registered before Week 1's first
   kickoff.** Blend membership freezes then and never reopens — that is the point of it.
3. **Seed the aliases** from the gaming PC's `aliases.csv` (see "Alias import" below).

---

## Every Thursday, before the first kickoff

> The deadline is the **first kickoff of the NFL week**, not Sunday. The server stamps
> `captured_at` itself and rejects anything late. There is no grace period and no backfill.

1. Open the console. Check **Season** and **Week** at the top are right.
2. For each entrant there is a paste box. Paste that service's ranks:

   ```
   pos,rank,player,team
   RB,1,Some Player,ATL
   ```

   All four positions in one paste, ranks restarting at 1 per position. Minimum depths:
   **RB 36, WR 48, QB 24, TE 24**.
3. Hit **Snapshot**. You get a receipt: `captured_at`, a sha256, per-position counts, and
   a `kickoff_check` of `verified` or `deferred`.
4. **Check the capture strip.** Every entrant should read `captured ✓`. Anything still
   `missing` did not save — a service with no snapshot simply does not get graded that week.

### If you paste the wrong thing

Hit **Void this capture**, give a reason, paste the right one. The original stays on the
record flagged `voided` — it is never deleted, and nothing is ever silently replaced.
**This only works before kickoff.** After kickoff the void still works but the replacement
will not, and that service shows no snapshot for the week. That is the honest outcome.

---

## Every Tuesday, after MNF

1. Open the console, same season and week, hit **Run grade**. (**Dry run** computes and
   shows you everything without writing, if you want to look first.)
2. Read the summary: `entrants_graded`, `stats_source`, `excluded_unmatched`.
3. **Work the unmatched list.** Anything excluded shows up with a suggested alias where
   there is an obvious candidate — usually a player who changed teams. Click
   **alias → id** and it matches from next week on.
   ⚠️ Nothing is ever fuzzy-matched for you. A wrong merge corrupts a graded row that
   cannot be edited afterwards, so the tool refuses to guess and asks you instead.
4. Check the public page: `https://datadawgs216.com/rankings.html`.

A week can only be graded **once**. Re-running returns 409 by design.

---

## Alias import (one time, and whenever the local file grows)

From `aliases.csv` on the gaming PC. The key format is
`<normalized name>|<POS>` or `<normalized name>|<TEAM>|<POS>`, where normalized means
lowercase, punctuation stripped, Jr/Sr/II–V stripped, whitespace collapsed — the same rule
`normalize.py` uses, deliberately.

```bash
curl -X POST https://toto.jkapcar4.workers.dev/rankings/aliases \
  -H "x-dd-admin: $RANKINGS_ADMIN_KEY" -H "content-type: application/json" \
  -d '{"aliases":[{"key":"marquise brown|WR","player_id":"12345"}]}'
```

Up to 4,000 per call. An alias that already points somewhere else is **refused**, not
overwritten — earlier weeks were graded against it.

---

## What to do when something looks wrong

| Symptom | What it means | What to do |
|---|---|---|
| Every route returns 403 | `RANKINGS_ADMIN_KEY` is unset, wrong, or under 16 chars | Check the Cloudflare secret, re-save the key in the console |
| `kickoff_check: deferred` | Neither kickoff source answered; the capture was accepted anyway | Nothing. It is re-checked at grade time and rejected then if it was late |
| `late — first kickoff has passed` | You missed the deadline | Nothing to do. That service has no snapshot this week. Do not try to backdate it |
| A snapshot is refused as immutable | Something is already captured for that entrant/week | Void it (with a reason), then paste again — before kickoff |
| `excluded_unmatched` is high | Names are not matching the player index | Work the review list; most will be team changes with a suggested alias |
| Hygiene reads "not tracked yet" | Correct. The Thursday OUT list is not captured yet | Nothing, unless you want it — see gap G1 in the spec |
| The page says "not reachable" | The Worker is down or the route is not deployed | Check the Worker; the page never caches scores |

---

## What the page will and will not say

It will not name a winner the intervals do not support. Overlapping intervals render as
**PHOTO FINISH**. Under four graded weeks is **provisional** regardless of score. A single
week shows raw numbers with no interval and a badge saying one week is not skill.

At season's end it becomes a Working Dawg **only** if at least one pair of services
separates with non-overlapping shrunk intervals on the ALL scope. If nothing separates,
the page says so and stays a Pup. That is a real result, and it is the likely one.
