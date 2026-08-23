# Refreshing the survivor snapshot — the weekly ritual

**Owner:** Kap · Written 2026-08-23 (Stage I-2 of the Survivor v2 handoff)

---

## The thing the handoff assumed existed, and did not

The brief said "regenerate `survivor.json` with current lines before Week 1 (Sep 10)…
if generation is a manual step, document the exact command."

**There was no command, and no manual step either.** `window.SV` was a hand-pasted JSON
blob inside `survivor.html`, and `tools/build-data.js` builds `/data/survivor.json` by
*scraping that blob back out of the page* (`build-data.js:55`,
`grab('survivor.html', 'window.SV=', '{')`). So:

- the published JSON was downstream of a paste,
- the paste had no upstream in the repo,
- nothing in `work/`, `scripts/`, `.github/workflows/` or any doc produced it, and
- `.github/workflows/nfl-data.yml` refreshes the data backbone weekly and has never
  touched it.

That is why the snapshot sat at `as_of 2026-08-06` for seventeen days with no way to move
it. There is now a generator: **`work/build-survivor-snapshot.mjs`**.

## The ritual

```bash
# 0. always, before anything
git fetch origin main && git reset --hard origin/main

# 1. refresh the inputs (this is the existing weekly workflow — it does NOT touch
#    survivor.html, which is the gap this doc closes)
#    .github/workflows/nfl-data.yml, or by hand:
python scripts/nfl_data_backbone.py refresh --season 2026

# 2. see what would change, WITHOUT writing anything
node work/build-survivor-snapshot.mjs --check

# 3. if the diff is what you expect, write it
node work/build-survivor-snapshot.mjs

# 4. republish the machine surface and its manifest
node tools/build-data.js survivor.json
node tools/data-manifest.js

# 5. prove nothing broke
node work/test-survivor-path.js
node work/test-survivor-cards.mjs
node work/test-survivor-double.mjs
node work/test-survivor-field.mjs
node work/test-survivor-grid.mjs
node tools/validate-data.js

# 6. bump sw.js VERSION — survivor.html changed, so this is mandatory
#    (md5 of every *.html, sorted, first 10 hex)
python3 -c "import hashlib,glob; h=hashlib.md5()
for f in sorted(glob.glob('*.html')): h.update(open(f,'rb').read())
print(h.hexdigest()[:10])"
```

Then commit `survivor.html`, `data/survivor.json`, `data/index.json` and `sw.js` together.

## What the generator can and cannot do

| Field | Source | Notes |
|---|---|---|
| `elo` | `data/nfelo.json` → `data.ratings[].nfelo` | rounded to 1dp, the snapshot's own precision |
| `games[].mm` | computed | `(elo_home − elo_away) / elo_per_pt + hfa` |
| `games[].d` | `data/nfl-schedule.json` → `kickoff_at`, **converted to US Eastern** | see the date trap below |
| `games[].p`, `src` | computed | blended at the published 0.75, using the page's own `ncdf`/`nppf` lifted from source so the file and the page cannot disagree about what 0.75 means |
| `meta.captured`, `nfelo_sha` | `data/nfelo.json` → `data.meta` | |
| `meta.elo_per_pt`, `hfa`, `sd`, `*_su` | **carried forward, never refitted** | fitted parameters and backtest claims, not weekly facts |
| `teams` | carried forward | display names |
| **`games[].mk`** | **carried forward from the existing snapshot** | ⚠️ see below |

### ⚠️ Market prices are the one thing this cannot fetch

`data/nfl-schedule.json` deliberately excludes market prices — its own note says the
upstream table "does not identify their book and observation timestamp", the same
standard the CFB market surface holds itself to. So `mk` is **preserved by game id** and
never invented, and the script **refuses to write** if a rebuild would lose any captured
line (a schedule change that moves a game the snapshot had a price for has to be
reconciled by hand). Today 51 of 272 games carry a market price; the other 221 are
model-only and the page says so per row.

Capturing new lines is a separate, unbuilt step. Until it exists, a refresh updates
ratings, schedule and dates but leaves the market coverage where it is.

## Three things the generator found in the shipped snapshot

None of them are changed by a refresh. All three are Kap's call.

1. **Neutral-site games carry full home-field advantage.** Eight 2026 games are flagged
   `neutral_site` and all eight are priced with the full +2.1. Correcting that is a
   *model change*, not a refresh, so the default reproduces it. `--neutral-hfa=0` applies
   the correction and is off by default, so a routine refresh can never quietly move
   numbers.
2. **`data/nfelo.json` still calls the Raiders `OAK`.** Everything else on the site says
   `LV`. There is a one-entry `RATING_ALIAS` and the build **dies** on any other
   unmatched code — a silently unrated team is a team whose probabilities become nonsense
   without an error anywhere.
3. **Rams game ids use `LA` where team codes use `LAR`.** Ids are joined on both the
   canonical form and `(week, home, away)`, and the snapshot's own id style is preserved,
   so nothing that quotes an id changes shape.

### ⚠️ The date trap, which cost a false green

`kickoff_at` is UTC. A Thursday 8:20pm ET kickoff is `00:20Z` the *next* day, so slicing
the ISO string moves every night game forward by one — and the page prints that field.
The first version of the script did exactly that, and its `--check` reported **"no
differences"** because the check was comparing only `mm` and `p` on loose tolerances and
never looked at `d` at all. The real write moved 247 of 272 rows.

`--check` now compares **every field**, exactly, and prints a per-field count. A check
that does not compare a field cannot report that field regressing.

## Expected steady-state diff

Running `--check` against the shipped snapshot today reports **9 games differing in `mm`
by ~0.005**, and nothing else. That drift is because the original blob was built from
unrounded ratings while `data/nfelo.json` publishes them to one decimal. It moves no
probability by more than 0.0001.

**So a rebuild is never byte-identical, and this should not be run as a no-op.** Run it
when the inputs have actually moved.

## Making it weekly

The cheapest durable option is to add step 3–4 to `.github/workflows/nfl-data.yml`, which
already refreshes the backbone and opens a review PR. It would need the `sw.js` bump in
the same commit, which that workflow does not currently do — so it is a real change to
that workflow rather than a one-line addition, and it is not made here.
