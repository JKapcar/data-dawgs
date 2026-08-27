"""
One league, one door: the dashboard's league identity is consistent however you arrive.

The bug, reported the day before the draft: nav -> dashboard.html (bare) showed a GENERIC
five-column cheat sheet, while dashboard.html?league=pepperoninipples showed the
league-priced one. Same room, two boards. Root cause: DDLeague.id is URL-only, but the
live sync separately falls back to DEFAULT.room ("pepperoninipples") — so the live view
connected to the league while the embedded views were never told which league they were
in. The page was half league-aware.

Heal, not redesign (draft is tomorrow):

1. The iframes get the league from DDLeague.id OR, failing that, the resolved sync room —
   the identity the live view is already connecting to — validated against LEAGUE_RE so a
   junk room name cannot become a bogus param. The address bar is then canonicalized with
   replaceState, so a refresh, a bookmark, or a shared link all land on the ONE door.

2. "League setup →" is relabelled "Switch league →": it goes to the leagues directory
   (create/join/pick), not to settings for the current league, and the old label promised
   the opposite.

3. draft-leagues.html gets a way back. It had none: arriving from the dashboard was a
   one-way trip, which is most of why it read as confusing.

    cd work && py patch-dash-one-door.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent

# ---- 1. dashboard: one identity for every frame ----------------------------
p = REPO / "dashboard.html"
s = p.read_text(encoding="utf-8")

old = ('  if(window.DDLeague && DDLeague.id) Object.values(VIEWS).forEach(v=>{ const u=new URL(v.src,location.href); '
       'u.searchParams.set("league",DDLeague.id); v.src=u.pathname.slice(1)+u.search; });')
new = r'''  /* ⚠ ONE DOOR. DDLeague.id is URL-only, but the live sync falls back to a default room
     — so bare dashboard.html used to connect the live view to the league while every
     embedded view rendered league-blind. Whatever identity the live view will use, the
     frames get too, and the address bar is canonicalized so refreshes and bookmarks all
     land on the same URL. LEAGUE_RE guards the fallback: a room name that is not a valid
     league id must not become a bogus param. */
  const LEAGUE_ID = (window.DDLeague && DDLeague.id)
    || (window.DDSync && DDLeague && DDLeague.LEAGUE_RE
        && DDLeague.LEAGUE_RE.test((DDSync.config||{}).room||"") ? DDSync.config.room : null);
  if(LEAGUE_ID){
    Object.values(VIEWS).forEach(v=>{ const u=new URL(v.src,location.href); u.searchParams.set("league",LEAGUE_ID); v.src=u.pathname.slice(1)+u.search; });
    if(!new URLSearchParams(location.search).get("league")){
      const canon=new URL(location.href); canon.searchParams.set("league",LEAGUE_ID);
      try{ history.replaceState(null,"",canon); }catch(e){}
    }
  }'''
assert s.count(old) == 1, "iframe append line"
s = s.replace(old, new, 1)

old = '<a class="dbsetup" href="draft-leagues.html">League setup &rarr;</a>'
new = '<a class="dbsetup" href="draft-leagues.html">Switch league &rarr;</a>'
assert s.count(old) == 1, "setup label"
s = s.replace(old, new, 1)

p.write_text(s, encoding="utf-8", newline=NL)

# ---- 2. the leagues page gets a way back ------------------------------------
p = REPO / "draft-leagues.html"
s = p.read_text(encoding="utf-8")
old = "<h1>Your draft. Your league.</h1>"
new = ('<p style="margin:0 0 10px"><a href="dashboard.html" '
       'style="color:var(--orange);text-decoration:none;font-weight:700">&larr; Back to the Draft Dashboard</a></p>' + NL
       + "  " + old)
assert s.count(old) == 1, "leagues h1"
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8", newline=NL)

print("patch-dash-one-door: ok")
