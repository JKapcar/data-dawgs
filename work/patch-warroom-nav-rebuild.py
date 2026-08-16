#!/usr/bin/env python3
"""The nav stops asking you to learn it.

"I built this and I barely know how to navigate it." The row mixed three
unrelated things at one weight: WHICH LEAGUE you are looking at (context),
WHICH VIEW you want (navigation), and settings/method (utilities). Three of
the six real views — Standings, Rosters, Money — sat inside a dropdown
labelled "League analysis…", while "All leagues", which is the rare case,
took a full-size button beside them.

Sleeper and ESPN both separate those three jobs, and so does this now.

  CONTEXT BAR   the league you are in and the team you are, as the two
                biggest words on the page, each a menu. Then the single
                scope toggle — One league / All N — and a gear.
  TABS          six views, equal weight, all visible, plain one-word names.
                Underlined tabs rather than loose pills, so the row reads as
                one set of choices instead of six unrelated buttons.
  GEAR          Settings, Method, Disconnect. None of them are views, so
                none of them belong in a view switcher.

"＋ Add a league" and "Manage leagues" move to the foot of the league menu,
where you already are when you are thinking about leagues.

⚠️ #reset keeps its id on the Disconnect item inside the gear menu: the
forget-a-league handler calls $('reset').click() to drop a league that is
currently open, and moving the button without keeping the id would silently
break that path.

Scope 'all' hides the tabs rather than disabling them — nothing per-league
applies there, and a row of dead tabs is worse than no row.

This is Phase 1: navigation only. Separating "which team am I" from "which
team am I looking at" is Phase 2 and lands on top of this.

Anchor-based, idempotent (explicit sentinels).
"""

PATH = "../fantasy-warroom.html"

STRIP = '''<div class="wr-strip" id="strip">
  <span class="wr-dot"></span>
  <div class="wr-who">
    <div class="wr-whorow">
      <button type="button" class="wr-pick" id="leagueBtn" aria-haspopup="true" aria-expanded="false">No league connected</button>
      <span class="wr-youlab wr-hide" id="youLab">you are</span>
      <button type="button" class="wr-pick sm wr-hide" id="teamBtn" aria-haspopup="true" aria-expanded="false">&mdash;</button>
    </div>
    <div class="wr-meta" id="stripText">Add or open a league to begin.</div>
  </div>
  <div class="wr-stripright">
    <div class="wr-horizon" id="valueHorizon" role="group" aria-label="Value horizon">
      <button type="button" data-horizon="season">This season</button><button type="button" data-horizon="dynasty">Overall dynasty</button>
    </div>
    <div class="wr-seg wr-hide" id="scopeSeg" role="group" aria-label="Scope">
      <button type="button" data-scope="one" class="on">One league</button><button type="button" data-scope="all" id="scopeAll">All leagues</button>
    </div>
    <button type="button" class="wr-iconbtn" id="gearBtn" aria-haspopup="true" aria-expanded="false" aria-label="Settings and methodology">&#9881;</button>
  </div>
</div>

<nav class="wr-tabs" id="flowNav" aria-label="War Room views">
  <button type="button" data-flow="report" class="on">My Team</button>
  <button type="button" data-flow="standings">Standings</button>
  <button type="button" data-flow="rosters">Rosters</button>
  <button type="button" data-flow="money">Money</button>
  <button type="button" data-flow="trades">Trades</button>
  <button type="button" data-flow="dynasty" id="flowDynasty">Dynasty</button>
</nav>

<div class="wr-menu" id="leagueMenu" role="menu"></div>
<div class="wr-menu" id="teamMenu" role="menu"></div>
<div class="wr-menu" id="gearMenu" role="menu">
  <button type="button" data-sheet="settings">Settings</button>
  <button type="button" data-sheet="method">Method &amp; footnotes</button>
  <hr>
  <button type="button" class="danger" id="reset">Disconnect this league</button>
</div>
<div class="wr-scrim" id="wrScrim"></div>'''

