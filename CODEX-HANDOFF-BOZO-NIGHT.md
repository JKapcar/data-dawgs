# CODEX-HANDOFF-BOZO-NIGHT.md

Night mode for `bozo.html` — direction **Midnight Midway** — plus the sitewide nav
overflow fix it sits on top of, and one new panel.

Visual spec: **`bozo-night-reference.html`** (repo root). Open it in a browser. Where this
document and that file disagree about a value, the file wins. Where either disagrees with
`AGENTS.md`, `AGENTS.md` wins — flag it, don't guess.

---

## §0 — Audit first. Do not skip.

Run this before your first edit and paste the output in the PR. It is how you learn your
true starting point rather than trusting this document.

```bash
git fetch origin main && git reset --hard origin/main

# A. theme model — expect MANY light-override hits and ZERO dark hits
grep -c ':root\[data-theme="light"\]' bozo.html
grep -c ':root\[data-theme="dark"\]'  bozo.html          # MUST be 0, before and after your work
grep -n 'prefers-color-scheme' bozo.html                  # expect only the two <meta> tags + the comment

# B. the playbill token block you are editing
grep -n 'the bill printed on dark stock' bozo.html        # base :root, ~line 1425
grep -n 'the slip stays paper in both themes' bozo.html   # the constraint in §2.2

# C. the bulb system that already exists
grep -n -- '--bulb:' bozo.html
grep -n 'bulbchase' bozo.html
grep -n 'bz-carnival' bozo.html | head

# D. nav overflow, the bug in commit 1 — expect 438
node -e "const{chromium}=require('playwright');(async()=>{const b=await chromium.launch();
const p=await b.newPage({viewport:{width:390,height:844}});
await p.goto('file://'+process.cwd()+'/bozo.html');await p.waitForTimeout(1500);
console.log('scrollWidth@390 =',await p.evaluate(()=>document.body.scrollWidth));await b.close()})()"

# E. baselines
grep -n 'const VERSION' sw.js
node tools/validate-data.js
```

Record the numbers. A dropped assertion count later is a lost check even on green.

---

## §1 — What you are building

Four commits, in this order, one concern each:

1. **Nav overflow fix** — sitewide, unrelated to night mode, ships first because it is
   visible on every page today.
2. **Midnight Midway tokens** — the base `:root` playbill palette on `bozo.html`.
3. **The marquee ornaments** — dead-bulb rail on the bill, ground fog.
4. **IF IT BUSTED TONIGHT** — one new panel under the house ticket, plus its `DD_BOTCTX`
   caveat in the same commit.

Commits 1–3 are paint. Commit 4 is the only behaviour change, and it has a correctness
trap in §6 that you must read before writing it.

---

## §2 — Facts about this repo. Do not re-derive these.

### 2.1 The site is dark-first. There is no dark selector.

Base `:root` holds the **dark** values; `:root[data-theme="light"]` overrides them. The
playbill block is commented `/* dark = the bill printed on dark stock */`. There is no
`@media (prefers-color-scheme)` block anywhere on the site, deliberately — the comment
above the theme code explains why, and the theme toggle is the only input.

So night mode means **editing the base `:root` values**, not adding a
`:root[data-theme="dark"]` block. Adding one is the single most likely way to get this
wrong, and `grep -c ':root\[data-theme="dark"\]' bozo.html` must still print `0` when you
are done.

### 2.2 The slip stays paper. Both themes. On purpose.

```
/* the slip stays paper in both themes — a real receipt on a dark table */
--slip-stock:#efe6d3; --slip-ink:#1d1509; --slip-ink2:#6d5f48; --slip-rule:#c6b99f;
--slip-red:#a8290b;
```

`bozo-night-reference.html` paints the slip dark. **The reference is wrong here and the
repo is right** — a lit paper ticket on a dark closed midway is the better image and it
preserves a decision already made. Leave every `--slip-*` value alone. Only the bill
around the slip changes.

