#!/usr/bin/env python3
"""War room: the pinned bar freezes and yanks the scroll at the top of the page.

Two defects, both firing at the same threshold, both measured in Chromium at
390x844 / DSR3, light theme.

1. P0 — the pinned bar and its own trigger are in a feedback loop.
   `#wrSentinel` sits ABOVE `.wr-pin`, and `.stuck` shortens the pin by ~48px
   (strip padding 12->6, .wr-meta and .wr-youlab to display:none, .wr-pick
   17->15, .wr-tabs margin 10->0). Chrome's scroll anchoring compensates that
   document-height change by pulling scrollY back ~30px, which returns the
   sentinel to the viewport, which un-sticks the pin, which restores the 48px.
   Measured as shipped, stepping 1px at a time across the threshold:

       target/actual/stuck
       346/346/0  347/342/0  348/353/0  349/315/1  350/346/1  351/378/0  352/323/1

   scrollY departs from the requested offset by up to 34px and `stuck` flips
   three times inside five pixels of scroll. That is the freeze.

   Fixed two ways, deliberately belt-and-braces:

   (a) `#wrSpacer` absorbs the collapse in the SAME style recalculation as the
       class toggle (adjacent-sibling selector, one layout pass), so the
       document height does not change and anchoring has nothing to correct.
       `--wr-collapse` is measured from the spacer's own document position, NOT
       from the pin's border box: `.wr-tabs`'s top margin collapses out of the
       pin, so a getBoundingClientRect() delta on the pin under-measures by
       7-20px and leaves a residual wobble. Measured rather than hardcoded
       because the natural height depends on the league name and on whether the
       tab row wraps.

   (b) The observer gets 40px of hysteresis — it sticks when the sentinel passes
       the top edge and un-sticks only once the sentinel is 40px back inside the
       viewport. Any residual jolt from (a), or a future edit that changes the
       bar's height again, is then too small to re-cross the threshold. This is
       the part that keeps the page from regressing the next time somebody adds
       a row to the strip.

2. P0 — the page re-lays out mid-scroll, at the same threshold.
   `.wr-pin.stuck::before{inset:0 -50vw}` is the full-bleed backdrop. Measured:

       unstuck  scrollWidth 438  innerWidth 438
       stuck    scrollWidth 561  innerWidth 561

   `innerWidth` is the layout viewport: Chrome re-widens it and re-scales the
   whole page mid-scroll, in both themes, at 390 / 768 / 1280. `overflow-x:clip`
   on `body` does not stop this — body's overflow propagates to the viewport and
   body itself computes to `visible`, so it never clips its own children. A
   100vw backdrop centred on the column covers the same pixels and overflows
   nothing.

NOT fixed here, deliberately: `.navauth` + `#themeBtn` put scrollWidth at 438 on
a 390px viewport on every page measured (challenge.html 429). That is the
pre-existing sitewide nav overflow already logged in
claude/bozo-playbill-build-handoff.md. Tested in isolation: fixing it does NOT
fix the oscillation (3 flips, 34px error remained), and this fix does not depend
on it. It is a separate sitewide glob("*.html") commit and must not ride along
inside a single-page patch.

Anchor-based, idempotent.
"""

PATH = "../fantasy-warroom.html"

CSS_OLD = (
    '.wr-pin.stuck::before{content:"";position:absolute;inset:0 -50vw;'
    'background:var(--page);z-index:-1}'
)
CSS_NEW = (
    '/* \u26a0\ufe0f LOAD-BEARING, all four rules.\n'
    '   `inset:0 -50vw` overflowed the layout viewport by 123px the instant the bar\n'
    '   stuck, which made Chrome re-widen innerWidth 438->561 and re-scale the whole\n'
    '   page mid-scroll. A centred 100vw box covers the same pixels and overflows\n'
    '   nothing. Do not reach for `overflow-x:clip` on body instead — body\'s overflow\n'
    '   propagates to the viewport and body itself computes to `visible`, so it never\n'
    '   clips its own children. Measured: it does not help.\n'
    '   #wrSpacer absorbs the pin\'s ~48px collapse in the same style recalculation as\n'
    '   the class toggle, so the document height never changes. Without it, scroll\n'
    '   anchoring pulls scrollY back, the sentinel ABOVE the pin re-enters the\n'
    '   viewport, the pin un-sticks, and the two oscillate — measured at 34px of\n'
    '   scroll error and three stuck flips inside five pixels. Do not replace it with\n'
    '   a min-height on .wr-pin itself: that holds the document height but leaves\n'
    '   ::before painting opaque --page over ~48px of the card below. */\n'
    '.wr-pin.stuck::before{content:"";position:absolute;inset:0 auto 0 50%;width:100vw;'
    'right:auto;transform:translateX(-50%);background:var(--page);z-index:-1}\n'
    '#wrSpacer{height:0}\n'
    '.wr-pin.stuck + #wrSpacer{height:var(--wr-collapse,0px)}\n'
    '.wr-pin.wr-measuring + #wrSpacer{height:0 !important}\n'
    '.wr-pin.wr-measuring,.wr-pin.wr-measuring *{transition:none !important}'
)

