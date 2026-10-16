# Audit procedure — "Grinding the Mocks" EDP workbook

Written 2026-10-16 for the "BDB Research Lab and Dawg Pound" release plan (PR 3).

**Status: procedure only. No code that reads this workbook ships until the owner supplies
its bytes and checksum.** The lab has not seen the workbook. Nothing below is a finding about
it, and no DataDawgs surface may cite it until every gate in this document has passed.

## Why it is audited before use

The workbook would supply a pre-draft market signal (mock-draft consensus by snapshot date).
It is attractive exactly because it can leak: a snapshot taken after the combine already
prices the combine, so "improvement" measured against it would be contaminated by the very
tracking features the registered hypotheses test. The rules below exist to stop that.

## Gate 0 — provenance (owner action)

1. The owner supplies the workbook file and states where and when it was obtained.
2. Record: file name, byte count, SHA-256 (`certutil -hashfile <file> SHA256` on Windows), and
   the date received. The checksum is pinned in this document before any parsing code is
   written. A different file is a different source and starts again at Gate 0.
3. **License.** Record the license or terms of use exactly as published by the author. If
   redistribution or derived publication is not allowed, the workbook may inform private
   research only: no derived numbers on public pages, in `/data/`, or in receipts. If no
   license can be found, treat it as private-only.

## Gate 1 — signature

- Confirm the file is a real XLSX (ZIP container, `[Content_Types].xml`, `xl/workbook.xml`).
  Refuse macros (`.xlsm`, `vbaProject.bin`) and external links (`xl/externalLinks/`).
- List the sheets, in order, with dimensions. Record any hidden sheets.

## Gate 2 — structure

For every sheet that holds rankings:

- **Snapshot dates.** Identify the column or sheet naming the snapshot date. Every row must
  map to exactly one dated snapshot. Undated rows are excluded and counted.
- **Grain.** The analysis table is one row per **player × draft year × snapshot**. Verify it:
  count duplicates on that key and report them; duplicates are not silently collapsed.
- **ID completeness.** Report, by draft year and by position, the share of rows that can be
  joined to the competition's player identifier without guessing. Name-only matches are
  reported as a separate tier and are never used for the registered hypotheses. Never write
  names or identifier lists into this repository (`tools/check-research-data.py` enforces it).

## Gate 3 — the pre-Combine rule

- A snapshot is usable as a pre-Combine market prior **only if its date is strictly before
  the first day of that year's NFL Scouting Combine**. On-the-day and later snapshots are
  excluded from the prior. Record the combine dates used and their source.
- If a draft year has no strictly pre-Combine snapshot, that year has no prior. It is not
  borrowed from a later snapshot.

## Gate 4 — derived measure

- `improvement = pre − post`, where `pre` is the player's rank in the last strictly
  pre-Combine snapshot and `post` is the rank in the last snapshot before the draft. A
  positive value means the player rose. State the rank direction in every output.
- **Missing stays missing.** A player absent from either snapshot has no `improvement`. Do not
  impute an unranked player to "last place plus one" or to any other value; report the count.

## Outputs of the audit (when it is eventually run)

- A redacted summary with the same discipline as `data/manifest-summary.json`: counts, dates,
  shares and checksums only. It may live under `research-lab/data/` only if it passes
  `python tools/check-research-data.py`.
- Each gate is recorded as passed, failed or blocked, with the date and the checksum it was
  run against.

## What unblocks this

The owner supplies the workbook bytes and its SHA-256 (Gate 0). Until then, the
`external-market` hypothesis uses `draft_overall_pick` only, as registered.
