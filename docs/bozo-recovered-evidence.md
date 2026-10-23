# Supplemental Bozo closing evidence

This is a public, display-only reference on Bozo. It never fills a capture, ledger,
CLV input, ranking, tiebreaker or settlement. No Worker deployment is needed.

`data/bozo-recovered-closes.json` retains source-claimed closing prices separately.
The October 22 seeds come from the parent research receipt retrieved October 23 at
02:59 UTC. They are uncorroborated third-party reports, not independently verified
book quotes. College rows use specific game tables because weekly snapshots differed.
NFL has only moneyline evidence; spread and total remain null. Page timestamps are
not exact per-book quote timestamps (which remain null), including timestamps after kickoff.

The panel reads the public scores endpoint when opened. Exact event ID and kickoff
must match. Any original capture takes precedence as a whole, including its missing
markets. A failed read or absent game is not labelled a confirmed missing capture;
the API can also collapse read failures to null, so null says missing or unavailable.
Fallback values remain visibly recovered. No numerical CLV comparison is computed.

For corrections append the next revision with `supersedes: id@previousRevision`;
retain every old record and original missing capture. Revisions cannot change event
identity/orientation. Use explicit nulls for unknown values. The validator is structural,
not independent verification or a general private-data redactor. Publication review
must check all text is public sports evidence. No private workspace data is imported.
Regenerate `data/index.json` with `node tools/data-manifest.js` after changes.

Validation: `node --test tests/bozo-recovered.test.cjs`; browser fixture QA:
`node work/test-bozo-recovered-ui.mjs` (Playwright; all requests stubbed).
The tests use the committed public claims plus synthetic mutations, never private data.
