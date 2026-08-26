# War room pinned bar — freeze at the top of the page

`fantasy-warroom.html` · repo `github.com/JKapcar/data-dawgs` · 2026-08-26
Reported: *"at the top, it sticks and crunches or freezes when scrolling."*
Reproduced, isolated, patched, tested. Held for the freeze — see §5.

---

## 1. WHAT IT IS

Two defects fire at the same scroll threshold. Both measured in Chromium at
390×844 / DSR3, both themes, and again at 768 and 1280.

### 1.1 — P0 — the pinned bar and its own trigger are in a feedback loop

`#wrSentinel` is a 1px div that sits **above** `.wr-pin`. The IntersectionObserver
watches it and toggles `.stuck` on the pin. But `.stuck` **shortens the pin by
~48px**:

| rule | unstuck | stuck |
|---|---|---|
| `.wr-strip` padding | 12px 14px | 6px 12px |
| `.wr-meta`, `.wr-youlab` | shown | `display:none` |
| `.wr-pick` | 17px | 15px |
| `.wr-tabs` margin-top | 10px | 0 |

Chrome's scroll anchoring compensates that document-height change by pulling
`scrollY` backwards ~30px. That returns the sentinel to the viewport, which
un-sticks the pin, which restores the 48px, which pushes `scrollY` forward again.

Measured on `origin/main`, stepping 1px at a time across the threshold
(`target/actual/stuck`):

```
346/346/0  347/314/1  348/342/1  349/379/0  350/322/1  351/344/1  352/348/1
```

`scrollY` departs from where it was put by **up to 34px**, and `stuck` flips
0→1→0→1 inside five pixels of scroll. At 1280 it flipped **seven** times.
That is the freeze.

The bug is invisible at any coarser step. A 10px scroll walk looks fine.

### 1.2 — P0 — the page re-lays out mid-scroll, at the same threshold

`.wr-pin.stuck::before{position:absolute;inset:0 -50vw}` — the full-bleed
backdrop. The instant the bar sticks:

```
          scrollWidth   innerWidth
unstuck      438           438
stuck        561           561        (768 → 1128, 1280 → 1846)
```

`innerWidth` is the **layout viewport**. Chrome re-widens it and re-scales the
entire page, mid-scroll, in both themes.

`overflow-x:clip` on `body` does not stop this. Body's overflow propagates to the
viewport and body itself computes to `visible`, so it never clips its own
children. Measured: it does not help.

### 1.3 — P1 — sitewide nav overflow (pre-existing, NOT fixed here)

`.navauth` + `#themeBtn` put `scrollWidth` at 438 on a 390px viewport:

```
fantasy-warroom 438   index 438   bozo 438   arena 438
dfs 438   survivor 438   cfb 438   challenge 429
```

This is the ~40px nav overflow already logged in
`claude/bozo-playbill-build-handoff.md`. It is why the page is laid out at 438
and scaled down to 390 in the first place, and it inflates §1.2 because `vw`
resolves against the widened viewport.

**It is not the cause of the freeze.** Tested in isolation: fixing the nav
overflow alone left 3 flips and 34px of scroll error. Freezing the pin's height
alone took the error to 2px. The pin is necessary and sufficient.

| variant | flips / 18px | max \|scrollY − target\| |
|---|---|---|
| as shipped | 1–7 | 30–34px |
| nav overflow fixed only | 3 | 34px |
| **pin height frozen only** | 1 | **2px** |

---

## 2. THE FIX

`work/patch-warroom-pin.py` — anchor-based, idempotent, five edits, one page.

**Backdrop.** `inset:0 auto 0 50%; width:100vw; right:auto;
transform:translateX(-50%)`. Covers the same pixels, overflows nothing.
`scrollWidth` and `innerWidth` now constant across the transition.

**The collapse, reserved.** A new `#wrSpacer` immediately after `.wr-pin` absorbs
the height delta via `.wr-pin.stuck + #wrSpacer{height:var(--wr-collapse,0px)}`.
Adjacent-sibling selector, so it resolves in the **same style recalculation** as
the class toggle — one layout pass, document height unchanged, anchoring has
nothing to correct.

