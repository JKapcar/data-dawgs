#!/usr/bin/env python3
"""Phase 0.5 T1 — Dashboard-first page. Patch dfs.html in place (assert uniqueness)."""
from __future__ import annotations

import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
PATH = REPO / "dfs.html"
DASH = (REPO / "work" / "dfs-dashboard.js").read_text(encoding="utf-8")

s = PATH.read_text(encoding="utf-8")
orig = s

def once(old: str, new: str, label: str) -> None:
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {n}")
    s = s.replace(old, new, 1)

# ---------------------------------------------------------------------------
# CSS — dashboard + gear + mobile single-column ≤600px (no new fonts)
# ---------------------------------------------------------------------------
CSS = """
/* ---- Phase 0.5 T1 dashboard ---- */
details.gear{border:1px solid var(--border);border-radius:11px;padding:0;margin:0 0 12px;background:color-mix(in srgb,var(--surface-1) 92%,var(--page))}
details.gear>summary{list-style:none;cursor:pointer;padding:10px 12px;font-size:12.5px;font-weight:750;color:var(--ink-2);display:flex;align-items:center;gap:8px}
details.gear>summary::-webkit-details-marker{display:none}
details.gear>summary::before{content:"⚙";opacity:.55;font-size:12px}
details.gear[open]>summary{border-bottom:1px solid var(--border);margin-bottom:10px;color:var(--ink-1)}
details.gear .gear-body{padding:0 12px 12px}
.week-grid{display:flex;flex-direction:column;gap:0}
.chiprow{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 0}
.pchip{appearance:none;border:1px solid var(--border);background:var(--page);border-radius:999px;padding:6px 11px;font:inherit;font-size:12px;font-weight:750;color:var(--ink-3);cursor:pointer}
.pchip.on{border-color:color-mix(in srgb,var(--good) 55%,var(--border));color:var(--good);background:color-mix(in srgb,var(--good) 10%,transparent)}
.pchip:hover{border-color:var(--accent);color:var(--accent)}
.lockbig{font-size:28px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin:4px 0 2px}
.lockmeta{font-size:13px;color:var(--ink-2);margin:0 0 10px}
.slate-row{display:grid;grid-template-columns:1fr auto auto;gap:8px 14px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--grid);font-size:13.5px}
.slate-row:last-child{border-bottom:0}
.slate-row .vs{font-weight:800;color:var(--ink-1);font-variant-numeric:tabular-nums}
.slate-row .ko{color:var(--ink-3);font-size:12px}
.slate-row .prob{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
.slate-row .mm{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink-2);font-size:12.5px}
.play-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--grid);font-size:13.5px}
.play-row:last-child{border-bottom:0}
@media(max-width:600px){
  .week-grid .grid2{grid-template-columns:1fr}
  .slate-row{grid-template-columns:1fr;gap:2px}
  .slate-row .prob,.slate-row .mm{text-align:left}
}
"""

# Insert CSS before the last duplicate DFS workbench block's prog styles end —
# use a unique anchor near first DFS workbench card styles after fstabs kbd hide.
anchor_css = "@media(max-width:760px){.fstabs button[data-s]{padding:8px 11px;font-size:13.5px}.fstabs .kbd{display:none}}\n\n.sheet[hidden]{display:none}"
# There may be 3 copies — patch all by replacing each occurrence? Spec says assert count==1 for string replace.
# Find a unique late CSS spot: rarity legend is unique-ish near end of style for dfs.
if s.count(".prog[hidden]{display:none}") >= 1:
    # append after the LAST occurrence of prog[hidden]
    idx = s.rfind(".prog[hidden]{display:none}")
    end = idx + len(".prog[hidden]{display:none}")
    s = s[:end] + "\n" + CSS + s[end:]
else:
    raise SystemExit("CSS anchor .prog[hidden] missing")

# ---------------------------------------------------------------------------
# Tabs: insert This week first; renumber 1..9
# ---------------------------------------------------------------------------
old_tabs = """  <div class="fstabs" id="fsTabs">
    <button data-s="slate">Slate<span class="kbd">1</span></button>
    <button data-s="solver">Solver<span class="kbd">2</span></button>
    <button data-s="sim">Simulator<span class="kbd">3</span></button>
    <button data-s="exposure">Exposure<span class="kbd">4</span></button>
    <button data-s="bankroll">Bankroll<span class="kbd">5</span></button>
    <button data-s="screener">Screener<span class="kbd">6</span></button>
    <button data-s="standings">Standings<span class="kbd">7</span></button>
    <button data-s="method">Method<span class="kbd">8</span></button>
  </div>"""

new_tabs = """  <div class="fstabs" id="fsTabs">
    <button data-s="week">This week<span class="kbd">1</span></button>
    <button data-s="slate">Slate<span class="kbd">2</span></button>
    <button data-s="solver">Solver<span class="kbd">3</span></button>
    <button data-s="sim">Simulator<span class="kbd">4</span></button>
    <button data-s="exposure">Exposure<span class="kbd">5</span></button>
    <button data-s="bankroll">Bankroll<span class="kbd">6</span></button>
    <button data-s="screener">Screener<span class="kbd">7</span></button>
    <button data-s="standings">Standings<span class="kbd">8</span></button>
    <button data-s="method">Method<span class="kbd">9</span></button>
  </div>"""
once(old_tabs, new_tabs, "tabs")

