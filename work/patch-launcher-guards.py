#!/usr/bin/env python3
"""Two independent guards against Ask Toto's fixed launcher covering content.

Kap chose options 1 + 3 from [[ask-toto-overlap-measured]] on 2026-08-10.

  GUARD A (bigboard.html only)  the document must not END inside the launcher's band.
  GUARD B (all 25 pages)        the launcher leaves while the page is moving.

⚠️ WHY TWO. [[feedback-fixed-elements]]: one guard removes the permanent overlap, the other
the transient one, and they fail independently. If the launcher later grows, moves, or the
scroll handler is refactored away, the other still holds.

⚠️ THE WIDGET IS INLINED IN ALL 25 PAGES AND THE BLOCKS ARE BYTE-IDENTICAL (verified
md5 css=fadc2ff6 js=600987ca on 45299e0). This script asserts that identity BEFORE and AFTER
editing, because a per-page divergence in a shared block is invisible in review and the next
sitewide sweep would clobber it. There is no generator for this block; if one is ever added,
this patch moves there.

Run from the repo root. Idempotent: re-running is a no-op that reports "already applied".
"""
import glob, hashlib, sys

# ---------- guard B, part 1: the injected stylesheet ----------
CSS_OLD = """  box-shadow:0 8px 26px rgba(0,0,0,.30);transition:transform .13s ease, box-shadow .13s ease}
#ddbLaunch:hover{transform:translateY(-2px);box-shadow:0 13px 32px rgba(0,0,0,.36)}
#ddbLaunch:active{transform:translateY(0)}"""

CSS_NEW = """  box-shadow:0 8px 26px rgba(0,0,0,.30);
  transition:transform .13s ease, box-shadow .13s ease, opacity .16s ease}
#ddbLaunch:hover{transform:translateY(-2px);box-shadow:0 13px 32px rgba(0,0,0,.36)}
#ddbLaunch:active{transform:translateY(0)}
/* ⚠️ GUARD B (2026-08-10). The launcher is fixed, so it owns the bottom-right ~74px band at
   EVERY scroll position and at rest it sits on top of whatever is there: measured 4,303 px2
   over two cells on receipts.html#models and 3,947 px2 over a heading on nfl.html. It steps
   aside while the page is moving and returns when it stops, which is when reading happens.
   The transform is decoration. opacity and pointer-events are what actually clear the
   text, which is why reduced motion still HIDES it instead of keeping it over the words —
   ⚠️ NEVER put a backtick in this comment. This stylesheet is a JS template literal, so a
   backtick ENDS it: quoting the two property names cost a debug cycle on 2026-08-10 and the
   error surfaced as "Unexpected identifier 'opacity'" with the launcher simply absent.
   honouring the preference means dropping the movement, not dropping the fix.
   Gate: work/test-launcher-overlap.mjs. */
#ddbLaunch.ddb-away{opacity:0;pointer-events:none;transform:translateY(12px) scale(.97)}
@media (prefers-reduced-motion:reduce){#ddbLaunch.ddb-away{transform:none;transition:none}}"""

# ---------- guard B, part 2: the scroll handler ----------
JS_OLD = """      document.body.appendChild(b);
    }, 300);
  });"""

JS_NEW = """      document.body.appendChild(b);
      /* ⚠️ GUARD B. 140ms of quiet before it comes back: long enough that momentum scrolling
         does not flicker it, short enough that it is already there when a reader reaches for
         it. passive so this can never delay a scroll.
         ⚠️ capture:true IS LOAD-BEARING. Scroll events do not bubble, and the tables on
         cfb.html and the receipts sheets scroll INSIDE their own container while the document
         never grows — a window-only listener sees nothing on exactly the surfaces the
         complaint named. Capture reaches them because the capture path runs even for
         non-bubbling events. */
      let ddbIdle = 0;
      addEventListener("scroll", () => {
        b.classList.add("ddb-away");
        clearTimeout(ddbIdle);
        ddbIdle = setTimeout(() => b.classList.remove("ddb-away"), 140);
      }, { passive: true, capture: true });
    }, 300);
  });"""

# ---------- guard A: bigboard only ----------
BB_OLD = """  .udfoot{justify-content:flex-start;padding-bottom:72px}
}
/* ---- cards & type ---- */"""