### 2.3 A bulb system already exists. Reuse it.

`bozo.html` ships the Bozo Machine v2: `.machine` cabinet, `.marq` marquee, reels, lever,
coins, belt, and the `.bz-carnival` skin on `#drawCard` / `#diagCard` / `#seasonCard`. The
bulb rail is `.machine::before` — four repeating radial-gradient layers, one per edge —
driven by `--bulb`, `--bulb-off`, `--bulbo` (opacity), `--bulbspeed`, `--bulbrun`, with
the `bulbchase` keyframes.

Do **not** add a second bulb implementation. The dead-bulb look is that system in a low
state: `--bulb-off` for the rail, a small number of live bulbs over it, `--bulbrun:paused`.

The `.bz-carnival` block carries a ⚠️ PAINT ONLY contract — no class the JS reads gets
renamed, no layout box gets restructured. Your commits 2 and 3 are bound by the same
contract.

### 2.4 The class names you are painting

`#hubCard.pb-bill`, `.pb-plate`, `.pb-eyebrow`, `.pb-present`, `.pb-word`, `.pb-souls`,
`.pb-lede`, `.pb-body`, `.pb-orn`, `.pb-cta`, `.pb-btn`, `.pb-act`, `.pb-kicker`,
`.pb-h2`, `.pb-sub`, `.slip` and its `.sl-*` children, `.acts` / `.act`, `.riffle` /
`.riffle-card`, `.pb-fine`, `.pb-stub-bar` (the mobile stub — it already exists).

---

## §3 — Commit 1: nav overflow (sitewide)

**Bug.** At a 390px viewport `document.body.scrollWidth` is **438**. The two elements that
overhang are `.navauth .authbtn` (the Sign-in / name chip) and `.theme-btn`. Every page
rocks sideways on a phone; the nav is inlined into all 32 root HTML files, so this is not a
`bozo.html` bug.

**Fix.** Your call on mechanism, but it must be a sitewide Python string-replace across
`glob("*.html")` asserting the expected occurrence count per file (`AGENTS.md` rule 2),
not 32 hand edits. Do not solve it by hiding the theme button on small screens — the
toggle is the only theme input on the site (§2.1).

**Done when** `scrollWidth` at 390 equals 390 on `bozo.html`, `index.html`, `signon.html`,
and two more root pages of your choosing, and nothing in the nav is unreachable at 390.

Ship the `sw.js` bump in this commit. `cd work && python3 stamp-sw-version.py`, verified by
`node work/verify-sw.mjs`.

---

## §4 — Commit 2: Midnight Midway tokens

Replace the **base `:root`** playbill values in `bozo.html` (the block commented
`/* dark = the bill printed on dark stock */`) with:

```css
--pb-stock:#0d100c;   /* was #1c1509 */
--pb-ink:#cfd3bd;     /* was #f4ebda */
--pb-ink2:#8b9179;    /* was #bcb098 */
--pb-ink3:#565b4b;    /* was #8d8371 */
--pb-red:#b6421a;     /* was #ff6a02 */
--pb-rule:rgba(207,211,189,.10);  /* was #3c3122 */
--pb-edge:#241a0d;    /* unchanged */
--pb-shadow:rgba(0,0,0,.46);      /* unchanged */
```

Page ground: the dark `--page` becomes `#070a08` (was `#161009`). If `--page` is shared
sitewide rather than scoped to this page, **stop and flag it** rather than repainting
every page as a side effect of a Bozo change.

`--slip-*`: unchanged (§2.2).

`<meta name="theme-color" ... media="(prefers-color-scheme: dark)">` in the head is
`#161009`; update it to `#070a08` in the same commit so the phone chrome matches.

**Contrast floor.** `--pb-ink2` on `--pb-stock` must stay ≥ 4.5:1 and `--pb-ink3` ≥ 3:1.
Assert it in the test file, don't eyeball it.

