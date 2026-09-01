# AGENTS.md — working on this repo

Read this before editing anything. The hazards here are not obvious from the file listing.

## What this repo is

`datadawgs216.com`, served by GitHub Pages from `main`. **There is no build system.** The
repo holds flattened, self-contained HTML — those files *are* the source. `site.css` and
`nav.js` are inlined into every page.

**Pushing this repo is deploying.**

## Hard rules

1. **`git fetch origin main && git reset --hard origin/main` before your first edit.** This
   repo has concurrent writers. Deploys go through GitHub's web upload path, which replaces
   whole files and cannot merge — so a stale local copy silently reverts whatever landed
   upstream, with no conflict and no warning. This has destroyed hundreds of lines of
   someone else's work. Re-sync again if more than ~30 minutes pass.
2. **A sitewide change is the same edit applied to every `*.html`.** Nav, CSS, brand and
   footer changes touch all of them. The working pattern is a Python string-replace across
   `glob("*.html")` with `assert s.count(old) == 1` per file — the assert catches a page
   that has drifted.
3. **Any page change ships with a `sw.js` version bump.** `VERSION` is a cache key; it only
   has to change. Convention: md5 of all `*.html` **and `*.js`** (sw.js itself excluded)
   concatenated in sorted order, first 10 hex. The scripts were added on 2026-08-25: the draft
   rig's behaviour lives in `draft-*.js`, they are served cache-first, and an HTML-only hash
   meant a JS-only fix never reached a phone that had already visited.
4. **No secrets in this repo, ever. It is public.** Keys, tokens and league-private data live
   only in the Cloudflare Worker.
5. **Verify a deploy landed before running `git reset --hard origin/main`,** and keep the
   check and the reset in separate commands. Combining them means the reset runs regardless
   of the result.
6. **Do not add auth to the draft rig.** A public board is a feature, and draft night is the
   worst possible time to find an auth bug.
7. **Do not clear room `pepperoninipples`.** It carried the simulated picks used for league
   testing, and then the real thing. The 2026 auction is finished and is committed to
   `data/leagues/pepperoninipples.json` (`draft.status: "complete"`, 157 picks) — the rig
   rebuilds the whole board from that file, so the results survive an empty room. Clearing
   the room still costs the live pick order, and an emptied room must never be allowed to
   overwrite the committed board: `hydrateEnvelope` drops an envelope older than the local
   copy, and `seedPublishedDraft` refuses to shrink a board. Keep both.

## Layout

| Path | What |
|---|---|
| `index.html` | manifesto homepage — Kap's verbatim copy, do not restructure |
| `auction.html` `board.html` `bigboard.html` `dashboard.html` `dataviz.html` `report.html` | the draft rig |
| `master.html` `strategy.html` | player pool + strategy digest |
| `stats.html` | EPA explorer, 2.1 MB, columnar base64 play-by-play. Never merge anything into it. |
| `nfelo.html` `survivor.html` `receipts.html` `dfs.html` `guillotine.html` | the Lab |
| `bozo.html` | the weekly betting game |
| `signon.html` | THE identity page — sign in, open signup (`POST /auth/signup`), join-link claim, recovery, password/email change. Every other page's Sign-in chip routes here with `?next=`; old `bozo.html?join=` links forward here. Identity UX lives here and nowhere else (8/7 rule) |
| `dawg-bot-worker.js` | source of the `toto` Cloudflare Worker (no secrets) |
| `wrangler.jsonc` | complete non-secret Worker config; do not deploy with a partial temporary manifest |
| `sw.js` | service worker, draft-night offline insurance |
| `data/` | **machine-readable surfaces — see below** |
| `llms.txt` | curated index for LLM consumers |
| `.nojekyll` | required: without it GitHub Pages' Jekyll step drops dot-directories |

## The `/data/` contract

Every file in `data/` is an envelope:

```json
{ "as_of": "YYYY-MM-DD", "source": "...", "note": "...", "built": "...",
  "canonical_url": "...", "data": ... }
```

**`as_of` and `source` are mandatory on every payload.** `node tools/validate-data.js` fails
the build if any file is missing them, is unparseable, or drifts from `data/index.json`.

`data/index.json` is a generated manifest — every file with its `as_of`, byte count and
SHA-256. Regenerate it whenever you touch a data file; do not hand-edit it.

Data currently lives inside the HTML pages as JS literals and is *extracted* into `data/`.
That means the two can drift. If you change a number on a page, rebuild `data/`.

## Toto's surface on a page

Toto is on every page. What he can see there is decided by two things, in this order:

1. **`window.DD_BOTCTX`** — the page's own surface, set in a `<script>` just before
   `</body>`. Shape: `{label, title, chrome:{sub, ph, chips}, sys, ctx()}`. A *partial*
   hook is legal: supply `sys` alone to claim the voice, `chrome` alone to claim the
   chips. Only supplying `ctx()` replaces the state.
2. **The page reader** — the fallback. It walks the rendered DOM and hands him headings,
   prose, settings, and tables with the rows trimmed, with the section on the reader's
   screen hoisted to the front. Exposed as `window.DDBotScan(budget)`, so a curated
   `ctx()` can fold the live rendering in under its own spine. That is the normal
   pattern: a hand-written spine for dates and provenance (which scraping gets wrong),
   the reader for what is actually on screen (which prose goes stale about).

Rules that are not optional:

- **`sys` is where a caveat has to live.** Toto answers from the system block, not from
  the page copy. A limit stated in prose on the page but not restated as an instruction
  is a limit he will be talked past.
- **The reader never reads free text.** It takes selects, checkboxes, numbers, ranges and
  dates — never a text or email box, and never anything under `data-ddb-skip`. Somebody
  is typing into those. `signon.html` and `connect.html` deliberately have a curated
  `ctx()` with no reader at all: the connector URL on that page *is* the credential.
- **A page with no `DD_BOTCTX` still works** — it gets the reader and the generic chips.
  Adding a page without a surface is a soft failure, not a broken one.
- The draft rig (`window.DD_POOL`) keeps the draft surface and ignores all of this.
- The prompt also carries `HELP` (the draft-rig manual) and `MAP` (the site map). Both are
  copy-pasted into every page. If the UI or the page list changes, change them in the
  **same commit** or Toto starts confidently lying about it.

## House style for anything user-facing

- Values are labelled **MV / Market Value**. Do not add new vendor-name instances, and do not
  claim "consensus methodology" until the blend actually ships.
- Numbers carry their date. Simulation output is labelled as simulation. Modelled inputs are
  labelled as modelled.
- Don't oversell. If a thing hasn't been graded yet, say it hasn't been graded yet.
