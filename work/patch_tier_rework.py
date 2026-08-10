#!/usr/bin/env python3
"""Stage TR — the tier ladder gets its display names.

Pup = unvalidated.  Working Dawg = validated.  The DawgHouse = the evidence said stop.
"Data Dawgs Labs" stops being a TIER and survives as a PLACE (the lab-chip furniture
on cfb.html / dfs.html / guillotine.html is deliberately untouched).

TIER IDS DO NOT MOVE.  labs / dawg / pound stay exactly as they are; only display
strings change.  Every replacement below is anchored and asserted, so a missed anchor
is a hard failure rather than a silent no-op.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

OLD_MEAN = (
    "Labs — useful and live, still being challenged. Open questions may remain about "
    "calibration, assumptions, data quality or edge. Use with your eyes open."
)
NEW_MEAN = (
    "Pup — live and useful, not yet validated. It may compute real answers and still "
    "have open questions about calibration, assumptions, data quality or edge. "
    "Everything starts here."
)

edits = 0
report = []


def patch(relpath, pairs, encoding="utf-8"):
    """Apply (old, new, count) triples to a file. Newlines preserved as LF."""
    global edits
    p = ROOT / relpath
    src = p.read_text(encoding=encoding)
    out = src
    for old, new, count in pairs:
        found = out.count(old)
        if found != count:
            sys.exit(f"ANCHOR FAIL {relpath}: expected {count}x, found {found}x:\n  {old[:120]!r}")
        out = out.replace(old, new)
    if out != src:
        p.write_text(out, encoding=encoding, newline="\n")
        edits += 1
        report.append(relpath)


# ---------------------------------------------------------------- 1. hero text chips
# Six pages carry a worded tier chip.  tierOf() reads data-tier from the TAG (05bce3b),
# so the text is now safe to rename -- that is why the collar commit went first.
for f in ("arena.html", "data.html", "nfl.html"):
    patch(f, [('href="index.html#tiers" title="Why this page is in Labs">Labs</a>',
               'href="index.html#tiers" title="Why this page is a Pup">Pup</a>', 1)])
patch("calculators.html", [('href="index.html#tiers" title="Why this work is in Labs">Labs</a>',
                            'href="index.html#tiers" title="Why this work is a Pup">Pup</a>', 1)])
for f in ("receipts.html", "survivor.html"):
    patch(f, [('href="index.html#tiers" title="What the tiers mean">Labs</a>',
               'href="index.html#tiers" title="What the tiers mean">Pup</a>', 1)])

# The Python builders are the SOURCE for three of those pages.  Patch them or the next
# rebuild silently reverts the HTML.
patch("work/build_arena.py", [('title="Why this page is in Labs">Labs</a>',
                               'title="Why this page is a Pup">Pup</a>', 1)])
patch("work/build_data_library.py", [('title="Why this page is in Labs">Labs</a>',
                                      'title="Why this page is a Pup">Pup</a>', 1)])
patch("work/build_nfl_hub.py", [('title="Why this page is in Labs">Labs</a>',
                                 'title="Why this page is a Pup">Pup</a>', 1)])

# ------------------------------------------------------- 2. TIER_LABEL, four copies
for f in ("arena.html", "nfl.html", "work/build_arena.py", "work/build_nfl_hub.py"):
    patch(f, [('const TIER_LABEL={labs:"Labs",dawg:"Working Dawg",pound:"The DawgHouse"};',
               'const TIER_LABEL={labs:"Pup",dawg:"Working Dawg",pound:"The DawgHouse"};', 1)])

# --------------------------------------------- 3. TIER_MEANING, all FIVE sources
# tools/build-data.js is the real map; three Python backbones hold their own hardcoded
# copy and write 17 of the 24 affected data/ files between them.
patch("tools/build-data.js", [("  labs: '" + OLD_MEAN + "',",
                               "  labs: '" + NEW_MEAN + "',", 1)])

PY_OLD = ('TIER_MEANING = (\n'
          '    "Labs — useful and live, still being challenged. Open questions may remain about "\n'
          '    "calibration, assumptions, data quality or edge. Use with your eyes open."\n'
          ')')
PY_NEW = ('TIER_MEANING = (\n'
          '    "Pup — live and useful, not yet validated. It may compute real answers and still "\n'
          '    "have open questions about calibration, assumptions, data quality or edge. "\n'
          '    "Everything starts here."\n'
          ')')
for f in ("scripts/cfb_data_backbone.py", "scripts/nfl_data_backbone.py",
          "scripts/elo_538_classic.py"):
    patch(f, [(PY_OLD, PY_NEW, 1)])

# The 24 published JSON files carry the sentence as a value.  Patch the string in place
# rather than reserialising -- cfb-market.json is 1 MB and must ship as a patch.
json_hits = 0
for p in sorted((ROOT / "data").glob("*.json")):
    src = p.read_text(encoding="utf-8")
    if OLD_MEAN not in src:
        continue
    # All 24 payloads store the em dash literally, not as —, so the sentence is its
    # own JSON-escaped form. Asserted by the count check below, not assumed.
    out = src.replace(OLD_MEAN, NEW_MEAN)
    if out == src:
        sys.exit(f"ANCHOR FAIL {p.name}: sentence present but replacement was a no-op")
    p.write_text(out, encoding="utf-8", newline="\n")
    json_hits += 1
    edits += 1
if json_hits != 24:
    sys.exit(f"ANCHOR FAIL: expected 24 data/*.json carrying the labs sentence, patched {json_hits}")
report.append(f"data/*.json ({json_hits} files)")

# ------------------------------------------------------- 4. index.html#tiers lifecycle
patch("index.html", [
    ("The path is simple: a tool starts in Labs.",
     "The path is simple: a tool starts as a Pup.", 1),
    ('<span class="lc-chip on">Labs</span>',
     '<span class="lc-chip on">Pup</span>', 1),
    # "Data Dawgs Labs" is the only occurrence in the tree.  The NAME does not die: it
    # stays the PLACE, which is the lab-chip furniture on the three lab pages.
    ("<h3>Data Dawgs Labs</h3>", "<h3>Pups</h3>", 1),
    ("<p><b>Useful, live, still being challenged.</b> A tool starts here. It may compute "
     "real answers and still have open questions about calibration, assumptions, data "
     "quality, or edge. Labs means use it with your eyes open.</p>",
     "<p><b>Live and useful, not yet validated.</b> Everything starts here. It may compute "
     "real answers and still have open questions about calibration, assumptions, data "
     "quality, or edge. A Pup means use it with your eyes open.</p>", 1),
    # the Toto brief block
    ("- LABS — useful and live, still being challenged. A tool can compute real answers "
     "while calibration, assumptions, data quality, or edge remain open.",
     "- PUP — live and useful, not yet validated. A tool can compute real answers while "
     "calibration, assumptions, data quality, or edge remain open. Everything starts here.", 1),
])

# ------------------------------------------------- 5. published prose: receipts-method.md
patch("data/receipts-method.md", [
    ("- **Labs** — useful and live, still being challenged. It may compute real answers and still\n"
     "  have open questions about calibration, assumptions, data quality or edge. Everything starts\n"
     "  here. Labs means use it with your eyes open.",
     "- **Pup** — live and useful, not yet validated. It may compute real answers and still\n"
     "  have open questions about calibration, assumptions, data quality or edge. Everything starts\n"
     "  here. A Pup means use it with your eyes open.", 1),
    # This warning went stale at 05bce3b: tierOf() reads data-tier from the tag now.
    # Leaving it in would tell the next reader the rename above was unsafe.
    ("⚠️ A page's own tier is still read from its hero chip **text** by `tierOf()` in\n"
     "`tools/build-data.js`. Hero chips therefore stay words until that function changes in the same\n"
     "commit. As of 2026-08-09 the collar is card-level only, where the tier comes from the map.\n\n",
     "", 1),
])

MC_ENTRY = """- **2026-08-10 — Labs is renamed Pup, and stops being a tier name.** Human-facing labels
  only. Stored machine values did not move: `tier` is still the string `labs`, and
  /data/surfaces.json still keys the policy on it. The ladder now reads Pup (unvalidated) →
  Working Dawg (validated) → The DawgHouse (the evidence said stop), which names what is
  known about a tool rather than where it lives. *Data Dawgs Labs* survives as the name of a
  PLACE — the lab pages — not a grade. No tool's tier changed, and no forecast, probability
  or benchmark moved. `tier_meaning` is now asserted byte-identical across all 24 published
  payloads and the five sources that write them; before this commit only its existence was
  checked, so two definitions could ship at once.
