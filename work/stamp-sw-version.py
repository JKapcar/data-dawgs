"""
Re-stamp sw.js VERSION from the HTML currently on disk.

AGENTS.md rule 3: any page change ships with a VERSION bump. VERSION is a cache key —
it only has to change — and the house convention is the md5 of every `*.html`
concatenated in sorted order, first 10 hex. Doing it by hand is how a deploy ends up
serving a stale page out of the service worker, so it is a script.

Note: a DATA-only change does not need this. teamdraft.html reads /data/draft-2026.json
at runtime, so appending draft picks changes no HTML and needs no bump.

    cd work && python3 stamp-sw-version.py
"""
import hashlib
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent

h = hashlib.md5()
# ⚠️ *.html AND root *.js (sw.js excluded) — sw.js's own header has claimed this set all
# along, but only the HTML was ever hashed. The gap bit on draft night 2026-08-27: a JS
# contract change re-keyed nothing, an old SW served stale cache-first js against fresh
# network-first html, and the pair mismatch killed the rig. verify-sw.mjs mirrors this
# set exactly — if you widen one side, widen the other in the same commit.
files = sorted(REPO.glob("*.html")) + sorted(p for p in REPO.glob("*.js") if p.name != "sw.js")
for f in files:
    # Git stores these text assets with LF even when core.autocrlf checks them out as
    # CRLF on Windows. Hash the canonical form so this script matches verify-sw.mjs,
    # which reads the staged Git blobs rather than platform-specific working bytes.
    h.update(f.read_bytes().replace(b"\r\n", b"\n"))
new = h.hexdigest()[:10]

p = REPO / "sw.js"
s = p.read_text(encoding="utf-8")
marker = 'const VERSION = "'
assert s.count(marker) == 1, "sw.js VERSION declaration is not unique"
old = s.split(marker)[1].split('"')[0]

if old == new:
    print(f"  sw.js VERSION already current at {new}")
else:
    p.write_text(s.replace(f'{marker}{old}"', f'{marker}{new}"', 1), encoding="utf-8", newline=chr(10))
    print(f"  sw.js VERSION {old} -> {new}")
