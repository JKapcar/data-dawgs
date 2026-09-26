---
as_of: 2026-09-26
source: Data Dawgs weather.html method
canonical_url: https://datadawgs216.com/data/weather-method.md
data: https://datadawgs216.com/data/nfl-stadiums.json
---

# NFL Weather — method

This surface answers one question: **what does the National Weather Service currently forecast at the stadium gridpoint around kickoff?**

It does not answer: will this move the total, should you fade the passing game, or what a meteorologist thinks after looking at mesoscale detail.

## Inputs

1. Games from `/data/nfl-schedule.json` (canonical 2026 schedule).
2. Home venue from `/data/nfl-stadiums.json` (lat/lon, roof class). Neutral-site overrides are not in the registry; the page uses the schedule's `home_team` venue unless a future override file exists.
3. Live forecast from `api.weather.gov` — `points/{lat},{lon}` then `forecast/hourly`. CORS-open. No API key. The number you see is NWS, dated by `properties.updateTime`.

## Roof class

- `fixed` — indoor play. Outdoor hours are still fetched and labelled as travel/tailgate, not play conditions.
- `retractable` — roof state at kickoff is unknown here. Outdoor hours are shown and marked contingent.
- `open` — outdoor play. Hours apply to the field.

A canopy over seats (new Highmark Stadium) is still `open` because the field is uncovered.

## Heuristic flags

Flags are thresholds, not a model:

- Wind: sustained ≥ 15 mph at the kickoff hour
- Precip: probability ≥ 40% at the kickoff hour
- Cold: temperature ≤ 32°F
- Heat: temperature ≥ 90°F

They have not been graded against scoring, completion percentage, or totals movement. Do not quote them as weather impact.

## What this is not

- Not Kevin Roth, MySportsWeather, OVERcast, or any private weather-impact product.
- Not a second NWS office. We do not blend models.
- Not a lock. NWS hourly grids change. Quote `updateTime`.
- Not betting advice.

## Promotion bar (still a Pup)

To leave labs this would need, at minimum: a pre-registered rule for “impactful weather,” a locked snapshot before kickoff, and a grade against a named on-field or market benchmark. None of that exists yet.
