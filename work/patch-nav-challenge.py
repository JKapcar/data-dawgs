#!/usr/bin/env python3
"""Sitewide nav sweep: add The Forecast Challenge to the Arena group (Stage FC-E).

The nav is inlined into every page, so a nav change is the same edit applied to all of
them. Per AGENTS.md rule 8 this is a string-replace with `assert count == 1` per file —
the assert is the whole point, because it catches a page that has drifted instead of
silently editing the wrong thing or nothing at all.

⚠️ Three pages carry NO nav (draft-leagues, pound, survivor-settings). They are skipped,
and the skip is ASSERTED rather than assumed: a page that has the nav but not the marker
would mean the nav drifted, and that must fail loudly instead of being quietly passed over.

⚠️ write_text gets newline="\\n" — otherwise Python turns every \\n into \\r\\n on Windows
and CRLF-corrupts an LF repo, which breaks verify-sw's byte hash.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

OLD = '      ["bozo.html","Bozo","bozo"],\n'
NEW = ('      ["bozo.html","Bozo","bozo"],\n'
       '      ["challenge.html","Forecast Challenge","challenge"],\n')

patched, skipped = [], []

for page in sorted(ROOT.glob("*.html")):
    src = page.read_text(encoding="utf-8")

    if "const NAV" not in src:
        # No shared nav on this page at all. Assert it really has no Arena group either,
        # so "no nav" cannot quietly mean "nav I failed to recognise".
        assert 'label:"Arena"' not in src, f"{page.name} has an Arena group but no NAV array"
        skipped.append(page.name)
        continue

    if "challenge.html" in src and '"challenge"]' in src:
        skipped.append(page.name + " (already has it)")
        continue

    n = src.count(OLD)
    assert n == 1, f"{page.name}: nav marker appears {n} times, expected exactly 1"
    src = src.replace(OLD, NEW, 1)
    assert src.count('["challenge.html","Forecast Challenge","challenge"],') == 1, \
        f"{page.name}: the challenge item did not land exactly once"
    assert "\r" not in src, f"{page.name}: a CR appeared before writing"
    page.write_text(src, encoding="utf-8", newline="\n")
    patched.append(page.name)

print(f"patched {len(patched)} pages")
print(f"skipped {len(skipped)}: {', '.join(skipped)}")
