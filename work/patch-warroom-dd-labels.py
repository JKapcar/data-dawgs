"""
Name the two sides of the disagreement panel for what they actually are.

The panel compared "the projection" against "the market". Both labels were wrong in a way
that misread as a verdict on a pick:
  - "the market" is /data/pool.json -- the Data Dawgs board. It is not a market.
  - "the projection" is the PROVIDER'S own scoring (ESPN's season split, or Sleeper's
    season projection), so naming it generically hid whose opinion was on the axis.

A reader saw "Mahomes -$13 / market rates him higher" and concluded he was a bad pick, when
the bar was reporting that ESPN and the Data Dawgs board disagree about him -- in a
superflex league, mostly about how much the second QB slot is worth.

No math changes here. Labels only.

    cd work && py patch-warroom-dd-labels.py
"""
import pathlib

NL = chr(10)
RSQ = chr(0x2019)          # the file writes this as a \u escape inside JS strings
ESC_RSQ = chr(92) + "u2019"

REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "fantasy-warroom.html"

EDITS = [
# 1 -- provider name helper, beside the other label helpers
(
 "function valueLabel(mod){return labelFor(hz(mod))}",
 "function valueLabel(mod){return labelFor(hz(mod))}" + NL +
 "/* Whose projection sits on the far side of the disagreement panel. The board it is" + NL +
 "   measured against is OURS, so the provider has to be named or the chart reads as a" + NL +
 "   verdict on the player instead of a disagreement between two sources. */" + NL +
 "function provName(){return state&&state.ref&&state.ref.provider==='espn'?'ESPN':'Sleeper'}"
),
# 2 -- panel title
(
 "<summary><b>Where the projection disagrees with the market</b>",
 '<summary><b>Where <span id="mnProvName">the provider</span> and Data Dawgs ranks disagree</b>'
),
# 3 -- standfirst
(
 "Optional. Market value against projected points over replacement",
 "Optional. Data Dawgs ranks against the provider's own projected points over replacement"
),
# 4 -- left axis label
(
 ">market rates him higher</text>'",
 ">Data Dawgs rate him higher</text>'"
),
# 5 -- right axis label, now named
(
 ">projection rates him higher</text>';",
 ">'+esc(provName())+' rates him higher</text>';"
),
# 6 -- fill the title span when the panel paints
(
 "  const rich=shown.filter(p=>p.d>0).length;",
 "  const rich=shown.filter(p=>p.d>0).length;" + NL +
 "  if($('mnProvName'))$('mnProvName').textContent=provName();"
),
# 7 -- the no-rate sentence
(
 "? 'No player here projects above replacement, so the projection cannot be put in dollars.'",
 "? 'No player here projects above replacement, so '+esc(provName())+'" + ESC_RSQ + "s projection cannot be put in dollars.'"
),
# 8 -- name whose projection is being converted
(
 "biggest gap first. The projection is converted at the league-wide rate",
 "biggest gap first. '+esc(provName())+'" + ESC_RSQ + "s projection is converted at the league-wide rate"
),
# 9 -- the board is ours, not a market
(
 "+' the market puts on '+rateRows.length+",
 "+' Data Dawgs put on '+rateRows.length+"
),
# 10 -- "the projection rates higher" in the same paragraph
(
 "+rich+' the projection rates higher. '",
 "+rich+' '+esc(provName())+' rates higher. '"
),
# 11 -- closing sentence: a disagreement, not a judgement
(
 "+'This is about the projection ",
 "+'This is a disagreement between two sources, not a judgement on a buy "
),
]

s = PAGE.read_text(encoding="utf-8")
applied = present = 0
for old, new in EDITS:
    if new in s:
        present += 1
        continue
    n = s.count(old)
    assert n == 1, "anchor is not unique (%d matches): %.80s" % (n, old)
    s = s.replace(old, new, 1)
    applied += 1

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-warroom-dd-labels: %d edit(s) applied, %d already present" % (applied, present))
