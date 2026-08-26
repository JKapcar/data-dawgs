"""
Turn the disagreement gap into a trade edge with a direction.

PREMISE, and it is an assumption about the humans rather than a measurement: most of this
league prices off the provider's own projection (ESPN here). If that holds, the gap between
the provider and the Data Dawgs board is not a scorecard -- it is arbitrage, and the sign
says which side of the trade to be on:

    d > 0   provider is HIGH on him  -> the room overpays  -> SELL, if you own him
    d < 0   provider is LOW  on him  -> the room discounts -> BUY, from whoever owns him

So the sell side is drawn from YOUR roster and the buy side from everyone else's. That is
the opposite scope from every other card on this sheet, and it is the point: the buy side
of an arbitrage never lives on your own roster.

    cd work && py patch-warroom-arbitrage.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "fantasy-warroom.html"

CARDS = r'''      <article class="wr-card">
        <h3>Sell high</h3>
        <p class="wr-note" id="mnSellNote"></p>
        <div class="wr-srlist" id="mnSell"></div>
      </article>
      <article class="wr-card">
        <h3>Buy low</h3>
        <p class="wr-note" id="mnBuyNote"></p>
        <div class="wr-srlist" id="mnBuy"></div>
      </article>
'''

JS = r'''  /* ---- arbitrage against a room that prices off the provider ------------------
     The gap above is descriptive. This is the same number read as a trade edge, and it
     only means anything if the league actually prices off the provider -- an ASSUMPTION
     about the humans, not something the data shows. It is stated on the cards rather
     than buried here.
     Scope is deliberately inverted: sell from YOUR roster, buy from everyone else's.
     A buy target on your own bench is not a trade.
     y>0 ON BOTH SIDES. A player the provider puts at or below replacement clamps to $0
     implied, so his d is just -mv and he would top the buy list without the provider
     having formed any opinion about him at all. That is a coverage hole in the
     conversion, not a bargain, and it would make the best-looking targets the ones we
     know least about.
     Reads `all`, not `shown`: the filter above scopes the chart, but an edge that exists
     on only one roster is not an edge.
     Does NOT call dollars(): that helper is a `const` declared LATER in this same
     function, so calling it from here is a temporal-dead-zone ReferenceError that takes
     the whole Money sheet down. fmt$ is a hoisted function declaration and is safe.
     Wrapped for the same reason -- these cards are additive and must never be able to
     break the sheet they sit on. */
  try{
    const myTi=+$('teamPicker').value||0;
    const arbRow=(p,own)=>'<div class="sr"><span class="p">'+esc(p.name)+'</span>'
      +'<span class="t">'+(own?esc(p.pos):esc(p.team)+' · '+esc(p.pos))+' · '
      +esc(provName())+' '+fmt$(p.y)+' · Data Dawgs '+fmt$(p.x)+'</span>'
      +'<span class="'+(p.d>=0?'wr-up':'wr-down')+'">'+(p.d>=0?'+':'−')+fmt$(Math.abs(p.d))+'</span></div>';
    const sell=all.filter(p=>p.y>0&&p.d>0&&p.ti===myTi).sort((a,b)=>b.d-a.d);
    const buy=all.filter(p=>p.y>0&&p.d<0&&p.ti!==myTi).sort((a,b)=>a.d-b.d);
    $('mnSell').innerHTML=sell.length?sell.slice(0,10).map(p=>arbRow(p,true)).join('')
      :'<p class="wr-note">'+esc(provName())+' is not high on anyone you own, so there is nothing to sell into.</p>';
    $('mnBuy').innerHTML=buy.length?buy.slice(0,10).map(p=>arbRow(p,false)).join('')
      :'<p class="wr-note">'+esc(provName())+' is not low on anyone worth targeting.</p>';
    $('mnSellNote').textContent='Your players '+provName()+' rates ABOVE the board. If the room prices off '
      +provName()+', these are the ones it will overpay for — which assumes it does.'
      +(sell.length>10?' Top 10 of '+sell.length+'.':'');
    $('mnBuyNote').textContent='Players on OTHER rosters that '+provName()+' rates below the board, owner shown. '
      +'League-wide — the team filter above does not apply here.'
      +(buy.length>10?' Top 10 of '+buy.length+'.':'');
  }catch(err){
    console.error('arbitrage cards:',err);
    const oops='<p class="wr-note">These could not be built for this league.</p>';
    if($('mnSell'))$('mnSell').innerHTML=oops;
    if($('mnBuy'))$('mnBuy').innerHTML=oops;
  }
'''

ANCHOR_CARDS = '        <div class="wr-srlist" id="mnWorst"></div>' + NL + '      </article>' + NL
ANCHOR_JS = "  const gaps=shown.filter(p=>p.y>0).sort((x,y)=>Math.abs(y.d)-Math.abs(x.d)).slice(0,14);"

EDITS = [
 (ANCHOR_CARDS, ANCHOR_CARDS + CARDS),
 (ANCHOR_JS, ANCHOR_JS + NL + JS),
]

s = PAGE.read_text(encoding="utf-8")
applied = present = 0
for old, new in EDITS:
    if new in s:
        present += 1
        continue
    n = s.count(old)
    assert n == 1, "anchor is not unique (%d matches): %.70s" % (n, old)
    s = s.replace(old, new, 1)
    applied += 1

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-warroom-arbitrage: %d edit(s) applied, %d already present" % (applied, present))
