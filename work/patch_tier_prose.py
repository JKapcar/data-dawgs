#!/usr/bin/env python3
"""Stage TR, part 2 — the vocabulary defects the new assertions exposed.

Run AFTER work/patch_tier_rework.py. Together the two scripts reproduce this commit
from 26f3bf8.

Three of these were not in the spec. The first was found by the new TIER_LABEL
assertion; the other two were found by reading the lines around it, and both are
cases of a page contradicting itself in a place nothing was checking.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def patch(relpath, pairs):
    p = ROOT / relpath
    src = p.read_text(encoding="utf-8")
    out = src
    for old, new, count in pairs:
        found = out.count(old)
        if found != count:
            sys.exit(f"ANCHOR FAIL {relpath}: expected {count}x, found {found}x:\n  {old[:120]!r}")
        out = out.replace(old, new)
    p.write_text(out, encoding="utf-8", newline="\n")
    print(f"  patched {relpath}")


patch("index.html", [
    # 1. The homepage lifecycle taught "Dawgs" while every hero chip, every card and
    #    TIER_LABEL said "Working Dawg". The h3 underneath already read "Working Dawgs",
    #    so the chip was the only thing out of step. Caught by the new assertion.
    ('<span class="lc-chip">Dawgs</span>',
     '<span class="lc-chip">Working Dawg</span>', 1),

    # 2. "These pups can be rehabilitated" now collides head-on with the Pup tier: a
    #    DawgHouse tenant is the opposite of a Pup. The word has to go in both places.
    ("Shelved is not erased. These pups can be rehabilitated—that's why they go to The DawgHouse,",
     "Shelved is not erased. Shelved work can be rehabilitated—that's why it goes to The DawgHouse,", 1),

    # 3. The Toto brief was stale on two counts and contradicted the page directly above
    #    it: the tier was renamed The DawgHouse on 2026-08-09, and the shelf stopped being
    #    empty the same day. An agent reading this block would have told a user the shelf
    #    was empty while the page said it was not.
    #    NOTE: the "The Pound is empty" wording in data/tier-audit.json and receipts.html
    #    is a DATED 2026-08-07 finding, not a live claim. It stays, and
    #    test-pound-contracts.js locks it.
    ("- THE POUND — where ideas go when the evidence says stop. Shelved is not erased. "
     "These pups can be rehabilitated, so the failure, the reason, and the condition that "
     "could reopen the case stay attached. It is empty today.",
     "- THE DAWGHOUSE (formerly The Pound) — where ideas go when the evidence says stop. "
     "Shelved is not erased. Shelved work can be rehabilitated, so the failure, the reason, "
     "and the condition that could reopen the case stay attached. It is not empty; every "
     "tenant keeps its blocker and its way back.", 1),
])

print("done")