# ---------------------------------------------------------------------------
# Week sheet HTML (insert before SLATE)
# ---------------------------------------------------------------------------
WEEK_HTML = """
<!-- ======================================================= THIS WEEK (T1) -->
<section class="sheet" id="sh-week" hidden>
  <div class="week-grid">
    <div class="card" id="weekLockCard">
      <h3>Next lock <span class="rt" id="weekLockRt"></span></h3>
      <div class="lockbig" id="weekLockCountdown">—</div>
      <p class="lockmeta" id="weekLockMeta">No slate lock time yet — load a draft group on the Slate sheet.</p>
      <div class="btnrow">
        <button class="btn ghost sm" id="dkSwitchAlt" type="button" hidden>Switch slate</button>
        <button class="btn ghost sm" data-goto="slate" type="button">Open Slate</button>
      </div>
    </div>

    <div class="card" id="weekSlateCard">
      <h3>Slate <span class="rt" id="weekSlateRt"></span></h3>
      <p class="sub">Home win probability and modelled margin from <code>data/survivor.json</code> (market or model). No totals.</p>
      <div id="weekSlateRows"></div>
      <p class="note" id="weekSlateFoot"></p>
      <div class="emptystate" id="weekSlateEmpty"><div class="big">No games on the pool</div>
        <p>Load a DraftKings slate to see AWAY @ HOME with kickoff and modelled home win odds.</p></div>
    </div>

    <div class="card" id="weekPipeCard">
      <h3>Pipeline</h3>
      <div class="chiprow" id="weekPipeChips"></div>
    </div>

    <div class="card" id="weekPlayCard">
      <h3>Play list <span class="rt" id="weekPlayRt"></span></h3>
      <div id="weekPlayRows"></div>
      <div class="emptystate" id="weekPlayEmpty"><div class="big">No lobby pull yet</div>
        <p>Score contests on the Screener sheet (or wait for the lobby pull). Top Play-band shows up here.</p></div>
    </div>

    <div class="card" id="weekLastCard">
      <h3>Last week <span class="rt" id="weekLastRt"></span></h3>
      <p class="sub" id="weekLastBody">Week N not graded — ingest standings on the Standings sheet.</p>
    </div>
  </div>
</section>

"""
once("<!-- ======================================================= SLATE -->", WEEK_HTML + "<!-- ======================================================= SLATE -->", "week section")

# ---------------------------------------------------------------------------
# Gear drawers on sheets 2–8 (slate … standings): wrap .fld settings blocks
# ---------------------------------------------------------------------------

def wrap_gear(block: str, summary: str) -> str:
    return (
        f'<details class="gear">\n'
        f'      <summary>{summary}</summary>\n'
        f'      <div class="gear-body">\n'
        f'{block}'
        f'      </div>\n'
        f'    </details>\n'
    )

# SLATE — wrap the two-column settings (grid2) fields; keep banners/pool outside.
# Replace the first card's inner grid2 with gear-wrapped content, leave btnrows inside gear for load actions?
# Spec: "Action buttons stay outside." So pull btnrows out.

old_slate_card = """  <div class="card">
    <h3>1 · The slate <span class="rt" id="slateState"></span></h3>
    <p class="sub">Load live DraftKings salaries through <b>toto</b> (CORS only — nothing is stored), or paste a desktop Export CSV if you have one. Player data stays in this browser.</p>
    <div class="grid2">
      <div>
        <label class="fld"><span>Site &amp; game type</span>
          <select class="fi" id="siteSel">
            <option value="dk_classic">DraftKings · Classic (QB/2RB/3WR/TE/FLEX/DST, $50,000)</option>
            <option value="dk_showdown">DraftKings · Showdown Captain Mode (CPT + 5 FLEX, $50,000)</option>
          </select>
        </label>
        <label class="fld"><span>Load from DraftKings</span>
          <select class="fi" id="dkGroupSel" disabled>
            <option value="">Fetch lobby…</option>
          </select>
        </label>
        <div class="btnrow">
          <button class="btn sm" id="dkLobbyGo">Refresh lobby</button>
          <button class="btn sm" id="dkLoadGo" disabled>Load slate</button>
        </div>
        <p class="note" id="dkLobbyNote">Uses toto → DraftKings draftables (salaries + OUT/Q). No Export CSV required.</p>
        <label class="fld"><span>Or salary file / paste</span>
          <input class="fi" type="file" id="salFile" accept=".csv,text/csv,text/plain">
        </label>
        <p class="note">Optional desktop Export CSV…</p>
        <textarea class="fi" id="salPaste" placeholder="Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame&#10;QB,Josh Allen (39...),Josh Allen,39...,QB,7800,BUF@MIA 09/13/2026 01:00PM ET,BUF,21.8"></textarea>
        <div class="btnrow"><button class="btn sm" id="salGo">Read salaries</button>
          <button class="btn ghost sm" id="salDemo">Load a demo slate</button></div>
      </div>
      <div>
        <label class="fld"><span>Projections &amp; ownership <span class="hint">— name column plus a points column; ownership optional</span></span>
          <textarea class="fi" id="projPaste" placeholder="Player,Proj,Own%&#10;Josh Allen,21.8,14.2&#10;Ja'Marr Chase,18.4,22.9"></textarea>
        </label>
        <div id="mapBox" hidden>
          <div class="grid3">
            <label class="fld"><span>Name column</span><select class="fi" id="mapName"></select></label>
            <label class="fld"><span>Projection column</span><select class="fi" id="mapProj"></select></label>
            <label class="fld"><span>Ownership % <span class="hint">optional</span></select class="fi" id="mapOwn"></select></label>
            <label class="fld"><span>Team <span class="hint">optional, improves matching</span></span><select class="fi" id="mapTeam"></select></label>
          </div>
        </div>
        <div class="btnrow"><button class="btn sm" id="projGo">Match to the slate</button>
          <button class="btn ghost sm" id="projClear">Clear projections</button></div>
        <p class="note" id="matchNote"></p>
      </div>
    </div>
    <div class="banner" id="slateWarn" hidden></div>
  </div>"""

# Fix typo risk — read exact from file
m = re.search(
    r'(  <div class="card">\n    <h3>1 · The slate.*?</div>\n    <div class="banner" id="slateWarn" hidden></div>\n  </div>)',
    s,
    flags=re.S,
)
if not m:
    raise SystemExit("slate card block not found")
old_slate = m.group(1)

