# Score refresh diagnostics and budget guard — October 10, 2026

## Incident evidence and limits

At 07:07 UTC, the public CFB score feed reported a last successful finals fetch of
October 9 at 02:40:11 UTC, a latest attempt at October 10 at 06:30:10 UTC, and
`provider_error`. Seven games whose scheduled kickoff had passed still had no final
in that feed. A passed kickoff alone is not proof that a game has completed.

The public health route recorded `bozo:scores` as failing since 06:30 and a current
five-minute cron heartbeat. Its failure timestamp is not necessarily the start of
the underlying provider outage. NFL's Thursday final was available through the
schedule feed even though its provider archive carried an older error.

Sources:
- https://toto.jkapcar4.workers.dev/scores?sport=cfb&dates=20261007-20261010
- https://toto.jkapcar4.workers.dev/ops/health
- https://github.com/JKapcar/data-dawgs/issues/209
- https://github.com/JKapcar/data-dawgs/actions/runs/38031771152

The existing request wrapper logged HTTP status but did not retain it on the
error object. The score archive intentionally discarded messages, making HTTP
refusals, network failures and invalid JSON indistinguishable. There is no verified
evidence here of quota exhaustion, a credential issue, or the board release causing
the outage. This patch does not claim to restore the provider or settle missing games.

## Changes

- Carry numeric HTTP status and a fixed failure kind through the request wrapper
  and score archive. Public `feeds.finals.diagnostic` exposes only `kind` and
  `httpStatus`; the health route remains unchanged. Legacy archives have a null
  diagnostic rather than an invented cause.
- Preserve existing private numeric quota metadata even when a successful HTTP
  response is invalid JSON or has the wrong scores shape. Credit balances are not
  added to public responses. Raw messages, URLs and provider bodies are never retained.
- Enforce the existing per-sport daily score-request cap in the shared score fetch
  function, including calls from grading. Previously only its cron caller enforced
  it. Cached verified finals still grade; a game needing a new provider fetch can
  remain pending until the cap resets or the schedule feed supplies its final.
- Failed or capped attempts preserve archived finals and their observation timestamps.
  Only a successful refresh clears diagnostics. No additional provider, retry,
  credential, odds capture, closing line, manual settlement or deployment is introduced.

## Verification and next evidence

Tests cover HTTP 401/403/429/500/503 without response-body leakage, invalid JSON,
network failures and deadlines, archive preservation and recovery, public allowlists,
legacy archives, private quota retention and direct-grading cap enforcement.

Follow the existing Worker deployment runbook only after owner approval. Following
an approved release, inspect the next real score refresh: the new diagnostic will
separate an HTTP refusal from network/response failures. Existing Worker logs named
`bozo-odds-api` can supply status before deployment if the owner has access. HTTP 401
alone still does not distinguish exhausted credits from an invalid key; consult the
owner-only account/log evidence rather than guessing. Do not bypass the budget to
force a diagnostic fetch. Provider recovery requires a fresh successful archive
fetch and verified finals, not merely a passing test suite or a healthy cron.
