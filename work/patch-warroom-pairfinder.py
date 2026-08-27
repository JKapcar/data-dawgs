"""
Part 2: surface the trades the room's own valuation calls fair.

Part 1 gave two lists -- sell high (yours, the provider is high on him) and buy low
(theirs, the provider is low on him). This pairs them.

A trade clears only if BOTH hold:
  1. the provider prices the two sides within a hair of each other, so a manager who
     values players off the provider sees an even swap and has no reason to refuse;
  2. the Data Dawgs board says the player coming back is worth materially more.

That is the whole edge. It is not "who is better" -- it is a disagreement between two
valuations that the counterparty cannot see, because he is using one of them.

WHAT THIS DELIBERATELY DOES NOT DO: it does not run the lineup or slot tests. The Trades
sheet owns those, and re-implementing them here would be a second implementation of a rule
that already exists once. A pair listed here can still be illegal (leaves a slot unfilled)
or useless (both your starters). The note says so; the Trades sheet is where a proposal
gets checked.

    cd work && py patch-warroom-pairfinder.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "fantasy-warroom.html"

CARD = r'''      <article class="wr-card wr-full">
        <h3>Trades the room should call fair</h3>
        <p class="wr-note" id="mnPairNote"></p>
        <div class="wr-srlist" id="mnPairs"></div>
      </article>
'''

JS = r'''    /* ---- pairs: even to the provider, lopsided on the board ------------------
       FAIR is deliberately generous at the low end. A flat percentage makes $4-vs-$6
       "unfair" at 50% when in auction terms nobody would blink, so the tolerance is the
       larger of $3 and 15%. Too tight and the list is empty on a normal roster; too
       loose and it proposes swaps the counterparty can see are bad.
       One row per player of yours -- his best target -- rather than the raw cross
       product, which would otherwise fill the card with the same name ten times. */
    const FAIR=(a,b)=>Math.abs(a-b)<=Math.max(3,0.15*Math.max(a,b));
    const pairs=[];
    sell.forEach(mine=>{
      let best=null;
      buy.forEach(theirs=>{
        if(!FAIR(mine.y,theirs.y))return;
        const gain=theirs.x-mine.x;          /* board value received minus board value sent */
        if(gain<=2)return;                   /* has to actually be worth doing */
        if(!best||gain>best.gain)best={theirs,gain};
      });
      if(best)pairs.push({mine,theirs:best.theirs,gain:best.gain});
    });
    pairs.sort((a,b)=>b.gain-a.gain);
    $('mnPairs').innerHTML=pairs.length?pairs.slice(0,8).map(p=>
      '<div class="sr"><span class="p">'+esc(p.mine.name)+' → '+esc(p.theirs.name)+'</span>'
      +'<span class="t">send '+esc(p.mine.name)+' ('+fmt$(p.mine.x)+') · get '+esc(p.theirs.name)
      +' ('+fmt$(p.theirs.x)+') from '+esc(p.theirs.team)+' · '+esc(provName())+' calls it '
      +fmt$(p.mine.y)+' vs '+fmt$(p.theirs.y)+'</span>'
      +'<span class="wr-up">+'+fmt$(p.gain)+'</span></div>').join('')
      :'<p class="wr-note">No pair is both even to '+esc(provName())+' and better on the board right now.</p>';
    $('mnPairNote').textContent='Swaps '+provName()+' prices as even — within $3 or 15% — where the board says '
      +'you gain. One row per player of yours, his best target. '
      +'These are NOT checked for lineup or slot legality: the Trades sheet does that, and a pair here '
      +'can still leave a slot unfilled. It also assumes the other manager prices off '+provName()+'.'
      +(pairs.length>8?' Top 8 of '+pairs.length+'.':'');
'''

ANCHOR_CARD = '        <div class="wr-srlist" id="mnBuy"></div>' + NL + '      </article>' + NL
ANCHOR_JS = "      +(buy.length>10?' Top 10 of '+buy.length+'.':'');"

EDITS = [
 (ANCHOR_CARD, ANCHOR_CARD + CARD),
 (ANCHOR_JS, ANCHOR_JS + NL + JS),
]

s = PAGE.read_text(encoding="utf-8")
applied = present = 0
for old, new in EDITS:
    if new in s:
        present += 1
        continue
    n = s.count(old)
    assert n == 1, "anchor not unique (%d): %.70s" % (n, old)
    s = s.replace(old, new, 1)
    applied += 1

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-warroom-pairfinder: %d applied, %d already present" % (applied, present))
