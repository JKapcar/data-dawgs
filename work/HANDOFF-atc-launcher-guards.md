# Handoff to Codex: the Ask Toto launcher guards (Stage ATC), 2026-08-10

**Status: built and passing its own gate, NOT committed, NOT swept by the browser suites, and
`sw.js` VERSION is NOT bumped.** Everything below is staged in the index (`git add -A` was the
checkpoint) on top of `45299e0`. Nothing has been pushed, so nothing is deployed.

    base                45299e0   (origin/main at handoff time)
    staged              25 *.html modified + 4 new work/ files
    sw.js VERSION       15463857c2  ← STALE. Must become 86a35afcc5 (see step 4)
    Worker              untouched. This stage is site-only; no deploy approval needed.

⛔ **Do not push before step 4.** 25 HTML files changed, so `work/verify-sw.mjs` is RED right
now by design. Pushing is deploying, and a stale VERSION ships a service worker that will not
pick up any of these pages.

---

## What Kap decided, and why the earlier handoff was wrong about it

The end-of-day handoff listed this stage as "site-only, self-contained, no decisions needed."
That was wrong, and `[[ask-toto-overlap-measured]]` says so explicitly: the overlap is almost
entirely **transient**, transient coverage is what every chat widget does, and removing it is a
product judgment about Kap's most prominent affordance. The stage had been measured and then
deliberately **stopped** rather than shipped.

Kap was asked and chose **options 1 + 3**: fix the unreachable case, and hide the chip while
scrolling. Two independent guards, which is the pattern `[[feedback-fixed-elements]]`
recommends for this class of bug.

He did **not** choose option 2 (shrink to an icon) or option 4 (reserve a right gutter). Do not
drift into either.

---

## What is in the tree

| File | What |
|---|---|
| `work/test-launcher-overlap.mjs` | **new gate.** 30 surfaces x 2 widths, element-vs-element, both scroll positions. Replaces the lost `measure-launcher-overlap.mjs` |
| `work/patch-launcher-guards.py` | applies both guards; asserts the 25 inlined widget blocks are byte-identical before AND after |
| `work/atc_mutations.py` | the mutation proof. **Written but never run** — see step 1 |
| `work/HANDOFF-atc-launcher-guards.md` | this file |
| 25 `*.html` | guard B (identical edit in all 25) |
| `bigboard.html` | guard B **plus** guard A (page-local) |

**Guard A**, bigboard only: `@media(min-width:420px){.udfoot{padding-bottom:72px}}`. At 1280 and
maximum scroll the last `.pf-stat .v` ended 69px above the document bottom while the launcher
owns the last 74px, leaving **754 px2 of "Next up (adj)" player prices that no scrolling could
reveal**. bigboard ships no `<footer>`, so the 🙃 row is the last thing in `<body>` and padding
it is what lengthens the document. It is 72px, not the measured 6px, matching the existing
≤419px guard — `[[feedback-fixed-elements]]` cost a day proving 2px of margin is not margin.

**Guard B**, all 25 pages: `#ddbLaunch.ddb-away{opacity:0;pointer-events:none;transform:...}`
plus a `scroll` listener that adds the class and removes it after 140ms of quiet. Reduced motion
drops the transform and the transition but still hides the chip, because opacity and
pointer-events are the fix and the movement is decoration.

---

## What is verified, and what is not

**Verified by me:**

- The gate reproduces the documented defect on the **unpatched** build: `bigboard.html@1280`,
  754 px2, `DIV.v "Jahmyr Gibbs $95 · Bijan Robinson $84 · Ja'Marr Chase $79"` — matching
  `[[ask-toto-overlap-measured]]` verbatim. A gate that cannot fail on its own bug is
  decoration.
- All 13 gates were **green before the first edit** (baseline), including `verify-sw` and
  `pound-contracts`, with `build-data` porcelain showing only my new untracked files.
- Post-patch the new gate is **82 passed / 0 failed**, including the reduced-motion path.
- The 25 widget blocks are still byte-identical after patching (`css=c01dc71e`).

**NOT verified — this is the honest list:**

- ⛔ **The mutation proof has never been run.** `work/atc_mutations.py` is written and ready.
- ⛔ **No browser suite has been run since the edit.** 25 pages changed. `test-udfoot.mjs`
  alone is 829 assertions across exactly these pages.
- ⛔ **The 13-gate list has not been re-run since the edit.**
- ⚠️ **The `capture:true` claim is unproven.** The comment in the widget says capture is
  load-bearing because the tables on `cfb.html` and the receipts sheets scroll inside their own
  container while the document never grows. That is a reasoned claim, not a measurement. M3
  settles it. **If M3 comes back GREEN, the claim is wrong and the comment must be softened**
  before commit, not left as decoration.

---

## What is left, in order

### 1. The mutation proof (from the repo root)

    python3 work/atc_mutations.py

Expectations, which the script checks for you:

