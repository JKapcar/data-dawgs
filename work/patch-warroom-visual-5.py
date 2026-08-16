#!/usr/bin/env python3
"""War room Standings sheet: the selected-team card.

Three things were wrong on the card that names your team:

1. The team name printed twice — once as an h2, once as the selected option
   of the picker directly beneath it. The Receipt already solved this by
   making the heading itself the control; this card now uses the same
   wr-teamh2 treatment, so the sheets agree and the duplicate line goes.

2. That picker was a raw native select sitting under styled headings — the
   one piece of unstyled browser chrome on the sheet.

3. With no simulation run, the playoff-odds metric rendered an em dash
   followed by a percent sign at metric size. "—%" is not a value; it looks
   like a number that failed to load. The unit only appears when there is a
   number to carry it.

Anchor-based, idempotent.
"""

PATH = "../fantasy-warroom.html"
edits = [
    # 1+2 — the heading becomes the picker, matching the Receipt
    ("""      <h2 id="myTeam">Choose a team</h2>
      <select id="teamPicker" aria-label="Your team"></select>""",
     """      <h2 class="wr-teamh2" id="myTeam"><select id="teamPicker" aria-label="Your team"></select></h2>"""),

    # the h2 no longer holds text of its own; the picker carries the name
    ("""  $('myTeam').textContent=me.name;\n  $('strength')""", """  $('strength')"""),

    # 3 — no unit without a number
    ("""  if(!sim){$('odds').innerHTML='—<small>%</small>';$('oddsNote').textContent='Run the deterministic season simulation.'}""",
     """  if(!sim){$('odds').textContent='—';$('oddsNote').textContent='Run the deterministic season simulation.'}"""),

    ("""  $('odds').innerHTML='—<small>%</small>';""",
     """  $('odds').textContent='—';"""),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new in edits:
    if new and new in s:
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-visual-5: {changed} edit(s) applied, {len(edits)-changed} already present")
