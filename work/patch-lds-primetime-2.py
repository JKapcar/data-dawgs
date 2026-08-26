#!/usr/bin/env python3
"""Prime Time follow-ups found by looking at the rendered page, not the code.

1. `.gx-stage h2` (0,1,1) outranks `.pt-title` (0,1,0), so the broadcast title
   rendered at the old 15px heading size. Specificity, not styling.
2. Vertical team names were clipped at 88px — this league has names like
   "I'mGettingChoppedWeek1". More room, slightly smaller type.
3. The saved-leagues shelf repeats the dark-on-dark bug: `.gx-shelf h3` and its
   chips inherit light-theme tokens inside the dark stage, so the heading was
   invisible. Same fix as the table: state the colours.

Run from repo root:  python3 work/patch-lds-primetime-2.py
"""
import pathlib

P = pathlib.Path("guillotine.html")
s = P.read_text(encoding="utf-8")


def sub(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f"{label}: expected 1 occurrence, found {n}"
    s = s.replace(old, new)
    print(f"  ok  {label}")


sub(""".pt-title{margin:0;font-size:clamp(30px,4.6vw,42px);font-weight:800;line-height:.98;
  letter-spacing:-.022em;color:#F8F3EC;text-transform:uppercase}
.pt-title em{color:#ff8a3d;font-style:normal}""",
    """/* ⚠️ `.gx-stage h2` is (0,1,1) and would win over a bare `.pt-title` (0,1,0),
   which silently rendered this title at the old 15px heading size. */
.gx-stage h2.pt-title{margin:0;font-size:clamp(27px,4.4vw,40px);font-weight:800;line-height:.98;
  letter-spacing:-.022em;color:#F8F3EC;text-transform:uppercase}
.gx-stage h2.pt-title em{color:#ff8a3d;font-style:normal}""",
    "title: beat .gx-stage h2 on specificity")

sub(""".pt-nm{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#8E8073;
  writing-mode:vertical-rl;transform:rotate(180deg);height:88px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}""",
    """.pt-nm{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#9C8E80;
  writing-mode:vertical-rl;transform:rotate(180deg);height:132px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}""",
    "names: room for real team names")

# same dark-on-dark class of bug as the table, in the league shelf
sub(".gx-stage .dtab th{color:#9C8E80}",
    """.gx-stage .dtab th{color:#9C8E80}
.gx-stage .gx-shelf{background:#171208;border-color:#3A2E24}
.gx-stage .gx-shelf h3{color:#E4DACE}
.gx-stage .gx-shelf .gx-private,.gx-stage .gx-shelf .legend{color:#9C8E80!important}
.gx-stage .gx-league-chip{background:#241D14;border-color:#443528;color:#E4DACE}
.gx-stage .gx-league-chip.on{border-color:#ff8a3d;color:#ff8a3d}
.gx-stage #gxConnect code{color:#D9CFC4}""",
    "shelf: explicit ink inside the dark stage")

P.write_text(s, encoding="utf-8")
print("\nguillotine.html patched (round 2).")
