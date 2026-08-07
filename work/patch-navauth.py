#!/usr/bin/env python3
"""Add the universal sign-in section to every page's banner.

The nav is inlined per page — there is no shared nav.js at build time — so a nav
change is the same edit applied 18 times. Every insertion asserts the anchor appears
EXACTLY once and that the payload is not already present, so a re-run is a no-op
rather than a second copy (the mistake the Worker build made).
"""
import glob, sys

CSS = open("work/navauth.css.txt", encoding="utf-8").read().rstrip("\n")
JS  = open("work/navauth.js.txt",  encoding="utf-8").read().rstrip("\n")

CSS_ANCHOR = '.theme-btn{background:none;border:1px solid var(--border);border-radius:8px;color:var(--ink-2);padding:4px 10px;cursor:pointer;font-size:12.5px}'
JS_ANCHOR  = '  nav.appendChild(brand);'
M1_ANCHOR  = '  .sitenav .brand .tag{display:none}'
M2_ANCHOR  = '  .sitenav .brand .logo{display:none}'

M1 = """  .sitenav .navauth{margin-left:5px}
  .sitenav .navauth .authbtn{padding:3px 8px;font-size:10.5px;max-width:104px;gap:4px;line-height:1.5}
  .sitenav .navauth .authbtn .dot{width:6px;height:6px}"""
M2 = """  .sitenav .navauth{margin-left:3px}
  .sitenav .navauth .authbtn{padding:3px 7px;font-size:10px;max-width:84px}"""

SENTINEL = "window.DDAuth"

def one(s, anchor, what, f):
    n = s.count(anchor)
    if n != 1:
        sys.exit("FAILED %s: %s appears %d times, expected 1" % (f, what, n))

changed = []
for f in sorted(glob.glob("*.html")):
    s = open(f, encoding="utf-8").read()
    if JS_ANCHOR not in s:
        print("  skip %-24s no nav" % f); continue
    if SENTINEL in s:
        print("  skip %-24s already patched" % f); continue
    one(s, CSS_ANCHOR, "theme-btn CSS anchor", f)
    one(s, JS_ANCHOR,  "nav.appendChild(brand)", f)
    one(s, M1_ANCHOR,  "phone brand-tag rule", f)
    one(s, M2_ANCHOR,  "narrow brand-logo rule", f)
    out = s
    out = out.replace(CSS_ANCHOR, CSS + "\n" + CSS_ANCHOR)
    out = out.replace(M1_ANCHOR,  M1_ANCHOR + "\n" + M1)
    out = out.replace(M2_ANCHOR,  M2_ANCHOR + "\n" + M2)
    out = out.replace(JS_ANCHOR,  JS_ANCHOR + "\n" + JS)
    for needle, what in [(".navauth{display:flex", "navauth CSS"),
                         ('id = "ddAuthBtn"', "chip"),
                         ("window.DDAuth = {", "module"),
                         ('nav.appendChild(authSec)', "section append")]:
        if out.count(needle) != 1:
            sys.exit("FAILED %s: %s landed %d times" % (f, what, out.count(needle)))
    if len(out) <= len(s):
        sys.exit("FAILED %s: file did not grow" % f)
    open(f, "w", encoding="utf-8").write(out)
    changed.append(f)
    print("  ok   %-24s +%.1f KB" % (f, (len(out)-len(s))/1024))

print("\npatched %d files" % len(changed))