Two things that were tried and rejected, both recorded in the source comments so
they are not retried:

- `min-height` on `.wr-pin` itself holds the document height but leaves `::before`
  painting opaque `--page` over ~48px of the card below it.
- Measuring the delta from the pin's `getBoundingClientRect()` **under-measures by
  7–20px**, because `.wr-tabs`'s top margin collapses out of the pin. The
  measurement reads the spacer's document position instead.

`--wr-collapse` is measured, not hardcoded — the natural height depends on the
league name and on whether the tab row wraps — and re-measured from `paintStrip()`
and `setLoaded()`, and on resize.

**Hysteresis, 40px.** Two observers: stick when the sentinel passes the top edge,
un-stick only once it is 40px back inside the viewport. This is the durable part.
Reservation is exact to ~5px; hysteresis means neither that residual nor a future
edit that changes the bar's height again can re-cross the threshold.

### Result

| | before | after |
|---|---|---|
| stuck flips across the threshold | 1–7 | **1**, every width and theme |
| max \|scrollY − target\| | 25–36px | **5–6px** |
| document-height spread | 42–47px | **4–6px** |
| scrollWidth across transition | 438→561 | **constant** |
| layout viewport across transition | 438→561 | **constant** |
| console errors | 0 | 0 |

---

## 3. TESTS

`work/test-warroom-pin.mjs` — **47 assertions, 0 failed.**
On `origin/main`: **21 passed, 26 failed.** A test that cannot fail is not a test.

Five source-level greps, then a 1px-at-a-time scroll walk at 390 / 768 / 1280 ×
light / dark asserting: exactly one state transition, scroll error ≤ 8px,
document-height spread ≤ 8px, `scrollWidth` constant, `innerWidth` constant,
`--wr-collapse` measured rather than left at its fallback, zero script errors.

These are geometry assertions. **None of them can pass on a static read of the
file** — which is the point. Three earlier rounds on this repo shipped a green
suite over a visibly broken page because every check was a string grep.

Harness note: the filler that stands in for a connected league's sheet is
appended **inside `.wrap`**, not to `<body>`. A sticky element cannot travel past
its containing block, so body-level filler makes the pin visibly detach from
`top:0` further down the page — an artefact that reads exactly like a bug.

---

## 4. NOT DONE

- **The sitewide nav overflow (§1.3).** Separate concern, separate commit, and it
  is a `glob("*.html")` edit across all 32 pages. It must not ride along inside a
  single-page patch.
- **The `sw.js` VERSION bump.** Deliberately not pre-computed — `VERSION` is an
  md5 over every root `*.html` **and `*.js`**, and a stamped-but-stale value that
  *looks* verified is worse than no value. One command does it correctly locally.

---

## 5. BEFORE COMMITTING — same commit, in order

```
git fetch origin main && git reset --hard origin/main
python3 work/patch-warroom-pin.py            # run from work/, PATH is ../
cd work && python3 stamp-sw-version.py && cd ..
node work/verify-sw.mjs                      # after staging
node tools/validate-data.js                  # no data change, but gate anyway
cd work && node test-warroom-pin.mjs         # expect: 47 passed, 0 failed
cd work && node test-warroom-shelf.mjs       # record the count; it must not drop
```

No `DD_BOTCTX` change: this is geometry, not a capability or a caveat. No copy
change. No new data surface.

## 6. TIMING

Today is **Aug 26 — inside the Aug 21–28 freeze**, draft night Thursday.

`fantasy-warroom.html` is not the draft rig, and this is one page, no nav flip, no
refactor. But the mandatory `sw.js` bump is an md5 over all root `*.html` and
`*.js`, so shipping re-keys the cache for **every** page including the draft rig,
on the eve of the draft.

Recommendation: **hold to Aug 29** unless the page is unusable right now. The
sitewide nav fix definitely waits — that is exactly what the freeze exists to
prevent.
