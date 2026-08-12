#!/usr/bin/env python3
"""Stage TOTO-PAGES follow-up — the reader was skipping the data.

Caught live on teamdraft.html: asked who got the biggest steal, Toto answered "I do
not have the per-pick reach figures in the state in front of me" and routed to the
board section — which was correct behaviour and a wrong outcome, because the board
was three inches above the dock.

Every drafted pick on that board is a <button>. So is every roster card, and so is
every expected-wins bar. The reader skipped BUTTON wholesale as chrome, so all Toto
got was the one summary line under the board: "25 picks · 11 took the board's best
remaining · 4 passed on a full win or more" — exactly what he said he had.

Skipping buttons was right for "Run", "Spin ×10", "Reset tally" and wrong for
everything this site builds out of them. So keep the ones carrying content and drop
the ones carrying a verb: a button is read if it has a data-tip, two or more element
children, or more than a couple of words of text. The tip is read too, tags stripped
— on the draft board that attribute is where "best available was X at Y" lives, which
is the whole answer to the question that exposed this.

Per AGENTS.md rule 2: same edit, every file, assert count == 1.
"""
import glob
import sys

MARK = "/* ---------- Toto: shared draft assistant"

OLD_SKIP = """    const SKIP_TAG = {SCRIPT:1, STYLE:1, NOSCRIPT:1, SVG:1, CANVAS:1, IFRAME:1, TEMPLATE:1,
                      NAV:1, FOOTER:1, VIDEO:1, AUDIO:1, BUTTON:1, OPTION:1, PICTURE:1};
"""
NEW_SKIP = """    const SKIP_TAG = {SCRIPT:1, STYLE:1, NOSCRIPT:1, SVG:1, CANVAS:1, IFRAME:1, TEMPLATE:1,
                      NAV:1, FOOTER:1, VIDEO:1, AUDIO:1, OPTION:1, PICTURE:1};
"""

OLD_CTRL = """        if(tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA"){
          const s = ddControl(el); if(s) cur.lines.push(s);
          continue;
        }
"""
NEW_CTRL = OLD_CTRL + """        if(tag === "BUTTON"){
          /* ⚠️ Buttons were skipped outright as chrome, and on this site that threw
             away the data. Every pick on the draft board, every roster card and every
             expected-wins bar is a button — the summary line under the board was all
             Toto could see, so he could not name a steal that was on screen.
             Keep the ones carrying content, drop the ones carrying a verb. */
          const s = ddTxt(el);
          if(!s || said[s]) continue;
          if(!(el.hasAttribute("data-tip") || el.children.length >= 2 || s.length > 24)) continue;
          said[s] = 1;
          if(ddInView(el)) cur.seen = true;
          // The tip is built as markup and lives in an attribute, so textContent never
          // sees it — and on the board it is the half that says what the pick passed on.
          const tip = (el.getAttribute("data-tip") || el.getAttribute("title") || "")
            .replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/\\s+/g, " ").trim();
          cur.lines.push(s.slice(0, 220) + (tip ? "  (" + tip.slice(0, 200) + ")" : ""));
          continue;
        }
"""

EDITS = [("BUTTON out of SKIP_TAG", OLD_SKIP, NEW_SKIP),
         ("content-button branch", OLD_CTRL, NEW_CTRL)]


def main():
    files = [f for f in sorted(glob.glob("*.html")) if MARK in open(f, encoding="utf-8").read()]
    if not files:
        sys.exit("no pages carry the Toto block — wrong directory?")
    print(f"{len(files)} pages carry the reader")
    for f in files:
        s = open(f, encoding="utf-8").read()
        for name, old, new in EDITS:
            assert s.count(old) == 1, f"{f}: {name} matched {s.count(old)} times"
            s = s.replace(old, new)
        open(f, "w", encoding="utf-8").write(s)
        print("  patched", f)


if __name__ == "__main__":
    main()
