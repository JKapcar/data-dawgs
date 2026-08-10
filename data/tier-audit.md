<!-- mirror of the Tier audit card on https://datadawgs216.com/receipts.html -->
---
title: Tier audit — is every tool in the right lane?
as_of: 2026-08-07
source: Audit of every live tool against the gate on index.html#tiers, performed 2026-08-07
canonical_url: https://datadawgs216.com/data/tier-audit.md
data: https://datadawgs216.com/data/tier-audit.json
---

# Tier audit — 2026-08-07

The gate is one question: **does it work, and can it be trusted?** Forecasts need receipts
against a benchmark chosen in advance. Measurement tools need named sources and reproducible
math. Nothing clears by feeling finished.

This is that question asked of every live tool, on one day, by one reviewer. **It is a
judgment, not a measurement** — which is the gate's known weakness, and the reason this
document exists in the open rather than in someone's head. What was checked is stated. What
was not checked is stated too. Argue with it.

> **Label note, 2026-08-10.** This audit was written when the first tier was called
> *Labs*; the headings below now read *Pup*, which is the same tier under its current
> name. The tier id `labs` never moved. No row was re-graded — that is its own commit.

**Result: no promotions, no demotions.** That is a suspiciously comfortable outcome and worth
naming as such. It survives scrutiny only because every collar came back with a condition
attached, and because the one tool closest to promotion is blocked for a specific, stated
reason rather than a vague one.

---

## The Dawgs

### NFL EPA Stats — ✅ collar stands, with an owed check

Instrument path. Sources named (nflverse play-by-play, 2023–25, 109,933 plays), snapshot dated
2026-07-29, filters explicit.

**What was checked:** the aggregation was independently re-implemented outside the page, in
`tools/build-data.js`, from the same encoded columns, and produces `/data/epa-teams.json`.
Outputs are internally consistent and land where a reader of the seasons would expect —
SF 2023, BAL 2024, NE 2025 leading offensive EPA per play.

**⚠️ What was NOT checked:** any external cross-check against a public nflfastR table.
Re-implementing a page's own algorithm proves the maths is *reproducible*. It does not prove
it is *right* — two implementations of the same wrong filter agree with each other perfectly.
The remaining work is one spot-check against a published source.

### nfelo Power Ratings — ✅ collar stands, but it certifies the wrong thing to a casual reader

Instrument path. Pinned to nfelo commit `0d3f8418`, model `v4.3.0`, source named, derivation
reproducible, dated.

**The collar is for the mirror, not the forecasts.** It certifies that this page faithfully
renders nfelo's published ratings. It does not certify that nfelo predicts well, and the
evidence on file says it doesn't beat the market: n=4,053, nfelo straight-up 0.6674 against
the market's 0.6677 — nfelo *behind* by 0.02pp, with a standard error of 0.196pp. That is
indistinguishable from the market, and the backtest overlaps nfelo's own optimisation window,
so it is not out-of-sample evidence in either direction.

**Risk:** a collar on a page full of win probabilities reads as "these forecasts are
validated." The homepage disclaims this; the page itself should carry the same line.
`/data/nfelo.json` already reports `graded: false`.

### Fantasy Draft Dashboard — ✅ collar stands, three conditions

The Dashboard is a frame shell: it embeds `board.html` (Live, Cheat Sheet), `dataviz.html`
(Analysis), `report.html` (Grades) and `auction.html` (Auctioneer). The collar therefore
covers the whole draft rig.

Evidence: it ran a live 14-team draft end to end. For an operational tool that is the right
kind of evidence — "does it work" is answered by it working under load, with real money and
fourteen impatient people.

**⚠️ Condition 1 — the parts are individually reachable and un-chipped.** `/report.html`,
`/dataviz.html`, `/board.html` and `/auction.html` are live standalone URLs carrying no tier.
The same code gets a different verdict depending on how you arrive at it. Chip the family, or
say plainly that the collar covers the rig.

**⚠️ Condition 2 — the Grades view is a measurement dressed as a judgment.** The grade is
`letter(0.5·z(surplus) + 0.5·z(starting-lineup value))`: did you buy more market value than
you paid for, relative to the room. That is reproducible arithmetic over a dated snapshot and
it clears the instrument gate honestly. But an "A" *reads* as a prediction that the roster
will win, which it does not measure, and it inherits any error in the underlying values with
no visible uncertainty. The fix is labelling, not demotion.

