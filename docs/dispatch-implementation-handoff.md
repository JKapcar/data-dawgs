# Data Dawgs Dispatch implementation handoff

Jason approved **Data Dawgs Dispatch**, with **Dispatch** in navigation: private project-management software for delegating to AIs. Preserve Claude Project for planning and Claude Code for implementation. This is a handoff, not an implemented rename or approved design.

## Execution blocker

On 2026-10-17, Claude Code was absent from PATH and the standard native executable, npm shim/package, and WinGet link locations checked for this Windows user. WSL reports that it is not installed. No callable Claude Code installation was found, so authentication could not be verified. No credential stores were read, agent installed, account configured, or alternate coding agent substituted. Resume with an existing authenticated Claude Code executable supplied or made available by the owner; do not install or authenticate one implicitly.

The isolated clone is in this task's `data-dawgs` directory, on local branch `dispatch-implementation-handoff`, based on freshly fetched `origin/main` at `be7d88721fd855590c23c2a3ce135d0bfd1d1f1a`. No other task's checkout was edited. No implementation, screenshots, independent code review, push, PR, merge or deployment has occurred.

## First change and compatibility boundary

Change the private product's page title and heading to Data Dawgs Dispatch, navigation labels and switcher accessible name to Dispatch, and private-product explanatory/error copy consistently. Inspect `dawg-pound.html`, client `dawg-pound.js`, research-lab HTML navigation, copied root-page navigation, and private-product display strings in `work/mcp-block.js`. Search each occurrence by meaning; a global replacement of Pound is unsafe.

Keep `dawg-pound.html`, `dawg-pound.js`, `/api/pound`, `/mcp/pound`, app identifier `pound`, owner connector names `dd_owner_pound_read` and `dd_owner_pound_write`, stored keys/records, revisions, auth and permissions unchanged. Preserve public `agent-board.html`. At this base, public `pound.html` is a historical redirect to `dawghouse.html`; it is not the private app and must remain unchanged.

Follow `AGENTS.md` and `work/README.md`: refresh the clean branch from current origin/main before implementation; flattened HTML is source and navigation is copied across pages. Edit Worker source blocks, never their generated copies in `dawg-bot-worker.js`. If display metadata changes in `work/mcp-block.js`, regenerate with `node assemble.mjs` from `work/` and prove idempotency. Any page change requires the `sw.js` root HTML/JS hash version bump. Preserve private shell/API/service-worker network-only exclusions. Never push main or deploy.

## Mobile layout proposal for Claude Project review

Apply Jason's durable [visual and tactile design direction](visual-interaction-design.md): abundant useful visuals, "538 meets Apple," high-contrast Dawg Orange, compact charts and comparison cards, with weighted-looking dials, sliders and lever/switch travel where real controls support them. Bring useful controls above the fold. Use truthful task counts and stored states; milestones and real vote visualizations require actual supporting records. Never fabricate them to fill the design. Audio is opt-in; provide reduced motion, keyboard operation, visible focus and readable mobile layouts. Avoid flashing and manipulative loops. Crisp press feedback is immediate, but success or celebration waits for verification. The name remains Data Dawgs Dispatch and navigation remains Dispatch.

The current header already has a compact CSS override. The primary remaining ordering problem is `renderNow()` in `dawg-pound.js`: it renders full latest context text in the first card, followed by open tasks and recent messages.

Use a compact dark/orange header, normal navigation, account control, refresh and new task action. Order the mobile page as follows:

1. Decisions needing Jason. Existing message kinds include question and decision, but there is no explicit recipient, pending/resolved flag or acceptance field. Label this capability unavailable; an optional list of saved questions/decisions must say that resolution is untracked. Do not infer pending approvals from message kind.
2. Project summary. Project grouping, milestones, project owner and structured blocker reasons are unavailable in the current schema. Task role assignments can be shown as assignments, not accepted ownership. Show unavailable fields explicitly without inventing projects or milestones from prose.
3. Work. Show stored queued, working, blocked and done tasks, with assigned role and saved timestamp where available. Reserve a clearly unavailable Review section; do not silently map blocked to review or write an unsupported status. Working is a saved status, not observed execution. Keep blocked work prominent.
4. Dependencies and last verified activity. Dependencies are unavailable. Render saved activity timestamps/attribution, plus the actual successful refresh time as verification of retrieval only. Do not claim those timestamps verify agent execution.
5. Context library on demand. Show document titles, versions and dates; open full content through the existing accessible reader. Keep discussions secondary to work. Include a daily brief/podcast entry only if supported data and a usable destination actually exist; there is no dedicated field in the inspected schema.

Retain keyboard navigation, visible focus, accessible dialogs, 320/390 px layouts, text escaping, session-change clearing, hidden-page clearing, in-memory drafts and uncertain-request replay. No fabricated progress, votes, online agents or runtime claims. Test and screenshot only synthetic fixtures with live network blocked. Private task records and invitation/acceptance details must stay outside the public repository.

## Verification and draft PR requirements

Baseline run at the stated commit: `node --test tests/dawg-pound.test.cjs tests/service-worker.test.js` passed **83/83** tests with no failures. This verifies the unchanged baseline, not the proposed implementation.

Add rename assertions and old-URL/tool-name/record compatibility coverage. Run the private workspace and service-worker suites, identity/public MCP regressions, owner-app/navigation contracts, and applicable CI checks in `.github/workflows/research-lab.yml`, `worker-validate.yml` and `site-safety.yml`. Run `node tools/validate-data.js` and required assembly validation. Do not change unrelated data.

Use `tests/dawg-pound-ui.cjs` for synthetic mobile/desktop screenshots and browser regressions, plus `research-lab/navigation-browser.test.mjs`. The UI test currently requires a pixel-identical header against commit `d5d48369a412fd7263c751e42b6108ba498a798a`; explicitly adapt that approved rename expectation while retaining navigation geometry, accessibility and privacy protections. Do not simply remove coverage.

Obtain an independent review if available without configuring agents or transferring private state. Open a draft PR only after Claude Code produces a reviewable change. Separate the narrow rename from the layout proposal in commits. Include exact changed scope, synthetic screenshots, actual test results, review outcome and the unavailable schema fields above. Do not represent this handoff as a finished code PR or backend capability. No security changes, subscriptions, external-agent setup, dataset transfers, merge or deploy are authorized.
