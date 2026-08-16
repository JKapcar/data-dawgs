#!/usr/bin/env python3
"""War room: make "whose team is this?" obvious and one-tap.

User report (2026-08-16, The Kayfabe Dynasty): the Receipt graded the wrong
roster and nothing on the Overview said how to change it. pickMyTeam falls
back to roster 0 when there is no saved focus and no display-name match, and
the only picker lived on the Standings sheet.

Changes:
1. The Receipt's team name becomes the picker: an h2-styled <select> with a
   dashed accent underline and caret, so the title itself is the control.
   Changing it saves focusRosterId to the shelf (and the account, signed in).
2. When the page GUESSED the roster (fallback 0, no match), a one-line nudge
   under the name says so and asks the user to set it. Picking any team, on
   either picker, clears the nudge permanently for that league.

Anchor-based, idempotent (skips any edit whose new text is already present).
"""

PATH = "../fantasy-warroom.html"
edits = [
    # 1 — markup: title becomes the picker, nudge line beneath
    ("""          <h2 id="rcTeam">—</h2>""",
     """          <h2 class="wr-teamh2"><select id="rcTeamSel" aria-label="Your team in this league"><option>—</option></select></h2>
          <p class="wr-note wr-nudge wr-hide" id="rcNudge">Guessed at your team — tap the name above to set yours. Saved per league.</p>"""),

    # 2 — CSS for the h2-select, its caret, and the nudge
    (".wr-radarcard .rf{font-size:11px;color:var(--ink-3);margin-top:3px}",
     ".wr-radarcard .rf{font-size:11px;color:var(--ink-3);margin-top:3px}\n"
     ".wr-teamh2{margin:0;position:relative;display:inline-block;max-width:100%}\n"
     ".wr-teamh2::after{content:\"\\25be\";color:var(--accent);position:absolute;right:4px;top:50%;transform:translateY(-52%);pointer-events:none;font-size:.65em}\n"
     ".wr-teamh2 select{appearance:none;-webkit-appearance:none;font:inherit;font-weight:800;letter-spacing:-.02em;color:inherit;background:transparent;border:0;border-bottom:2px dashed color-mix(in srgb,var(--accent) 55%,transparent);border-radius:0;padding:0 26px 3px 2px;cursor:pointer;max-width:100%}\n"
     ".wr-teamh2 select:hover,.wr-teamh2 select:focus-visible{border-bottom-color:var(--accent);outline:none}\n"
     ".wr-nudge{color:var(--accent);font-weight:650}"),

    # 3 — pickMyTeam records whether it guessed
    ("""function pickMyTeam(teams,ref,users){
  const saved=readShelf().find(x=>x.provider===ref.provider&&x.leagueId===String(ref.id));
  if(saved&&saved.focusRosterId!=null){const i=teams.findIndex(t=>String(t.id)===String(saved.focusRosterId));if(i>=0)return i}
  const wanted=myName().trim().toLowerCase();
  if(wanted&&users){
    const u=users.find(x=>[x.display_name,x.metadata?.team_name].some(v=>String(v||'').trim().toLowerCase()===wanted));
    if(u){const i=teams.findIndex(t=>String(t.ownerId)===String(u.user_id));if(i>=0)return i}
  }
  return 0;
}""",
     """function pickMyTeam(teams,ref,users){
  state.focusGuessed=false;
  const saved=readShelf().find(x=>x.provider===ref.provider&&x.leagueId===String(ref.id));
  if(saved&&saved.focusRosterId!=null){const i=teams.findIndex(t=>String(t.id)===String(saved.focusRosterId));if(i>=0)return i}
  const wanted=myName().trim().toLowerCase();
  if(wanted&&users){
    const u=users.find(x=>[x.display_name,x.metadata?.team_name].some(v=>String(v||'').trim().toLowerCase()===wanted));
    if(u){const i=teams.findIndex(t=>String(t.ownerId)===String(u.user_id));if(i>=0)return i}
  }
  state.focusGuessed=true;
  return 0;
}"""),

    # 4 — renderReport drives the picker instead of static text
    ("""  $('rcTeam').textContent=me.name;""",
     """  $('rcTeamSel').innerHTML=state.teams.map((t,i)=>'<option value="'+i+'"'+(t===me?' selected':'')+'>'+esc(t.name)+'</option>').join('');
  $('rcNudge').classList.toggle('wr-hide',!state.focusGuessed);"""),

    # 5 — an explicit pick, from either picker, is a decision: persist and stop nudging
    ("""function saveFocus(){
  if(!state)return;""",
     """function saveFocus(){
  if(!state)return;
  state.focusGuessed=false;"""),

    # 6 — wire the Receipt picker to the existing flow
    ("""$('teamPicker').onchange=()=>{
  tradeFilter=null;
  saveFocus();
  render();
};""",
     """$('teamPicker').onchange=()=>{
  tradeFilter=null;
  saveFocus();
  render();
};
$('rcTeamSel').onchange=e=>{
  $('teamPicker').value=e.target.value;
  tradeFilter=null;
  saveFocus();
  render();
};"""),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new in edits:
    if new in s:
        continue  # already applied (old may be a substring of new — never re-apply)
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-team-picker: {changed} edit(s) applied, {len(edits)-changed} already present")
