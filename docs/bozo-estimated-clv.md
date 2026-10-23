# Estimated CLV

Alongside two-sided measured CLV and `clvPts` manual overrides, the schema stores `ledger/<row>/clvEstimate`, exposed by `/bozo/clv`, and a separate
estimated-evidence disclosure below the existing CLV chart. Estimates never feed the
measured chart, official rankings, tiebreakers, expected-win baseline or settlement.
Existing zero overrides remain intact. No result field is changed.

## Existing manager write path

POST `/bozo/close` with `league`, `row`, `requestId` (16–80 alphanumeric/hyphen),
`expectedEstimateRevision` (0 for new), and `estimate`:

- `closeQuote`: price, opposite (explicit null if unknown), book=draftkings,
  exact existing selectionKey, sourceUrl (public HTTPS without query/credentials),
  quotedAt (explicit null allowed), retrievedAt, evidence (`source_reported_closing`
  or `observed_pregame`). The timestamp must describe the quote evidence, not be
  fabricated from retrieval time; page-only timing belongs in rationale.
- `rationale`: public-safe explanation of assumptions and source limitations.
- `scenarios`: three explicitly chosen increasing overround fractions when neither
  end has an observed pair. No universal default is supplied.

The same manager authorization already used by the route applies. A fresh full-league
ETag read/write protects concurrent edits, the row must match the inspected snapshot,
and revision comparison prevents lost estimate edits. Duplicate request IDs are
idempotent only for identical input. Existing audit retains prior/new estimates.
No new credentials or access grants. Each estimate still requires reviewed source evidence.

## Calculation

American odds -> implied probability. With a pair, fair=impliedMine/(impliedMine+
impliedOpposite). With one side, modeled fair=implied/(1+assumedOverround).
CLV=100*(fairClose-fairEntry), in probability percentage points, NOT expected ROI.
When exactly one end has a pair, its observed hold calibrates the missing end; vary
that assumed hold by ±0.02, bounded at 0 and 0.30. This is illustrative sensitivity,
not statistical confidence. When neither has a pair, apply each chosen scenario
consistently at both ends. With two reported pairs, no vig is inferred; uncertainty
remains in closing-source provenance/timing, not a fictional numerical interval.

Only settled won/lost/push rows, same book and exact selection key are supported.
Future, void, missing quote, other book, alternate-line mismatch and measured-pair
replacement are refused. Unverified entry prices stay visibly unverified. Existing
original closing pairs take precedence. Unknown closing quotes remain unknown;
there is no zero default. Assumed opposite prices are never written to capture fields.

No participant records or research inventory are seeded by this patch. The parent
can prepare individual requests after source review, preserving the current four
manager overrides. Local tests use synthetic rows only.

Observed-pregame evidence requires a known kickoff and an earlier quote timestamp. Saved estimates bind to the inspected price, market and status fields. Changed basis rejects duplicate replay and suppresses stale numerical display until recalculated. The manager form submits reviewed inputs through the existing manager route.

## Visibility and limits

The league Overview CLV card displays the estimate evidence panel **open by default**.
It includes current and historical ledger weeks, each labeled with its week, and wraps
long source URLs on mobile. It is separate from the measured chart; it does not replace
weekly outcome cards, standings, hierarchy history or chart values. Thus estimates
are readable for old weeks in Overview, but not yet embedded into every historical
weekly card. Any future integration there must preserve the same precedence and labels.
Browser tests use the actual page CSS with isolated synthetic current/history records,
not an authenticated live session or production data.

## Manager form

Open the league Overview while signed in as its manager. In the CLV card, use
**Manager: save estimated CLV**, then **Load league ledger**, choose the exact week and leg,
then enter sourced closing prices, source URL, evidence classification, quote and
retrieval timestamps, and rationale. Unknown opposite/time fields stay blank. If
neither end has a pair, explicitly choose three overround percentages. **Preview
estimate** shows the modeled probability-point range; **Save estimated CLV** submits
through the existing authenticated route. Success appears only after the exact row
is read back with matching request ID, revision and evidence. Conflicts require a
fresh review; an unchanged retry reuses its request ID. No DevTools or token copying.

The form preserves an existing retrieval timestamp; new evidence requires its actual
retrieval time. Saving freezes the inputs until the request and readback finish.
A successful readback must match the saved estimate and preserve all other row fields.
Unknown object fields omitted by Firebase are equivalent to explicit nulls only for
estimate comparisons; changes to actual prices, markets or result evidence remain stale.

## Current-week settled results

An ungraded ledger row can use an already stored terminal current-board result only
when season, week, exact ledger key, selectionKey and event all match. The estimate
records that settlement basis and becomes stale if it changes. It never updates the
ledger result, current results, week status or Bozo decision. Missing, mismatched and
void results remain ineligible. Whole-week finalization is neither required nor called.

## Untimed quote proxy

`untimed_quote_proxy` explicitly uses a sourced, matching-market quote as an estimated
closing proxy without claiming closing timing. Quote time must remain null; public
source URL, actual retrieval time and rationale remain required. The preview and
board display “Untimed quote used as closing proxy.” It never becomes measured CLV
or an original capture, and does not affect rankings, settlement or overrides.
