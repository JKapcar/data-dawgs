"""
Cheat sheet: a league profile for pepperoninipples — one price, priced for THIS league.

The board showed five generic auction columns and bolded the closest one. For a 14-team
custom-scoring league every one of them is noise: the right number is the league-adjusted
value work/build-ppn-values.mjs bakes into the pool as `lg`. When the board is opened with
?league=pepperoninipples it now shows ONLY that column, drops kickers entirely (this league
has no K slot — a kicker is worth $0 here, and a $1 column would say otherwise), sorts by
it, and explains its own method and holes in the intro.

Everything is gated on the URL param, which the dashboard already appends to every embedded
view. No stored room state is touched — this must not write anything on draft day.

    cd work && py patch-board-ppn.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "board.html"
s = PAGE.read_text(encoding="utf-8")

# ---- 1. card CSS: lg behaves like the other money keys ----------------------
old = "#board td[data-c=half14],#board td[data-c=half],#board td[data-c=full],#board td[data-c=sfhalf12],#board td[data-c=sf]{order:11;"
new = "#board td[data-c=half14],#board td[data-c=half],#board td[data-c=full],#board td[data-c=sfhalf12],#board td[data-c=sf],#board td[data-c=lg]{order:11;"
assert s.count(old) == 1, "hide list"
s = s.replace(old, new, 1)

old = '  #board td[data-c=sf]::after{content:" SF";color:var(--ink-3)}'
new = old + NL + '  #board td[data-c=lg]::after{content:" PPN";color:var(--ink-3)}'
assert s.count(old) == 1, "suffix list"
s = s.replace(old, new, 1)

# ---- 2. the profile: columns, sort, chrome ---------------------------------
old = 'const MONEY_KEYS=["half14","half","full","sfhalf12","sf"];'
new = old + NL + r'''/* ---- league profile: pepperoninipples (Yahoo 773763) ------------------------
   14-team half PPR with custom scoring and NO KICKER SLOT. `lg` is baked into the pool
   by work/build-ppn-values.mjs: the half14 market value re-priced by each player's
   VOR ratio under this league's scoring vs the generic sheet the market priced.
   Gated on the URL param the dashboard already appends — nothing stored changes. */
const LGP = new URLSearchParams(location.search).get("league")==="pepperoninipples";
if(LGP){
  for(let i=COLS.length-1;i>=0;i--) if(MONEY_KEYS.includes(COLS[i].key)) COLS.splice(i,1);
  COLS.splice(4,0,{key:"lg",label:"$ PPN 14t",sortable:true});
  MONEY_KEYS.length=0; MONEY_KEYS.push("lg");
  state.sort={key:"lg",dir:-1};
  /* no K slot in this league: the chip would filter to a page of $0 rows */
  const kb=document.querySelector('#posChips .chip[data-v="K"], .chip[data-v="K"]'); if(kb) kb.remove();
  const so=document.getElementById("msortKey");
  if(so){
    ["half","half14","full","sfhalf12","sf"].forEach(v=>{const o=so.querySelector('option[value="'+v+'"]'); if(o) o.remove();});
    const o=document.createElement("option"); o.value="lg"; o.textContent="$ PPN";
    so.insertBefore(o, so.children[1]||null);
  }
  const intro=document.querySelector(".bd-intro");
  if(intro) intro.innerHTML='Priced for <b>this league</b> — 14-team Half PPR, custom scoring (+.25/completion, −.5/incompletion, 20 pass yds/pt, −2.5 INT, −1/sack, +.25 per rushing and receiving first down, 40-yard play bonuses), lineup QB/2RB/2WR/TE/2FLEX/DEF. <b>No kicker slot — kickers are $0 here.</b> <b>$ PPN</b> = the personal board (updated Aug 27, 2026) converted to this room: each price is its premium over the $1 floor plus the shift in value-over-replacement between the board&rsquo;s generic 12-team room and this one, from Sleeper season projections captured Aug 27, with sacks from per-QB 2025 rates (nflverse) shrunk to the position median and 40-yard run/completion bonuses at position means. Every priced player holds a $1 floor and only the cash above the reserve is distributed, so the top of the board is compressed on purpose. Prices were stress-tested at half and 1.5x the scoring adjustment and cross-checked against an independent build — top-20 agreement within $2. Still not modeled: return yards, pick-sixes thrown, Yahoo&rsquo;s whole-point rounding. Net effect: volume RB/WR gain (first downs), and elite QBs hold value while replacement QBs crater — the sack and INT penalties punish bad quarterbacking hardest, so the middle QB tier is where the discount lives.';
}'''
assert s.count(old) == 1, "money keys"
s = s.replace(old, new, 1)

# ---- 3. the bold column follows the profile --------------------------------
old = '  const SCORING = MONEY_KEYS.includes(A.scoring) ? A.scoring : "half";'
new = '  const SCORING = LGP ? "lg" : (MONEY_KEYS.includes(A.scoring) ? A.scoring : "half");'
assert s.count(old) == 1, "scoring pick"
s = s.replace(old, new, 1)

# ---- 4. no kicker rows in this league --------------------------------------
old = "    if(state.tagOnly && !(r.tags&&r.tags.length)) return false;"
new = ("    if(LGP && r.pos===\"K\") return false;   // no K slot: a kicker is not draftable here" + NL + old)
assert s.count(old) == 1, "row filter"
s = s.replace(old, new, 1)

# ---- 5. one money cell in profile, five otherwise --------------------------
old = '''      ["$"+(+r.half14||0),false,SCORING==="half14"],
      ["$"+(+r.half||0),false,SCORING==="half"],
      ["$"+(+r.full||0),false,SCORING==="full"],
      ["$"+(+r.sfhalf12||0),false,SCORING==="sfhalf12"],
      ["$"+(+r.sf||0),  false,SCORING==="sf"],'''
new = '''      ...(LGP ? [["$"+(+r.lg||0),false,true]] : [
      ["$"+(+r.half14||0),false,SCORING==="half14"],
      ["$"+(+r.half||0),false,SCORING==="half"],
      ["$"+(+r.full||0),false,SCORING==="full"],
      ["$"+(+r.sfhalf12||0),false,SCORING==="sfhalf12"],
      ["$"+(+r.sf||0),  false,SCORING==="sf"]]),'''
assert s.count(old) == 1, "money cells"
s = s.replace(old, new, 1)

old = '    const CKEY=["rk","name","pos","team","half14","half","full","sfhalf12","sf","silva"];'
new = '    const CKEY=LGP?["rk","name","pos","team","lg","silva"]:["rk","name","pos","team","half14","half","full","sfhalf12","sf","silva"];'
assert s.count(old) == 1, "ckey"
s = s.replace(old, new, 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-board-ppn: ok")
