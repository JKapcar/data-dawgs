"""
Team selector: make a selected chip readable, and stop it eating the page on a phone.

TWO BUGS, both introduced by the previous commit.

1. A SELECTED CHIP HID ITS OWN NAME. The renderer writes the team's compare colour as an
   INLINE style="color:...", and the new rule filled the chip with background:currentColor.
   Inline colour beats a stylesheet colour, so `color:#fff` never applied and the label
   ended up exactly the same colour as the fill it sat on -- a solid blue lozenge with the
   name invisible inside it. The colour now travels as a custom property (--c) instead, so
   the fill can use it while the label stays white. A custom property does not participate
   in `color` inheritance, which is precisely why it is the right carrier here.

2. IT WAS NINE ROWS TALL. flex-wrap:wrap under 520px turned 18 long team names into a
   wall that pushed the chart off the screen. It is one horizontally scrolling row now --
   the same pattern as the tab strips above it -- and every chip is capped and ellipsised
   so a single long name cannot set the height for everyone. Fixed height, swipe for the
   rest.

    cd work && py patch-lds-chips-fix.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"
s = PAGE.read_text(encoding="utf-8")

# ---- 1. carry the colour as a custom property ------------------------------
old = """          +(on&&!isMe?' style="color:'+colorOf[r.rid]+'"':'')+'>'+esc(r.name)+'</button>';"""
new = ("""          /* ⚠ --c, NOT color. An inline `color` outranks the stylesheet, so a filled\n"""
       """             chip painted with currentColor rendered its label in the fill colour and\n"""
       """             the name vanished. A custom property is inert to inheritance. */\n"""
       """          +(on&&!isMe?' style="--c:'+colorOf[r.rid]+'"':'')+'>'+esc(r.name)+'</button>';""")
assert s.count(old) == 1, "chip render"
s = s.replace(old, new, 1)

# ---- 2. the styles ----------------------------------------------------------
old = (".gx-cmp{display:flex;gap:7px;margin:16px 0 6px;padding:7px;background:var(--surface-1);" + NL +
       "  border:1px solid var(--grid);border-radius:16px;overflow-x:auto;scrollbar-width:thin;" + NL +
       "  -webkit-overflow-scrolling:touch}" + NL +
       ".gx-cmp button{flex:0 0 auto;border:1px solid transparent;background:transparent;color:var(--ink-1);" + NL +
       "  border-radius:999px;padding:9px 14px;min-height:38px;font:700 12px/1.2 inherit;cursor:pointer;" + NL +
       "  white-space:nowrap;transition:background .15s,color .15s,border-color .15s}" + NL +
       ".gx-cmp button:hover{background:color-mix(in srgb,var(--ink-1) 7%,transparent)}" + NL +
       ".gx-cmp button.on{color:#fff;background:currentColor;box-shadow:inset 0 0 0 999px currentColor}" + NL +
       ".gx-cmp button.me{color:var(--accent);border-color:var(--accent);font-weight:800;cursor:default;" + NL +
       "  background:color-mix(in srgb,var(--accent) 12%,transparent);box-shadow:none}" + NL +
       "@media(max-width:520px){.gx-cmp{flex-wrap:wrap;overflow-x:visible}}")
assert s.count(old) == 1, "chip css"

new = r'''/* One scrolling row, never a wrap. 18 team names wrapped into nine rows on a phone and
   pushed the chart off screen; the row is a fixed height now and you swipe, which is what
   the tab strips above it already do. */
.gx-cmp{display:flex;flex-wrap:nowrap;gap:7px;margin:16px 0 6px;padding:7px;
  background:var(--surface-1);border:1px solid var(--grid);border-radius:16px;
  overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;-webkit-overflow-scrolling:touch;
  scroll-snap-type:x proximity}
.gx-cmp button{flex:0 0 auto;scroll-snap-align:start;border:1px solid var(--grid);
  background:var(--page);color:var(--ink-1);border-radius:999px;padding:9px 14px;min-height:38px;
  font:700 12px/1.2 inherit;cursor:pointer;white-space:nowrap;
  /* a single long name must not set the width for everyone */
  max-width:11rem;overflow:hidden;text-overflow:ellipsis;
  transition:background .15s,color .15s,border-color .15s}
.gx-cmp button:hover{border-color:var(--ink-3)}
/* ⚠ --c, not currentColor. See the note at the chip renderer: an inline `color` outranks
   this rule, so filling with currentColor painted the label the same colour as the fill
   and the name disappeared. */
.gx-cmp button.on{background:var(--c,var(--accent));border-color:var(--c,var(--accent));color:#fff}
.gx-cmp button.me{color:var(--accent);border-color:var(--accent);font-weight:800;cursor:default;
  background:color-mix(in srgb,var(--accent) 12%,transparent)}
.gx-cmp::-webkit-scrollbar{height:6px}
.gx-cmp::-webkit-scrollbar-thumb{background:var(--grid);border-radius:99px}'''
s = s.replace(old, new, 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-chips-fix: ok")
