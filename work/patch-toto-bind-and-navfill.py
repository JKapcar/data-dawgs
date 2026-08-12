#!/usr/bin/env python3
"""Two fixes, both caught on a phone.

1. `this.spine is not a function` — Toto broken on teamdraft.html.

   surface() hands the page's ctx on as a bare reference:

       ctx: typeof h.ctx === "function" ? h.ctx : base.ctx

   and ask() then calls it as SF.ctx(). That detaches the method from DD_BOTCTX, so
   `this` is undefined inside it and teamdraft's ctx — which calls this.spine() and
   this.board() — throws. The throw lands in ask()'s catch, which reports it as a
   network failure: "Couldn't reach Toto. Check this device is online."

   ⚠️ THE VERIFICATION MISSED IT BECAUSE THE PROBE CALLED window.DD_BOTCTX.ctx(),
   which keeps the binding. The client's call path is the only one that counts —
   test through it or not at all.

   Two belts: surface() binds (so any page may use method shorthand, as cfb.html
   already does), and teamdraft stops depending on `this` at all — its helpers move
   into a closure.

2. The phone nav does not fill its row. Measured on teamdraft at 393px: the links
   run ends at x=335 inside a box that runs to 369, and the sign-in chip sits at
   x=110 with 259px of nothing to its right. Below 420 the links have their own row,
   so the free space is real space rather than the price of fitting.

   The links row spreads to both edges, and the chip goes to the right of the row it
   shares with the brand. No new elements, no font or padding change, so none of the
   overlap and height measurements in work/test-nav-fit.mjs move — the run is the
   same width, it is the gaps between items that grow.
   ⚠️ Not touched: 420-760, where the bar is ONE row and the links are end-justified
   against the brand. That band fails by collision, and free space there is the
   margin that keeps it from colliding.
"""
import glob
import sys

MARK = "/* ---------- Toto: shared draft assistant"

# ------------------------------------------------------- 1a. bind, every page
OLD_BIND = """            ctx:   typeof h.ctx === "function" ? h.ctx : base.ctx};
"""
NEW_BIND = """            /* ⚠️ BIND IT. This is called as SF.ctx(), which detaches the method from
               DD_BOTCTX — a ctx() written in method shorthand loses `this` and throws,
               and ask()'s catch reports that as "Couldn't reach Toto. Check this device
               is online." A page's own object is the only sane `this` here. */
            ctx:   typeof h.ctx === "function" ? h.ctx.bind(h) : base.ctx};
"""

# ------------------------------------------- 2. the phone nav fills its row
OLD_CSS = """  .sitenav .links{flex:1 1 100%;margin-left:0;justify-content:flex-start;flex-wrap:wrap;gap:2px 3px;padding-top:3px}
"""
NEW_CSS = """  /* ⚠️ space-between, not flex-start. The links own this row outright below 420, so a
     left-packed run leaves a ragged 34px hole at 393 and reads as broken rather than
     tight. Spreading costs nothing measurable: the run is the same width and only the
     gaps grow, so every overlap figure in work/test-nav-fit.mjs is unchanged. */
  .sitenav .links{flex:1 1 100%;margin-left:0;justify-content:space-between;flex-wrap:wrap;gap:2px 3px;padding-top:3px}
"""

OLD_AUTH = """  .sitenav .navauth{margin-left:3px}
  .sitenav .navauth .authbtn{padding:3px 7px;font-size:10px;max-width:84px}
"""
NEW_AUTH = """  /* The chip shares a row with the brand and nothing else, so it goes to the far end
     of it — 259px of dead space at 393px, next to a bar the reader called terrible.
     ⚠️ An auto margin here is safe in a way it is NOT on the theme button below: this
     row's only other item is the brand, and .links takes a 100% basis onto its own
     line regardless. The theme button lives INSIDE that wrapping run, where an auto
     margin eats the free space the last line needs and forces another one. */
  .sitenav .navauth{margin-left:auto}
  .sitenav .navauth .authbtn{padding:3px 7px;font-size:10px;max-width:84px}
"""