---

## §5 — Commit 3: the two ornaments

**Dead-bulb rail on the bill.** A strip across the top and bottom edges of
`#hubCard.pb-bill`, built from the existing bulb tokens:

```css
/* dead bulbs: the rail is off, three bulbs are still lit */
background: radial-gradient(circle at 13px 8px, var(--bulb-off) 0 3.4px, transparent 4.2px)
            0 0/26px 16px repeat-x;
```

with a small number of live bulbs positioned over it (`--bulb`, plus
`box-shadow:0 0 12px 5px rgba(255,233,168,.40), 0 0 46px 16px rgba(255,233,168,.10)`).
`--bulbrun:paused` — the midway is closed, nothing is chasing.

If `.machine::before` can be reused for this with a modifier class instead of new CSS,
do that; a second bulb implementation is the failure mode here.

**Ground fog.** One `pointer-events:none` overlay, two radial-gradients anchored
bottom-left and bottom-right, ~8% alpha of `#8b9179`. No images, no filters, no JS.

**`prefers-reduced-motion`:** if you animate anything at all — a bulb flicker, say — it
must be off under `prefers-reduced-motion: reduce`. Static is an acceptable ship.

---

## §6 — Commit 4: IF IT BUSTED TONIGHT

### The correctness trap. Read this before writing anything.

`bozo-night-reference.html` shows this panel naming **KAP** with the copy *"on tonight's
order."* **That copy is wrong and you must not ship it**, for two reasons:

1. **The running order does not exist before lock.** The page's own small print says the
   order is "drawn at the moment the ticket locks and written once… the strip above is a
   demonstration of the shuffle, not a preview of it." Pre-lock there is no order to read.
2. **Nothing has lost.** Only losing legs are eligible. Pre-grade, no leg has lost.

So the panel has two states, and neither one claims to know the future:

**State A — card open, order not drawn.** Report standing on each lever independently, no
order, no single name:

> **AS IT STANDS** — You hold the shortest price on the board (-245). If every leg on this
> card lost, Shortest odds would name you. Three other levers have not been drawn yet, and
> nothing has been graded.

Show only levers that are computable from filed data: **Shortest odds** (min price) and
**Last in** (max `filed_at`). **Worst beat** needs results — omit it pre-grade rather than
guessing. **Worst CLV** is dormant sitewide; never show it as live.

**State B — card locked, order drawn, results not in.** Now the order is known and you may
read it. Still no name until legs are graded — walk the drawn order and report the first
lever that is computable, with its current leader and the standing assumption stated:

> **IF EVERY LEG LOST** — First lever drawn: Shortest odds → **Kap** (-245).
> Hypothetical: assumes every leg on this card loses. Nothing has been graded.

### Required properties

- **Deterministic, from data already on the page.** Filed legs and their prices, filed
  timestamps, and (state B) the drawn order. No new model, no simulation, no new fetch.
- **The assumption is in the DOM**, in text a screen reader reaches — not a tooltip, not
  a `title=`, not prose elsewhere on the page.
- **Hidden below 2 filed legs.** With one leg the "shortest price" is trivially that leg
  and the panel is noise.
- **Ties render as ties.** Two legs at the same price → name both, or say "tied". Never
  break a tie arbitrarily and never break it by display name.
- **Never mutates anything.** Read-only against the board. Never writes, never grades.
- **Not a notification.** On-page and on-demand only. Do not wire this to push, email, or
  any scheduled job. A "who's exposed right now" alert stops being a joke among friends
  and becomes a sportsbook nudge — it is out of scope by decision, not by omission.

### `DD_BOTCTX` — same commit

A caveat that is not in the sys block does not exist. Add to `bozo.html`'s `DD_BOTCTX.sys`,
in the same commit, wording to this effect:

