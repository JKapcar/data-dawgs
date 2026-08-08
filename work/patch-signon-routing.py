#!/usr/bin/env python3
"""Route the banner Sign-in chip to signon.html on every page.

The DDAuth modal (patch-navauth.py, 8/7) opened in place. The 8/7 house rule since
moved every identity workflow onto signon.html, so the chip now NAVIGATES there,
carrying ?next=<this page> so signing in returns you to where you were. On
signon.html itself the chip just scrolls to the cards.

The modal code stays inline and dormant — removing it would be a 21-file surgery for
zero behavior change, and DDAuth's session plumbing (me/set/clear/post/render) is
load-bearing everywhere.

Same discipline as patch-navauth.py: anchor must appear EXACTLY once per file,
sentinel makes re-runs no-ops. Run from repo root:  python3 work/patch-signon-routing.py
"""
import glob, sys

ANCHOR = '  authBtn.addEventListener("click", ()=>window.DDAuth.open());'
SENTINEL = 'signon.html?next='   # the navigation string itself

NEW = """  authBtn.addEventListener("click", ()=>{
    /* one page owns every identity workflow (8/7) — the chip goes there, not to a modal */
    const here = location.pathname.split("/").pop() || "index.html";
    if (here === "signon.html") { window.scrollTo({top:0, behavior:"smooth"}); return; }
    location.href = "signon.html?next=" + encodeURIComponent(here);
  });"""

changed = []
for f in sorted(glob.glob("*.html")):
    s = open(f, encoding="utf-8").read()
    if "window.DDAuth" not in s:
        print("  skip %-24s no nav auth" % f); continue
    if SENTINEL in s and ANCHOR not in s:
        print("  skip %-24s already routed" % f); continue
    n = s.count(ANCHOR)
    if n != 1:
        sys.exit("FAILED %s: chip anchor appears %d times, expected 1" % (f, n))
    out = s.replace(ANCHOR, NEW)
    if out.count(SENTINEL) < 1 or len(out) <= len(s):
        sys.exit("FAILED %s: replacement did not land" % f)
    open(f, "w", encoding="utf-8").write(out)
    changed.append(f)
    print("  ok   %-24s" % f)

print("\nrouted %d files" % len(changed))