new_slate = """  <div class="card">
    <h3>1 · The slate <span class="rt" id="slateState"></span></h3>
    <p class="sub">Load live DraftKings salaries through <b>toto</b> (CORS only — nothing is stored), or paste a desktop Export CSV if you have one. Player data stays in this browser.</p>
    <details class="gear">
      <summary>Site · DraftKings group · salary paste · projection columns</summary>
      <div class="gear-body">
    <div class="grid2">
      <div>
        <label class="fld"><span>Site &amp; game type</span>
          <select class="fi" id="siteSel">
            <option value="dk_classic">DraftKings · Classic (QB/2RB/3WR/TE/FLEX/DST, $50,000)</option>
            <option value="dk_showdown">DraftKings · Showdown Captain Mode (CPT + 5 FLEX, $50,000)</option>
          </select>
        </label>
        <label class="fld"><span>Load from DraftKings</span>
          <select class="fi" id="dkGroupSel" disabled>
            <option value="">Fetch lobby…</option>
          </select>
        </label>
        <p class="note" id="dkLobbyNote">Uses toto → DraftKings draftables (salaries + OUT/Q). No Export CSV required.</p>
        <label class="fld"><span>Or salary file / paste</span>
          <input class="fi" type="file" id="salFile" accept=".csv,text/csv,text/plain">
        </label>
        <p class="note">Optional desktop Export CSV…</p>
        <textarea class="fi" id="salPaste" placeholder="Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame&#10;QB,Josh Allen (39...),Josh Allen,39...,QB,7800,BUF@MIA 09/13/2026 01:00PM ET,BUF,21.8"></textarea>
        <label class="fld"><span>Projections &amp; ownership <span class="hint">— name column plus a points column; ownership optional</span></span>
          <textarea class="fi" id="projPaste" placeholder="Player,Proj,Own%&#10;Josh Allen,21.8,14.2&#10;Ja'Marr Chase,18.4,22.9"></textarea>
        </label>
        <div id="mapBox" hidden>
          <div class="grid3">
            <label class="fld"><span>Name column</span><select class="fi" id="mapName"></select></label>
            <label class="fld"><span>Projection column</span><select class="fi" id="mapProj"></select></label>
            <label class="fld"><span>Ownership % <span class="hint">optional</span></span><select class="fi" id="mapOwn"></select></label>
            <label class="fld"><span>Team <span class="hint">optional, improves matching</span></span><select class="fi" id="mapTeam"></select></label>
          </div>
        </div>
        <p class="note" id="matchNote"></p>
      </div>
      <div>
        <p class="note">Actions stay outside the gear. Use Refresh / Load / Read / Match below.</p>
      </div>
    </div>
      </div>
    </details>
    <div class="btnrow">
      <button class="btn sm" id="dkLobbyGo">Refresh lobby</button>
      <button class="btn sm" id="dkLoadGo" disabled>Load slate</button>
      <button class="btn sm" id="salGo">Read salaries</button>
      <button class="btn ghost sm" id="salDemo">Load a demo slate</button>
      <button class="btn sm" id="projGo">Match to the slate</button>
      <button class="btn ghost sm" id="projClear">Clear projections</button>
    </div>
    <div class="banner" id="slateWarn" hidden></div>
  </div>"""
s = s.replace(old_slate, new_slate, 1)

# SOLVER settings card — wrap grid3 + stacking flds
old_solver_settings = """  <div class="card">
    <h3>Solver settings <span class="rt" id="presetState"></span></h3>
    <p class="sub">Contest-aware presets (Bible §4.1) set lineups / uniques / randomness / stacks. An exact integer solve returns <b>the</b> highest-projected roster under those constraints. There is no lineup-count paywall.</p>
    <div class="grid3">"""
# Use regex to wrap from grid3 through end of first solver card (before stackCard)
m = re.search(
    r'(  <div class="card">\n    <h3>Solver settings.*?</div>\n  </div>\n\n  <div class="card" id="stackCard">)',
    s,
    flags=re.S,
)
if not m:
    raise SystemExit("solver settings card not found")
sol = m.group(1)
# Insert details after sub, before grid3; close before final </div></div> of card
sol2 = sol.replace(
    '<p class="sub">Contest-aware presets (Bible §4.1) set lineups / uniques / randomness / stacks. An exact integer solve returns <b>the</b> highest-projected roster under those constraints. There is no lineup-count paywall.</p>\n    <div class="grid3">',
    '<p class="sub">Contest-aware presets (Bible §4.1) set lineups / uniques / randomness / stacks. An exact integer solve returns <b>the</b> highest-projected roster under those constraints. There is no lineup-count paywall.</p>\n    <details class="gear"><summary>Preset · field · salary window · uniques · exposure · time</summary><div class="gear-body">\n    <div class="grid3">',
    1,
)
# close gear before `  </div>\n\n  <div class="card" id="stackCard">`
sol2 = sol2.replace(
    "    </div>\n  </div>\n\n  <div class=\"card\" id=\"stackCard\">",
    "    </div>\n    </div></details>\n  </div>\n\n  <div class=\"card\" id=\"stackCard\">",
    1,
)
s = s.replace(sol, sol2, 1)

# Stacking card gear
m = re.search(
    r'(  <div class="card" id="stackCard">\n    <h3>Stacking</h3>.*?  </div>\n\n  <div class="card">\n    <h3>Build)',
    s,
    flags=re.S,
)
if not m:
    raise SystemExit("stack card not found")
st = m.group(1)
st2 = st.replace(
    '<p class="sub">Correlation is the only free lunch in a tournament: a quarterback and his receiver score the same touchdown twice. The estimated size of that effect is on the <a href="#" data-goto="method">Method</a> sheet.</p>\n    <div class="grid3">',
    '<p class="sub">Correlation is the only free lunch in a tournament: a quarterback and his receiver score the same touchdown twice. The estimated size of that effect is on the <a href="#" data-goto="method">Method</a> sheet.</p>\n    <details class="gear"><summary>QB stack · bring-back · DST rules</summary><div class="gear-body">\n    <div class="grid3">',
    1,
)
st2 = st2.replace(
    '    <div class="chkrow"><input type="checkbox" id="cfNoOppDst"><label for="cfNoOppDst">Never roster any player facing my defence</label></div>\n  </div>\n\n  <div class="card">\n    <h3>Build',
    '    <div class="chkrow"><input type="checkbox" id="cfNoOppDst"><label for="cfNoOppDst">Never roster any player facing my defence</label></div>\n    </div></details>\n  </div>\n\n  <div class="card">\n    <h3>Build',
    1,
)
s = s.replace(st, st2, 1)

# SIM — The contest card settings
m = re.search(
    r'(  <div class="card">\n    <h3>The contest</h3>.*?  </div>\n\n  <div class="card">\n    <h3>The field</h3>)',
    s,
    flags=re.S,
)
if not m:
    raise SystemExit("sim contest card not found")
sc = m.group(1)
sc2 = sc.replace(
    '<p class="sub">The solver asks <b>what scores most</b>. This asks <b>what beats the room</b> — and in a top-heavy tournament those are rarely the same lineup.</p>\n    <div class="grid3">',
    '<p class="sub">The solver asks <b>what scores most</b>. This asks <b>what beats the room</b> — and in a top-heavy tournament those are rarely the same lineup.</p>\n    <details class="gear"><summary>Entries · fee · payout shape · rake</summary><div class="gear-body">\n    <div class="grid3">',
    1,
)
# close after siCustomBox label ends — before final card close
sc2 = re.sub(
    r'(<label class="fld" id="siCustomBox" hidden>.*?</label>\n)  </div>\n\n  <div class="card">\n    <h3>The field</h3>',
    r'\1    </div></details>\n  </div>\n\n  <div class="card">\n    <h3>The field</h3>',
    sc2,
    count=1,
    flags=re.S,
)
s = s.replace(sc, sc2, 1)

