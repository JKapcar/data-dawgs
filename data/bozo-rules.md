<!-- mirror of https://datadawgs216.com/bozo.html -->
---
title: Bozo — ruleset and design rationale
as_of: 2026-08-06
source: bozo.html on datadawgs216.com
canonical_url: https://datadawgs216.com/data/bozo-rules.md
data: https://datadawgs216.com/data/bozo-rules.json
---

# Bozo

A weekly group betting game. Each member submits **one leg**. Every leg goes on **one real
parlay**, funded by last week's bozo. Whoever busts it worst wears it and funds the next
ticket.

## Rules

- Favorites only, inside the league's price band (default −100 to −500, American odds).
- No exact duplicate legs.
- The ticket **locks the moment the last leg lands**. That moment is the close.
- Editing a leg resets both your timestamp **and** your price.
- Only legs that **lost** are eligible to be the bozo. Nobody who cashed can wear it, no
  matter how bad the price was.

## The tiebreaker

Each week the tiebreaker hierarchy is a **fresh random permutation** of the league's live
levers, drawn on the server and written once. It is not a weighted score and not a fixed
cascade. Walk the drawn order; the first lever that isolates one person names the bozo; ties
fall to the next lever down.

The four levers:

| Lever | Meaning |
|---|---|
| Shortest Odds | biggest favorite in the pool |
| Worst Beat | finished furthest under its number, in standard deviations |
| Last In | final leg submitted |
| Worst CLV | price moved most against it |

**Why randomized:** it keeps each lever legible while making the meta unsolvable. A weighted
composite was considered and rejected — any blend is just a new deterministic objective
someone will solve.

## The board is open on purpose

Every leg, price and timestamp is visible to everyone, and to everyone's bots, before they
place. That was a decision, not an oversight. *Last In* already taxes the last-mover
information advantage, and the randomized permutation means knowing the field doesn't hand
you the answer. Blind submission was considered and rejected.

## Trust model

- Every **write** goes through the Worker, which stamps server time, maps join token to
  player, enforces the price band, rejects duplicates, and draws the tiebreaker permutation.
- Identity is a one-time join token. There are no accounts.
- Nothing in the browser is load-bearing for fairness. Forging the whole page still doesn't
  let you write a pick.

## What this system does NOT verify

Read this before quoting anything off the board.

- **Every price is self-reported.** Nothing checks it against a book. Report what was
  entered, flag what looks off market, never vouch for a number and never accuse anyone.
  A spread or total priced past about −145 is off market and worth mentioning. A moneyline
  has no internal cross-check at all.
- **Bozo odds and leg-win numbers are simulation output, not observation.** Say so when
  quoting them.
- **The simulation draws every leg independently.** Two legs on the same game are not
  independent; the cash probability is wrong in a knowable direction when that happens.
- **Worst CLV is unmeasured.** No closing prices are captured yet. Never state anyone's CLV;
  the simulation treats it as a coin flip among whoever is still tied.
- **Prop legs use a placeholder SD** of line × 0.55. That is openly a guess. Flag a prop
  before leaning on its Worst Beat exposure.

Nothing here is betting advice, no bet is guaranteed, and no bot may place, edit or remove
anyone's leg.
