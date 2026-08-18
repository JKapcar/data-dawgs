#!/usr/bin/env python3
"""
Transplant the v2 slot machine into bozo.html.

Anchor-based and idempotent: every span is located by unique start/end strings and
spliced, and the script exits clean (no-op) if the v2 marker is already present.
Run from the repo root:  python3 work/patch-bozo-machine.py

Sources for the transplanted blocks live in work/machine-v2/.
"""
import os, sys, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'work', 'machine-v2')
PAGE = os.path.join(ROOT, 'bozo.html')
MARK = 'BOZO MACHINE v2'

def read(n): return open(os.path.join(SRC, n)).read()

def splice(s, start, end, new, what):
    """Replace s[i:j] where i is the start of `start` and j is the start of `end`."""
    assert s.count(start) == 1, f'{what}: start anchor x{s.count(start)}'
    assert s.count(end)   == 1, f'{what}: end anchor x{s.count(end)}'
    i = s.index(start); j = s.index(end)
    assert i < j, f'{what}: anchors out of order'
    return s[:i] + new + s[j:]

def sub1(s, old, new, what):
    assert s.count(old) == 1, f'{what}: x{s.count(old)}'
    return s.replace(old, new)

s = open(PAGE).read()
if MARK in s:
    print('bozo.html already carries the v2 machine — nothing to do.')
    sys.exit(0)

before = len(s)

# ---------------------------------------------------------------- 1 · base CSS
# The base `/* slot machine */` block becomes the single home for the whole
# machine. The carnival overrides below are folded into it, so there is one
# place to change and no cross-block override order to reason about.
s = splice(s,
    '/* slot machine */\n.machine{background:#241c12;',
    '.ord{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:6px}',
    f'/* {MARK} — cabinet, reels, lever. Was two blocks (base + .bz-carnival\n'
    '   overrides); folded into one so the geometry has a single home. */\n'
    + read('machine.css') + '\n',
    'base slot-machine CSS')

# ------------------------------------------------------- 2 · carnival CSS block
# cabinet / reel windows / lever are now all in the block above.
s = splice(s,
    '/* --- the cabinet --- */\n.bz-carnival .machine{',
    '/* --- the drawn order, as a lit marquee list --- */',
    '/* --- cabinet, reel windows and lever: see the ' + MARK + ' block above. --- */\n',
    'carnival machine CSS')

# ------------------------------------------- 2b · the old armed-state animations
# ⚠️ `animation: reelidle` on .strip animates `transform`, which beats the inline
# transform the v2 rAF engine writes every frame — the reels would look like they
# were idling but would ignore the engine entirely. knobpulse likewise fights
# v2's knobbeg. The dimming and the border stay; only the two animations go.
# The reduced-motion rule further down that HATCHES the armed glass is kept on
# purpose: with motion off the strips park, and four windows showing the same
# cell reads as a drawn hierarchy. Blanking the glass is the true statement.
s = splice(s,
    '@keyframes reelidle{from{transform:translateY(0)}to{transform:translateY(calc(-1 * var(--spin,280px)))}}',
    '.ord li.ghost{opacity:1}',
    '/* idle motion is owned by the v2 rAF engine, not CSS — see the ' + MARK + '\n'
    '   block above. A CSS animation on `transform` would override it. */\n'
    '.machine.armed .cell{opacity:.62}\n',
    'old armed-state animations')

# ------------------------------------------------------------- 3 · mobile block
s = splice(s,
    '  .machine{flex-direction:column;padding:14px 10px}',
    '  /* the tent scales down but keeps its peak',
    read('machine-mobile.css'),
    'mobile machine CSS')

# --------------------------------------------------------- 4 · reduced motion
s = sub1(s,
    "@media(prefers-reduced-motion:reduce){.strip,.rod,.ord li{transition:none!important}",
    read('machine-reduced.css').rstrip() + "\n@media(prefers-reduced-motion:reduce){.strip,.rod,.ord li{transition:none!important}",
    'reduced-motion CSS')

# ------------------------------------------------------------------ 5 · markup
s = splice(s,
    '  <div class="machine" id="machine"><div class="reels" id="reels"></div>',
    '  <ol class="ord" id="ord"></ol>',
    read('machine.html.txt'),
    'machine markup')

# --------------------------------------------------- 5b · the sound toggle row
s = sub1(s,
    '  <p class="note" id="drawNote"></p>',
    '  <div class="row" style="margin-top:12px">\n'
    '    <button type="button" class="btn ghost sm" id="mute" aria-pressed="false">Sound on</button>\n'
    '  </div>\n'
    '  <p class="note" id="drawNote"></p>',
    'sound toggle')

# ------------------------------------------- 6 · lever glyphs beside the levers
s = sub1(s,
    "  {k:'clv', name:'Worst CLV', desc:'price moved most against it'}];",
    "  {k:'clv', name:'Worst CLV', desc:'price moved most against it'}];\n"
    + read('lever-icons.js'),
    'lever glyphs')

# ---------------------------------------------------------------- 7 · JS engine
s = splice(s,
    '/* ---------------- slot machine ----------------\n',
    '/* ---------------- grading (admin) ---------------- */',
    read('machine.js'),
    'machine JS')

open(PAGE, 'w').write(s)
print(f'patched bozo.html: {before} -> {len(s)} bytes')
