#!/usr/bin/env python3
"""Choosing your team becomes the first step after linking a league.

Reported 2026-08-16: "I am not the Receipt. We have the wrong teams loaded
for me." The page had guessed roster 0 and then printed a confident A- for
somebody else's roster — a wrong number displayed boldly, which is worse
than no number. The picker existed, but it sat below the grade it should
have preceded.

Now the choice gates the analysis. When a league is connected and no team
has been confirmed for it, the Overview shows one card — every team in the
league as a one-tap chip — and every team-specific surface on every sheet
stays hidden. No grade, no radar, no trade list computed for a roster that
might not be yours. One tap sets it, saves it to the league shelf (and
through the account sync, to every signed-in device), and the whole page
renders at once.

The chips carry the roster's starter count and player count, so a manager
who does not remember their team name can still recognise their roster.
The gate sits above the league-management card: after linking, the very next
thing on screen is the choice. The nudge under the Receipt heading is redundant
now and goes.

Anchor-based, idempotent.
"""

PATH = "../fantasy-warroom.html"
edits = [
    # markup: the gate card, between the league hub and the first team-specific grid
    ("""<section id="sheetReport">""",
     """<section id="sheetReport">
  <article class="wr-card wr-full wr-gate wr-hide" id="teamGate">
    <h2 id="gateTitle">Which team is yours?</h2>
    <p class="wr-note" id="gateNote">Pick it once. Everything on this page is measured against it, so nothing is calculated until you do.</p>
    <div class="wr-chips" id="gateChips"></div>
  </article>""", 'id="teamGate"'),

    # the nudge is superseded by the gate
    ("""          <p class="wr-note wr-nudge wr-hide" id="rcNudge">Guessed at your team — tap the name above to set yours. Saved per league.</p>\n""",
     "", ""),

    # CSS
    (".wr-nudge{color:var(--accent);font-weight:650}",
     ".wr-gate{border-color:color-mix(in srgb,var(--accent) 45%,var(--grid));"
     "background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 7%,var(--surface-1)),var(--surface-1) 58%)}\n"
     ".wr-gate h2{font-size:clamp(20px,3vw,27px)}\n"
     ".wr-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr));gap:9px;margin-top:15px}\n"
     ".wr-teamchip{display:block;width:100%;text-align:left;border:1px solid var(--grid);border-radius:11px;"
     "padding:11px 13px;background:var(--page);color:var(--ink-1);cursor:pointer;font:inherit;"
     "transition:transform .09s ease,border-color .09s ease,background .09s ease}\n"
     ".wr-teamchip b{display:block;font-size:15px;font-weight:750;letter-spacing:-.01em;overflow-wrap:anywhere}\n"
     ".wr-teamchip small{display:block;margin-top:3px;font-size:11px;color:var(--ink-3)}\n"
     ".wr-teamchip:hover,.wr-teamchip:focus-visible{border-color:var(--accent);"
     "background:color-mix(in srgb,var(--accent) 10%,var(--page));transform:translateY(-1px);outline:none}\n"
     ".wr-teamchip:active{transform:translateY(0)}\n"
     "@media(prefers-reduced-motion:reduce){.wr-teamchip{transition:none}.wr-teamchip:hover{transform:none}}", ".wr-teamchip{"),

    # renderReport no longer drives the nudge
    ("""  $('rcNudge').classList.toggle('wr-hide',!state.focusGuessed);""",
     "", ""),

    # the gate is painted, and gates every team-specific surface
    ("""function setLoaded(on){
  document.querySelectorAll('.wr-has-league').forEach(el=>el.classList.toggle('wr-hide',!on));""",
     """/* One card, every team in the league, one tap. Painted only while the team is
   unconfirmed — see setLoaded, which hides every team-specific surface until then. */
function paintTeamGate(){
  const gate=$('teamGate'),show=!!state&&state.focusGuessed===true;
  gate.classList.toggle('wr-hide',!show);
  if(!show)return;
  $('gateTitle').textContent='Which team is yours in '+state.league.name+'?';
  $('gateChips').innerHTML=state.teams.map((t,i)=>{
    const {starters}=chooseStarters(t.players,state.slots);
    return '<button type="button" class="wr-teamchip" data-team-index="'+i+'">'
      +'<b>'+esc(t.name)+'</b><small>'+starters.length+' starters · '+t.players.length+' rostered</small></button>';
  }).join('');
  $('gateChips').querySelectorAll('[data-team-index]').forEach(b=>{
    b.onclick=()=>{
      $('teamPicker').value=b.dataset.teamIndex;
      tradeFilter=null;
      saveFocus();          /* clears focusGuessed and persists the choice */
      render();
      setLoaded(true);
      $('strip').scrollIntoView({block:'start',behavior:'smooth'});
    };
  });
}

function setLoaded(on){
  /* ⚠️ A grade for a roster that might not be yours is worse than no grade. Every
     team-specific surface stays hidden until the team is confirmed for this league. */
  const ready=on&&!(state&&state.focusGuessed);
  document.querySelectorAll('.wr-has-league').forEach(el=>el.classList.toggle('wr-hide',!ready));""", "function paintTeamGate"),

    ("""  paintStations();paintShelf();paintSwitch();""",
     """  paintTeamGate();paintStations();paintShelf();paintSwitch();""", "  paintTeamGate();paint"),
]

# ⚠️ "Is this already applied?" cannot be answered with `new in s` when the
# replacement CONTAINS its own anchor (the gate markup ends with the anchor it
# replaced) — that reads as applied AND as matchable, and re-runs duplicate the
# block. Every edit therefore carries an explicit sentinel that exists only in
# the applied state.
s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new, sentinel in edits:
    if (sentinel in s) if sentinel else (old not in s):
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-team-gate: {changed} edit(s) applied, {len(edits)-changed} already present")
