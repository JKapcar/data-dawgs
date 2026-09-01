"""Apply the Midnight Midway base-theme palette to bozo.html.

The page is dark-first: base :root is night mode and the light-theme override stays
untouched.  This patch is deliberately anchor-based and idempotent.
"""
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "bozo.html"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    if old_count == 0 and new_count == 1:
        print(f"  skip {label} — already patched")
        return text
    raise AssertionError(
        f"{label}: expected old/new counts 1/0 or 0/1, got {old_count}/{new_count}"
    )


s = PAGE.read_text(encoding="utf-8")
s = replace_once(
    s,
    '<meta name="theme-color" content="#161009" media="(prefers-color-scheme: dark)">',
    '<meta name="theme-color" content="#070a08" media="(prefers-color-scheme: dark)">',
    "dark theme-color",
)
s = replace_once(
    s,
    "  --surface-1:#241c12; --page:#161009;",
    "  --surface-1:#241c12; --page:#070a08;",
    "page ground",
)
s = replace_once(
    s,
    """  --pb-stock:#1c1509; --pb-ink:#f4ebda; --pb-ink2:#bcb098; --pb-ink3:#8d8371;
  --pb-red:#ff6a02; --pb-rule:#3c3122; --pb-edge:#4d3d27;
  --pb-shadow:rgba(0,0,0,.46);""",
    """  --pb-stock:#0d100c; --pb-ink:#cfd3bd; --pb-ink2:#8b9179; --pb-ink3:#5d6251;
  --pb-red:#b6421a; --pb-rule:rgba(207,211,189,.10); --pb-edge:#241a0d;
  --pb-shadow:rgba(0,0,0,.46);""",
    "playbill palette",
)
PAGE.write_text(s, encoding="utf-8", newline="\n")
print("  bozo.html Midnight Midway tokens current")
