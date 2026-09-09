# Default season DataDawg$

Custom league/horizon boards retain priority. A missing season board now resolves to the default ETR conversion. Dynasty values never inherit these season inputs.

Input: owner-supplied NFL ETR Auction Values CSV. Five columns are normalized separately to a $2,400 comparison pool. The original file stays outside the repository. The import records its SHA-256 and receipt date; publication date is unknown. This is an auction-value snapshot, not a one-week projection feed or a verified rest-of-season forecast.

## Calculation

Choose the nearest supplied PPR format; two starting QBs or a superflex slot selects a superflex prior. Fill dedicated starter slots, then flex slots, across the entire league using the chosen value curve. The best remaining player at each position defines replacement value. Repeat for an assumed 12-team reference lineup of 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K and 1 DST, plus superflex when applicable.

Adjusted weight = max(0, normalized prior - 1 + 0.5 × (reference replacement value - league replacement value)). The 50% coefficient is a judgmental damping assumption, not calibrated performance evidence. Bench depth determines the count of priced roster slots. IR and taxi do not consume that pool. Active-position players beyond the priced roster capacity receive zero; unmatched players remain unpriced.

Reserve $1 per priced slot and distribute the remainder in proportion to adjusted weights. Largest-remainder cents rounding makes total values equal teams × budget. When an auction budget is absent from the adapter, use a labelled nominal $200/team comparison scale. This is not money remaining or a suggested FAAB bid. ESPN's current War Room feed does not expose auction budget, so its default currently uses that nominal scale.

No custom scoring-bonus adjustment, keeper inflation, injury override, dynasty conversion or guillotine survival valuation is claimed. Unsupported starter slots or insufficient player coverage refuse the calculation. No price from another custom league is used.

## Updating the shared input

Run from the repository root:

    python work/import-default-etr.py /private/path/ETR.csv YYYY-MM-DD
    node work/test-datadawg-default.cjs
    node tools/data-manifest.js
    node tools/validate-data.js
    python work/stamp-sw-version.py

Publish the generated input and manifest, not the uploaded CSV. The War Room fetches the default source once per page session with no-cache; reopening the page uses the latest published input. Receiving another file in chat does not by itself update the website; the import and deployment must complete.