# SIM — The field settings; keep Run button outside
m = re.search(
    r'(  <div class="card">\n    <h3>The field</h3>.*?id="simWarn" hidden></div>\n  </div>)',
    s,
    flags=re.S,
)
if not m:
    raise SystemExit("sim field card not found")
sf = m.group(1)
sf2 = sf.replace(
    '<p class="sub">Opponent lineups are generated to hit the ownership you supplied, spending close to the cap the way real entries do. <b>The field is a sample</b> — your finishing rank is measured against it and then scaled to the real contest size.</p>\n    <div class="grid3">',
    '<p class="sub">Opponent lineups are generated to hit the ownership you supplied, spending close to the cap the way real entries do. <b>The field is a sample</b> — your finishing rank is measured against it and then scaled to the real contest size.</p>\n    <details class="gear"><summary>Sims · sample · stack share · field salary</summary><div class="gear-body">\n    <div class="grid3">',
    1,
)
sf2 = sf2.replace(
    """    </div>
    <div class="btnrow">
      <button class="btn" id="simGo">Run the simulation</button>
      <button class="btn ghost sm" id="simStop" hidden>Stop</button>
    </div>""",
    """    </div>
    </div></details>
    <div class="btnrow">
      <button class="btn" id="simGo">Run the simulation</button>
      <button class="btn ghost sm" id="simStop" hidden>Stop</button>
    </div>""",
    1,
)
s = s.replace(sf, sf2, 1)

# BANKROLL — log form fields in gear (if present)
m = re.search(
    r'(<div class="card">\n    <h3>Log a contest</h3>.*?id="brAdd".*?</div>\n  </div>)',
    s,
    flags=re.S,
)
if m:
    br = m.group(1)
    if 'class="gear"' not in br:
        br2 = re.sub(
            r'(<p class="sub">.*?</p>\n)(    <div class="grid)',
            r'\1    <details class="gear"><summary>Date · type · entries · fee · winnings · name</summary><div class="gear-body">\n\2',
            br,
            count=1,
            flags=re.S,
        )
        br2 = br2.replace(
            """    <div class="btnrow"><button class="btn sm" id="brAdd">Add to the log</button></div>""",
            """    </div></details>\n    <div class="btnrow"><button class="btn sm" id="brAdd">Add to the log</button></div>""",
            1,
        )
        s = s.replace(br, br2, 1)

# SCREENER form gear
m = re.search(
    r'(  <div class="card">\n    <h3>Contest screener.*?</div>\n  </div>\n  <div class="card">\n    <h3>Ranked contests</h3>)',
    s,
    flags=re.S,
)
if not m:
    raise SystemExit("screener card not found")
scr = m.group(1)
scr2 = re.sub(
    r'(<p class="sub">.*?</p>\n)(    <div class="grid3">)',
    r'\1    <details class="gear"><summary>Name · game type · buy-in · field · prizes · rake</summary><div class="gear-body">\n\2',
    scr,
    count=1,
    flags=re.S,
)
scr2 = scr2.replace(
    """    </div>
    <div class="btnrow">
      <button class="btn sm" id="scrAdd">Score &amp; add</button>
      <button class="btn ghost sm" id="scrClear">Clear list</button>
    </div>""",
    """    </div>
    </div></details>
    <div class="btnrow">
      <button class="btn sm" id="scrAdd">Score &amp; add</button>
      <button class="btn ghost sm" id="scrClear">Clear list</button>
    </div>""",
    1,
)
s = s.replace(scr, scr2, 1)

# STANDINGS ingest gear
m = re.search(
    r'(  <div class="card">\n    <h3>Standings ingest.*?</div>\n  </div>\n  <div class="card">\n    <h3>Stored contests</h3>)',
    s,
    flags=re.S,
)
if not m:
    raise SystemExit("standings card not found")
stg = m.group(1)
stg2 = re.sub(
    r'(<p class="sub">.*?</p>\n)(    <div class="grid3">)',
    r'\1    <details class="gear"><summary>Week · contest key · CSV paste</summary><div class="gear-body">\n\2',
    stg,
    count=1,
    flags=re.S,
)
stg2 = stg2.replace(
    """    <div class="btnrow">
      <button class="btn sm" id="stImport">Parse &amp; store locally</button>
      <button class="btn ghost sm" id="stRefresh">Refresh list</button>
    </div>""",
    """    </div></details>
    <div class="btnrow">
      <button class="btn sm" id="stImport">Parse &amp; store locally</button>
      <button class="btn ghost sm" id="stRefresh">Refresh list</button>
    </div>""",
    1,
)
s = s.replace(stg, stg2, 1)

# Exposure: wrap filter selects as light gear? Spec says sheets 2-8 every .fld settings —
# exposure uses select.fi not always label.fld. Skip if no label.fld settings.

# ---------------------------------------------------------------------------
# HELP / MAP (H7)
# ---------------------------------------------------------------------------
once(
    "guillotine.html — guillotine league companion. dfs.html — DFS solver, contest simulator, exposure, bankroll. The projections there are the USER'S OWN.",
    "guillotine.html — guillotine league companion. dfs.html — DFS Labs: This week dashboard, slate, solver, simulator, exposure, bankroll, screener, standings, method (keys 1–9). The projections there are the USER'S OWN.",
    "MAP dfs line",
)

# ---------------------------------------------------------------------------
# DEF state + SHEETS fix
# ---------------------------------------------------------------------------
once(
    """  screener: [],
  cfg: { count: 20, minSal: 49000, maxSal: 50000, uniq: 2, rand: 15, maxExp: 100, team: 4, game: 6,
         time: 60, qbMin: 1, qbPos: "WR,TE", bring: 0, noRbDst: false, noOppDst: false },
  sim: { field: 20000, fee: 20, payout: "gpp", paid: 20, alpha: 1.15, rake: 15, custom: "",
         sims: 10000, sample: 2500, stack: 60, fieldSal: 49000 },
  sheet: "slate"
};""",
    """  screener: [],
  weeks: {},
  exportedAt: null,
  slate: { loadedAt: null, source: null, draftGroupId: null, stale: false, label: null, startTime: null },
  cfg: { count: 20, minSal: 49000, maxSal: 50000, uniq: 2, rand: 15, maxExp: 100, team: 4, game: 6,
         time: 60, qbMin: 1, qbPos: "WR,TE", bring: 0, noRbDst: false, noOppDst: false },
  sim: { field: 20000, fee: 20, payout: "gpp", paid: 20, alpha: 1.15, rake: 15, custom: "",
         sims: 10000, sample: 2500, stack: 60, fieldSal: 49000 },
  sheet: "week"
};""",
    "DEF state",
)

