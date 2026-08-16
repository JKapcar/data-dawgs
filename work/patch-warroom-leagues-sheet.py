#!/usr/bin/env python3
"""My Team opens with your team, not with league admin.

After the nav rebuild the first tab is called "My Team" and the first thing
on it was still the league-management card — add a league, the saved shelf,
four league cards — pushing the grade below the fold. A tab named for your
team should open on your team.

League management becomes its own sheet, reached from the two places you
would look for it: "＋ Add a league" and "Manage leagues" at the foot of the
league menu, which is where you already are when you are thinking about
leagues. It is deliberately NOT a tab — managing leagues is not a view of
your team, and the whole point of the rebuild was to stop mixing those.

The empty state moves with it: with nothing connected, the page opens on
Leagues, because there is nothing else it could honestly show.

Anchor-based, idempotent (explicit sentinels).
"""

PATH = "../fantasy-warroom.html"

HUB = '''  <div class="wr-leaguehub">
    <div class="wr-leaguehead">
      <div><h2>Your fantasy leagues</h2><p>Add once. Open or switch anytime.</p></div>
      <span class="wr-sync" id="shelfState">Checking saved leagues…</span>
    </div>
    <div class="wr-connect">
      <form id="connectForm">
        <input id="leagueInput" inputmode="url" autocomplete="url" placeholder="Paste a Sleeper league URL or ID" aria-label="League URL or Sleeper ID">
        <button class="wr-btn">Add league</button>
      </form>
      <p class="wr-status" id="connectionStatus">Sleeper leagues connect without a Sleeper login.</p>
    </div>
    <div class="wr-saved" id="savedList"></div>
  </div>

  <!-- No league: this sheet carries the "what is this room" job, so the page still explains
       itself before anything is connected. -->
  <div class="wr-grid wr-needs-league">
    <article class="wr-card wr-full">
      <h2>Start with a league</h2>
      <p>Connect above to see your team, dynasty position, and trade opportunities.</p>
      <div class="wr-stations wr-hide" id="stations"></div>
    </article>
  </div>
'''

edits = [
    # Lift the hub out of the report sheet. ⚠️ The sentinel is the DESTINATION, not
    # the absence of the anchor: once the move has happened the same markup exists
    # again inside #sheetLeagues, and a re-run deleted it from there.
    (HUB, "", 'id="sheetLeagues"'),

    # ...into their own sheet, declared just before the report sheet
    ('<section id="sheetReport">',
     '<!-- ========================== LEAGUES (admin) ========================== -->\n'
     '<section id="sheetLeagues" hidden>\n' + HUB + '</section>\n\n'
     '<section id="sheetReport">',
     'id="sheetLeagues"'),

    # register it
    ("  {id:'report',label:'My Team',panel:'#sheetReport'},",
     "  {id:'leagues',label:'Leagues',panel:'#sheetLeagues'},\n"
     "  {id:'report',label:'My Team',panel:'#sheetReport'},",
     "id:'leagues'"),

    # the league menu's two admin items point at it
    ('''    +'<button type="button" role="menuitem" data-sheet="report">\\uff0b Add a league</button>'
    +'<button type="button" role="menuitem" data-sheet="report">Manage leagues\\u2026</button>';''',
     '''    +'<button type="button" role="menuitem" data-sheet="leagues">\\uff0b Add a league</button>'
    +'<button type="button" role="menuitem" data-sheet="leagues">Manage leagues\\u2026</button>';''',
     'data-sheet="leagues">\\uff0b Add'),

    # every "manage your leagues" call to action follows the move (5 sheets carry one)
    (None, None, None),

    # leagues is an admin sheet, so it must not be remembered as the view to return to
    ("if(typeof lastLeagueSheet!=='undefined'&&!['all','settings','method'].includes(id))lastLeagueSheet=id;",
     "if(typeof lastLeagueSheet!=='undefined'&&!['all','settings','method','leagues'].includes(id))lastLeagueSheet=id;",
     "'method','leagues'].includes(id)"),

    # connecting from Leagues must land on My Team, where the team gate lives
    ("  try{await connect($('leagueInput').value);st.className='wr-status good';st.textContent=readShelf().length+' league'+(readShelf().length===1?'':'s')+' saved. This league is open now.';$('leagueInput').value=''}",
     '  try{await connect($(\'leagueInput\').value);st.className=\'wr-status good\';st.textContent=readShelf().length+\' league\'+(readShelf().length===1?\'\':\'s\')+\' saved. This league is open now.\';$(\'leagueInput\').value=\'\';\n    /* ⚠️ Connecting from the Leagues sheet used to leave you there, so the\n       "which team is yours" gate — which lives on My Team — never came into\n       view and the league looked connected but inert. */\n    SHEETS.show(\'report\');window.scrollTo({top:0,behavior:\'smooth\'})}',
     "never came into"),

    # with nothing connected there is nothing honest to show on My Team
    ("SHEETS=DDSheets({key:'warroom',mount:'#sheets',sheets:[",
     "/* Nothing connected means nothing to analyse: open on Leagues rather than an\n"
     "   empty My Team. */\n"
     "if(!readShelf().length&&!location.search.includes('league='))setTimeout(()=>SHEETS&&SHEETS.show('leagues'),0);\n"
     "SHEETS=DDSheets({key:'warroom',mount:'#sheets',sheets:[",
     "open on Leagues rather than an"),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new, sentinel in edits:
    if old is None:
        n = s.count('data-sheet="report">Manage your leagues')
        if n:
            s = s.replace('data-sheet="report">Manage your leagues', 'data-sheet="leagues">Manage your leagues')
            changed += 1
        continue
    if (sentinel in s) if sentinel else (old not in s):
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new, 1)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-leagues-sheet: {changed} edit(s) applied, {len(edits)-changed} already present")
