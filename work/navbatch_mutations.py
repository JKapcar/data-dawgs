#!/usr/bin/env python3
"""
Mutation harness for Stage NB (the nav batch).

Seven mutations, one per new assertion. Each one must turn the NAMED assertion red. An
assertion that survives its own mutation is not testing what its message claims, and the
whole point of the batch — that 25 files agree about one array — would be unguarded.

⚠️ Every mutation here edits a SINGLE page on purpose. The NAV array is asserted identical
across all 25, so a one-page edit trips the per-page assertion first and names the page.
That ordering is the thing being relied on: `blocks.size === 1` would also go red, but it
would not tell you WHICH rule was broken.

Restores every file in a finally block, even on an exception.
"""
import pathlib, re, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BAKDIR = ROOT / "work" / ".navbak"

"""Each row: (name, file, old, new, expected-substring, suite)."""
# ⚠️ cwd matters. test-pound-contracts.js reads data/ relatively and must run from the repo
# root; test-receipts-sheets.mjs resolves its page URLs from work/. Running either from the
# wrong directory dies with ENOENT, which reads like a missing file rather than a wrong cwd.
CONTRACTS = ("test-pound-contracts.js", ".")
SHEETS = ("test-receipts-sheets.mjs", "work")

MUTATIONS = [
    # N1 — the model scoreboard stops being first. This is the "front and centre" ruling;
    # a reorder is the exact way it would rot back, and it is invisible in a diff review.
    ("N1 scoreboard demoted from first", "receipts.html",
     '''      ["receipts.html#models","Model scoreboard","receipts-models"],
      ["receipts.html","Pre-registered calls","receipts"],''',
     '''      ["receipts.html","Pre-registered calls","receipts"],
      ["receipts.html#models","Model scoreboard","receipts-models"],''',
     "the model scoreboard is not the first item in the Receipts group", CONTRACTS),

    # N2 — the shelf item is deleted. Reverting Stage NB by hand looks exactly like this.
    ("N2 shelf item removed from the menu", "index.html",
     '      ["dawghouse.html","The DawgHouse","pound"],\n', "",
     'the shelf is not an item in the nav exactly once, keyed "pound"', CONTRACTS),

    # N3 — the shelf item keeps its place but is keyed "dawghouse", the obvious-looking
    # choice. It renders, it links, it never highlights, and the Receipts group never reads
    # as active on the shelf page. Nothing at runtime complains. This is the mutation that
    # matters most, because the bug it models is silent and cosmetic-looking.
    ("N3 shelf keyed dawghouse, not pound", "index.html",
     '["dawghouse.html","The DawgHouse","pound"],',
     '["dawghouse.html","The DawgHouse","dawghouse"],',
     'the shelf is not an item in the nav exactly once, keyed "pound"', CONTRACTS),

    # N4 — league setup is restored to the Arena group.
    ("N4 league setup back in Arena", "arena.html",
     '      ["guillotine.html","Guillotine Companion","guillotine"],',
     '      ["draft-leagues.html","League setup","draft-leagues"],\n      ["guillotine.html","Guillotine Companion","guillotine"],',
     "draft-leagues.html is back in the nav", CONTRACTS),

    # N5 — the hub link is deleted after the menu entry was removed. draft-leagues.html
    # carries no nav of its own, so this is the mutation that orphans a live page while
    # every other suite stays green.
    ("N5 draft hub drops league setup", "dashboard.html",
     '    <a class="dbsetup" href="draft-leagues.html">League setup &rarr;</a>\n', "",
     "the draft hub does not link league setup exactly once", CONTRACTS),

    # N6 — the grading sheet takes the word "scoreboard" back. Two tabs would then compete
    # for the same word, and the nav item that says "Model scoreboard" would land next to a
    # tab that says "Scoreboard" and mean something else. This is the defect a screenshot
    # found; nothing else on the page notices it.
    ("N6 grading tab reclaims 'Scoreboard'", "receipts.html",
     '{id:"scoreboard",label:"Grading",panel:"#sheetScore"}',
     '{id:"scoreboard",label:"Scoreboard",panel:"#sheetScore"}',
     "FAIL the models sheet is not the grading sheet", SHEETS),

    # N7 — the labels are made "consistent" by renaming the IDS to match. Every
    # receipts.html#models and #scoreboard link on the site is an anchor, so all of them
    # keep resolving to the page and silently land on the default sheet instead.
    ("N7 sheet id renamed to match its label", "receipts.html",
     '{id:"models",label:"Model scoreboard",panel:"#sheetModels"}',
     '{id:"model-scoreboard",label:"Model scoreboard",panel:"#sheetModels"}',
     "FAIL the sheet IDS did not move with the labels", SHEETS),
]


def run(suite):
    script, cwd = suite
    rel = script if cwd != "." else "work/" + script
    r = subprocess.run([shutil.which("node"), rel], cwd=ROOT / cwd,
                       capture_output=True, text=True, timeout=900)
    return r.stdout + r.stderr, r.returncode


def main():
    files = sorted({m[1] for m in MUTATIONS})
    BAKDIR.mkdir(exist_ok=True)
    for f in files:
        shutil.copy(ROOT / f, BAKDIR / f.replace("/", "__"))
    results = []
    try:
        for name, fname, old, new, expect, suite in MUTATIONS:
            path = ROOT / fname
            s = path.read_text(encoding="utf-8")
            n = s.count(old)
            if n != 1:
                results.append((name, "ANCHOR x%d in %s" % (n, fname), False))
                print("  !!!  " + name + "  ->  anchor appears %d times" % n)
                continue
            path.write_text(s.replace(old, new, 1), encoding="utf-8", newline="")
            out, code = run(suite)
            m = re.search(r"(\d+) passed[ /,]+(\d+) failed", out)
            tally = m.group(0) if m else ("suite aborted, exit %d" % code)
            hit = expect in out and code != 0
            results.append((name, tally + "; named assertion red: %s" % hit, hit))
            print(("  RED  " if hit else "  !!!  ") + name + "  ->  " + tally)
            if not hit:
                bad = re.findall(r"AssertionError.*", out)[:2]
                print("        instead: " + (" | ".join(bad) if bad else "nothing failed"))
            shutil.copy(BAKDIR / fname.replace("/", "__"), path)
    finally:
        for f in files:
            shutil.copy(BAKDIR / f.replace("/", "__"), ROOT / f)
        shutil.rmtree(BAKDIR, ignore_errors=True)

    print("\n=== mutation proof ===")
    for name, detail, hit in results:
        print(("PASS " if hit else "FAIL ") + name + "  |  " + detail)
    sys.exit(0 if all(h for _, _, h in results) else 1)


if __name__ == "__main__":
    main()
