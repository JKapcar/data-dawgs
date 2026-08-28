"""Colour-code the position on the cheat sheet so the All view is scannable.

Filtering to one position was the only way to see position at a glance: in All,
"RB" and "WR" are the same three grey characters at 11px, so finding the next
receiver meant reading 613 rows one at a time. That is the wrong tool at a live
auction — you filter to answer "who is left at WR", not to answer "what am I
looking at".

Colour is carried by ONE custom property, --posc, set on the row from the
player's own position. Both layouts read it, so desktop and phone can never
disagree about what green means, and a position added to the pool later gets
the neutral fallback rather than a wrong colour.

⚠ The position must NOT be a tinted pill on the phone card. That was the first
build and it was wrong: .pill.buy/.fade/.zrb are already tinted pills of the same
size, radius and construction sitting in the very next cell, so a green RB read as
a green "buy" recommendation. A category cannot wear the costume of a judgement on
a board someone scans at speed under a draft clock.

So the phone card carries the colour on a 3px bar down the left edge of the whole
row instead — nothing else on the page is shaped like that, it cannot be mistaken
for a tag, and a bar running the full height of the card is the thing that makes a
LIST scannable rather than a cell. The position text is coloured too, on both
layouts, which is all the desktop table needs: it has a labelled Pos column, so
the colour is a nicety there rather than the signal.

Colours are per-theme, not one set with opacity: the dark surface is #241c12
and the light one is #fffdf7, and a single palette legible on both does not
exist. DST is deliberately the muted ink — it is not a position you hunt for.
"""
import re, pathlib

p = pathlib.Path("board.html")
s = p.read_text()

def sub(old, new):
    global s
    n = s.count(old)
    assert n == 1, f"expected 1 occurrence, found {n}: {old[:70]!r}"
    s = s.replace(old, new)

# 1. Tokens, dark theme.
sub("""  --good:#2fbf3f; --bad:#ff6b6b; --warn:#eda100;
}""",
    """  --good:#2fbf3f; --bad:#ff6b6b; --warn:#eda100;
  /* Position colours. Hue is the whole signal, so they must stay distinguishable
     from each other AND from --accent (#ff6a02), which is what a price is printed
     in — a position that reads as a dollar figure is worse than no colour. */
  --pos-qb:#e2607a; --pos-rb:#4fbf6a; --pos-wr:#5aa8f0;
  --pos-te:#d9a441; --pos-k:#a98cf0;  --pos-dst:#8f897d;
}""")

# 2. Tokens, light theme.
sub("""  --navbar:#2a1a06; --navink:#ecdfc9; --navink2:#b7a488;
}""",
    """  --navbar:#2a1a06; --navink:#ecdfc9; --navink2:#b7a488;
  /* Darkened for the paper field — the dark theme's values are ~2:1 on #fffdf7. */
  --pos-qb:#b4304c; --pos-rb:#1f7a34; --pos-wr:#1f5fa8;
  --pos-te:#8a5a00; --pos-k:#5b3fa8;  --pos-dst:#6b6355;
}""")

# 3. The row-to-colour mapping plus the desktop rendering, next to the other
#    #board rules rather than in the phone block, because desktop uses it too.
sub("""  #board, #board tbody, #board tr, #board td{display:block}""",
    """  #board, #board tbody, #board tr, #board td{display:block}""")

s = s.replace("""@media(max-width:620px){
  /* ⚠️ Buy back the gutters before touching type size.""",
    """/* One property, set from the player's own position, read by both layouts. An
   unrecognised position falls back to the ordinary ink instead of picking a
   colour that means something else. */
#board tr[data-pos=QB]{--posc:var(--pos-qb)}
#board tr[data-pos=RB]{--posc:var(--pos-rb)}
#board tr[data-pos=WR]{--posc:var(--pos-wr)}
#board tr[data-pos=TE]{--posc:var(--pos-te)}
#board tr[data-pos=K]{--posc:var(--pos-k)}
#board tr[data-pos=DST]{--posc:var(--pos-dst)}
#board td[data-c=pos]{color:var(--posc,var(--ink-2));font-weight:700}
/* A drafted row is struck through and dimmed on purpose; a bright position chip
   would undo that and pull the eye to exactly the players you can no longer buy. */
#board tr.taken td[data-c=pos]{color:var(--ink-3)}

@media(max-width:620px){
  /* ⚠️ Buy back the gutters before touching type size.""", 1)
assert s.count("#board tr[data-pos=QB]") == 1

# 4a. The phone block restates the pos colour, and it is declared AFTER the rule in
#     step 3 at the same specificity — so without this the card would print the
#     position in plain ink while the bar beside it was coloured.
sub("""  #board td[data-c=pos]{order:4;flex:0 0 auto;font-size:11px;font-weight:700;
    letter-spacing:.04em;color:var(--ink-2)}""",
    """  #board td[data-c=pos]{order:4;flex:0 0 auto;font-size:11px;font-weight:700;
    letter-spacing:.04em;color:var(--posc,var(--ink-2))}""")

# 4. Phone card: the edge bar. It replaces 3px of the row's existing 4px left
#    padding, so no row gets wider and line one keeps every pixel it had.
sub("""  #board tr{
    display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;
    padding:9px 4px;border-bottom:1px solid var(--grid);white-space:nowrap}""",
    """  #board tr{
    display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;
    padding:9px 4px 9px 1px;border-bottom:1px solid var(--grid);white-space:nowrap;
    /* The scan aid. A bar down the full height of the card is the only mark on this
       page shaped like this, which is exactly why it is used: the tinted pill it
       replaced was indistinguishable from the buy/fade tag in the next cell.
       Transparent, not absent, so an unknown position still lines the rows up. */
    border-left:3px solid var(--posc,transparent)}
  /* Drafted rows are struck through and dimmed on purpose; a live colour bar would
     pull the eye straight to the players nobody can buy any more. */
  #board tr.taken{border-left-color:var(--grid)}""")

# 5. Carry the position onto the row.
sub("""    if(isTaken) tr.classList.add("taken");""",
    """    // The colour lives in CSS; the row only says which position it is.
    tr.dataset.pos = r.pos || "";
    if(isTaken) tr.classList.add("taken");""")

p.write_text(s)
print("board.html patched")
