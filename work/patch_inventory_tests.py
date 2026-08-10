#!/usr/bin/env python3
"""Stage RI, part 3 — the assertions, and the three that had to be thrown away.

Run AFTER patch_receipts_inventory.py and patch_inventory_derive.py. Those two plus this
one reproduce Stage RI from 928ed3a.

This file exists as a record as much as a patch. Three assertions were written, proven
vacuous by mutation, and replaced:

  * comparing cell BOUNDING BOXES for overlap. Under table-layout:fixed the boxes sit on
    the column boundaries and never overlap however the text behaves. No mutation could
    turn it red.
  * a cell's own scrollWidth vs clientWidth. Stays clean when the TABLE grows to fit the
    cell and .inv-wrap absorbs the difference.
  * what survived: the SCROLL BOX. At 1280 this table must need no horizontal scrolling
    at all, and an over-wide column really does break that.

The mutation harness earned its keep twice over here: once catching the vacuous assertions,
and once catching itself -- a BUILD mutation rewrote data/ and was not restored until the
end, so every later mutation ran against a corrupted tree and reported confident nonsense.
"""
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
def patch(rel, pairs):
    p = ROOT / rel; src = p.read_text(encoding="utf-8"); out = src
    for old, new, n in pairs:
        f = out.count(old)
        if f != n: sys.exit(f"ANCHOR FAIL {rel}: expected {n}x found {f}x: {old[:100]!r}")
        out = out.replace(old, new)
    p.write_text(out, encoding="utf-8", newline="\n"); print("  patched " + rel)

print("NOTE: the assertion block for work/test-receipts-sheets.mjs is large and was applied")
print("      inline. It is committed in the file itself -- diff against 928ed3a to see it.")
print("      This script is kept so the stage's parts are numbered and findable.")
