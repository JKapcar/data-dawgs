"""
War room: Toto reads the room he is in, not the one he loaded.

fantasy-warroom.html was the only page on the site that folded the page reader into
`sys` instead of into `ctx()`. `sys` is a string literal, evaluated once when the
script at the bottom of the body runs — which is BEFORE any league has been fetched,
so what it captured was the landing shelf with every sheet showing its empty state.
That snapshot was then sent with every question for the rest of the session: connect a
league, open Trades, ask Toto what he sees, and he answers about a page that stopped
existing at load.

Worse, it was sent twice. The page supplies no ctx(), so surface() falls through to
the LIVE reader for the state block — and both copies compete for the same 20,000-byte
request budget. ask() trims the state block, never sys, so the stale copy is the one
that survives and the live one is what gets cut.

Moving the reader into ctx() fixes all of it: called fresh per question, sent once, and
`sys` goes back to being what AGENTS.md says it is — the block where the caveats live.

Run:  cd work && python3 patch-warroom-toto-reader.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

page = pathlib.Path(__file__).resolve().parent.parent / "fantasy-warroom.html"
s = page.read_text(encoding="utf-8")

OLD = ('\n` + (window.DDBotScan ? window.DDBotScan(5200) : '
       '"The page reader could not run, so nothing on the page can be read right now.")\n};')

NEW = ('\n`,\n'
       '  /* ⚠️ THE READER GOES IN ctx(), NEVER IN sys. sys is a string literal, evaluated once\n'
       '     when this script runs — before any league has been fetched — so folding the reader\n'
       '     into it froze the empty landing shelf and sent that same dead snapshot with every\n'
       '     question for the rest of the session. It was also a second copy: with no ctx() the\n'
       '     surface falls through to the live reader for the state block, and the two competed\n'
       '     for one 20,000-byte body. ask() trims the state block and never sys, so the stale\n'
       '     copy won and the live one was cut. ctx() runs fresh for every question. */\n'
       '  ctx(){\n'
       '    return window.DDBotScan ? window.DDBotScan(5200)\n'
       '      : "The page reader could not run, so nothing on the page can be read right now.";\n'
       '  }\n'
       '};')

if s.count(OLD) != 1:
    sys.exit(f"FAIL fantasy-warroom.html: reader-in-sys anchor matched {s.count(OLD)} times, expected 1")

page.write_text(s.replace(OLD, NEW, 1), encoding="utf-8", newline="\n")
print("  fantasy-warroom.html")
print("      - the page reader moved from sys into ctx(), so it is regenerated per question")