"""
p = ROOT / "data/receipts-method.md"
src = p.read_text(encoding="utf-8")
anchor = "hash cannot see.\n\n"
if src.count(anchor) != 1:
    sys.exit("ANCHOR FAIL receipts-method.md: material-changes insertion point")
p.write_text(src.replace(anchor, anchor + MC_ENTRY), encoding="utf-8", newline="\n")
edits += 1
report.append("data/receipts-method.md (material-changes entry)")

# ------------------------------------------------------------------ 6. tier-audit.md
# The two lane headings relabel.  The dated ⚠️ finding and headline_finding are HISTORY
# and are locked by test-pound-contracts.js:897 -- deliberately not touched.
patch("data/tier-audit.md", [
    ("## Labs — the ones near the line", "## Pup — the ones near the line", 1),
    ("## Labs — correctly placed, not close", "## Pup — correctly placed, not close", 1),
    ("### Receipts — correctly in Labs, for exactly one reason",
     "### Receipts — correctly a Pup, for exactly one reason", 1),
])
# An audit dated 2026-08-07 should not silently acquire vocabulary from 2026-08-10.
p = ROOT / "data/tier-audit.md"
src = p.read_text(encoding="utf-8")
anchor = "was not checked is stated too. Argue with it.\n"
if src.count(anchor) != 1:
    sys.exit("ANCHOR FAIL tier-audit.md: dated-note insertion point")
note = (anchor + "\n> **Label note, 2026-08-10.** This audit was written when the first tier was called\n"
        "> *Labs*; the headings below now read *Pup*, which is the same tier under its current\n"
        "> name. The tier id `labs` never moved. No row was re-graded — that is its own commit.\n")
p.write_text(src.replace(anchor, note), encoding="utf-8", newline="\n")
edits += 1
report.append("data/tier-audit.md (dated label note)")

# ------------------------------------------------------------------------ 7. llms.txt
# 5,111 of 5,120 bytes. The replacement must be SHORTER; asserted after writing.
patch("llms.txt", [
    ("Tiers: `labs` is challenged; `dawg` validated; `pound` shelved — The DawgHouse. Do not overstate Labs.",
     "Tiers: `labs`=Pup, unvalidated; `dawg`=Working Dawg, validated; `pound`=DawgHouse, stopped.", 1),
])
size = (ROOT / "llms.txt").stat().st_size
if size > 5120:
    sys.exit(f"llms.txt is {size} B, over the 5,120 B ceiling")

# ------------------------------------------------- 8. the MCP registry page description
# Stale on two counts: the tier name, and "The Pound" (renamed 2026-08-09).
patch("work/mcp-block.js", [
    ("the working-dawg taxonomy (Labs / Dawgs / The Pound).",
     "the working-dawg taxonomy (Pup / Dawgs / The DawgHouse).", 1),
])

# ------------------------------------------------- 9. the seven chip-text assertions
patch("work/test-pound-contracts.js", [
    ("test('calculators.html holds the ten forms and claims Labs, not a collar'",
     "test('calculators.html holds the ten forms and claims Pup, not a collar'", 1),
    ('assert.match(html, /class="tierchip"[^>]*>Labs<\\/a>/);',
     'assert.match(html, /class="tierchip"[^>]*>Pup<\\/a>/);', 1),
    ("assert.equal(chip[1].trim(), 'Labs', 'a hub is a directory, not a graded tool');",
     "assert.equal(chip[1].trim(), 'Pup', 'a hub is a directory, not a graded tool');", 1),
    ("assert.equal(chip && chip[1].trim(), 'Labs', 'a hub is a directory, not a graded tool');",
     "assert.equal(chip && chip[1].trim(), 'Pup', 'a hub is a directory, not a graded tool');", 2),
])
for f in ("work/test-arena.mjs", "work/test-data-library.mjs", "work/test-nfl-hub.mjs"):
    patch(f, [('ok("the page\'s own tier chip is Labs", !!chip && chip[1].trim() === "Labs", chip && chip[1]);',
               'ok("the page\'s own tier chip is Pup", !!chip && chip[1].trim() === "Pup", chip && chip[1]);', 1)])
patch("work/test-arena.mjs", [
    ("      Labs — a hub is not a graded tool and must never pick up a collar.",
     "      Pup — a hub is not a graded tool and must never pick up a collar.", 1)])
patch("work/test-nfl-hub.mjs", [
    ("   3. THE HUB CLAIMS NOTHING. No surfaces row, chip is Labs, no collar of its own.",
     "   3. THE HUB CLAIMS NOTHING. No surfaces row, chip is Pup, no collar of its own.", 1)])

print(f"{edits} files patched")
for r in report:
    print("  " + r)
