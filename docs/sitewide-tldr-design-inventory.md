# Sitewide TL;DR: design inventory and scope checkpoint

Status: integrated with chart comprehension and approved cash-line accounting on the isolated integrated-review branch, based on 7fe3953. Original separate local branches and review artifacts are preserved. This inventory describes the shared presentation scope; release evidence is recorded separately.

## Actual implementation surface

52 top-level HTML files, 34 containing the repeated `nav.className = "sitenav"` implementation. Nine HTML files one directory below root include research-lab tools and a mockup. There is no checked-in top-level nav.js or site.css: shared behavior/styles are embedded copies. The companion JSON inventory records titles and static headings; keyword matches are discovery cues, not automatic classifications.

## Scope before broad edits

New visitors get TL;DR, with the page's actual chart, tool, table or primary task first. A compact `🤖 Agent details` control reveals only explicitly classified machine/API/schema/implementation content. Use a decorative robot plus accessible text; retain human-facing explanations as Help, not Agent details. Preserve source dates, uncertainty/quality badges and expandable warnings near the values they qualify. Do not hide sign-in, consent, privacy, account controls, or failure states.

Preference: a versioned page-scoped localStorage value with only `tldr` or `agent`, written on deliberate selection. No identity, credentials, user inputs or account writes. Empty/missing/invalid preference means TL;DR. Explicit machine-section hash links should reveal their target without silently changing the saved default. Keyboard: native buttons/details, aria-expanded/controls, visible focus; collapsed content not focusable. Changing presentation must not reset form state or rerun calculations.

## Proposed staged implementation

1. Page-local pilot: Arena directory, Calculators and Data Library have clear `#machines` sections. Collapse those sections under Agent details, preserve their IDs and deep links, and keep task cards/forms/shelves first. Existing source/assumption notices stay beside outputs. Test the pilot before generalizing.
2. Apply explicit per-page annotations to other human-facing public pages after inspecting their actual DOM. Never blanket-hide paragraphs, all details, all code, or every section matching AI/agent keywords. Preserve specialized DFS, draft, rankings and fitness controls.
3. Add shared presentation control only after protected-page handling below is settled. Test all affected routes, links and first viewports; do not infer 52-page coverage from the pilot.

## Approved narrow Stats exception and implementation

User approved including Stats in the shared presentation control only: calculations, data and charts remain untouched. This is not a removal of repository protections. The Stats and Home source changes consist solely of the shared-script reference; all pre-existing source bytes are verified unchanged. Home manifesto text/structure is unchanged. Research/account/consent controls remain intact.

Implemented: 52 root pages and 8 research-lab pages share TL;DR default plus robot-and-text Agent details control. Three existing meta redirects preserve their behavior and do not mount a control. The work/ reference mockup is excluded. Nine explicit technical sections are hidden only in TL;DR; existing machine links are available in Agent details. Seven reviewed directory introductions are human About disclosures, six caveats retain concise visible summaries with their complete original text in human details, and four section-reading guides move below cards. Specialized app layouts retain their existing ordering; no broad keyword-based hiding was used.

CSP is unchanged: DateDawg receives an identical inline copy because it blocks external scripts. Two pages that require self-hosted styles receive presentation-mode.css, generated identically from the shared style string. Other pages use the shared script's inline style. No access-policy relaxation, network calls, account writes or new AI capability is added.

Validation records are in sitewide-review-artifacts. Static tests compare original page bytes after removing only the hook and verify protected files unchanged. Route tests cover every nonredirect DOM shell with application scripts suppressed, using existing markup plus synthetic fixture cards. Real-script integration separately uses synthetic Arena and Stats inputs and the empty DateDawg app. These checks do not establish full live application, signed-in, physical-phone or screen-reader validation. The focused Showdown and cash-accounting branches must be integrated separately before any release; this branch intentionally does not absorb them.

## Top-level page inventory

| Page | Repeated nav | Technical keyword cues | Review treatment |
|---|---|---:|---|
| agent-board.html | custom/none | 0 | Agent workflow: not ordinary human copy |
| ai.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| arena.html | yes | 1 | Pilot candidate: explicit #machines section |
| auction.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| bigboard.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| board.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| bozo-menu.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| bozo-night-reference.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| bozo.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| calculators.html | yes | 3 | Pilot candidate: explicit #machines section |
| cfb-power.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| cfb.html | yes | 4 | Inspect task hierarchy and human/technical content separately |
| challenge.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| connect.html | custom/none | 0 | Identity redirect: preserve behavior |
| dashboard.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| data.html | yes | 3 | Pilot candidate: explicit #machines section |
| datadawg-dollars.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| dataviz.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| datedawg.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| dawg-pound.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| dawghouse.html | yes | 2 | Inspect task hierarchy and human/technical content separately |
| dawgs.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| dfs-diagnostics.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| dfs-nhl.html | custom/none | 3 | Inspect task hierarchy and human/technical content separately |
| dfs-showdown.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| dfs.html | yes | 9 | Inspect task hierarchy and human/technical content separately |
| draft-leagues.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| explore.html | yes | 2 | Inspect task hierarchy and human/technical content separately |
| fantasy-warroom.html | yes | 2 | Inspect task hierarchy and human/technical content separately |
| feedback-inbox.html | custom/none | 0 | Private administrative surface |
| fourth-down.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| guillotine.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| index.html | yes | 2 | Manifesto copy/structure protected |
| markets.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| master.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| nfelo.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| nfl.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| pound.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| radar.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| rankings-admin.html | custom/none | 0 | Administrative grading surface |
| rankings.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| receipts.html | yes | 4 | Inspect task hierarchy and human/technical content separately |
| report.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| signon.html | yes | 5 | Identity and consent surface: presentation needs separate audit |
| stats.html | yes | 1 | Protected: never merge into this file |
| strategy.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| survivor-settings.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
| survivor.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| swoledawg.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| teamdraft.html | yes | 1 | Inspect task hierarchy and human/technical content separately |
| vault.html | custom/none | 0 | Account setup: preserve controls |
| weather.html | custom/none | 0 | Inspect task hierarchy and human/technical content separately |
