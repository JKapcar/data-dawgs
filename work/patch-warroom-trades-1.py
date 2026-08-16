#!/usr/bin/env python3
"""Trade finder: give the swap a shape, and unclip the sheet selects.

1. Twenty-five candidate swaps rendered as twenty-five identical paragraphs
   with the rival's name as the loudest element in each row. The rival is
   context; the trade is the point, and the number that ranks the list —
   your lineup gain — was buried mid-sentence in the same 13px grey as the
   prices. Rows are now a two-column layout: the swap on the left with the
   rival as a small chip above it, the gain as a right-aligned figure that
   the eye can run down. The sort order finally looks like a sort order.

   Nothing about which trades qualify changed — same three gates, same
   ranking, same rejection counts.

2. The two sheet selects in the flow bar carried max-width:150px while
   using native appearance, so the platform's arrow sat on top of the last
   characters: "League analysis" rendered clipped at the s. The cap is gone
   and the arrow gets its own right pad. The pill buttons beside them keep
   their symmetric padding — only the selects need the extra room.

Anchor-based, idempotent.
"""

PATH = "../fantasy-warroom.html"
edits = [
    # 2 — room for the native select arrow
    (".wr-flow select{max-width:150px}",
     ".wr-flow select{max-width:none;padding-right:26px}"),

    # 1 — row layout
    (".wr-trade{border-top:1px solid var(--grid);padding:13px 0;color:var(--ink-1)}",
     ".wr-trade{border-top:1px solid var(--grid);padding:13px 0;color:var(--ink-1);display:flex;gap:16px;align-items:flex-start}\n"
     ".wr-trade .tw{flex:1;min-width:0}\n"
     ".wr-trade .rival{display:inline-block;font:800 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);margin-bottom:5px}\n"
     ".wr-trade .swap{font-size:15px;line-height:1.4}\n"
     ".wr-trade .gain{flex:none;text-align:right;min-width:104px}\n"
     ".wr-trade .gain b{display:block;font-size:21px;font-weight:800;letter-spacing:-.03em;color:var(--good);line-height:1.1}\n"
     ".wr-trade .gain span{display:block;font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);margin-top:2px}\n"
     ".wr-trade .gain em{display:block;font-style:normal;font-size:11px;color:var(--ink-3);margin-top:6px}\n"
     "@media(max-width:560px){.wr-trade{flex-direction:column;gap:8px}.wr-trade .gain{text-align:left;min-width:0}\n"
     "  .wr-trade .gain b{display:inline}.wr-trade .gain span{display:inline;margin-left:5px}.wr-trade .gain em{display:inline;margin-left:8px}}"),

    ("""  $('trades').innerHTML=(rows.slice(0,25).map((x,i)=>'<div class="wr-trade"><strong>'+(i+1)+'. '+esc(x.o.name)+'</strong><div>You send <b>'+esc(x.give.name)+'</b> ('+x.give.pos+') \\u21c4 you get <b>'+esc(x.get.name)+'</b> ('+x.get.pos+')</div><div class="wr-note">'+priceOf(x)+' · Your lineup <span class="wr-up">+'+x.mine.toFixed(1)+'/wk</span> · Their lineup <span class="wr-up">+'+x.theirs.toFixed(1)+'/wk</span>'+(x.edge?' · <b class="wr-edge">'+x.edge+'</b>':'')+'</div></div>').join('')""",
     """  $('trades').innerHTML=(rows.slice(0,25).map((x,i)=>'<div class="wr-trade">'
    +'<div class="tw"><span class="rival">'+(i+1)+' · '+esc(x.o.name)+'</span>'
    +'<div class="swap">You send <b>'+esc(x.give.name)+'</b> ('+x.give.pos+') \\u21c4 you get <b>'+esc(x.get.name)+'</b> ('+x.get.pos+')</div>'
    +'<div class="wr-note">'+priceOf(x)+' · Their lineup <span class="wr-up">+'+x.theirs.toFixed(1)+'/wk</span>'
    +(x.edge?' · <b class="wr-edge">'+x.edge+'</b>':'')+'</div></div>'
    +'<div class="gain"><b>+'+x.mine.toFixed(1)+'</b><span>your lineup /wk</span></div></div>').join('')"""),
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
print(f"patch-warroom-trades-1: {changed} edit(s) applied, {len(edits)-changed} already present")