once(
    "const SHEETS\nfunction show(name) {\n  if (SHEETS.indexOf(name) < 0) name = \"slate\";",
    'const SHEETS = ["week","slate","solver","sim","exposure","bankroll","screener","standings","method"];\nfunction show(name) {\n  if (SHEETS.indexOf(name) < 0) name = "week";',
    "SHEETS",
)

# show() fallbacks when disabled → week
once(
    '  if (btn && btn.disabled) name = "slate";\n  S.sheet = name; save();',
    '  if (btn && btn.disabled) name = "week";\n  S.sheet = name; save();\n  if (name === "week") renderWeekDash();',
    "show week hook",
)

# ---------------------------------------------------------------------------
# Inline dashboard module before workbench state (after engine boot block start)
# Insert after `const E = window.DDFS;`
# ---------------------------------------------------------------------------
once(
    "const E = window.DDFS;\n\nlet WORKER_URL = null;",
    "const E = window.DDFS;\n\n/* ---- Dashboard helpers (Phase 0.5 T1 — source: work/dfs-dashboard.js) ---- */\n"
    + DASH
    + "\n\nlet WORKER_URL = null;",
    "inline dashboard",
)

# Attach kickoff from competition.startTime in draftables path (in-page copy)
once(
    """        var g = parseGame(d.competition && d.competition.name, tm);
        var st = normStatus(d.status);
        statusCounts[st || "OK"] = (statusCounts[st || "OK"] || 0) + 1;
        var key = pid || (name.toLowerCase() + "|" + tm + "|" + pos);
        var rec = byPid[key] || (byPid[key] = {
          name: name, pos: pos, team: tm,
          gid: g.gid, opp: g.opp,
          sal: 0, dkId: "", cptId: "", cptSal: 0,
          avg: fppgFromDraftable(d),
          proj: null, own: 0, status: st
        });""",
    """        var g = parseGame(d.competition && d.competition.name, tm);
        var st = normStatus(d.status);
        statusCounts[st || "OK"] = (statusCounts[st || "OK"] || 0) + 1;
        var key = pid || (name.toLowerCase() + "|" + tm + "|" + pos);
        var kick = (d.competition && d.competition.startTime) || null;
        var rec = byPid[key] || (byPid[key] = {
          name: name, pos: pos, team: tm,
          gid: g.gid, opp: g.opp, away: g.away, home: g.home,
          kickoff: kick, startTime: kick,
          sal: 0, dkId: "", cptId: "", cptSal: 0,
          avg: fppgFromDraftable(d),
          proj: null, own: 0, status: st
        });
        if (kick && !rec.kickoff) { rec.kickoff = kick; rec.startTime = kick; }""",
    "draftables kickoff classic-ish",
)

# Also CSV salary path — parse kickoff from Game Info when present
once(
    """      var m = gi.match(/([A-Za-z]{2,4})\\s*@\\s*([A-Za-z]{2,4})/);
      var away = m ? team(m[1]) : "", home = m ? team(m[2]) : "";
      var rp = idx.rp >= 0 ? String(row[idx.rp] || "").trim().toUpperCase() : "";
      var id = idx.id >= 0 ? String(row[idx.id] || "").trim() : (idFromName || "");
      var key = normName(name) + "|" + tm + "|" + pos;
      var rec = bySlot[key] || (bySlot[key] = {
        name: name, pos: pos, team: tm,
        gid: m ? away + "@" + home : (tm || "?"),
        opp: tm === away ? home : (tm === home ? away : ""),
        sal: 0, dkId: "", cptId: "", cptSal: 0,
        avg: idx.avg >= 0 ? parseFloat(row[idx.avg]) || 0 : 0,
        proj: null, own: 0, status: ""
      });""",
    """      var m = gi.match(/([A-Za-z]{2,4})\\s*@\\s*([A-Za-z]{2,4})/);
      var away = m ? team(m[1]) : "", home = m ? team(m[2]) : "";
      var kickM = gi.match(/(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\s+\\d{1,2}:\\d{2}\\s*[AP]M(?:\\s*ET)?)/i);
      var kickoff = kickM ? kickM[1] : null;
      var rp = idx.rp >= 0 ? String(row[idx.rp] || "").trim().toUpperCase() : "";
      var id = idx.id >= 0 ? String(row[idx.id] || "").trim() : (idFromName || "");
      var key = normName(name) + "|" + tm + "|" + pos;
      var rec = bySlot[key] || (bySlot[key] = {
        name: name, pos: pos, team: tm,
        gid: m ? away + "@" + home : (tm || "?"),
        opp: tm === away ? home : (tm === home ? away : ""),
        away: away, home: home,
        kickoff: kickoff, startTime: kickoff,
        sal: 0, dkId: "", cptId: "", cptSal: 0,
        avg: idx.avg >= 0 ? parseFloat(row[idx.avg]) || 0 : 0,
        proj: null, own: 0, status: ""
      });""",
    "csv kickoff",
)

# ---------------------------------------------------------------------------
# JS: week dashboard render + T2 stubs + boot migration + toto + export stamp
# Insert before botContext / after gradeReceipts area — before /* ---- Toto */
# ---------------------------------------------------------------------------

