#!/usr/bin/env python3
"""Mutation proofs for Stage TR — the Labs→Pup relabel.

The risk of this commit is not a broken page. It is TWO DEFINITIONS SHIPPING AT ONCE.
`tier_meaning` is written from five independent sources and `tools/validate-data.js`
only ever checked that the field EXISTED, so patching the real map while seventeen
payloads kept the old sentence was green on every gate. TIER_LABEL had the same shape
one layer up: four copies, two of them the Python builders that GENERATE the two pages,
and nothing compared them.

Each mutation below re-creates one way this stage could have been silently wrong and
must turn a NAMED assertion red. T3 is the important one: it proves the new check
reports itself blind rather than passing vacuously when it cannot find its source.
"""
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BAKDIR = ROOT / "work" / ".tierbak"

VALIDATE = ("node", "tools/validate-data.js")
CONTRACTS = ("node", "work/test-pound-contracts.js")
ARENA = ("node", "work/test-arena.mjs")

OLD_MEAN = ("Labs — useful and live, still being challenged. Open questions may remain "
            "about calibration, assumptions, data quality or edge. Use with your eyes open.")
NEW_MEAN = ("Pup — live and useful, not yet validated. It may compute real answers and "
            "still have open questions about calibration, assumptions, data quality or "
            "edge. Everything starts here.")

MUTATIONS = [
    # The headline mutation named in the spec.
    ("T1  one CFB payload keeps the old sentence (the two-definitions bug)",
     "data/cfb-ratings.json", NEW_MEAN, OLD_MEAN,
     "cfb-ratings.json: tier_meaning does not match TIER_MEANING.labs",
     VALIDATE),

    # The exact failure mode the old validator allowed: change the real map, leave the
    # seventeen Python-written payloads alone. Before this commit, green.
    ("T2  the real map moves and the published payloads do not",
     "tools/build-data.js", "  labs: '" + NEW_MEAN + "',",
     "  labs: 'Pup — something else entirely.',",
     "tier_meaning does not match TIER_MEANING.labs",
     VALIDATE),

    # A check that silently passes when it cannot find its source is worse than no check.
    ("T3  the TIER_MEANING map is renamed, so the check cannot find it",
     "tools/build-data.js", "const TIER_MEANING = {", "const TIER_MEANINGS = {",
     "could not parse the TIER_MEANING map — this check is now blind",
     VALIDATE),

    # The builder-drift bug: patch the page, forget the builder that regenerates it.
    ("T4  build_arena.py drifts from the page it generates",
     "work/build_arena.py", 'const TIER_LABEL={labs:"Pup"',
     'const TIER_LABEL={labs:"Labs"',
     "disagrees with arena.html about the tier labels",
     CONTRACTS),

    # A half-finished relabel: one hero chip left on the old word.
    # Deliberately survivor.html and not calculators.html. calculators.html is already
    # covered by an older literal assertion that fires first, so mutating it would prove
    # that assertion rather than this one. survivor.html's chip had NO guard at all before
    # this commit — its class is "tierchip lab", which the older regex never matched.
    ("T5  one hero chip is left reading the old label",
     "survivor.html", '"What the tiers mean">Pup</a>',
     '"What the tiers mean">Labs</a>',
     'survivor.html chip reads "Labs", which is not in TIER_LABEL',
     CONTRACTS),

    # The homepage is where the vocabulary is taught. It must not teach a fourth word.
    ("T6  the homepage lifecycle teaches a word no chip uses",
     "index.html", '<span class="lc-chip on">Pup</span>',
     '<span class="lc-chip on">Labs</span>',
     'index.html#tiers teaches "Labs", which is not in TIER_LABEL',
     CONTRACTS),

    # The relabelled directory-chip assertions must still bite after being moved.
    ("T7  a hub chip claims a grade it did not earn",
     "arena.html", '"Why this page is a Pup">Pup</a>',
     '"Why this page is a Pup">Working Dawg</a>',
     "the page's own tier chip is Pup",
     ARENA),
]


def run(cmd):
    r = subprocess.run([shutil.which(cmd[0])] + list(cmd[1:]),
                       cwd=ROOT, capture_output=True, text=True, timeout=900)
    return r.stdout + r.stderr, r.returncode


def main():
    files = sorted({m[1] for m in MUTATIONS})
    BAKDIR.mkdir(exist_ok=True)
    for f in files:
        dest = BAKDIR / f.replace("/", "__")
        shutil.copy2(ROOT / f, dest)

    # Prove the tree is green before mutating, or every "RED" below is meaningless.
    baseline_bad = []
    for cmd in {m[5] for m in MUTATIONS}:
        out, rc = run(cmd)
        if rc != 0:
            baseline_bad.append(" ".join(cmd))
    if baseline_bad:
        print("BASELINE NOT GREEN — mutation results would be meaningless:")
        for b in baseline_bad:
            print("   " + b)
        return 2

    results = []
    try:
        for name, relpath, old, new, expect, cmd in MUTATIONS:
            p = ROOT / relpath
            src = p.read_text(encoding="utf-8")
            if src.count(old) < 1:
                results.append((name, "SKIP", "anchor not found: " + old[:60]))
                continue
            p.write_text(src.replace(old, new, 1), encoding="utf-8", newline="\n")
            out, rc = run(cmd)
            p.write_text(src, encoding="utf-8", newline="\n")
            named = expect in out
            if rc != 0 and named:
                results.append((name, "RED", f"named assertion red: {expect[:70]}"))
            elif rc != 0:
                results.append((name, "RED-WRONG", "failed, but NOT on the named assertion"))
            else:
                results.append((name, "GREEN", "MUTATION SURVIVED — the test is not testing this"))
    finally:
        for f in files:
            shutil.copy2(BAKDIR / f.replace("/", "__"), ROOT / f)
        shutil.rmtree(BAKDIR, ignore_errors=True)

    print()
    bad = 0
    for name, verdict, detail in results:
        print(f"  {verdict:10s} {name}  ->  {detail}")
        if verdict != "RED":
            bad += 1
    print()
    print(f"{len(results) - bad} of {len(results)} mutations turned a named assertion red")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
