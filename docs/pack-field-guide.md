# Pack Field Guide

Entry: `ai.html#pack-guide`, reached through the existing A.I. navigation. Existing
model-board sheets and routes remain intact. There is no build step: HTML, CSS and
JavaScript are the shipped source. The feature reads only its bundled public catalog.
It has no network calls, account reads, persistence, agent execution or permission UI.
The pre-existing AI board and Toto retain their existing behavior.

## Evidence contract

`pack-catalog.js` is the public research source; `schemas/pack-catalog.schema.json`
defines profiles, claims, evidence, run configurations, paired outcomes and reviewed
revisions. All objects reject unknown fields. No private agent configuration, project
records, account identifiers, permissions or credentials belong in this catalog.
This feature does not export private records into `/data` or any public surface.

The first five profiles are deliberately historical: GPT-4.1, Claude Sonnet 4,
Gemini 2.5 Pro Experimental, gpt-4o-transcribe and launch-era GPT-4o image generation.
These cover general coding/reasoning, multimodal input, transcription and image
generation. They are not a current frontier census. Current model versions, prices,
availability, local tool access and task-fit performance are unverified. A persona
does not create a new model. A harness change warrants a new setup record.

Source publication/version date, source checked date, and actual test date are
separate fields. Null test dates mean no test date is reported in this catalog;
checking a source never creates a test result. Source `verified` means checked,
not independently reproduced. Checks older than 90 days display stale (an editorial
freshness policy). Explicit stale and version-changed states override recency. The
image launch page redirects readers to a newer experience, so its profile is changed.
Debate or Vote v1 is retained and marked stale because a later revision exists.

Every capability description links to a vendor source. External research cards
retain scope and caveats; independent benchmark results are never mixed across
definitions or suites. The selection principle is labeled editorial inference.
No scores, ranks, prices, correlations or Pack performance are invented.

## Advisory selection and measurement

`pack-core.js` separates shared failure, conditional same-wrong-answer agreement,
independent rescue opportunity and actual review gain. Zero observations returns
null, never a zero performance estimate. Zero measured failures also makes the
rescue fraction undefined. Review gain subtracts newly introduced failures and
includes every valid reviewed answer, including originally correct answers.
Exclusions are counted. Direction is explicit. The UI currently renders only the
empty state: no Pack runs exist. Future result rendering must retain the run's exact
suite/version, task IDs, model/harness/tool configurations, dates, exclusions and
uncertainty method; incompatible run sets must never be pooled silently.

Mandatory capabilities must be verified for the exact setup. Vendor advertising,
missing capability fields and unknown tool access do not pass. All starter setups
therefore remain blocked for recommendations. The team form records a hypothetical
builder/reviewer choice in page memory only. It does not dispatch, connect, save or
grant anything. Same-model choices explicitly identify the self-review baseline.

The proposed pilot is not executed: three setups, twelve matched independently
solved tasks, blinded deterministic scoring, then a preselected directed reviewer
pair over all twelve. Include no-review and self-review controls and equal-budget
sampling/voting when applicable. Use held-out replication before stronger claims.

## Manual refresh

1. Check the official, version-specific source. Keep its actual publication date;
   record today's check date separately. Record a test date only with test evidence.
2. Add a new profile for a model version change. Do not transfer old results to it.
   Keep historical profiles and label stale, unknown and changed versions honestly.
3. Attach source type, exact scope, caveats and claim references. Check hyperlinks.
4. Review the proposed public diff for secrets, private project data and unsupported
   capability assertions. Only public-safe reviewed run artifacts may be referenced.
5. Run the logic, schema and browser checks below; inspect mobile screenshots.
6. Recompute `sw.js` VERSION from root HTML and JS per AGENTS.md. Open a review PR.

No scheduler, cadence, automatic refresh or automatic publication is configured.

## Verification

Logic: `node --test tests/pack-field-guide.test.cjs`.
Schema: `node tests/pack-schema.cjs` (Ajv 8 plus ajv-formats).
Browser: `node work/test-pack-guide-ui.mjs` (Playwright plus @axe-core/playwright).
The existing loader supports `DD_NODE_MODULES` for test-only dependencies and
`PLAYWRIGHT_CHROMIUM` for the browser. `PACK_SCREENSHOTS` changes the capture directory.
Tests stub external services; they never invoke paid models or private live records.

Verified at 320, 390 and 1440 pixels: no horizontal page overflow; library filtering,
empty results, comparison, modal Escape/focus return, mandatory-tool blocking,
unknown heatmaps, WCAG A/AA axe checks and synthetic private-canary isolation.
Automated accessibility checks do not replace broader assistive-technology review.

Public-only QA captures: [320px mobile](pack-field-guide/mobile-320.png),
[desktop](pack-field-guide/desktop-1440.png), [evidence drawer](pack-field-guide/evidence-390.png),
and [team builder](pack-field-guide/team-1440.png). External services were stubbed.
Test dependency versions used: Playwright 1.64.1, @axe-core/playwright 4.14.0,
Ajv 8.20.0 and ajv-formats 3.0.1, installed outside the repository.

Shared merge surface: the existing site-map strings in 34 HTML pages and the cache
version in `sw.js`. Other pages receive only that map description. Recompute the
cache key after integrating concurrent work; do not overwrite Dispatch or private
workspace changes. No Worker, deployment manifest or security settings change here.
