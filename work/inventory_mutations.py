#!/usr/bin/env python3
"""Mutation proofs for Stage RI — the receipts inventory.

The risk of this stage is not a broken table. It is a page that LOOKS like an honest count
and is not: a typed number that has gone stale, an aggregate that quietly double-counts the
overlapping ledgers, a score column creeping back in, or the tier audit's judgment being
added to a forecast total.

R7 is the one that matters most. The first cut of this sheet fetched all four ledgers on
show, and because the inventory is the DEFAULT sheet that pulled ~830 KB on first paint and
broke the lazy-load contract. That mutation puts the mistake back and must go red.
"""
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BAKDIR = ROOT / "work" / ".invbak"

VALIDATE = ("node", "tools/validate-data.js")
SHEETS = ("node", "work/test-receipts-sheets.mjs")
# ⚠️ A mutation to tools/build-data.js is a NO-OP until the builder runs: validate-data.js
# reads the already-PUBLISHED receipts-inventory.json. R3 and R5 both survived on the first
# attempt for exactly this reason, which is itself worth knowing -- a mutation that does not
# reach the artefact under test proves nothing. These rebuild first.
BUILD_VALIDATE = ("BUILD", "tools/validate-data.js")

MUTATIONS = [
    ("R1  a count is typed into the inventory markup",
     "receipts.html",
     '<b id="invForecasts">&mdash;</b><span>forecasts registered</span>',
     '<b id="invForecasts">544</b><span>forecasts registered</span>',
     "no count is typed into the inventory markup", SHEETS),

    ("R2  a score column creeps into the inventory table",
     "receipts.html",
     "<thead><tr><th>Ledger</th><th>Registered</th><th>Settled</th>",
     "<thead><tr><th>Ledger</th><th>Brier</th><th>Registered</th><th>Settled</th>",
     "the inventory table has no score column", SHEETS),

    ("R3  the aggregate becomes the column sum (the overlap double-count)",
     "tools/build-data.js",
     "      forecasts: sup.registered,",
     "      forecasts: ledgers.reduce((a, l) => a + l.registered, 0),",
     "the overlap was double-counted", BUILD_VALIDATE),

    ("R4  a published ledger count goes stale",
     "data/receipts-inventory.json",
     '"registered": 272,',
     '"registered": 271,',
     "but the file holds", VALIDATE),

    ("R5  the tier audit is added to the forecast ledgers",
     "tools/build-data.js",
     "  { file: 'cfb-model-receipts.json', id: 'cfb-model-receipts',",
     "  { file: 'tier-audit.json', id: 'audit', name: 'Tier audit', sheet: 'audit',\n"
     "    rows: d => d, what: 'A judgment.' },\n"
     "  { file: 'cfb-model-receipts.json', id: 'cfb-model-receipts',",
     "a judgment is not a forecast", BUILD_VALIDATE),

    ("R6  the do-not-sum warning is dropped",
     "receipts.html",
     "`<b>Do not add the Registered column up.</b> It comes to ${invNum(ag.naive_sum)}, which `+",
     "`It comes to ${invNum(ag.naive_sum)}, which `+",
     "warns against summing the Registered column", SHEETS),

    # R8 and R9 were originally "remove table-layout:fixed" and "nowrap the description".
    # Both SURVIVED, because moving the description into its own colspan row removed that
    # failure mode entirely -- the mutations no longer described a reachable defect.
    # Replaced with mutations that do: an over-wide column really does push the right-hand
    # columns out of the scroll box, and a nowrap cell really does paint outside itself.
    # A mutation that cannot fail is as useless as a test that cannot.
    #
    # A THIRD attempt at R9 -- nowrap the description row -- was also dropped, for the same
    # reason rather than a different one: at 1280 those sentences fit on one line even
    # unwrapped, so nothing overflowed. The sideways-scroll property is already proven by
    # R8, and adding a mutation that cannot go red would only make this harness look more
    # thorough than it is.
    ("R8  a column is wide enough to push the others out of the scroll box",
     "receipts.html",
     "#sheetInv .inv-tbl col.c-led{width:30%}",
     "#sheetInv .inv-tbl col.c-led{width:150%}",
     "needs no sideways scrolling at 1280", SHEETS),

    ("R7  the default sheet goes back to fetching every ledger (830 KB on first paint)",
     "receipts.html",
     'const env=await mdlJson("/data/receipts-inventory.json");',
     'const env=await mdlJson("/data/receipts-inventory.json");\n'
     '    await mdlJson("/data/538-classic.json");await mdlJson("/data/cfb-model-receipts.json");'
     'await mdlJson("/data/tier-audit.json");',
     "NONE of the three files is fetched", SHEETS),
]


