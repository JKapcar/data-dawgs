"""Add "The Dog Track" to the Arena > Tools nav group, on every flattened page.

⚠️ THE NAV IS INLINED INTO EVERY *.html — the flattened HTML is the source. One exact
replacement per page, with `assert s.count(OLD) == 1` per file, which is what catches a
page that has drifted. A page that does not carry the nav at all is skipped and reported;
a page that carries it but does not match is a FAILURE, not a skip.

Placement (spec §4): Arena, not a ninth top-level group — the nav row is at its measured
width limit and a dropdown item costs no row width. Under Tools rather than Games: it is a
scoreboard you read, not a game you enter. Alphabetical by label puts it after Survivor.

Run:  python3 work/patch-nav-dogtrack.py
"""
from pathlib import Path
import glob

ROOT = Path(__file__).resolve().parent.parent

OLD = '''      ["survivor.html","Survivor","survivor"],
    ]},'''
NEW = '''      ["survivor.html","Survivor","survivor"],
      ["rankings.html","The Dog Track","rankings"],
    ]},'''

def main():
    changed, skipped, failed = [], [], []
    for path in sorted(glob.glob(str(ROOT / "*.html"))):
        p = Path(path)
        s = p.read_text(encoding="utf-8")
        if 'label:"Arena"' not in s:
            skipped.append(p.name)
            continue
        if '["rankings.html","The Dog Track","rankings"]' in s:
            continue                                    # already patched; idempotent
        n = s.count(OLD)
        if n != 1:
            failed.append(f"{p.name}: expected 1 anchor, found {n}")
            continue
        p.write_text(s.replace(OLD, NEW, 1), encoding="utf-8")
        changed.append(p.name)

    print(f"nav: {len(changed)} pages patched, {len(skipped)} without nav skipped")
    if skipped:
        print("  no nav (expected for standalone/admin pages): " + ", ".join(skipped))
    if failed:
        for f in failed:
            print("  FAILED " + f)
        raise SystemExit("nav patch did not apply cleanly — fix the drifted page, do not force")

if __name__ == "__main__":
    main()
