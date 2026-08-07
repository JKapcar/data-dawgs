#!/usr/bin/env python3
"""Port the universal auth module into draft-leagues.html's compact header."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "draft-leagues.html"
CSS = (ROOT / "work" / "navauth.css.txt").read_text(encoding="utf-8").rstrip("\n")
JS = (ROOT / "work" / "navauth.js.txt").read_text(encoding="utf-8").rstrip("\n")

CSS_ANCHOR = "  </style>"
JS_ANCHOR = '<script src="draft-providers.js"></script>'
TAIL = "  nav.appendChild(authSec);"
SENTINEL = "window.DDAuth"

HUB_CSS = """
/* draft hub aliases for the shared auth module's site tokens */
:root{--page:var(--paper);--surface-1:var(--card);--border:var(--line);
  --accent:var(--orange);--accent-ink:#111;--ink-1:var(--ink);--ink-2:var(--muted);
  --ink-3:var(--muted);--bad:var(--red);--good:var(--green);--navink:var(--ink)}
.top .navauth{margin-left:auto}
@media(max-width:420px){.top{gap:8px}.top>.muted{display:none}
  .top .navauth .authbtn{max-width:110px;padding:4px 9px}}
""".strip()


def exactly_once(text, needle, label):
    count = text.count(needle)
    if count != 1:
        raise SystemExit(f"FAILED {TARGET.name}: {label} appears {count} times, expected 1")


source = TARGET.read_text(encoding="utf-8")
if SENTINEL in source:
    print(f"skip {TARGET.name}: already patched")
    raise SystemExit(0)

exactly_once(source, CSS_ANCHOR, "style close anchor")
exactly_once(source, JS_ANCHOR, "provider script anchor")
exactly_once(JS, TAIL, "shared nav append tail")

hub_js = JS.replace(
    TAIL,
    '  const authHost = document.querySelector(".top");\n'
    '  if(!authHost) throw new Error("Draft hub auth host missing.");\n'
    "  authHost.appendChild(authSec);",
)
output = source.replace(CSS_ANCHOR, CSS + "\n" + HUB_CSS + "\n" + CSS_ANCHOR)
output = output.replace(JS_ANCHOR, JS_ANCHOR + "\n<script>\n" + hub_js + "\n</script>")

for needle, label in [
    (".navauth{display:flex", "auth CSS"),
    ('id = "ddAuthBtn"', "auth chip"),
    ("window.DDAuth = {", "auth module"),
    ("authHost.appendChild(authSec)", "compact-header append"),
    ('window.addEventListener("storage"', "cross-tab listener"),
]:
    exactly_once(output, needle, label)
exactly_once(
    output,
    "authHost.appendChild(authSec);\n  window.DDAuth.render();",
    "compact-header append followed by initial render",
)

TARGET.write_text(output, encoding="utf-8", newline="\n")
print(f"patched {TARGET.name}: complete auth module added to compact header")
