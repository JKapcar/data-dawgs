#!/usr/bin/env python3
"""Mutation proofs for the hero collar + tierOf() change.

The whole risk of this commit is a SILENT demotion: the glyph removes the word "Dawg",
tierOf() reports labs, and every /data/ envelope for dashboard, nfelo and stats quietly
drops a tier with nothing failing. Each mutation below re-creates one way that could
happen and must turn a NAMED assertion red.
"""
import subprocess, pathlib, shutil, sys, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
BAKDIR = ROOT / "work" / ".collarbak"

MUTATIONS = [
    ("C1  data-tier stripped from a collared page (the silent demotion)",
     "nfelo.html",
     '<a class="tierchip tierchip-collar" data-tier="dawg" href="index.html#tiers"',
     '<a class="tierchip tierchip-collar" href="index.html#tiers"',
     "nfelo.html has a tier chip with no data-tier"),

    ("C2  tierOf() reverted to reading the chip TEXT only",
     "tools/build-data.js",
     '  const tag = html.match(/<[a-z]+[^>]*class="tierchip[^"]*"[^>]*>/);\n'
     '  if (tag) {\n'
     '    const a = tag[0].match(/data-tier="([a-z]+)"/);\n'
     '    if (a && TIERS[a[1]]) return TIERS[a[1]];\n'
     '  }\n',
     '',
     "tierOf() no longer reads data-tier"),

    ("C3  the word Dawg put back into a collared chip",
     "stats.html",
     '<span class="collar" role="img" aria-label="Working Dawg — earned its collar">',
     'Dawg</a><span class="collar" role="img" aria-label="Working Dawg — earned its collar">',
     "put the word back"),

    ("C4  the collar glyph loses its accessible name",
     "dashboard.html",
     '<span class="collar" role="img" aria-label="Working Dawg — earned its collar">',
     '<span class="collar">',
     "no accessible name on its collar glyph"),

    ("C5  a chip's data-tier disagrees with committed surfaces.json",
     "survivor.html",
     '<a class="tierchip lab" data-tier="labs" href="index.html#tiers"',
     '<a class="tierchip lab" data-tier="dawg" href="index.html#tiers"',
     "but survivor.html now derives dawg"),
]


def run():
    r = subprocess.run([shutil.which("node"), "work/test-pound-contracts.js"],
                       cwd=ROOT, capture_output=True, text=True, timeout=600)
    return r.stdout + r.stderr, r.returncode


def main():
    files = sorted({m[1] for m in MUTATIONS})
    BAKDIR.mkdir(exist_ok=True)
    for f in files:
        shutil.copy(ROOT / f, BAKDIR / f.replace("/", "__"))
    results = []
    try:
        for name, fname, old, new, expect in MUTATIONS:
            path = ROOT / fname
            s = path.read_text(encoding="utf-8")
            n = s.count(old)
            if n != 1:
                results.append((name, "ANCHOR x%d in %s" % (n, fname), False)); continue
            path.write_text(s.replace(old, new, 1), encoding="utf-8")
            out, code = run()
            m = re.search(r"(\d+) passed / (\d+) failed", out)
            tally = m.group(0) if m else ("suite aborted, exit %d" % code)
            hit = expect in out and code != 0
            results.append((name, tally + "; named assertion red: %s" % hit, hit))
            print(("  RED  " if hit else "  !!!  ") + name + "  ->  " + tally)
            if not hit:
                bad = re.findall(r"not ok.*", out)[:2]
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
