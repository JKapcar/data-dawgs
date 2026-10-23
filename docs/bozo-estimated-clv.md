# Estimated CLV (local draft, no live writes)

Existing schema supports two-sided measured CLV and `clvPts` manual overrides only.
This draft adds `ledger/<row>/clvEstimate`, exposed by `/bozo/clv`, and a separate
estimated-evidence disclosure below the existing CLV chart. Estimates never feed the
measured chart, official rankings, tiebreakers, expected-win baseline or settlement.
Existing zero overrides remain intact. No result field is changed.

## Proposed existing manager write path

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
No new credentials or access grants. This is a schema/Worker change needing review
and deployment, not an instruction to send this payload to current production.

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

Observed-pregame evidence requires a known kickoff and an earlier quote timestamp. Saved estimates bind to the inspected price, market and status fields. Changed basis rejects duplicate replay and suppresses stale numerical display until recalculated. There is no estimate entry form yet: reviewed structured requests use the existing manager route.

## Supported operator workflow after reviewed deployment

There is no estimate-entry form. The supported alternative is the existing page's
`wPost` manager request helper, which supplies the active league and current session
without copying or displaying credentials. In an already signed-in manager's Bozo
page, choose the intended league and inspect that league's `/bozo/clv` readback.
Prepare a reviewed JSON payload with the exact ledger row key, selectionKey, sourced
quote and expected estimate revision. Call `await wPost('/bozo/close', payload)` from
the page's developer console. Do not paste session tokens, use raw database writes,
or put credentials in the payload. This is an operator procedure, not a consumer UI.

For example, the following is SYNTHETIC and must not be submitted to a real league:

```js
const payload = {
  row: '2026-w1-synthetic', requestId: crypto.randomUUID(),
  expectedEstimateRevision: 0,
  estimate: {
    closeQuote: {
      price: -180, opposite: 150, book: 'draftkings',
      selectionKey: 'synthetic-same-market',
      sourceUrl: 'https://example.com/closing', quotedAt: null,
      retrievedAt: '2026-10-23T12:00:00Z', evidence: 'source_reported_closing'
    },
    rationale: 'Synthetic example only; page timing is unknown.'
  }
};
// Only after substituting a reviewed real payload and approval:
// const saved = await wPost('/bozo/close', payload);
// await clvLoad(true);
```

Success requires the returned revision AND a fresh `/bozo/clv` readback matching
requestId, quote, method, point and unchanged original prices/override. A 409 means
reread and review; never automatically increment the revision or overwrite a newer
record. Retry an uncertain request only with the same requestId and identical input.

## Visibility and limits

The league Overview CLV card displays the estimate evidence panel **open by default**.
It includes current and historical ledger weeks, each labeled with its week, and wraps
long source URLs on mobile. It is separate from the measured chart; it does not replace
weekly outcome cards, standings, hierarchy history or chart values. Thus estimates
are readable for old weeks in Overview, but not yet embedded into every historical
weekly card. Any future integration there must preserve the same precedence and labels.
Browser tests use the actual page CSS with isolated synthetic current/history records,
not an authenticated live session or production data.

## Release sequence (not executed)

Review this exact local diff, publish a branch/PR only when authorized, run exact-head
required CI, then review the assembled Worker artifact and complete configuration.
Release Worker schema/route first with existing settings preserved; verify authenticated
read-only behavior. Release Pages with its matching service-worker stamp. Submit only
individually approved estimate payloads via the manager path, verify persisted readback,
and verify current/historical Overview display. No result writes or week finalization.
