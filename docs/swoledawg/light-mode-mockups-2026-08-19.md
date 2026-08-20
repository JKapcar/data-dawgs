# SwoleDawg light mode — five art directions (2026-08-19)

**Decision: 01 Molten Foundry.** Ported into `swoledawg.html`'s
`:root[data-theme="light"]` token block the same day.

## Why this happened

The previous light theme, **"BLAST FURNACE"**, was ash shop-floor concrete
(`--surface-1:#dcd9d4`, `--page:#c8c5c0`) with molten orange-red as the only
saturation and `--glow:none`. On desktop it read as intended. On a phone it read
flat and gray — the surfaces were close enough in value that the card bevels
disappeared, and with no glow there was nothing to carry the accent.

Rather than tune it, five competing directions were built as standalone
mobile-first HTML mockups — 390×844 primary, clean at 320–430px, app-frame on
desktop — with identical content and demo data, so the choice was pure art
direction and not a content argument.

## The five

| # | Name | Direction |
|---|---|---|
| **01** | **Molten Foundry** ← **chosen** | Warm foundry paper + charcoal steel; the only saturation is molten metal (deep red → ember → gold). Heat is *earned* dopamine — PRs, streaks, filled targets; everything unearned stays paper and steel. Sparks on completion, hazard chevron, stenciled labels. |
| 02 | Cuyahoga Current | Ivory mist + river teals, burnt-orange reserved for "burn" semantics. Bridge-truss header, flowing area chart, ripple presses. |
| 03 | Chalk & Iron | Chalk white + rubber-floor charcoal, bumper-plate palette. Volume bars as loaded barbells, rings as plates, chalk-puff celebrations. |
| 04 | Neural Bloom | Porcelain + one iridescent aurora gradient. Glass cards, AI coach chip, odometer numbers. |
| 05 | Jackpot 216 | Cream/champagne casino: gold/cherry/teal, slot-odometer KPIs, marquee streak, jackpot PR confetti, Cleveland skyline footer. |

Dark mode (**"Cleveland Sunset"**) was never in scope and is untouched.

## What actually shipped

Only the token block and one light-only `.card` bevel rule. Concretely:

- Foundry paper surfaces `#fffcf5` / `#f7f0e4` / `#efe7da`, replacing the ash grays.
- Charcoal-steel ink `#211f24`; warm border `#d9cdb8` instead of a flat black alpha.
- Molten accent `#d13d08`, hot `#e8650e`; steel cool `#2f639c`.
- `--glow` turned back **on** for light mode — this is the fix for the phone problem.
- Warm cross-hatch `--tex` with a soft heat gradient at the top.
- `.card` gets a warm cast face and a warmer drop shadow, keeping the same
  three-shadow structure as the old steel bevel.

Charts needed no changes — they read tokens through `css()` / `C()`.

## Not shipped

Mockup 01's richer app-shell ideas are **not** in the site page: bottom tab bar,
FAB, spark effects, stencil section headers, molten channel progress bars. Those
are the reference for the mobile app build (~1 month out), not for this page.

## Verification at the time

Light and dark at 390px and 1280px; repo test suite 48/48.

Two pre-existing issues were found during that pass and are **not** caused by
this change, and are **not** fixed:

1. Horizontal document overflow from the shared site-nav chrome (`theme-btn` /
   `navauth` overflow the bar). Sitewide — needs the every-page treatment per
   AGENTS.md rule 2. Measured 2026-08-20 on `swoledawg.html`:

   | Width | Light | Dark |
   |---|---|---|
   | 390px | overflows | — |
   | 1280px | 8px (`.sitenav` right edge 1273 vs 1265) | 0 |

   It is **light-mode only** at 1280. Checked against the pre-Molten-Foundry page at
   `8e4ef0b` and the number is identical there, so the theme did not cause it — the
   light nav chrome was always this wide.
2. The Energy & protein and Sleep & readiness charts use dual y-axes. The Nightly
   vitals card added 2026-08-20 deliberately does not: see its comment.

## Note on sources

The five mockup HTML files were produced in a Cowork session and were not kept.
This document is the record.
