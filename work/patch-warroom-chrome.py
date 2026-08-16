#!/usr/bin/env python3
"""The top chrome stops mixing two control languages.

Reported 2026-08-16: the strip and nav row are "visually not very beautiful"
and need "better methods for visibility and navigation."

The cause is that six controls sitting in one row are built from two
different things. Four are custom pill buttons; two are raw <select>s
carrying platform chrome — a different height, a different font, a different
corner radius and the OS arrow. Side by side they read as an unfinished
row, and the mismatch is the first thing the eye lands on.

Every control in the row is now one language: identical height, radius,
weight and hit area, with one drawn caret on the two that open a menu. The
selects keep their native popup — on a phone that is a full-height wheel,
which beats any menu that could be built here — so this buys the visual
consistency without spending a keyboard trap or a focus bug four days
before a freeze.

Two behaviours the row was missing:
  - a group whose sheet is open now reads as active, the same as a pill.
    Before, opening Standings left every pill inactive and the group
    looking untouched — nothing on screen said where you were.
  - the strip's own league switcher gets the same treatment, so the two
    rows agree.

The strip itself is rebalanced: the league name leads, its metadata drops
to a second muted line rather than running on in the same sentence, and
the whole thing stops wrapping into three ragged rows on a narrow desktop.

Anchor-based, idempotent (explicit sentinels).
"""

PATH = "../fantasy-warroom.html"
edits = [
    # one control language for the flow row
    (".wr-flow select{max-width:none;padding-right:26px}",
     "/* One language for the whole row: the selects match the pills exactly and carry a\n"
     "   drawn caret instead of the platform's. The native popup is deliberately kept —\n"
     "   on a phone it is a full-height wheel, better than anything hand-built here. */\n"
     ".wr-flow select,.wr-strip select{max-width:none;appearance:none;-webkit-appearance:none;"
     "padding-right:28px;cursor:pointer;"
     "background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);"
     "background-position:calc(100% - 15px) calc(50% + 1px),calc(100% - 10px) calc(50% + 1px);"
     "background-size:5px 5px,5px 5px;background-repeat:no-repeat}\n"
     ".wr-flow select:hover,.wr-strip select:hover{border-color:var(--accent);color:var(--accent)}\n"
     "/* A group whose sheet is open reads active, exactly as a pill does. */\n"
     ".wr-flow select.on{border-color:var(--accent);background-color:color-mix(in srgb,var(--accent) 14%,var(--surface-1));color:var(--accent)}",
     ".wr-flow select,.wr-strip select{"),

    # the strip's switcher joins the same language
    (".wr-mini{border:1px solid var(--grid);background:var(--surface-1);color:var(--ink-1);border-radius:6px;",
     ".wr-strip select{flex:none;border:1px solid var(--grid);background:var(--surface-1);color:var(--ink-2);"
     "border-radius:999px;padding:8px 12px;font:700 12px/1 system-ui,sans-serif;max-width:230px;"
     "text-overflow:ellipsis;overflow:hidden;white-space:nowrap}\n"
     ".wr-mini{border:1px solid var(--grid);background:var(--surface-1);color:var(--ink-1);border-radius:999px;",
     ".wr-strip select{flex:none;border:1px solid"),

    # strip layout: name leads, metadata is a quiet second line
    (".wr-strip{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:20px 0 4px;padding:12px 15px;",
     ".wr-strip .wr-grow b{display:block;font-size:15px;letter-spacing:-.01em}\n"
     ".wr-strip .wr-meta{display:block;margin-top:2px;font-size:12px;color:var(--ink-3)}\n"
     ".wr-strip{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:20px 0 4px;padding:12px 15px;",
     ".wr-strip .wr-meta{display:block"),

    ("""    ? '<b>'+esc(state.league.name)+'</b> · '+esc(state.ref.provider)+' · '+state.teams.length+' teams · rosters frozen '+new Date().toLocaleString([],{dateStyle:'short',timeStyle:'short'})""",
     """    ? '<b>'+esc(state.league.name)+'</b><span class="wr-meta">'+esc(state.ref.provider)+' · '+state.teams.length
      +' teams · rosters frozen '+new Date().toLocaleString([],{dateStyle:'short',timeStyle:'short'})+'</span>'""",
     'class="wr-meta">'),

    # the open sheet marks its group active
    ("""  $('flowLeague').value=['standings','rosters','money'].includes(id)?id:'';
  $('flowMore').value=['settings','method'].includes(id)?id:'';""",
     """  $('flowLeague').value=['standings','rosters','money'].includes(id)?id:'';
  $('flowMore').value=['settings','method'].includes(id)?id:'';
  /* Without this, opening Standings left every pill inactive and the group looking
     untouched — nothing on screen said which sheet you were on. */
  $('flowLeague').classList.toggle('on',!!$('flowLeague').value);
  $('flowMore').classList.toggle('on',!!$('flowMore').value);""",
     "nothing on screen said which sheet you were on"),
]

s = open(PATH, encoding="utf-8").read()
changed = 0
for old, new, sentinel in edits:
    if sentinel in s:
        continue
    assert s.count(old) == 1, f"anchor not unique or missing ({s.count(old)}x): {old[:70]!r}"
    s = s.replace(old, new)
    changed += 1
open(PATH, "w", encoding="utf-8").write(s)
print(f"patch-warroom-chrome: {changed} edit(s) applied, {len(edits)-changed} already present")
