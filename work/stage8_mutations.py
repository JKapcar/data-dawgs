#!/usr/bin/env python3
"""Stage 8 mutation proofs. Each mutation must turn a NAMED assertion red.

If a mutation does NOT turn a test red, the test is not testing what it claims and
gets rewritten. That happened in Stage 6; it is why this file exists.

Usage: python3 work/stage8_mutations.py            (runs all, restores after each)
"""
import subprocess, pathlib, sys, shutil, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "receipts.html"
BAK = ROOT / "work" / ".receipts.stage8.bak"

MUTATIONS = [
    ("M1  a typed number replaces the file's forecast count",
     '`<div class="s8-stat"><b>${fc.length}</b><span>forecasts</span></div>`',
     '`<div class="s8-stat"><b>999</b><span>forecasts</span></div>`',
     "classic: forecast count comes from the file"),

    ("M2  the lazy loader is called at page load",
     'if(id==="classic") loadClassic();',
     'loadClassic(); if(id==="classic") loadClassic();',
     "at page load NONE of the three files is fetched"),

    ("M3  the zero-row file renders an empty table instead of a stated zero",
     'mdlEl("cfrCount").textContent=String(rows.length);',
     'mdlEl("cfrCount").textContent=String(rows.length);'
     'mdlEl("cfrTerms").insertAdjacentHTML("beforebegin",'
     '"<table><tbody></tbody></table>");',
     "cfbrec: a zero-row file renders NO table at all"),

    ("M4  a block OUTSIDE the scroll wrap takes a width wider than 320px",
     '#sheetAudit .s8-neither{border:1px solid var(--border);border-left:3px solid var(--warn);',
     '#sheetAudit .s8-neither{min-width:820px;border:1px solid var(--border);border-left:3px solid var(--warn);',
     "no document overflow at 320 on the audit sheet"),

    ("M5  a belief loader writes into the GRADING panel",
     'mdlEl("auLoad").hidden=true;mdlEl("auTable").hidden=false;',
     'mdlEl("auLoad").hidden=true;mdlEl("auTable").hidden=false;'
     'mdlEl("sheetScore").insertAdjacentHTML("beforeend","<p>graded</p>");',
     "opening all three belief sheets leaves the GRADING panel untouched"),

    ("M6  the classic loader emits a hit-rate claim",
     'mdlEl("clValid").innerHTML=`Week 1 shown',
     'mdlEl("clValid").innerHTML=`Hit rate so far 61.2%. Week 1 shown',
     "no belief sheet claims a result"),
]


def run_suite():
    r = subprocess.run([shutil.which("node"), "work/test-receipts-sheets.mjs"],
                       cwd=ROOT, capture_output=True, text=True, timeout=1800)
    return r.stdout + r.stderr


def main():
    shutil.copy(SRC, BAK)
    results = []
    try:
        for name, old, new, expect in MUTATIONS:
            s = SRC.read_text(encoding="utf-8")
            n = s.count(old)
            if n != 1:
                results.append((name, "ANCHOR x%d" % n, False)); continue
            SRC.write_text(s.replace(old, new, 1), encoding="utf-8")
            out = run_suite()
            fails = re.findall(r"^  FAIL (.+?)(?:  —|$)", out, re.M)
            hit = any(expect in f for f in fails)
            m = re.search(r"(\d+) passed, (\d+) failed", out)
            tally = m.group(0) if m else "suite did not finish"
            results.append((name, f"{tally}; expected assertion red: {hit}", hit))
            print(("  RED  " if hit else "  !!!  ") + name + "  ->  " + tally)
            if not hit and fails:
                print("        red instead: " + " | ".join(sorted(set(fails))[:3]))
            shutil.copy(BAK, SRC)
    finally:
        shutil.copy(BAK, SRC)
        BAK.unlink(missing_ok=True)

    print("\n=== mutation proof ===")
    for name, detail, hit in results:
        print(("PASS " if hit else "FAIL ") + name + "  |  " + detail)
    sys.exit(0 if all(h for _, _, h in results) else 1)


if __name__ == "__main__":
    main()
