# DataDawgs contribution protocol v1

An evidence-first record of how people and assistants contribute to the living site.
BDB is the first pilot; `project_id` separates projects. This is a document format
and offline lint tool, **not a new task store, deployed API or access policy**.
Jason remains owner. Stewardship means accountable work with receipts, not ownership
transfer. No assistant is claimed to be participating, continuously connected, or
logging automatically. We make no claim of being first ever or of winning BDB.

## Use today

1. Copy [the synthetic proposal](contributions/synthetic-proposal.json), preserving
   explicit nulls. Choose the actual project and public/private scope. Synthetic
   examples are not live receipts. Never copy private material into this repository.
2. Before work, record the question, intended method, known data/version/split,
   assumptions, bounded task and the judgment behind the approach.
3. After an actual attempt, record its artifacts and execution reference, including
   null, inconclusive and failed outcomes. Do not delete failed attempts to improve
   the apparent success rate. If execution is uncertain, set stage `uncertain`, keep execution/results unknown, preserve any known attempted-call reference (null if unavailable) and use
   the existing RoboKap reconciliation gate; do not claim performed work.
4. Run `node tools/contribution-protocol.mjs path/to/record.json`. Passing checks
   structure only. A reviewer must inspect evidence, attribution and privacy.
5. Save through the project's **existing authorized** artifact/discussion interface,
   using its current schema, revision and idempotency rules. Retain its returned ID,
   version and hash. Do not send this JSON as new fields to existing write APIs.
6. Reference the saved artifact from the existing task receipt. Record review and
   disagreement faithfully, then the actual owner decision with its precise scope.
   A write or accepted task does not by itself establish a scientific finding.

Keep a stable contribution `id`; increment `revision` and reference the prior saved
artifact in `supersedes`. Never rewrite an immutable receipt. Existing records remain
valid legacy evidence; missing fields are unknown, not grounds for invented backfill.

## Required document fields

All fields in the example are required. Nullable fields must be explicit `null`
when unknown, never zero, an empty string, an invented identity or a guessed result.
An empty list means known none; `null` means not known for reviews/alternatives.

| Fields | Meaning and evidence rule |
|---|---|
| `schema_version`, `id`, `revision`, `supersedes` | Document version and continuity; not a new database identity or authentication claim. |
| `project_id`, `scope`, `kind` | Project boundary; public/private; research/infrastructure. Infrastructure CI is not research performance. |
| `stage` | `proposed`: no execution/results. `uncertain`: unknown execution/results awaiting reconciliation, with any known attempted-call reference. It never counts as completed. `performed`: referenced actual attempt, including failure/null. `accepted`: referenced owner acceptance with explicit scope, not inferred from prose. |
| `question` | Research question or engineering problem; distinguish intention from finding. |
| `actor` | Display label; optional self-reported model; optional server-recorded credential identity plus evidence reference. A key/account is not a verified model or independent reviewer. `continuity_ref` links an allowed handoff, not proof that two sessions are the same mind. |
| `data` | Dataset, exact version, split and SHA256; null where unknown. `holdout_accessed` stays false. BDB 2025 holdout is sealed. This format does not authorize evaluation. |
| `method` | What was proposed/done, sources, exact code/config references. URLs and prose are claims until inspected. |
| `judgment` | Choice, tradeoffs, rejected alternatives and assumptions: a concise decision rationale, not hidden reasoning. Mark contributor report, retrospective interpretation of a diff, or synthetic example. |
| `execution`, `results` | Actual experiment/test/merge reference; unknown is distinct from the observed outcome string `null`. Unknown summary stays JSON null. Keep error/null outcomes and limitations. |
| `artifacts` | Kind, exact reference/version, SHA256 or explicit unknown, public/private visibility. Hashes identify bytes; they do not prove correctness. |
| `reviews`, `owner_decision` | Actual record references, verdicts, disagreement, UTC time and decision scope. No fabricated reviewer participation. Private decisions stay private. |
| `timestamps` | UTC recorded/start/finish times; start/finish may be null. Do not substitute commit time for model runtime. |
| `resources` | Known elapsed milliseconds, amount/currency and evidence basis. Unknown costs stay null; no claim that work is free. |

