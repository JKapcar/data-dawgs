"""
The phone card labels its four prices instead of stacking bare numbers.

On mobile the board renders each row as a card. The design: every money cell is hidden by
default, the ACTIVE currency is promoted onto line two in accent colour, and each cell
carries an ::after suffix naming its currency, so "a number on screen always says which
currency it is".

The four-source columns broke both halves of that. The hide-by-default selector and the
suffix rules both enumerate the OLD keys (half14/half/full/sfhalf12/sf/lg) and never
gained dd/espn/pff/fp — so three of the four new prices fell through as visible, and none
of the four had a label. The result on a phone was "$85 $90 $90" on line one with nothing
saying which board each came from, which is worse than not showing them.

Fixed by finishing the pattern rather than working around it, and by showing all four
deliberately, because a cheat sheet whose whole point is comparing sources should compare
them on the device people actually draft from:

    $90 DD$ · $85 ESPN · $90 PFF · $90 FP

DataDawg$ keeps the accent weight — it is the target, the other three are triangulation —
and each number now carries its source. The dead `lg` rules go with it.

Run:  cd work && python3 patch-board-mobile-labels.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
p = REPO / "board.html"
s = p.read_text(encoding="utf-8")

OLD_HIDE = ('  #board td[data-c=half14],#board td[data-c=half],#board td[data-c=full],'
            '#board td[data-c=sfhalf12],#board td[data-c=sf],#board td[data-c=lg]{order:11;display:none}')
NEW_HIDE = ('  #board td[data-c=half14],#board td[data-c=half],#board td[data-c=full],'
            '#board td[data-c=sfhalf12],#board td[data-c=sf]{order:11;display:none}\n'
            '  /* ⚠️ THE FOUR-SOURCE PRICES ARE SHOWN, NOT HIDDEN. Comparing sources is the whole\n'
            '     point of this sheet, and the phone is where it gets read at the draft. They sit\n'
            '     on line two after DataDawg$, each carrying its own suffix — three bare numbers\n'
            '     with no label is worse than not showing them at all. */\n'
            '  #board td[data-c=dd],#board td[data-c=espn],#board td[data-c=pff],#board td[data-c=fp]{\n'
            '    order:7;display:inline-block;font-size:12px;font-weight:650;color:var(--ink-2);\n'
            '    margin-right:7px}\n'
            '  #board td[data-c=dd]{margin-left:33px}')
if s.count(OLD_HIDE) != 1:
    sys.exit(f"FAIL hide selector matched {s.count(OLD_HIDE)} times")
s = s.replace(OLD_HIDE, NEW_HIDE, 1)

OLD_SUFFIX = '  #board td[data-c=lg]::after{content:" PPN";color:var(--ink-3)}'
NEW_SUFFIX = ('  /* One source for each label — the number always says which board it came from. */\n'
              '  #board td[data-c=dd]::after{content:" DD$";color:var(--ink-3);font-weight:500}\n'
              '  #board td[data-c=espn]::after{content:" ESPN";color:var(--ink-3);font-weight:500}\n'
              '  #board td[data-c=pff]::after{content:" PFF";color:var(--ink-3);font-weight:500}\n'
              '  #board td[data-c=fp]::after{content:" FP";color:var(--ink-3);font-weight:500}')
if s.count(OLD_SUFFIX) != 1:
    sys.exit(f"FAIL lg suffix matched {s.count(OLD_SUFFIX)} times")
s = s.replace(OLD_SUFFIX, NEW_SUFFIX, 1)

# the promoted cell keeps its emphasis but must not double up the indent
OLD_LG = '''  #board td.lgprice{order:7;display:block;margin-left:33px;
    font-weight:750;color:var(--accent);font-size:13.5px}'''
NEW_LG = '''  #board td.lgprice{order:7;display:inline-block;margin-left:33px;
    font-weight:750;color:var(--accent);font-size:13.5px}'''
if s.count(OLD_LG) != 1:
    sys.exit("FAIL lgprice rule not unique")
s = s.replace(OLD_LG, NEW_LG, 1)

# the tr.open reveal list also enumerates the old keys; the new ones are already shown
OLD_OPEN = ("  #board tr.open td[data-c=half14],#board tr.open td[data-c=half],"
            "#board tr.open td[data-c=full],#board tr.open td[data-c=sfhalf12],#board tr.open td[")
if s.count(OLD_OPEN) != 1:
    sys.exit("FAIL tr.open reveal list not unique")

p.write_text(s, encoding="utf-8", newline="\n")
print("  board.html: four-source prices labelled DD$ / ESPN / PFF / FP on the phone card")
