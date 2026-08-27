"""
Regression guards for the two chip bugs that shipped in 0d4fa06.

Neither would have been caught by anything else in the suite: one is a CSS specificity
interaction that only shows on a rendered page, the other is a layout rule that only
misbehaves under 520px. Both are asserted against the source so they cannot come back.

    cd work && py patch-lds-chips-tests.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
T = REPO / "work" / "test-guillotine.mjs"
s = T.read_text(encoding="utf-8")

anchor = '// one sampled season, drawn from the same model as the curves.'
assert s.count(anchor) == 1, "anchor"

block = r'''/* ⚠ REGRESSION GUARD. A selected chip painted itself background:currentColor while the
   renderer set an INLINE style="color:<team>". Inline colour outranks the stylesheet, so
   the label rendered in the fill colour and the name vanished inside a solid lozenge. The
   colour has to travel as a custom property, which is inert to inheritance. */
ok("the chip colour rides a custom property, not an inline color",
  html.includes('style="--c:') && !html.includes(`style="color:'+colorOf`));
ok("a selected chip fills from --c and keeps a readable label",
  /\.gx-cmp button\.on\{[^}]*background:var\(--c/.test(html)
  && /\.gx-cmp button\.on\{[^}]*color:#fff/.test(html));
// ⚠️ 18 long names wrapped into nine rows on a phone and pushed the chart off screen.
ok("the selector is one scrolling row, never a wrap",
  /\.gx-cmp\{[^}]*flex-wrap:nowrap/.test(html) && !/\.gx-cmp\{flex-wrap:wrap/.test(html));
ok("a long team name is capped rather than setting the row width",
  /\.gx-cmp button\{[^}]*text-overflow:ellipsis/.test(html));

'''
s = s.replace(anchor, block + anchor, 1)
T.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-chips-tests: ok")
