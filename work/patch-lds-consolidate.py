"""
Last Dawg Standing: one place to look, and tabs you can actually see.

1. The Chop Wheel and The Long Game fold WHOLESALE into "Am I Safe?" -- the wheel and the
   survival-decay curve are the two things you go to that page for, and they were each
   parked behind their own tab. Their sections are removed and their tabs with them.
   Order inside the sheet is odds -> wheel -> decay, which is the order you ask the
   questions in.

   The sheet switcher is pure show/hide with no lazy rendering, so nothing needs to be
   re-wired: the ids move with the markup and every writer still finds its target. The
   wheel canvas is now sized while VISIBLE rather than inside a hidden section, which can
   only help it.

2. The Draft Room comes out entirely -- sheet, its script block, the Toto surface bullet
   that described it, and the __GXD context branch. The honesty card loses the sentence
   about it. Removing the sheet but leaving Toto claiming it exists would make the page
   lie about itself, which is the one thing DD_BOTCTX is there to prevent.
   The FAAB War Plan is NOT part of this: it lives in The Money sheet and stays.

3. The tab strip pops. A later restyle had turned it into var(--ink-3) uppercase text on a
   hairline -- on a cream background that reads as disabled, which is exactly why the
   sheets went unused. It is a segmented control again, with a filled pill for the sheet
   you are on.

    cd work && py patch-lds-consolidate.py
"""
import pathlib, re

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"

s = PAGE.read_text(encoding="utf-8")
before = len(s)

def section(sid):
    m = re.search(r'(  <section class="gx-sheet" id="' + sid + r'"[^>]*>)(.*?)(\n  </section>\n)', s, re.S)
    assert m, "section not found: " + sid
    return m

# ---- 1. fold wheel + season into survival ----------------------------------
wheel = section("gxSheetWheel")
season = section("gxSheetSeason")
wheel_inner, season_inner = wheel.group(2), season.group(2)

s = s.replace(wheel.group(0), "", 1)
s = s.replace(season.group(0), "", 1)

surv = section("gxSheetSurvival")
s = s.replace(surv.group(0),
              surv.group(1) + surv.group(2) + wheel_inner + season_inner + surv.group(3), 1)

# ---- 2. remove the Draft Room ----------------------------------------------
draft = section("gxSheetDraft")
s = s.replace(draft.group(0), "", 1)

for btn in ['    <button role="tab" aria-selected="false" data-gx-sheet="draft">Draft Room</button>' + NL,
            '    <button role="tab" aria-selected="false" data-gx-sheet="wheel">Chop Wheel</button>' + NL,
            '    <button role="tab" aria-selected="false" data-gx-sheet="season">The Long Game</button>' + NL]:
    assert s.count(btn) == 1, "tab button not found: " + btn.strip()[:60]
    s = s.replace(btn, "", 1)

m = re.search(r'<script>\n/\* =+ LAST DAWG STANDING . DRAFT WAR ROOM =+.*?\n</script>\n', s, re.S)
assert m, "draft war room script block not found"
s = s.replace(m.group(0), "", 1)

m = re.search(r'- The DRAFT WAR ROOM sheet reads a Sleeper draft.*?\n', s)
assert m, "toto draft bullet not found"
s = s.replace(m.group(0), "", 1)

m = re.search(r'    const D = window\.__GXD, dl = \[\];\n    if\(D\)\{.*?\n    \}\n', s, re.S)
assert m, "__GXD context branch not found"
s = s.replace(m.group(0), "    const dl = [];" + NL, 1)

sent = (" The Draft War Room polls Sleeper every few seconds &mdash; near-live, not instant "
        "&mdash; and never writes to Sleeper; its pick matching is a name-and-position heuristic "
        "that can miss an unusual name, which a tap on the row fixes. The Guillotine Board&rsquo;s "
        "ranks, tiers and flags are editorial opinion built 2026-08-26 over the 2026-08-24 MV "
        "snapshot, not projections, and the")
assert s.count(sent) == 1, "honesty-card sentence not found"
s = s.replace(sent, " The", 1)

# ---- 2b. the Draft Room's dead CSS ------------------------------------------
# .gxd-* and #gxDBoard were written by the script block that just went. Verified zero
# references anywhere else in the page before removing.
css_start = ".gxd-flag{display:inline-block;"
css_end = ".gxd-onclock .sv{color:var(--good)}" + NL
i = s.index(css_start); j = s.index(css_end) + len(css_end)
assert i < j, "draft css bounds"
s = s[:i] + s[j:]

# ---- 3. make the tabs pop ---------------------------------------------------
old_css = (".gx-tabs{gap:0;border-bottom:1px solid var(--grid);padding:0;margin:18px 0 16px}" + NL +
 ".gx-tabs button{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;" + NL +
 "  padding:12px 15px;font:800 12.5px/1 inherit;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)}" + NL +
 ".gx-tabs button:hover{color:var(--ink-1)}" + NL +
 ".gx-tabs button.on{background:transparent;color:var(--accent);border-bottom-color:var(--accent)}")
assert s.count(old_css) == 1, "tab css not found"
new_css = (r'''/* ⚠ These were var(--ink-3) uppercase labels on a hairline underline. On the cream
   background that is the same grey the page uses for DISABLED text, so the sheets read
   as unavailable and went unused -- the reason this rework exists. It is a segmented
   control now: a real container, ink-1 labels, and a filled pill for the active sheet. */
.gx-tabs{gap:6px;border-bottom:0;padding:5px;margin:18px 0 18px;background:var(--surface-1);
  border:1px solid var(--grid);border-radius:999px;overflow-x:auto}
.gx-tabs button{border:1px solid transparent;border-bottom:0;border-radius:999px;background:transparent;
  padding:11px 17px;font:800 12.5px/1 inherit;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-1)}
.gx-tabs button:hover{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 38%,transparent)}
.gx-tabs button.on{background:var(--accent);color:#fff;border-color:var(--accent);
  box-shadow:0 2px 12px color-mix(in srgb,var(--accent) 38%,transparent)}''')
s = s.replace(old_css, new_css, 1)

# ---- 3b. on a phone, wrap rather than scroll --------------------------------
# The 4 tabs measure 494px against a 333px strip at 375px wide, so one always sat
# off-screen -- the same hidden problem in another form, and no padding trim closes a
# 189px gap. Two rows of two shows all four at once.
mq = "@media(max-width:390px){.gx-stage{margin-left:-2px"
assert s.count(mq) == 1, "phone media query anchor"
s = s.replace(mq,
  "@media(max-width:460px){" + NL +
  "  .gx-tabs{flex-wrap:wrap;overflow-x:visible;border-radius:18px}" + NL +
  "  .gx-tabs button{flex:1 1 calc(50% - 6px);padding:11px 8px;font-size:11.5px;letter-spacing:.03em}}" + NL +
  mq, 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-consolidate: ok (%d -> %d bytes)" % (before, len(s)))
