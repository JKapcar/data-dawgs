"""Keep the site banner on one row through the narrow-phone breakpoint.

The nav is flattened into every page, so this patch replaces the complete 419px
override between stable media-query markers and asserts that every matching page has
exactly one copy. Pages with purpose-built chrome (connect, pound, etc.) are untouched.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
START = "@media(max-width:419px){"
END = "@media(max-width:359px){"

REPLACEMENT = r'''@media(max-width:419px){
  /* The six-section nav fits beside the logo and account chip. Keep the desktop
     composition instead of forcing .links onto a second row. The old two-row rule
     was written for an eight-group nav and survived after the menu became smaller. */
  .sitenav{flex-wrap:nowrap;gap:0 4px}
  .sitenav .links{flex:1 1 auto;margin-left:0;justify-content:flex-end;
    flex-wrap:nowrap;gap:0;padding-top:0}
  .sitenav .links .theme-btn{margin-left:1px}
  .sitenav .navauth{margin-left:0}
  .sitenav .navauth .authbtn{padding:3px 6px;font-size:10px;max-width:72px}
  .sitenav .links a,.sitenav .links .grpbtn{
    padding:4px 1px;font-size:10px;letter-spacing:-.3px}
  .sitenav .links a.livebtn{margin-left:0}
  :root[data-theme="light"] .sitenav .links > a.livebtn{margin-left:0}

  /* Ask Toto occupies the lower-right corner when the page is scrolled to its foot. */
  .udfoot{justify-content:flex-start;padding-bottom:72px}
}
/* The smallest supported phones need another few pixels, but still keep the same row. */
'''

OLD_NARROW = '''@media(max-width:359px){
  .sitenav .links{justify-content:flex-start}
}'''

NEW_NARROW = '''@media(max-width:359px){
  .sitenav{gap:0 2px}
  .sitenav .brand img{width:20px;height:25px}
  .sitenav .navauth .authbtn{padding:3px 5px;font-size:9.5px;max-width:64px}
  .sitenav .links{justify-content:flex-end}
  .sitenav .links a,.sitenav .links .grpbtn{padding:3px 1px;font-size:9px}
  .sitenav .links .theme-btn{margin-left:0;padding:3px 4px;font-size:11px}
}'''


changed = []
for path in sorted(ROOT.glob("*.html")):
    text = path.read_text(encoding="utf-8")
    starts = text.count(START)
    ends = text.count(END)
    if starts == 0 and ends == 0:
        continue
    assert starts == 1, f"{path.name}: expected one {START}, found {starts}"
    assert ends == 1, f"{path.name}: expected one {END}, found {ends}"
    before, tail = text.split(START, 1)
    _old, after = tail.split(END, 1)
    patched = before + REPLACEMENT + END + after
    assert patched.count(OLD_NARROW) == 1, (
        f"{path.name}: expected one narrow-phone rule, found {patched.count(OLD_NARROW)}"
    )
    patched = patched.replace(OLD_NARROW, NEW_NARROW, 1)
    path.write_text(patched, encoding="utf-8")
    changed.append(path.name)

assert len(changed) == 28, f"expected 28 shared-nav pages, changed {len(changed)}"
print(f"patched one-row mobile nav in {len(changed)} pages")