> The "as it stands / if every leg lost" panel is a hypothetical over currently filed legs.
> It assumes every leg loses, it does not know results, and it never names a bozo. Before
> the card locks there is no running order at all. Do not present it as a prediction, a
> probability, or a graded outcome.

If the panel's UI or the page list changes, the HELP and MAP strings pasted into every page
update in the same commit.

---

## §7 — Not in this pass

- **The season sheet** (the per-member tab). Designed, in the reference file's third
  section, and it needs graded weeks — it lands after grading is automated. Do not build it
  now, and do not fill the current six-zeroes sheet with a proxy.
- The other three night directions (Vigil, Greasepaint, Cold Room). Rejected.
- Any change to the light theme, the draft rig, the worker's data routes, or CLV capture.
- Bozo uid re-key. Separate, and it is still free only while zero picks exist.

---

## §8 — Tests

New file `work/test-bozo-night.mjs`. Minimum assertions, and state the count in the PR:

**Theme (6)**
1. `bozo.html` contains zero `:root[data-theme="dark"]` selectors.
2. Zero `@media (prefers-color-scheme` CSS blocks (the two `<meta>` tags are fine).
3. Base `:root` carries the eight new playbill values exactly.
4. Every `--slip-*` value is byte-identical to `origin/main`.
5. `--pb-ink2` on `--pb-stock` ≥ 4.5:1; `--pb-ink3` on `--pb-stock` ≥ 3:1.
6. `theme-color` dark meta equals the new `--page`.

**Nav (3)**
7. `scrollWidth` at 390 equals 390 on `bozo.html`.
8. Same on two other root pages.
9. The Sign-in chip and theme button are both within the viewport at 390.

**Panel (8)**
10. With 0 filed legs, the panel is absent.
11. With 1 filed leg, absent.
12. With 2+ filed legs and no drawn order, state A renders and contains no bozo name.
13. State A names the min-price leg under Shortest odds.
14. Two legs at the same price render as a tie.
15. Worst beat does not appear pre-grade.
16. Worst CLV never appears as live in either state.
17. The assumption string is present in text content, not only in an attribute.

**Bulbs / ornaments (3)**
18. Exactly one bulb-rail implementation exists (no second gradient stack).
19. Fog overlay is `pointer-events:none`.
20. No animation runs under `prefers-reduced-motion: reduce`.

**Screenshots (2)** — and then **look at them**, do not just let them pass:
21. `bozo.html` at 1440×900, night.
22. `bozo.html` at 390×844, night.

Also re-run: `node work/verify-sw.mjs`, `node tools/validate-data.js`, `node work/test-mcp.mjs`
if you touched the worker.

---

## §9 — Before you open a PR

- [ ] §0 audit re-run, output pasted, `[data-theme="dark"]` count still `0`.
- [ ] Four commits, in order, one concern each. `sw.js` bumped in **every** commit that
      touches an HTML or root JS file, in that same commit.
- [ ] `git fetch && git reset --hard origin/main` before the first edit **and** again
      before committing. Re-sync if 30 minutes pass. Verify any pending deploy landed
      before resetting, in separate commands.
- [ ] Assertion counts recorded and not reduced; new count stated.
- [ ] Both screenshots in the PR description, next to the equivalent frames from
      `bozo-night-reference.html`.
- [ ] Light theme visually unchanged — screenshot proof at 1440.
- [ ] `DD_BOTCTX` updated in the same commit as the panel.
- [ ] If you could not finish everything, say which commits landed and which did not. Do
      not report the handoff done when part of it is not.

---

## §10 — Push back rather than complying if

- A constraint here turns out not to be real. Verify before designing around it.
- `--page` is sitewide and commit 2 would repaint every page. Stop and flag.
- The fix would mutate a published forecast, a graded result, or a locked slip.
- The panel would require inventing data it does not have — a probability, an assumed
  result, a CLV proxy. Prefer explicit abstention over an unsupported answer.
- This document conflicts with `AGENTS.md`. `AGENTS.md` wins.