**⚠️ Condition 3 — the rig runs on a 2026-07-29 market snapshot**, now nine days old, from a
source that publishes through August. The tool works; the input is decaying. "Open questions
about data quality" is language from the *Labs* definition, and it currently applies to a
Dawg. The collar is conditional on a refresh before draft night.

---

## Pup — the ones near the line

### Receipts — correctly a Pup, for exactly one reason

This is the closest thing to a Dawg outside the collar. Sources named (nfelo `0d3f8418`,
nflverse/nfldata, ESPN finals). Math reproducible — the canonical string is published and
recomputes the locked hash, 272 rows, 6,697 bytes. Dated. A failure threshold pre-registered
before any 2026 game.

**⚠️ The blocker: the trust mechanism is self-anchored.** Data Dawgs hosts the ledger, the
hash, and the spec that connects them. Recomputing proves today's file matches today's hash.
It cannot prove these were the predictions made *before the games*, because both could have
been replaced together. A page whose entire purpose is verifiability cannot earn a collar on
verification that isn't independently checkable.

This is the most specific promotion path on the site: anchor the hash externally and
timestamp it, and this clears. Nothing else about the page needs to change.

(Nothing is graded yet either — but grading is the forecast gate, and Receipts is being judged
here as an instrument: a ledger that records honestly.)

### Master Data — correctly in Labs, blocked operationally rather than epistemically

A dated table, not a model. It would clear the instrument gate on sources and reproducibility;
what holds it back is that the source updates daily and the file says 2026-07-29. The fix is a
refresh cadence, not a redesign. Worth noting because it is the cheapest promotion available.

---

## Pup — correctly placed, not close

- **Survivor.** Forecast path, no receipts, and two disclosed defects: double-pick weeks are
  recorded but not simulated, so every survival number after such a week is optimistic in a
  known direction; and pool ownership is modelled, not observed.
- **Bozo.** Further from the line than it looks. Every price is self-reported and nothing
  checks it against a book. The simulation draws legs independently, which is knowably false
  for two legs on the same game. Worst CLV is unmeasured. The *game* is well designed; the
  *numbers* are not validated.
- **DFS Solver.** Built 2026-08-06, zero graded slates. The solver is deterministic, which is
  a genuine strength, but determinism is not validation — an optimiser is exactly as good as
  the projections it is fed, and those are the untested part.
- **Guillotine Companion.** Nothing graded, nothing claimed.

## Arguably outside the tier system

**Strategy** is a synthesis of one analyst's opinions, not a tool. **Dawgs** is photographs.
Tiering them implies a validation question that does not apply to either. Recommend leaving
them unchipped and saying why, rather than defaulting them into Labs by silence.

---

## ⚠️ The Pound is empty, and that is the biggest finding here

The Pound exists to fix survivorship bias: to keep the failures visible next to the wins. It
has no residents. After roughly 170 commits, zero recorded retirements.

There are two explanations. Either nothing has ever failed, or things are being abandoned
rather than recorded. The first is not plausible. **An empty Pound is survivorship bias
appearing in the one structure built to prevent it.**

Real candidates already sitting in the project record: the Worker `/scores` proxy, dead
because ESPN blocks Cloudflare egress; two rejected definitions of this very gate; blind Bozo
submission; the composite-score tiebreaker. Some of those are design decisions rather than
products — but at least one is a shipped capability that stopped working, has a known cause,
and has a condition that would reopen it. That is precisely a Pound entry.

**Recommendation: populate it, or state on the page that nothing has been retired yet and why
that is true.** Silence reads as "we don't fail."

---

## What would change these verdicts

- **EPA Stats** — an external cross-check that disagrees with the page's numbers.
- **nfelo** — nothing this season; the market comparison is unresolvable in one year by the
  site's own pre-registered arithmetic.
- **Dashboard** — a draft night where the rig fails under load, or a refusal to refresh the
  market snapshot before it.
- **Receipts** — an external, timestamped anchor would promote it. Nothing else would.
- **Any Labs tool** — receipts against a benchmark declared in advance.

## What this audit is

One reviewer, one day, reasoning from the code and the published data. It is not an
independent review, and it is not a measurement. It is offered as the thing the gate has been
owing since it was written: a dated record of what was actually checked, so that the next
person can find where it was wrong.
