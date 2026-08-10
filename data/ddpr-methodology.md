---
as_of: "2026-08-10"
source: "Data Dawgs Power Rank, computed by scripts/ddpr_nfl.py from the prospective nfelo and 538 Classic rows in /data/model-receipts.json at commit 706177db2bbdbf4b3e0bc62966a1f65e7d77fc34."
---

# DDPR NFL methodology

DDPR is an ensemble of forecasts this site already publishes. It is not a novel model and
nothing here should be read as claiming otherwise. Its only claim is that combining
pre-registered forecasts honestly is worth doing in public, with the combination rule fixed
before any game is played.

## What it averages

The prospective `nfelo` and `538-classic` rows in `/data/model-receipts.json`, latest
`captured_at` per game per model, restricted to games where **both** models published. A
game missing an input is dropped rather than averaged over whoever happened to publish,
because an ensemble whose panel changes game to game is a different model on each game.

Coverage is the 272-game 2026 NFL regular season.

## The two aggregations, both registered before kickoff

    displayed        p = inverse_logit( mean( logit(p_i) ) )
    also registered  p = mean( p_i )

Both are quantized to 6 decimal places, rounding half away from zero. The displayed line is
the log-odds average, published as `ddpr-nfl`. The arithmetic average is published as
`ddpr-nfl-linear`: registered, ungraded, and not shown anywhere on the site.

Averaging probabilities pulls toward 0.5 hardest exactly where the inputs agree, which is
where a proper scoring rule pays. Averaging log-odds does not. Registering both is the only
way to answer the question at season end without having chosen the winner afterward.

**There is no extremizing.** The argument for pushing an ensemble away from 0.5 assumes the
members are partially independent. These two are Elo-family models whose logits correlate at
0.9283 over the 272 games, so extremizing would overshoot and damage calibration on the one
line carrying our own name.

## What to expect from the comparison, said now rather than later

Over these 272 games the two aggregations differ by a mean of 0.00096 and a maximum of
0.00932. On a sample this size, with inputs this correlated, the season-end comparison will
very likely land inside the noise. It is registered anyway because it costs nothing and
because the alternative is deciding after the fact. When the result is published it will be
reported as what it is, not as having settled the question.

## DDPR is not independent evidence

DDPR is a function of its inputs. A scoreboard showing nfelo, 538 Classic and DDPR is
showing **two** sources of evidence, not three. `/data/ddpr-nfl.json` carries the measured
pairwise logit correlation for exactly this reason, and it is computed from prospective
forecasts alone, so it is available now while every grading column is still empty.

## Reproduce it

    python3 scripts/ddpr_nfl.py validate

Or independently: fetch `/data/model-receipts.json`, take the two input columns, average the
logits, round as above. `integrity.input_snapshot_id` in `/data/ddpr-nfl.json` is a SHA-256
over exactly the input probabilities that entered the average and nothing else, so it does
not move when an unrelated model is appended to the ledger.

## State

Ungraded. The 2026 NFL season starts 2026-09-10 and no DDPR forecast has been scored. Any
Brier, points total or accuracy figure attributed to DDPR before then is wrong.