CSS = '''/* ---- context bar, tabs and menus: three jobs, three treatments ---------- */
.wr-who{min-width:0;flex:1 1 260px}
.wr-whorow{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.wr-pick{appearance:none;border:0;background:none;font:inherit;font-size:17px;font-weight:800;
  letter-spacing:-.02em;color:var(--ink-1);cursor:pointer;padding:1px 20px 2px 3px;position:relative;
  border-bottom:2px dashed color-mix(in srgb,var(--accent) 55%,transparent);border-radius:0;
  max-width:100%;text-align:left}
.wr-pick::after{content:"\\25be";position:absolute;right:2px;top:50%;transform:translateY(-52%);
  color:var(--accent);font-size:.7em}
.wr-pick:hover,.wr-pick:focus-visible{border-bottom-color:var(--accent);outline:none}
.wr-pick.sm{font-size:14px;font-weight:700;color:var(--ink-2)}
.wr-youlab{font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3)}
.wr-stripright{display:flex;align-items:center;gap:9px;margin-left:auto;flex-wrap:wrap}
.wr-seg{display:inline-flex;border:1px solid var(--grid);border-radius:999px;overflow:hidden;background:var(--page)}
.wr-seg button{appearance:none;border:0;background:none;color:var(--ink-2);cursor:pointer;
  font:800 12px system-ui,sans-serif;padding:8px 15px;white-space:nowrap}
.wr-seg button.on{background:var(--accent);color:var(--accent-ink)}
.wr-iconbtn{border:1px solid var(--grid);background:var(--surface-1);color:var(--ink-2);
  border-radius:999px;width:34px;height:34px;cursor:pointer;font-size:15px;line-height:1;flex:none}
.wr-iconbtn:hover,.wr-iconbtn:focus-visible{border-color:var(--accent);color:var(--accent);outline:none}
.wr-tabs{display:flex;gap:4px;margin:18px 0 0;overflow-x:auto;scrollbar-width:none;
  border-bottom:2px solid var(--grid)}
.wr-tabs::-webkit-scrollbar{display:none}
.wr-tabs button{appearance:none;border:0;background:none;color:var(--ink-2);cursor:pointer;
  font:800 14px system-ui,sans-serif;padding:11px 15px 12px;white-space:nowrap;
  border-bottom:3px solid transparent;margin-bottom:-2px}
.wr-tabs button:hover{color:var(--ink-1)}
.wr-tabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
.wr-tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}
.wr-menu{position:fixed;z-index:60;min-width:255px;max-height:70vh;overflow:auto;display:none;
  border:1px solid var(--grid);border-radius:12px;background:var(--surface-1);padding:6px;
  box-shadow:0 14px 40px rgba(0,0,0,.28)}
.wr-menu.on{display:block}
.wr-menu button{display:block;width:100%;text-align:left;appearance:none;border:0;background:none;
  color:var(--ink-1);cursor:pointer;font:600 14px system-ui,sans-serif;padding:10px 12px;border-radius:8px}
.wr-menu button:hover,.wr-menu button:focus-visible{background:color-mix(in srgb,var(--accent) 12%,transparent);outline:none}
.wr-menu button.on{color:var(--accent);font-weight:800}
.wr-menu button.danger{color:var(--bad)}
.wr-menu button small{display:block;color:var(--ink-3);font-size:11px;font-weight:600;margin-top:2px}
.wr-menu .mhd{font:800 10px system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);padding:8px 12px 4px}
.wr-menu hr{border:0;border-top:1px solid var(--grid);margin:6px 4px}
.wr-scrim{position:fixed;inset:0;z-index:55;display:none}
.wr-scrim.on{display:block}
@media(max-width:560px){.wr-stripright{width:100%;margin-left:0}.wr-seg{flex:1}.wr-seg button{flex:1}}'''

JS = '''/* ---- the chrome: context menus, scope toggle, tabs ---------------------- */
/* One opener for all three menus. The scrim catches the outside click; Escape
   closes. aria-expanded rides the anchor so the state is not colour-only. */
let openAnchor=null;
function closeMenus(){
  document.querySelectorAll('.wr-menu').forEach(m=>m.classList.remove('on'));
  $('wrScrim').classList.remove('on');
  if(openAnchor){openAnchor.setAttribute('aria-expanded','false');openAnchor=null}
}
function openMenu(id,anchor){
  const already=$(id).classList.contains('on');
  closeMenus();
  if(already)return;
  const m=$(id),r=anchor.getBoundingClientRect();
  m.classList.add('on');
  const left=Math.min(r.left,window.innerWidth-m.offsetWidth-12);
  m.style.left=Math.max(10,left)+'px';
  m.style.top=Math.min(r.bottom+8,window.innerHeight-m.offsetHeight-12)+'px';
  $('wrScrim').classList.add('on');
  anchor.setAttribute('aria-expanded','true');
  openAnchor=anchor;
}
$('wrScrim').onclick=closeMenus;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});
$('leagueBtn').onclick=e=>openMenu('leagueMenu',e.currentTarget);
$('teamBtn').onclick=e=>openMenu('teamMenu',e.currentTarget);
$('gearBtn').onclick=e=>openMenu('gearMenu',e.currentTarget);
$('gearMenu').addEventListener('click',closeMenus);

/* Scope: 'all' hides the tabs rather than disabling them — nothing per-league
   applies on that sheet, and a row of dead tabs is worse than no row. */
let wrScope='one',lastLeagueSheet='report';
function setScope(s){
  wrScope=s;
  $('scopeSeg').querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('on',b.dataset.scope===s));
  $('flowNav').classList.toggle('wr-hide',s==='all');
  SHEETS.show(s==='all'?'all':lastLeagueSheet);
  window.scrollTo({top:0,behavior:'smooth'});
}
$('scopeSeg').addEventListener('click',e=>{
  const b=e.target.closest('[data-scope]');if(b)setScope(b.dataset.scope);
});

function paintTeamMenu(){
  const m=$('teamMenu');
  if(!state){m.innerHTML='';return}
  const cur=+$('teamPicker').value||0;
  m.innerHTML='<div class="mhd">Which team is yours?</div>'+state.teams.map((t,i)=>{
    const {starters}=chooseStarters(t.players,state.slots);
    return '<button type="button" role="menuitem" data-menu-team="'+i+'"'+(i===cur?' class="on"':'')+'>'
      +esc(t.name)+'<small>'+starters.length+' starters \\u00b7 '+t.players.length+' rostered</small></button>';
  }).join('');
  m.querySelectorAll('[data-menu-team]').forEach(b=>{
    b.onclick=()=>{
      $('teamPicker').value=b.dataset.menuTeam;
      tradeFilter=null;saveFocus();render();closeMenus();
    };
  });
}'''