WEEK_JS = r'''
/* ---------------------------------------------------------------- Phase 0.5 T1 dashboard + T2 switch stubs */

let _survivorCache = null;
let _weekLockTimer = null;
/** T2 hook: alternate draft group for one-tap switch (filled when autoload lands). */
let _autoloadAlt = null;
let _dfsSwitchTarget = null;

function ensureSlateMeta() {
  if (!S.slate || typeof S.slate !== "object") {
    S.slate = { loadedAt: null, source: null, draftGroupId: null, stale: false, label: null, startTime: null };
  }
}

function updateAutoloadSwitch(pick) {
  /* Compatible with T2: pick.switchTarget / pick.alternate */
  const alt = (pick && (pick.switchTarget || pick.alternate)) || null;
  _autoloadAlt = alt;
  _dfsSwitchTarget = alt;
  const btn = $("dkSwitchAlt");
  if (!btn) return;
  if (alt && alt.draftGroupId) {
    const label = alt.format === "showdown" ? "Showdown" : (alt.label || "Classic");
    btn.hidden = false;
    btn.textContent = "Switch to " + label + (alt.draftGroupId ? " (DG " + alt.draftGroupId + ")" : "");
    btn.dataset.draftGroupId = String(alt.draftGroupId);
  } else {
    btn.hidden = true;
    btn.removeAttribute("data-draft-group-id");
  }
}

function switchToAltSlate() {
  const alt = _dfsSwitchTarget || _autoloadAlt;
  const id = (alt && alt.draftGroupId) || ($("dkSwitchAlt") && $("dkSwitchAlt").dataset.draftGroupId);
  if (!id) return;
  if (typeof loadDkSlateById === "function") {
    loadDkSlateById(id, { reason: "switch" });
    return;
  }
  /* Minimal stub until T2 merges: select group in picker and load. */
  const sel = $("dkGroupSel");
  if (sel) {
    sel.value = String(id);
    if (typeof loadDkSlate === "function") loadDkSlate();
  }
}

function fmtKickLocal(raw) {
  if (!raw) return "—";
  const t = Date.parse(raw);
  if (isFinite(t)) {
    try {
      return new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) { return String(raw); }
  }
  return String(raw);
}

function nextLockInfo() {
  ensureSlateMeta();
  let start = S.slate.startTime || null;
  if (!start && S.players && S.players.length) {
    let best = null;
    S.players.forEach(p => {
      const k = p.kickoff || p.startTime;
      const ms = k ? Date.parse(k) : NaN;
      if (isFinite(ms) && (best == null || ms < best)) best = ms;
    });
    if (best != null) start = new Date(best).toISOString();
  }
  const lockMs = start ? Date.parse(start) : NaN;
  const label = S.slate.label || (S.slate.draftGroupId ? ("DG " + S.slate.draftGroupId) : (S.demo ? "Demo slate" : (S.players.length ? "Loaded slate" : "")));
  return { start: start, lockMs: isFinite(lockMs) ? lockMs : null, label: label };
}

async function loadSurvivorJson() {
  if (_survivorCache) return _survivorCache;
  try {
    const r = await fetch("/data/survivor.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    _survivorCache = await r.json();
  } catch (e) {
    _survivorCache = { as_of: null, data: { games: [] }, _err: String(e && e.message || e) };
  }
  return _survivorCache;
}

function renderPipelineChips() {
  if (typeof DDFSDashboard === "undefined") return;
  const chips = DDFSDashboard.pipelineChips(S, { sim: SIM, exportedAt: S.exportedAt });
  const box = $("weekPipeChips");
  if (!box) return;
  box.innerHTML = chips.map(c =>
    `<button type="button" class="pchip${c.ready ? " on" : ""}" data-goto="${esc(c.sheet)}" title="${esc(c.detail)}">${esc(c.label)}${c.detail ? ` · ${esc(c.detail)}` : ""}</button>`
  ).join("");
}

function renderPlayList() {
  const box = $("weekPlayRows"), empty = $("weekPlayEmpty"), rt = $("weekPlayRt");
  if (!box) return;
  let plays = [];
  if (typeof DDFSDashboard !== "undefined" && typeof DDFSScreener !== "undefined") {
    plays = DDFSDashboard.playBandList(S.screener || [], c => DDFSScreener.scoreContest(c), 5);
  }
  if (!plays.length) {
    box.innerHTML = "";
    if (empty) empty.hidden = false;
    if (rt) rt.textContent = "";
    return;
  }
  if (empty) empty.hidden = true;
  if (rt) rt.textContent = plays.length + " play";
  box.innerHTML = plays.map((row, i) => {
    const c = row.contest || {};
    const pkey = (row.preset && row.preset.key) || "";
    return `<div class="play-row"><div><b>${esc(c.name || "(unnamed)")}</b>` +
      `<div class="mut">$${c.buyIn || 0} · ${c.entryCap || 1}-max · rank ${row.rank}</div></div>` +
      `<button type="button" class="btn sm" data-scr-apply="${esc(pkey)}" data-scr-cap="${c.entryCap || 1}" data-scr-field="${c.fieldCap || ""}">Apply</button></div>`;
  }).join("");
}

function renderLastWeek() {
  if (typeof DDFSDashboard === "undefined") return;
  const wk = ($("stWeek") && +$("stWeek").value) || null;
  const card = DDFSDashboard.lastWeekCard(S, wk);
  if ($("weekLastRt")) $("weekLastRt").textContent = card.week != null ? ("week " + card.week) : "";
  if ($("weekLastBody")) {
    if (card.empty) $("weekLastBody").textContent = card.message;
    else {
      const rec = card.record || {};
      $("weekLastBody").textContent = card.graded
        ? (`Week ${card.week} graded` + (rec.net != null ? ` · net ${rec.net}` : "") + (rec.note ? ` — ${rec.note}` : "."))
        : (`Week ${card.week} not graded — ingest standings on the Standings sheet.`);
    }
  }
}

function tickWeekLock() {
  if (typeof DDFSDashboard === "undefined") return;
  const info = nextLockInfo();
  const el = $("weekLockCountdown");
  const meta = $("weekLockMeta");
  const rt = $("weekLockRt");
  if (!info.lockMs) {
    if (el) el.textContent = "—";
    if (meta) meta.textContent = "No slate lock time yet — load a draft group on the Slate sheet.";
    if (rt) rt.textContent = "";
    return;
  }
  const left = info.lockMs - Date.now();
  if (el) el.textContent = DDFSDashboard.formatCountdown(left);
  if (meta) meta.textContent = (info.label ? info.label + " · " : "") + "locks " + fmtKickLocal(info.start) + " (device clock)";
  if (rt) rt.textContent = left <= 0 ? "locked" : "upcoming";
}

async function renderWeekSlate() {
  const box = $("weekSlateRows"), empty = $("weekSlateEmpty"), foot = $("weekSlateFoot"), rt = $("weekSlateRt");
  if (!box) return;
  if (typeof DDFSDashboard === "undefined") return;
  const games = DDFSDashboard.gamesFromPlayers(S.players || []);
  if (!games.length) {
    box.innerHTML = "";
    if (empty) empty.hidden = false;
    if (foot) foot.textContent = "";
    if (rt) rt.textContent = "";
    return;
  }
  if (empty) empty.hidden = true;
  const surv = await loadSurvivorJson();
  const joined = DDFSDashboard.joinSurvivorSlate(games, surv, {});
  if (rt) rt.textContent = joined.rows.length + " games";
  box.innerHTML = joined.rows.map(r => {
    const srcLabel = r.src === "market" ? "market" : (r.src === "model" ? "model" : "—");
    const p = (r.p == null || !isFinite(r.p)) ? "—" : ((r.p * 100).toFixed(1) + "%");
    const mm = (r.mm == null || !isFinite(r.mm)) ? "—" : ((r.mm > 0 ? "+" : "") + r.mm.toFixed(1));
    return `<div class="slate-row"><div><span class="vs">${esc(r.away)} @ ${esc(r.home)}</span>` +
      `<div class="ko">${esc(fmtKickLocal(r.kickoff || r.d))}</div></div>` +
      `<div class="prob" title="Home win prob (${esc(srcLabel)})">${p}<div class="mut">${esc(srcLabel)}</div></div>` +
      `<div class="mm" title="Modelled margin (home)">MV mm ${mm}</div></div>`;
  }).join("");
  if (foot) {
    foot.textContent = joined.as_of
      ? (`as_of ${joined.as_of}` + (joined.unmatched.length ? ` · ${joined.unmatched.length} unmatched` : "") + " · modelled margin from survivor.json")
      : (joined.unmatched.length ? `${joined.unmatched.length} unmatched to survivor.json` : "");
  }
}

async function renderWeekDash() {
  ensureSlateMeta();
  tickWeekLock();
  clearInterval(_weekLockTimer);
  _weekLockTimer = setInterval(tickWeekLock, 1000);
  renderPipelineChips();
  renderPlayList();
  renderLastWeek();
  await renderWeekSlate();
  updateAutoloadSwitch({ switchTarget: _dfsSwitchTarget || _autoloadAlt });
  botContext();
}

'''

