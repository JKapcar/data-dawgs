#!/usr/bin/env python3
"""Rename the public challenge label across flattened page copies.

The count is asserted before and after so navigation or HELP/MAP copies that drift
cannot be silently skipped.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD = "Forecast Challenge"
NEW = "NFL Forecasting Challenge"
paths = sorted(ROOT.glob("*.html"))
counts = {path: path.read_text(encoding="utf-8").count(OLD) for path in paths}
total = sum(counts.values())
assert total == 60, f"expected 60 old labels, found {total}"
assert all(n in (0, 2, 3, 5) for n in counts.values()), counts
for path, n in counts.items():
    if n:
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace(OLD, NEW), encoding="utf-8", newline="")
assert sum(path.read_text(encoding="utf-8").count(OLD) for path in paths) == 0
assert sum(path.read_text(encoding="utf-8").count(NEW) for path in paths) == total
print(f"renamed {total} labels across {sum(bool(n) for n in counts.values())} pages")