edits = [
    # ---- markup ----------------------------------------------------------
    ('''<div class="wr-strip" id="strip">
  <span class="wr-dot"></span>
  <span class="wr-grow" id="stripText">No league connected. Add or open one to begin.</span>
  <div class="wr-horizon" id="valueHorizon" role="group" aria-label="Value horizon">
    <button type="button" data-horizon="season">This season</button><button type="button" data-horizon="dynasty">Overall dynasty</button>
  </div>
  <select class="wr-mini wr-switch wr-hide" id="leagueSwitch" aria-label="Switch league"></select>
  <button class="wr-mini" id="stripAction" data-sheet="report">Manage leagues</button>
  <button class="wr-mini wr-hide" id="reset">Disconnect</button>
</div>

<nav class="wr-flow" id="flowNav" aria-label="War Room sections">
  <button type="button" data-flow="report" class="on">Overview</button>
  <button type="button" data-flow="dynasty" id="flowDynasty">Dynasty lens</button>
  <button type="button" data-flow="trades">Trade ideas</button>
  <select id="flowLeague" aria-label="League analysis"><option value="">League analysis…</option><option value="standings">Standings</option><option value="rosters">Roster strengths</option><option value="money">Money</option></select>
  <button type="button" data-flow="all">All leagues</button>
  <select id="flowMore" aria-label="Settings and methodology"><option value="">More…</option><option value="settings">Settings</option><option value="method">Method &amp; footnotes</option></select>
</nav>''', STRIP, 'id="leagueBtn"'),

    # ---- css -------------------------------------------------------------
    ('.wr-strip .wr-meta{display:block',
     CSS + '\n.wr-strip .wr-meta{display:block', '.wr-whorow{display:flex'),

    # ---- syncFlow: no more group selects --------------------------------
    ('''function syncFlow(id){
  document.querySelectorAll('[data-flow]').forEach(b=>b.classList.toggle('on',b.dataset.flow===id));
  $('flowLeague').value=['standings','rosters','money'].includes(id)?id:'';
  $('flowMore').value=['settings','method'].includes(id)?id:'';
  /* Without this, opening Standings left every pill inactive and the group looking
     untouched — nothing on screen said which sheet you were on. */
  $('flowLeague').classList.toggle('on',!!$('flowLeague').value);
  $('flowMore').classList.toggle('on',!!$('flowMore').value);
}''',
     '''function syncFlow(id){
  document.querySelectorAll('[data-flow]').forEach(b=>b.classList.toggle('on',b.dataset.flow===id));
  /* Remember the last per-league view so the scope toggle can come back to it
     instead of dumping you on My Team every time. */
  if(typeof lastLeagueSheet!=='undefined'&&!['all','settings','method'].includes(id))lastLeagueSheet=id;
  if(typeof wrScope!=='undefined'){
    const isAll=id==='all';
    if(isAll!==(wrScope==='all')){
      wrScope=isAll?'all':'one';
      $('scopeSeg').querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('on',b.dataset.scope===wrScope));
    }
    $('flowNav').classList.toggle('wr-hide',isAll);
  }
}''', 'lastLeagueSheet=id'),

    # ---- the league menu replaces the switcher select --------------------
    ('''function paintSwitch(){
  const list=readShelf(),sel=$('leagueSwitch');
  sel.classList.toggle('wr-hide',list.length===0);
  const cur=state?keyOf(state.ref.provider,state.ref.id):'';
  sel.innerHTML=(state?'':'<option value="">Choose a saved league…</option>')
    +list.map(x=>{const k=keyOf(x.provider,x.leagueId);
      return '<option value="'+esc(k)+'"'+(k===cur?' selected':'')+'>'+esc(x.name)+'</option>'}).join('')
    +(list.length>1?'<option value="__all">▤ All leagues…</option>':'')
    +'<option value="__add">＋ Add a league…</option>';
}''',
     '''/* The league menu. "Add" and "Manage" live at its foot because that is where you
   already are when you are thinking about which league you are in. */
function paintSwitch(){
  const list=readShelf(),cur=state?keyOf(state.ref.provider,state.ref.id):'';
  $('leagueBtn').textContent=state?state.league.name:(list.length?'Choose a league':'No league connected');
  $('scopeSeg').classList.toggle('wr-hide',list.length<2);
  $('scopeAll').textContent='All '+list.length;
  $('leagueMenu').innerHTML=(list.length?'<div class="mhd">Your leagues</div>':'')
    +list.map(x=>{const k=keyOf(x.provider,x.leagueId);
      return '<button type="button" role="menuitem" data-open="'+esc(x.leagueId)+'" data-provider="'+esc(x.provider)
        +'"'+(k===cur?' class="on"':'')+'>'+esc(x.name)+'<small>Sleeper \\u00b7 '+esc(x.leagueId)+'</small></button>'}).join('')
    +(list.length?'<hr>':'')
    +'<button type="button" role="menuitem" data-sheet="report">\\uff0b Add a league</button>'
    +'<button type="button" role="menuitem" data-sheet="report">Manage leagues\\u2026</button>';
  $('leagueMenu').querySelectorAll('[data-open]').forEach(b=>{
    b.onclick=()=>{closeMenus();openLeague(b.dataset.provider,b.dataset.open)};
  });
  $('leagueMenu').querySelectorAll('[data-sheet]').forEach(b=>{
    b.addEventListener('click',()=>{closeMenus();setTimeout(()=>$('leagueInput')&&$('leagueInput').focus(),80)});
  });
  paintTeamMenu();
}''', 'function paintTeamMenu' if False else "The league menu."),

    # ---- setLoaded drives the new bar ------------------------------------
    ('''  $('stripAction').textContent='Manage leagues';\n''', '''''', ''),

    # the three handlers whose elements no longer exist
    ('''$('flowLeague').onchange=e=>{if(e.target.value)SHEETS.show(e.target.value)};
$('flowMore').onchange=e=>{if(e.target.value)SHEETS.show(e.target.value)};
$('leagueSwitch').onchange=e=>{
  const v=e.target.value;
  if(!v){paintSwitch();return}
  if(v==='__all'){paintSwitch();SHEETS.show('all');return}
  if(v==='__add'){paintSwitch();SHEETS.show('report');$('leagueInput').focus();return}
  const i=v.indexOf(':');openLeague(v.slice(0,i),v.slice(i+1));
};
''', '''''', ""),

    ('''  $('stripText').innerHTML=on
    ? '<b>'+esc(state.league.name)+'</b><span class="wr-meta">'+esc(state.ref.provider)+' · '+state.teams.length
      +' teams · rosters frozen '+new Date().toLocaleString([],{dateStyle:'short',timeStyle:'short'})+'</span>'
    : 'No league connected. Add or open one to begin.';''',
     '''  $('stripText').textContent=on
    ? esc(state.ref.provider)+' \\u00b7 '+state.teams.length+' teams \\u00b7 rosters frozen '
      +new Date().toLocaleString([],{dateStyle:'short',timeStyle:'short'})
    : 'Add or open a league to begin.';
  $('youLab').classList.toggle('wr-hide',!ready);
  $('teamBtn').classList.toggle('wr-hide',!ready);
  if(ready)$('teamBtn').textContent=state.teams[+$('teamPicker').value||0].name;''',
     "$('youLab').classList.toggle"),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new, sentinel in edits:
    if (sentinel in s) if sentinel else (old not in s):
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1

# the chrome JS goes in just before the sheet registry
JS_ANCHOR = "SHEETS=DDSheets({key:'warroom',mount:'#sheets',sheets:["
if "function paintTeamMenu" not in s:
    assert s.count(JS_ANCHOR) == 1
    s = s.replace(JS_ANCHOR, JS + "\n\n" + JS_ANCHOR)
    changed += 1

# labels in the registry follow the tabs
for a, b in [("label:'Report Card'", "label:'My Team'"), ("label:'Dynasty Lens'", "label:'Dynasty'")]:
    if a in s:
        s = s.replace(a, b); changed += 1

open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-nav-rebuild: {changed} change(s) applied")
