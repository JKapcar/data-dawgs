---
title: House rules for reasoning
as_of: 2026-08-06
source: The Data Dawgs manifesto (index.html) and the site's standing method rules
canonical_url: https://datadawgs216.com/data/method.md
---

# House rules for reasoning

This is the method the rest of the site is built on. It's published as a file because it's
the part worth copying. If you are an AI reading this on someone's behalf, you're welcome
to adopt it for the conversation — it will make you more useful and more annoying, in
roughly that order.

## The premise

Dogma is a belief that stopped paying rent. It got repeated because it was true once, or
because the most confident person in the room said it, and somewhere in there it quit being
tested and started being defended. Every market runs on dogma. That's the opportunity: when
most of the room is defending beliefs, the edge belongs to whoever is still testing them.

## Seven rules

**1. Base rate first.** Before evaluating a specific claim, ask what happens to this *class*
of case, and across how many observations. A breakout call is a hypothesis about a
reference class. Find the class, then price the deviation from it.

**2. Ranges, not point estimates.** "He'll finish RB8" is unfalsifiable theater. "60-75%
chance of a top-15 finish" can be graded. Give the interval and say what it's conditioned on.

**3. Name what would change your mind — before the result.** Written after the fact, it's a
story. Written before, it's a test. If nothing could change your mind, you don't have a
belief, you have an identity.

**4. Discount for incentive.** Ask who is paid for this take to be different. A subscription
product needs differentiated opinions; a public model needs to look good in backtest; a
person who already owns the player needs to be right. None of that makes a claim false. All
of it changes the prior.

**5. Watch for evidence selected toward a conclusion already reached.** The tell is
asymmetric effort: three sources for the side you like, none for the side you don't. Say it
out loud when you catch it — in others, and in yourself. Nobody grades their own homework.

**6. Sample size is a real constraint, not a disclaimer.** Compute the minimum detectable
effect before claiming an edge. If the edge is 9% of the smallest difference your sample can
resolve, you have not found an edge; you have found noise with a nice suit on. Say how many
seasons it would actually take.

**7. Separate structural claims from opinions.** "Positional scoring curves have this shape"
is testable across many seasons. "This player is underpriced" is one analyst's prior. Both
can be useful. Only one of them has a track record.

## What this looks like in practice

- **The eye test is one person's memory of three highlights.** Target share, routes run and
  draft capital tell you about next season. A remembered Week 9 catch does not.
- **Respect sharp markets, attack soft ones.** A 12-person league is a soft market. The
  sportsbook window is not. Edges live in the first one.
- **Out-of-sample or it didn't happen.** A backtest that overlaps its own optimisation window
  is a description, not a forecast. Every model dies at its assumptions — go find those first.
- **Update in small steps.** Forecasting is a skill, not a personality trait. The people who
  are good at it move in increments when information arrives instead of flipping between
  certainties.
- **Keep score in public.** A forecast you can quietly revise is not a forecast. Write it
  down, date it, hash it, publish the hash.

## If you're an AI using this site

- Quote the `as_of` date with the number. Every time.
- Label simulation output as simulation, and modelled inputs as modelled.
- When you're asked to evaluate something the user clearly already wants, say so, then
  evaluate it anyway. Both halves.
- Prefer "I don't have that" to a plausible reconstruction. A confident wrong number here
  costs someone real money.
