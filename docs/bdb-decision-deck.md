# Private evening decision deck

`research-lab/decisions.html` reads one explicitly selected project through the existing signed-owner `/api/project/v1/<project_id>` route. It starts with no fabricated items and does not turn queued tasks into decisions. The initial project ID is `bdb-2027`, a selectable destination, not a claim that a project exists. The project feature remains **off** in the release manifest. This PR does not activate it, seed private records, change grants, schedule a brief, merge or deploy.

## Additive schema

The storage envelope remains `dd-project/1` at `/researchProjects/v1/<tenant>/<project_id>`. Existing project records, legacy decisions and callers remain valid. `decision.save` accepts optional `deck` version 1; read the actual `writeSchema` for complete lengths and required fields. The brief includes why now, a human-readable deadline, consequence, lesson, options/consequences, recommendation, strongest counterargument, uncertainty, dependent work, researched-at and valid-until timestamps, sources with checked-at dates and supported claims, and explicit intent-only/approval-link metadata. All are authored claims; structural validation is not fact checking or independent source verification.

Only a fully sourced, current brief with option tradeoffs can be marked `ready_for_decision`. Other authored stages are `proposed` and `needs_research`. Returned `deck_status` derives `answered`, `deferred`, `needs_research` or `stale` from the latest response, proposal hash and validity. Changing any brief or control field changes the proposal hash. Prior-version responses are retained and visibly stale. Withdrawing a proposal removes it from the deck. Old decisions without briefs are retained but not falsely presented as researched cards.

New owner-only operation `decision.respond` requires `expected_revision`, `request_id`, item `id`, `expected_record_revision`, `proposal_version`, `disposition` (`answer`, `defer`, `need_information`) and `rationale`. `answer` uses exactly one canonical control-specific field:

| Control | Meaning | Canonical answer |
| --- | --- | --- |
| choice | One declared categorical option | `{ "choice": "option_id" }` |
| scale | A bounded integer measure with explicit unit/min/max/step | `{ "number": 6 }` |
| rank | A complete ordering without ties | `{ "order": ["b", "a"] }` |
| budget | Allocate an integer total in declared units | `{ "allocations": [{"id":"a","amount":3},{"id":"b","amount":7}] }` |
| buckets | Assign each option to a declared group | `{ "assignments": [{"id":"a","bucket":"now"},{"id":"b","bucket":"later"}] }` |

No numeric answer is silently inferred from a recommendation or slider position. The initial scale thumb is only a mechanical affordance; the numeric answer remains empty until explicit input. First-version measures are nonnegative integers up to 1,000,000. Fractional/signed measures, tied ranks, intervals and multidimensional controls require a later explicit contract; do not encode them as pretend categorical sliders. Reserve can be an explicit budget option authored with its own tradeoff.

Non-answer dispositions carry an empty answer. Responses are append-only (100 per item, then fail closed), stamped with verified signed-owner identity, proposal version, request ID and time. They record `execution: not_executed`. A new response can supersede an earlier choice through another explicit preview/confirm; it does not undo any external action. Existing receipt retention and project byte limits still apply. After receipt eviction an old expected revision fails rather than duplicating the response.

`decision.resolve` remains compatible for legacy records; brief-backed records use `decision.respond` so typed controls cannot be bypassed. The new operation is denied to connector, collaborator and automation principals by the existing owner-only gate. No public agent-board popularity or vote authorizes these decisions. Existing owner connector decision-save proposals can carry a brief through their existing schema-driven payload, but cannot answer it.

## UX and extensibility

The page provides summary cards, expandable explanatory lessons and sources, five working conventional controls, a reversible preview, explicit confirm, defer and need-more-information. Save success requires receipt plus readback of the same request and proposal. An uncertain save retries the identical request ID; a conflict clears stale cards and requires a new read. Values render as text, links accept credential-free HTTPS only, and sign-in uses the existing account helper. No private text enters URLs, browser persistence, screenshots or telemetry. Screenshots/tests are synthetic.

`decision-controls.mjs` separates canonical answer validation/formatting from the renderer and preserves a 26-mechanism **proposed, not efficacy-tested** catalog. Richer ideas include pairwise tournaments, tied priority tiers, constrained loadouts, two-axis preferences, measured Pareto frontiers, scenarios, sensitivity, intervals, forecasts, evidence influence, dependency maps, stopping rules and teach-back. These need appropriate data, uncertainty and accessible input contracts before implementation. No invented charts, random rewards, agreement incentives, countdowns or streak penalties. Audio is off; reduced motion is respected and controls are at least 44px. This version uses taps/keyboard; no swipe gesture is advertised.

The page links from My Lab. It is a manually opened deck, not a new schedule or autonomous research process. The existing 8:30 PM America/New_York brief can link to it after separately coordinated automation work. Researchers must explicitly author evidence-backed briefs; this release does not fetch source pages or manufacture research from tasks.

## Rollout and verification

1. Review source tests, assembly parity, packaged Worker and synthetic browser screenshots.
2. Obtain release approval; upload and inspect the full packaged Worker with existing bindings, secrets and dataset pin preserved. Backend must precede the page.
3. Project storage activation is separate: verify existing owner and private storage rules, approve `RESEARCH_PROJECTS_ENABLED=true`, and reconcile the complete deployment manifest. This PR keeps it false.
4. Through an authorized private session, read the schema/current revision and create the intended project/actual decision briefs. Do not put private project content in GitHub or screenshots. No data migration or automatic seeding is required.
5. Verify a real signed-owner save/readback only with a separately authorized non-sensitive item. Binding/permission-sensitive actions still follow their own approval flow; this UI only records intent.

Tests: `node --test tests/research-project.test.cjs research-lab/decision-controls.test.mjs`; `node research-lab/decisions-browser.test.mjs`; existing owner-app and Worker regressions. Browser coverage includes all five controls, preview cancellation, lost-response same-key retry, readback, revision conflict, disabled backend and 320/390px reduced-motion screenshots. Local screenshots do not establish production activation or real account access.