# ⚠️ Spreading is right only while the run is ONE line. Measured: it wraps below 360 —
# two link rows from 330 to 350, three at 320 — and space-between then throws the last
# line's one or two survivors to opposite edges of an otherwise empty row, which looks
# more broken than the hole it was fixing. Below the wrap they pack left again.
OLD_NARROW = """  .udfoot{justify-content:flex-start;padding-bottom:72px}
}
"""
NEW_NARROW = """  .udfoot{justify-content:flex-start;padding-bottom:72px}
}
/* ⚠️ THE SPREAD STOPS WHERE THE RUN WRAPS. Measured on teamdraft: the links run is one
   line from 360 to 419 and wraps below it — two rows at 330-350, three at 320. On a
   wrapped run space-between spreads the LAST line too, so at 320 "Dawgs" sat at x=24
   and the theme button at x=271 with nothing between them. There is no CSS for "spread
   every line except the last", so the narrow end packs left, which is what it did
   before and what it should keep doing until a ninth-section overflow menu exists.
   ⚠️ IT MUST SIT AFTER THE 419 BLOCK, NOT BEFORE IT. Same specificity, so the later
   rule wins — written above the 419 block, the spread simply overrode this and 320 was
   unchanged. A stray line outside the comment does the same thing more quietly: the
   parser drops the @media that follows it and everything still looks like a no-op. */
@media(max-width:359px){
  .sitenav .links{justify-content:flex-start}
}
"""

SITEWIDE = [("ctx binding", OLD_BIND, NEW_BIND),
            ("links fill the row", OLD_CSS, NEW_CSS),
            ("sign-in chip to the row end", OLD_AUTH, NEW_AUTH),
            ("pack left where the run wraps", OLD_NARROW, NEW_NARROW)]

# ------------------------------------------ 1b. teamdraft stops using `this`
TD_OLD_HEAD = """  board(){
"""
TD_NEW_HEAD = """  ctx: (function(){
  /* ⚠️ A CLOSURE, NOT METHODS. surface() binds now, but a surface that needs `this`
     to survive is one refactor away from the same silent break — and the break
     presents as "Couldn't reach Toto. Check this device is online." Nothing here
     depends on how ctx() is called. */
  function board(){
"""

TD_OLD_TAIL = """    return L.join('\\n');
  },
  ctx(){ return this.spine() + '\\n\\n' + this.board() + '\\n\\n'
    + (window.DDBotScan ? window.DDBotScan(4200) : 'The page reader could not run.'); },
  spine: () => `THE 32-TEAM DRAFT PAGE."""
TD_NEW_TAIL = """    return L.join('\\n');
  }
  const spine = `THE 32-TEAM DRAFT PAGE."""

TD_OLD_END = """ · a diagnostics panel that reports drift rather than only printing OK.

`
};
</script>"""
TD_NEW_END = """ · a diagnostics panel that reports drift rather than only printing OK.

`;
  return () => spine + '\\n\\n' + board() + '\\n\\n'
    + (window.DDBotScan ? window.DDBotScan(4200) : 'The page reader could not run.');
  })()
};
</script>"""


def main():
    files = [f for f in sorted(glob.glob("*.html")) if MARK in open(f, encoding="utf-8").read()]
    if not files:
        sys.exit("no pages carry the Toto block — wrong directory?")
    for f in files:
        s = open(f, encoding="utf-8").read()
        for name, old, new in SITEWIDE:
            assert s.count(old) == 1, f"{f}: {name} matched {s.count(old)} times"
            s = s.replace(old, new)
        open(f, "w", encoding="utf-8").write(s)
    print(f"patched {len(files)} pages (binding + phone nav)")

    s = open("teamdraft.html", encoding="utf-8").read()
    for name, old, new in [("board head", TD_OLD_HEAD, TD_NEW_HEAD),
                           ("ctx/spine", TD_OLD_TAIL, TD_NEW_TAIL),
                           ("close", TD_OLD_END, TD_NEW_END)]:
        assert s.count(old) == 1, f"teamdraft.html: {name} matched {s.count(old)} times"
        s = s.replace(old, new)
    assert "this." not in s.split("Toto's surface: the 32-team wins pool")[1], "teamdraft surface still uses `this`"
    open("teamdraft.html", "w", encoding="utf-8").write(s)
    print("patched teamdraft.html (surface no longer needs `this`)")


if __name__ == "__main__":
    main()