The validator rejects unsupported fields, proposals with performed results, acceptance
without a decision reference, missing method/judgment/evidence fields, public records
explicitly carrying private artifacts, and holdout access. It cannot verify external
references, redact secrets, certify scientific claims or enforce project permissions.

## Reuse existing records: BDB pilot mapping

Source mapping checked against main `7375836bfb49172ef1f59adfc01a5d591d6c65bd`.

| Existing surface | Contribution mapping | Boundary |
|---|---|---|
| Lab hypothesis revisions (`machine-core.mjs`) | Question/title, method and versioned design. | Current schema and owner-only status gates remain authoritative. |
| Lab evidence and discussion | Sources plus method/judgment note or challenge; link hypothesis version in the document. | Current source permits notes/challenges plus constrained advisory reviews/findings; binding owner decisions and experiment execution remain excluded. Read the live advertised schema first. |
| Lab experiment receipt | `hypothesisVersion`, `split`, `provenance`, `outcome`, `summary`, `hashes.data/code/config`, `receiptHash`, `elapsedMs`, uncertainty/limits. | Only actual runner receipts prove attempts. `execution: not_executed` never becomes performed. Null/failure and descriptive-only limits survive. |
| Lab review/finding/owner-decision discussion | Receipt-specific review and decision references. | Only supported authorized routes; a shared-owner advisory is not independent review. |
| Existing Pound context version | Store full contribution document as text when that private workspace is appropriate. | Same owner/project authorization and version/hash rules; no public mirror. |
| RoboKap `rk.report` artifacts | `pound_context` ref `context_id@version`; `lab_receipt` ref receipt ID plus SHA256; `lab_discussion` ref discussion ID. | Server verifies these references as implemented. A GitHub PR URL is only format checked; a note is claimed evidence. |
| RoboKap plan/claim/review/decision | Link task/plan version, attempt, receipt and owner decision in the saved contribution. | Do not replace graph state with document `stage`; current server derivation decides eligibility/acceptance. |

The Lab and private Pound remain separate stores. A cross-reference is not a join,
data export, permission grant or research dispatch. See [owner connector boundaries](../research-lab/OWNER-CONNECTOR.md)
and [bounded foreground pilot](robokap-operational-pilot.md). Personal connector
credentials can carry full owner authority; this protocol does not make them scoped.

## Public science and private projects

Public contributions require a deliberate project-specific publication review. Never
export private Pound content, hidden session transcripts, jobs, finances, clients,
credentials, credential-bearing URLs or private record identifiers into public docs.
Do not infer public permission from a public `project_id` or an agent's claimed role.
A private project keeps its records and references in its existing private surface.
Any future public view must use an explicit allowlist and redacted export, not a feed
of all owner records. This local validator is not that security boundary.

## Examples and measured rollout

[PR333](contributions/engineering-pr-333.json) and [PR335](contributions/engineering-pr-335.json)
are retrospective, source-backed infrastructure records. Unknown model identity,
cost, session continuity and owner research decisions remain null. They establish
neither external AI adoption nor BDB scientific acceptance. [Synthetic null example](contributions/synthetic-null.json)
illustrates a record shape only and must never enter a real results denominator.

First acceptance gate: 2/2 bounded synthetic pilot tasks have contribution artifacts,
method and judgment recorded, correct identity qualification, artifact references,
and actual review/decision disposition. Live verified count remains **0/2** here.
Report coverage as recorded/eligible actual contributions with the denominator and
project scope; unknown coverage is unknown. Do not rank models from self-labels.

Later integration requires a separately reviewed diff: server-side validation of
documents, project-scoped export controls, UI forms/coverage views and supported
session execution. No new persistence, migration, grants, runner, schedule or agent
contact is introduced by this change. Existing assistants must actually adopt the
protocol in an authorized session before we claim they are logging.
