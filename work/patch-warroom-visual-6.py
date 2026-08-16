#!/usr/bin/env python3
"""War room: the empty metric, and cards stretched to a taller neighbour.

1. Before a simulation runs, the playoff-odds metric printed an em dash at
   full metric size in accent orange — a thick floating bar that reads as a
   rendering fault, not as "no value yet". A dash at that size is not worth
   rescuing: the metric is hidden until there is a number, and the note
   under it already says what to do to get one.

2. Grid cards stretched to match the tallest card in their row. Next to the
   12-row standings table that left the selected-team card with roughly 700
   pixels of empty background under its button. Cards size to their content
   now; a ragged bottom edge is the normal look for a card grid and is much
   better than a void.

Anchor-based, idempotent.
"""

PATH = "../fantasy-warroom.html"
edits = [
    (".wr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}",
     ".wr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}"),

    (".wr-card{background:var(--surface-1);border:1px solid var(--grid);border-radius:12px;padding:18px;min-width:0}",
     ".wr-card{background:var(--surface-1);border:1px solid var(--grid);border-radius:12px;padding:18px;min-width:0}\n"
     ".wr-metric.is-empty{display:none}"),

    ("""  if(!sim){$('odds').textContent='—';$('oddsNote').textContent='Run the deterministic season simulation.'}""",
     """  if(!sim){$('odds').textContent='—';$('odds').classList.add('is-empty');$('oddsNote').textContent='Run the deterministic season simulation.'}"""),

    ("""  $('odds').textContent='—';\n""",
     """  $('odds').textContent='—';$('odds').classList.add('is-empty');\n"""),

    ("""  if(sim){const me=state.teams[+$('teamPicker').value||0];$('odds').innerHTML=Math.round(sim.odds[me.id]*100)+'<small>%</small>';""",
     """  if(sim){const me=state.teams[+$('teamPicker').value||0];$('odds').classList.remove('is-empty');$('odds').innerHTML=Math.round(sim.odds[me.id]*100)+'<small>%</small>';"""),

    ("""  $('odds').innerHTML=Math.round(sim.odds[me.id]*100)+'<small>%</small>';""",
     """  $('odds').classList.remove('is-empty');$('odds').innerHTML=Math.round(sim.odds[me.id]*100)+'<small>%</small>';"""),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new in edits:
    if new in s:
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-visual-6: {changed} edit(s) applied, {len(edits)-changed} already present")