def run(cmd):
    node = shutil.which("node")
    if cmd[0] == "BUILD":
        env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "DD_BUILD_DATE": "2026-08-10"}
        b = subprocess.run([node, "tools/build-data.js"], cwd=ROOT, capture_output=True,
                           text=True, timeout=900, env=env)
        if b.returncode != 0:
            # a builder that cannot run is a red result too, and the reason must be visible
            return b.stdout + b.stderr, b.returncode
        r = subprocess.run([node, cmd[1]], cwd=ROOT, capture_output=True, text=True, timeout=900)
        return b.stdout + b.stderr + r.stdout + r.stderr, r.returncode
    r = subprocess.run([node] + list(cmd[1:]), cwd=ROOT, capture_output=True,
                       text=True, timeout=900)
    return r.stdout + r.stderr, r.returncode


def main():
    files = sorted({m[1] for m in MUTATIONS})
    BAKDIR.mkdir(exist_ok=True)
    for f in files:
        shutil.copy2(ROOT / f, BAKDIR / f.replace("/", "__"))
    # ⚠️ A BUILD mutation rewrites all of data/, so the whole directory is the blast radius.
    datbak = BAKDIR / "data"
    if datbak.exists():
        shutil.rmtree(datbak)
    shutil.copytree(ROOT / "data", datbak)

    for cmd in {m[5] for m in MUTATIONS}:
        out, rc = run(cmd)
        if rc != 0:
            print("BASELINE NOT GREEN, results would be meaningless: " + " ".join(cmd))
            print(out[-600:])
            for f in files:
                shutil.copy2(BAKDIR / f.replace("/", "__"), ROOT / f)
            shutil.rmtree(ROOT / "data")
            shutil.copytree(datbak, ROOT / "data")
            shutil.rmtree(BAKDIR, ignore_errors=True)
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
            # ⚠️ RESTORE data/ AFTER EVERY BUILD MUTATION, not just in the finally. A
            # BUILD mutation rewrites the published payloads, and leaving them mutated
            # made every LATER mutation run against a corrupted tree -- R8 and R9 came
            # back RED-WRONG for that reason and looked like bad assertions when the
            # harness was the thing at fault. State leaking between mutations makes a
            # mutation harness worse than none: it reports confident nonsense.
            if cmd[0] == "BUILD":
                shutil.rmtree(ROOT / "data")
                shutil.copytree(datbak, ROOT / "data")
            named = expect in out
            if rc != 0 and named:
                results.append((name, "RED", f"named assertion red: {expect[:60]}"))
            elif rc != 0:
                results.append((name, "RED-WRONG", "failed, but NOT on the named assertion"))
            else:
                results.append((name, "GREEN", "MUTATION SURVIVED — the test is not testing this"))
    finally:
        for f in files:
            shutil.copy2(BAKDIR / f.replace("/", "__"), ROOT / f)
        shutil.rmtree(ROOT / "data")
        shutil.copytree(datbak, ROOT / "data")
        shutil.rmtree(BAKDIR, ignore_errors=True)

    print()
    bad = 0
    for name, verdict, detail in results:
        print(f"  {verdict:10s} {name}\n             -> {detail}")
        if verdict != "RED":
            bad += 1
    print(f"\n{len(results) - bad} of {len(results)} mutations turned a named assertion red")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
