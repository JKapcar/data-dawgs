# DDCC question-library operations

The active DDCC answer bank is intentionally not committed. This repository is published
verbatim by GitHub Pages, so a tracked answer-key file would become a browser-readable URL.

The local authoring file is `private/ddcc-question-library.json`. It contains an array of
records with the V1 question schema: `id`, `claim`, Boolean `truthValue`, `domain`,
`secondaryTags`, `explanation`, source metadata, positive `version`, `verified`, and
`draft|active|retired` status. The checked-in example at
`scripts/ddcc-question-example.json` documents the shape without supplying an active key.

Validate and report counts:

```text
node scripts/validate-ddcc-questions.mjs private/ddcc-question-library.json
```

The validator fails on structural errors, unknown domains, duplicate IDs or normalized
claims, malformed URLs, invalid dates, unverified active records, and per-domain truth
imbalances greater than one. It warns until each domain reaches the 60-question target.

Importing is a production data change and must be separately authorized. The importer
requires the rotatable `DDCC_IMPORT_TOKEN` operator secret in the process environment and
an explicit confirmation phrase. It never requires or exposes the Firebase credential:

```text
DDCC_IMPORT_CONFIRM=replace-ddcc-question-bank node scripts/import-ddcc-questions.mjs private/ddcc-question-library.json
```

It validates locally, then the Worker independently validates the complete payload before
writing only `/ddcc/questions`. It never touches attempts, responses, users, or the protected
test room. Do not run it merely to test the feature; Worker tests provide an in-memory
Firebase substitute.

The browser never reads this file or the Firebase question node. The Worker selects and
snapshots questions server-side and removes truth values, explanations, and sources from
active-attempt responses. Those fields are returned only for completed-attempt review.