MARKUP_OLD = '</div><!-- /.wr-pin -->'
MARKUP_NEW = '</div><!-- /.wr-pin -->\n<div id="wrSpacer" aria-hidden="true"></div>'

JS_OLD = """/* The bar compacts once the sentinel above it leaves the viewport. A scroll
   listener would fire on every frame; this fires twice. */
try{
  new IntersectionObserver(([e])=>{$('wrPin').classList.toggle('stuck',!e.isIntersecting);},
    {threshold:0}).observe($('wrSentinel'));
}catch(e){}"""

JS_NEW = """/* The bar compacts once the sentinel above it leaves the viewport. A scroll
   listener would fire on every frame; these fire twice each.
   \u26a0\ufe0f Two guards, and both are load-bearing — see the #wrSpacer comment in the
   stylesheet for the failure they prevent.
   1. wrMeasureCollapse() reserves the collapse so the document height does not
      change when the bar compacts. It measures the SPACER'S DOCUMENT POSITION,
      not the pin's border box: .wr-tabs's top margin collapses out of the pin,
      so a getBoundingClientRect() delta on the pin under-measures by 7-20px and
      leaves a residual wobble. Re-measured whenever the strip's contents change,
      because the natural height depends on the league name and on whether the
      tab row wraps. The class is added and removed synchronously inside one
      task so nothing paints between; .wr-measuring keeps the strip's own
      transitions from interpolating the measurement.
   2. WR_HYST px of hysteresis between sticking and un-sticking, so any residual
      jolt — or a future edit that changes the bar's height again — is too small
      to re-cross the threshold. Two observers, because one cannot carry two
      different edges. */
const WR_HYST=40;
function wrMeasureCollapse(){
  const p=$('wrPin'), sp=$('wrSpacer'); if(!p||!sp) return;
  const was=p.classList.contains('stuck');
  p.classList.add('wr-measuring');
  p.classList.remove('stuck');
  const tall=sp.getBoundingClientRect().top;
  p.classList.add('stuck');
  const short=sp.getBoundingClientRect().top;
  p.classList.toggle('stuck',was);
  p.classList.remove('wr-measuring');
  document.documentElement.style.setProperty('--wr-collapse',
    Math.max(0,tall-short).toFixed(2)+'px');
}
window.wrMeasureCollapse=wrMeasureCollapse;
try{
  wrMeasureCollapse();
  addEventListener('resize',wrMeasureCollapse,{passive:true});
  new IntersectionObserver(([e])=>{
    if(!e.isIntersecting)$('wrPin').classList.add('stuck');
  },{threshold:0}).observe($('wrSentinel'));
  new IntersectionObserver(([e])=>{
    if(e.isIntersecting)$('wrPin').classList.remove('stuck');
  },{threshold:0,rootMargin:'-'+WR_HYST+'px 0px 0px 0px'}).observe($('wrSentinel'));
}catch(e){}"""

STRIP_OLD = """  if(all)$('stripText').textContent='All leagues \\u00b7 '+readShelf().length+' saved';
  else if(state&&state._stripLine)$('stripText').textContent=state._stripLine;
}"""
STRIP_NEW = """  if(all)$('stripText').textContent='All leagues \\u00b7 '+readShelf().length+' saved';
  else if(state&&state._stripLine)$('stripText').textContent=state._stripLine;
  if(window.wrMeasureCollapse)window.wrMeasureCollapse();
}"""

LOADED_OLD = """  paintTeamGate();paintStations();paintShelf();paintSwitch();paintShare();
}"""
LOADED_NEW = """  paintTeamGate();paintStations();paintShelf();paintSwitch();paintShare();
  if(window.wrMeasureCollapse)window.wrMeasureCollapse();
}"""

edits = [
    (CSS_OLD, CSS_NEW),
    (MARKUP_OLD, MARKUP_NEW),
    (JS_OLD, JS_NEW),
    (STRIP_OLD, STRIP_NEW),
    (LOADED_OLD, LOADED_NEW),
]

# ⚠️ newline="" on read and chr(10) on write. The repo's HTML is pure LF; Python's
# text mode on Windows would rewrite all 5,026 lines to CRLF and turn a five-line
# change into a five-thousand-line diff. Same guard as patch-bozo-playbill.py.
s = open(PATH, encoding="utf-8", newline="").read()
changed = 0
for old, new in edits:
    if new in s:
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8", newline=chr(10)).write(s)
print(f"patch-warroom-pin: {changed} edit(s) applied, {len(edits)-changed} already present")