BB_NEW = """  .udfoot{justify-content:flex-start;padding-bottom:72px}
}
/* ⚠️ GUARD A (2026-08-10, THIS PAGE ONLY, and measured before it was written).
   Ask Toto's launcher is position:fixed with a 56px box 18px off the bottom, so it owns the
   last 74px of the viewport at every scroll position. This page ships no <footer>, so the 🙃
   row is the last thing in <body> and the document ends close behind the board lens. At 1280
   and MAXIMUM scroll the last .pf-stat .v ended 69px above the document bottom — 5px inside
   the band — leaving 754 px2 of "Next up (adj)" prices that NO amount of scrolling could
   reveal. That is the one genuinely unreachable overlap on the whole site; the other 27
   surfaces measure 0. Guard B does not help here: this is not a scrolling problem.
   ⚠️ The measured shortfall is 6px. This is 72px, matching the ≤419px guard above, because
   [[feedback-fixed-elements]] cost a day proving that ~2px of margin is not margin. Do not
   trim it to the measurement.
   ⚠️ Padding the 🙃 row is what lengthens the DOCUMENT. Padding .projfoot instead would move
   the stats up without moving the document bottom, and .projfoot is shared with auction.html,
   which has no fixed launcher at all (it ships its own in-flow #aiBtn).
   Gate: work/test-launcher-overlap.mjs asserts zero unreachable overlap on all 30 surfaces. */
@media(min-width:420px){.udfoot{padding-bottom:72px}}
/* ---- cards & type ---- */"""

CSS_ANCHOR = "#ddbLaunch{position:fixed;right:18px;bottom:18px;z-index:58;border:0;"
CSS_END = "@media print{#ddbLaunch,#ddbDock{display:none!important}}`;"
JS_ANCHOR = "  // Auto-launcher on any page that exposes a player pool"


def block_sig(text, start, end):
    i, j = text.find(start), text.find(end)
    if i < 0 or j < 0:
        return None
    return hashlib.md5(text[i:j + len(end)].encode()).hexdigest()[:8]


def main():
    pages = sorted(p for p in glob.glob("*.html") if "ddbLaunch" in open(p, encoding="utf-8").read())
    if len(pages) != 25:
        sys.exit(f"expected 25 pages carrying the launcher, found {len(pages)}: {pages}")

    # identity BEFORE
    before = {block_sig(open(p, encoding="utf-8").read(), CSS_ANCHOR, CSS_END) for p in pages}
    if len(before) != 1:
        sys.exit(f"the launcher CSS has already diverged across pages: {before}")

    applied, already = [], []
    for p in pages:
        s = open(p, encoding="utf-8").read()
        if "ddb-away" in s:
            already.append(p)
            continue
        for name, old, new in (("css", CSS_OLD, CSS_NEW), ("js", JS_OLD, JS_NEW)):
            n = s.count(old)
            if n != 1:
                sys.exit(f"{p}: expected exactly 1 {name} anchor, found {n} — refusing to guess")
            s = s.replace(old, new)
        open(p, "w", encoding="utf-8", newline="").write(s)
        applied.append(p)

    # guard A
    bb = open("bigboard.html", encoding="utf-8").read()
    if "GUARD A (2026-08-10" in bb:
        print("guard A: already applied")
    else:
        if bb.count(BB_OLD) != 1:
            sys.exit("bigboard.html: guard A anchor not found exactly once")
        open("bigboard.html", "w", encoding="utf-8", newline="").write(bb.replace(BB_OLD, BB_NEW))
        print("guard A: bigboard.html patched")

    # identity AFTER — the whole point of this script over 25 hand edits
    after_css = {block_sig(open(p, encoding="utf-8").read(), CSS_ANCHOR, CSS_END) for p in pages}
    after_js = {block_sig(open(p, encoding="utf-8").read(), JS_ANCHOR, "    }, 300);\n  });\n})();") for p in pages}
    if len(after_css) != 1 or len(after_js) != 1:
        sys.exit(f"POST-EDIT DIVERGENCE — css={after_css} js={after_js}")

    print(f"guard B: {len(applied)} patched, {len(already)} already applied")
    print(f"blocks still identical across all 25 pages: css={after_css.pop()} js={after_js.pop()}")


if __name__ == "__main__":
    main()