once(
    "/* ---------------------------------------------------------------- Toto */\n// The assistant's view of this page has to move when the page moves, or the copy lies",
    WEEK_JS + "\n/* ---------------------------------------------------------------- Toto */\n// The assistant's view of this page has to move when the page moves, or the copy lies",
    "week JS",
)

# boot: default sheet once + switch click + ensure slate
once(
    '  show(location.hash.slice(1) || S.sheet || "slate");',
    '''  ensureSlateMeta();
  if (!S.weeks) S.weeks = {};
  // Existing users: ignore saved sheet once, land on This week; then honour saved sheet.
  const WEEK_ONCE = "dd-dfs-week-default-once";
  let bootSheet = location.hash.slice(1) || "";
  if (!bootSheet) {
    try {
      if (!localStorage.getItem(WEEK_ONCE)) {
        localStorage.setItem(WEEK_ONCE, "1");
        bootSheet = "week";
      } else {
        bootSheet = S.sheet || "week";
      }
    } catch (e) { bootSheet = "week"; }
  }
  show(bootSheet || "week");
  if ($("dkSwitchAlt")) $("dkSwitchAlt").addEventListener("click", () => switchToAltSlate());''',
    "boot sheet once",
)

# exportCsv — stamp exportedAt (find function and patch save path)
# Locate exportCsv function end-ish
m = re.search(r'function exportCsv\(\) \{.*?^\}\n', s, flags=re.S | re.M)
if not m:
    raise SystemExit("exportCsv not found")
# Add near start after validations — find `save();` inside? Better: after successful download trigger
ex = m.group(0)
if "exportedAt" not in ex:
    ex2 = ex.replace(
        "function exportCsv() {",
        'function exportCsv() {\n  /* T1 pipeline chip */',
        1,
    )
    # stamp before return-less end — look for common download pattern
    if "save();" in ex2:
        ex2 = ex2.replace("save();", 'S.exportedAt = new Date().toISOString(); save(); if (S.sheet === "week") renderPipelineChips();', 1)
    else:
        # append before last closing brace
        ex2 = ex2[:-2] + '  S.exportedAt = new Date().toISOString(); save();\n  if (S.sheet === "week") renderPipelineChips();\n}\n'
    s = s.replace(ex, ex2, 1)

# When applyMappedSlate / doSalaries sets players, stamp slate meta lightly
once(
    "function applyMappedSlate(r) {",
    '''function applyMappedSlate(r) {
  ensureSlateMeta();
''',
    "applyMappedSlate ensure",
)

# Patch applyMappedSlate body for slate meta — find S.players = r.players in applyMappedSlate
# There may be multiple S.players = r.players — be careful
# After applyMappedSlate's S.players assignment:
# Read function
m = re.search(r'function applyMappedSlate\(r\) \{\n  ensureSlateMeta\(\);\n.*?^\}', s, flags=re.S | re.M)
if m:
    body = m.group(0)
    if "S.slate.source" not in body:
        body2 = body.replace(
            "S.players = r.players; S.demo = false; S.lineups = []; SIM = null;",
            '''S.players = r.players; S.demo = false; S.lineups = []; SIM = null;
  S.slate.loadedAt = new Date().toISOString();
  S.slate.source = S.slate.source || "toto";
  S.slate.stale = false;
  if (!S.slate.startTime) {
    let best = null;
    (r.players || []).forEach(p => { const ms = Date.parse(p.kickoff || p.startTime || ""); if (isFinite(ms) && (best == null || ms < best)) best = ms; });
    if (best != null) S.slate.startTime = new Date(best).toISOString();
  }''',
            1,
        )
        s = s.replace(body, body2, 1)

# doSalaries path
once(
    """  S.site = wantShowdown ? "dk_showdown" : "dk_classic";
  $("siteSel").value = S.site;
  S.players = r.players; S.demo = false; S.lineups = []; SIM = null;
  save();
  renderStrip(); renderPool(); renderLineups(); renderSolveStats(); renderExposure();""",
    """  S.site = wantShowdown ? "dk_showdown" : "dk_classic";
  $("siteSel").value = S.site;
  ensureSlateMeta();
  S.players = r.players; S.demo = false; S.lineups = []; SIM = null;
  S.slate.loadedAt = new Date().toISOString();
  S.slate.source = "csv";
  S.slate.stale = false;
  S.slate.draftGroupId = null;
  let bestCsv = null;
  (r.players || []).forEach(p => { const ms = Date.parse(p.kickoff || p.startTime || ""); if (isFinite(ms) && (bestCsv == null || ms < bestCsv)) bestCsv = ms; });
  S.slate.startTime = bestCsv != null ? new Date(bestCsv).toISOString() : null;
  save();
  renderStrip(); renderPool(); renderLineups(); renderSolveStats(); renderExposure();
  if (S.sheet === "week") renderWeekDash();""",
    "doSalaries slate meta",
)