| Mutation | Expected | Means |
|---|---|---|
| M1 guard A removed | **RED** | the 754 px2 comes back on bigboard@1280 |
| M2 guard B listener removed | **RED** | 6 assertions, 3 pages x 2 motion prefs |
| M3 `capture:true` → `false` | **unknown** | report it; see the warning above |
| M4 reduced-motion override removed | **GREEN** | expected no-op: opacity is the fix |
| M5 auction's `#aiBtn` made fixed | **RED** | the one exemption cannot hide a launcher-shaped button in the launcher's corner |

The script restores the tree from bytes held in memory, never from git. Do not "simplify" that
to a checkout: `git checkout -- .` destroyed a finished stage on 2026-08-10
(`[[feedback-never-bare-checkout]]`). `git add -A` is the checkpoint.

### 2. The browser suites (my change touches all 25 pages)

One at a time, never a loop — suites that bind servers collide. Ports: udfoot 8917, the new
launcher gate 8931.

    node work/test-udfoot.mjs        # REPO ROOT, ~7 min, 829 assertions, these exact pages
    cd work && node test-nav-fit.mjs
    cd work && node test-arena.mjs
    cd work && node test-data-library.mjs
    cd work && node test-nfl-hub.mjs
    cd work && node test-cfb-page.mjs
    cd work && node test-receipts-sheets.mjs

⚠️ `test-udfoot.mjs` is the one most likely to have an opinion here: it asserts the 🙃 row does
not collide with this exact launcher, and guard A moves that row. It measures at the document
bottom, which is the right place, so a real regression will show. Do not touch its scroll.

### 3. Re-run the 13-gate list

The list and the required cwd per gate are in `[[test-suites]]`. `build-data` must be pinned:

    DD_BUILD_DATE=2026-08-10 node tools/build-data.js && git status --porcelain

Porcelain must list only the files you meant to move. No `data/` file should change: this stage
touches no page that feeds `/data/`.

### 4. `sw.js` VERSION — LAST, after every HTML edit is final

    git add -A
    node work/verify-sw.mjs          # ⚠️ REPO ROOT ONLY. From work/ it cannot pass at all.

For the tree exactly as staged at handoff it prints:

    staged sw VERSION 15463857c2 != staged HTML 86a35afcc5

So set `const VERSION = "86a35afcc5"` in `sw.js`, `git add -A`, and re-run until it prints
`verified`. **Recompute if you change any HTML** — including reverting a mutation imperfectly.
Bumping `sw.js` does not change the HTML hash, so the value survives that step.

### 5. Commit

One stage, one commit, mutation proof in the body. Reconcile immediately before the write —
`git fetch origin main` — not at the start of your session. Chat B was still writing when this
was handed off, and on 2026-08-10 FC-A landed mid-stage and `MEMORY.md` got clobbered by a
parallel chat. `[[codex_coexistence]]`: the hazard is any concurrent writer, including another
Cowork chat.

Suggested subject, in the house style of the log:

    The launcher steps aside, and the one corner it never left gets its clearance (Stage ATC)

---

## Traps I hit, so you do not

1. ⚠️ **A backtick inside the injected stylesheet ends the JS template literal.** I wrote a
   comment quoting `` `opacity` `` and `` `pointer-events` ``, which terminated the literal.
   The failure mode is nasty: no syntax highlighting complaint, the launcher simply never
   mounts on any page, and the console says `Unexpected identifier 'opacity'`. Plain words only
   inside that block. The patch script now carries this warning.
2. **The widget is inlined in all 25 pages with no generator and no markers**, and the blocks
   were byte-identical on `45299e0` (`css=fadc2ff6 js=600987ca`). Use the patch script, which
   asserts that identity on both sides of the edit. A per-page divergence in a shared block is
   invisible in review and the next sitewide sweep clobbers it.
3. **`auction.html` has no fixed launcher and that is correct.** It ships its own in-flow
   `#aiBtn` and the widget bails on any page that has one. The gate asserts the exemption
   rather than skipping it.
4. **Hash-routed sheets must be requested by hash** or they render nothing and report clean.
   That trap already burned the first measurement run on the exact surface the complaint named.
5. **`waitForSelector` needs a real wait**: the launcher is appended 300ms after `load`.

---

## Do not

- Do not reorder the MS-B withheld-line caption back. It leads with the disclosure as a
  workaround for this very overlap.
- Do not trim guard A to the measured 6px.
- Do not deploy the Worker. This stage does not touch it, and deploy approval is per-occasion
  anyway — Kap's 8/10 grant does not carry to 8/11.
- Do not mint an MCP token to check anything. `POST /auth/mcp-token {action:"mint"}` overwrites
  `mcpToken` and permanently kills Kap's existing connector URL.

## Read first

`MEMORY.md`, then `state_2026-08-10.md`, `ask_toto_overlap_measured.md`,
`feedback_fixed_elements.md`, `feedback_gates_vs_suites.md`, `feedback_never_bare_checkout.md`,
`feedback_mutation_proofs.md`, `test_suites.md`, `codex_coexistence.md`.
