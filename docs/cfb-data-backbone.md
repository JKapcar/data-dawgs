# CFB data backbone (roadmap step 1)

This pipeline turns SportsDataverse's published cfbfastR-data schedule CSVs into the canonical College Football schedule surface at `/data/cfb-schedule.json`. It is the first shipped piece of the CFB roadmap (ideas `cfb-sportsdataverse` and `cfb-games` in `/data/pound-tools.json`) and follows the NFL backbone's discipline: facts only, gates that fail closed, and a snapshot hash every downstream consumer must record.

## Provenance and runtime

- Source: `sportsdataverse/cfbfastR-data` `schedules/csv/cfb_schedules_{season}.csv` on branch `main`.
- Pinning: the source repository HEAD at capture, via `git ls-remote` (no GitHub API dependency), plus a SHA-256 of the exact raw CSV bytes. Repository-level pinning is coarser than the NFL backbone's path-level commit lookup; the raw-bytes hash is what makes drift detectable and the load reproducible.
- Source data license: not independently verified for the cfbfastR-data repository; the envelope says so.
- Scope: FBS-involved games only. Lower-division games with no FBS side are dropped at ingest.
- Excluded on purpose: upstream modelled columns (post/pregame win probabilities, ESPN Elo, excitement index). They are model outputs, not schedule facts, and carry no methodology or observation metadata. Lab work may read them from the raw snapshot, never from the canonical rows.
- Python: standard library only for validation, so contract checks run without network access.

## Gates (all fail closed)

Required source columns present; single season per load; season type in {regular, postseason}; week in range; valid ISO kickoff timestamps; TRUE/FALSE flags well-formed; completed games may not carry a partial score; incomplete games have scores nulled rather than trusted; FBS teams must name a conference; canonical and upstream game IDs unique; FBS-involved game count within 400-1100; FBS team count within 120-145.

## Reproducibility

`integrity.snapshot_id` is a SHA-256 of canonical JSON for the ordered game rows. Git history retains every changed snapshot. Downstream models and receipts must reference the exact snapshot they consumed.

Run locally:

```
python3 scripts/cfb_data_backbone.py refresh --season 2025
node tools/data-manifest.js
python3 -m unittest tests.test_cfb_data_backbone
python3 scripts/cfb_data_backbone.py validate
node tools/validate-data.js
```

## Known limits and next steps

- The 2026 season file does not exist upstream yet (checked 2026-08-08). When cfbfastR-data publishes it, `refresh --season 2026` produces the prospective schedule; until then the canonical surface is the completed 2025 season.
- CFBD API ingestion (`cfb-cfbd`) remains unstarted: it requires an API key, which belongs in the Cloudflare Worker, never in this public repo.
- Play-by-play (`cfb-plays`) is deliberately not in this step; the schedule surface had to exist first.