# Toto updates
once(
    '    chrome: { sub: "reads your slate, your lineups and your simulation", ph: "Ask Toto about this slate…", chips: [',
    '    chrome: { sub: "reads this week\'s slate, lineups, contests and grades", ph: "Ask Toto about this slate…", chips: [',
    "chrome.sub",
)

once(
    """    sys: `RIGHT NOW you are on the DFS Solver & Contest Simulator. It is BUILT and it computes — the solver, the contest simulator, the exposure view and the bankroll tracker all run in the browser.
- ⚠️ The PROJECTIONS ARE THE USER'S OWN. This tool has no player opinions and generates no projections. Never present a projection as the site's view, and never rate a player yourself as if the page had done so.
- ⚠️ The correlation structure IS measured — seven seasons of nflverse weekly stats, ${E.CORR.meta.games} games — but it is a league-average structure, not this game.
- ⚠️ The simulated FIELD is the weak link: it is built from the user's ownership estimate, it is a sample of a few thousand lineups extrapolated to contest size, and a field built from ownership alone is usually softer than a real one. Say so whenever ROI comes up.
- ⚠️ There are NO RECEIPTS. Nothing here has been run forward against a declared benchmark. If asked whether it beats anything, the answer is that nobody knows yet.
${S.demo ? "- ⚠️ THE LOADED SLATE IS THE DEMO SLATE. Every player name, salary, projection and ownership figure on screen right now is INVENTED. Say that before discussing any number on it." : ""}`,""",
    """    sys: `RIGHT NOW you are on the DFS Solver & Contest Simulator. It is BUILT and it computes — the solver, the contest simulator, the exposure view and the bankroll tracker all run in the browser.
- ⚠️ The PROJECTIONS ARE THE USER'S OWN. This tool has no player opinions and generates no projections. Never present a projection as the site's view, and never rate a player yourself as if the page had done so.
- ⚠️ The correlation structure IS measured — seven seasons of nflverse weekly stats, ${E.CORR.meta.games} games — but it is a league-average structure, not this game.
- ⚠️ The simulated FIELD is the weak link: it is built from the user's ownership estimate, it is a sample of a few thousand lineups extrapolated to contest size, and a field built from ownership alone is usually softer than a real one. Say so whenever ROI comes up.
- ⚠️ There are NO RECEIPTS. Nothing here has been run forward against a declared benchmark. If asked whether it beats anything, the answer is that nobody knows yet.
- ⚠️ Selection key is DUPE-ADJUSTED TOP-10 / EV_adj (Bible §3.4 / I4), not raw ROI. E[dupes] is a PRIOR until ≥3 weeks of standings grade the pair multipliers (I5) — say "prior" whenever you quote EV (dupe-adj) or E[dupes]. Top-10 means literal places 1–10 (B5), not a percent of field.
${S.demo ? "- ⚠️ THE LOADED SLATE IS THE DEMO SLATE. Every player name, salary, projection and ownership figure on screen right now is INVENTED. Say that before discussing any number on it." : ""}`,""",
    "sys T4 line",
)

once(
    """    ctx: () => {
      const L = [];
      L.push(`SHEET ON SCREEN: ${S.sheet}.`);
      L.push(`SLATE: ${E.SITES[S.site].label}. ${st.total} players, ${st.games} games, ${st.priced} with a projection.` +
             (S.demo ? " ⚠️ THIS IS THE INVENTED DEMO SLATE." : ""));""",
    """    ctx: () => {
      const L = [];
      L.push(`SHEET ON SCREEN: ${S.sheet}.`);
      if (typeof DDFSDashboard !== "undefined") {
        const chips = DDFSDashboard.pipelineChips(S, { sim: SIM, exportedAt: S.exportedAt });
        L.push("PIPELINE: " + chips.map(c => c.label + (c.ready ? "=ready" : "=pending") + (c.detail ? "(" + c.detail + ")" : "")).join(" · ") + ".");
        const lock = nextLockInfo();
        if (lock.lockMs) L.push(`NEXT LOCK: ${lock.label || "slate"} at ${lock.start} · countdown ${DDFSDashboard.formatCountdown(lock.lockMs - Date.now())} (device clock).`);
        else L.push("NEXT LOCK: none set — no StartTime on the loaded group yet.");
      }
      L.push(`SLATE: ${E.SITES[S.site].label}. ${st.total} players, ${st.games} games, ${st.priced} with a projection.` +
             (S.demo ? " ⚠️ THIS IS THE INVENTED DEMO SLATE." : ""));""",
    "ctx pipeline prepend",
)

# Also refresh week when screener/standings render
once(
    "  $(\"scrNote\").textContent = ranked.length ? `${ranked.length} contest${ranked.length === 1 ? \"\" : \"s\"} scored.` : \"No contests scored yet.\";\n  $(\"scrState\").textContent = ranked.length ? ranked[0].verdict : \"\";\n}",
    "  $(\"scrNote\").textContent = ranked.length ? `${ranked.length} contest${ranked.length === 1 ? \"\" : \"s\"} scored.` : \"No contests scored yet.\";\n  $(\"scrState\").textContent = ranked.length ? ranked[0].verdict : \"\";\n  if (S.sheet === \"week\") { renderPlayList(); renderPipelineChips(); }\n}",
    "screener refresh week",
)

# gradeReceipts → set S.weeks
once(
    """  const g = DDFSReceipts.gradeWeek({ week: week });
  $("rcState").textContent = "week " + week;
  $("rcOut").textContent = JSON.stringify(g, null, 2);
  banner("rcWarn", "ok", "<b>Receipts graded</b> for week " + week + ". Empty sections stay labelled prior (I5).");
}""",
    """  const g = DDFSReceipts.gradeWeek({ week: week });
  $("rcState").textContent = "week " + week;
  $("rcOut").textContent = JSON.stringify(g, null, 2);
  if (!S.weeks) S.weeks = {};
  S.weeks[week] = { graded: true, grade: g, at: new Date().toISOString() };
  save();
  banner("rcWarn", "ok", "<b>Receipts graded</b> for week " + week + ". Empty sections stay labelled prior (I5).");
  if (S.sheet === "week") renderLastWeek();
}""",
    "grade weeks",
)

if s == orig:
    raise SystemExit("no changes made")

PATH.write_text(s, encoding="utf-8", newline="\n")
print(f"patched dfs.html ({len(orig)} → {len(s)} bytes)")
