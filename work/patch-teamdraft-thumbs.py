"""
Thumb-sized tap targets and the owner name back on the phone ladder — Stage TD-THUMBS.

⚠️ WHY THIS IS A PATCH AND NOT A REBUILD. Same reason as patch-teamdraft-mobile.py:
the Toto page-reader stages edited teamdraft.html directly and never touched
work/build_teamdraft.py, so re-stamping the page from the builder would delete their
work with no conflict and no warning. Every edit lands twice — here against the
shipped page, and in the builder so a future full rebuild still carries it.

What an audit at 390x844 turned up, after the four sheets came back clean on
horizontal overflow, clipped text and console errors:

  · the 32 ladder bars — the page's primary "pick a team" control, documented as
    "click any bar on the ladder" — were 19px tall against a 44/48px guideline
  · the rail chips and the team <select> disagreed by a few pixels, and the select
    landed at 31px
  · "Round by round, as a table" was a 17px disclosure toggle
  · ⚠️ .td-own{display:none} below 860px took the owner's name off every ladder row,
    leaving COLOUR AS THE ONLY OWNERSHIP CHANNEL on phones. Eight categorical hues
    cannot be pairwise CVD-safe, which is exactly why this page's rule is that every
    mark carries a name or a number too. The names are at most five characters
    ("Kevin"); they were never the reason the row was tight.

Run:  cd work && python3 patch-teamdraft-thumbs.py && python3 stamp-sw-version.py
"""
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
TARGETS = [REPO / "teamdraft.html", REPO / "work" / "build_teamdraft.py"]

EDITS = [
    # -------------------------------------------------- 1 · the ladder rows ----
    # 32 rows at 19px. Bumped to a 34px floor with real padding: the pitch goes
    # from ~26px to ~36px, which costs about 320px on a sheet that is already
    # 8900px long, and buys a control you can actually hit.
    #
    # The owner column comes back at the same time. Five characters at 11px needs
    # 40px; the bar gives that up and is still ~145px wide.
    ("""  .td-row{grid-template-columns:20px 40px 1fr 48px;gap:7px}
  .td-own{display:none}""",
     """  .td-row{grid-template-columns:20px 38px 1fr 44px 40px;gap:6px;
    padding:6px 0;min-height:34px}
  .td-own{font-size:11px}""",
     "ladder row / owner column"),

    # ------------------------------------------------ 2 · the disclosure ----
    ("""summary{cursor:pointer;font:750 12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-3);letter-spacing:.05em}""",
     """summary{cursor:pointer;font:750 12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-3);letter-spacing:.05em;padding:12px 0;min-height:40px;
  display:flex;align-items:center;gap:6px}""",
     "disclosure tap area"),
    # The padding above replaces the margins that used to do the spacing, so the
    # section does not grow by the full 24px.
    (""".td-disc{margin-top:12px}""", """.td-disc{margin-top:2px}""", "disclosure top margin"),
    (""".td-disc[open] summary{margin-bottom:10px;color:var(--ink-2)}""",
     """.td-disc[open] summary{margin-bottom:2px;color:var(--ink-2)}""",
     "disclosure open margin"),

    # ----------------------------------------------------- 3 · the rail ----
    # The chips and the select were within a few pixels of each other and of the
    # 32px floor. One shared minimum makes the row uniform AND thumb-sized, which
    # matters more here than anywhere else on the page — the rail is the control
    # every other visual hangs off.
    ("""    padding-bottom:2px;scroll-padding-left:8px}""",
     """    padding-bottom:2px;scroll-padding-left:8px}
  .td-rail-in .td-chip,.td-rail-in .td-pick{min-height:38px}""",
     "rail target size"),
]


def apply_to(path):
    txt = path.read_text(encoding="utf-8")
    for old, new, what in EDITS:
        n = txt.count(old)
        assert n == 1, f"anchor {what!r} appears {n} times in {path.name}, expected 1"
        txt = txt.replace(old, new, 1)
    assert "\r" not in txt, "CRLF crept in; this repo is all-LF"
    path.write_text(txt, encoding="utf-8")
    return len(txt.encode("utf-8"))


for t in TARGETS:
    size = apply_to(t)
    print(f"patched {t.name}: {size} bytes")

# ⚠️ The whole reason the page is patched instead of rebuilt: prove the other
# session's work survived.
page = (REPO / "teamdraft.html").read_text(encoding="utf-8")
assert "toto" in page.lower(), "the Toto page-reader hooks were lost"
assert page.count(".td-own{font-size:11px}") == 1 and "display:none}" in page
print(f"Toto hooks intact ({page.lower().count('toto')} references)")
