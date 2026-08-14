"""Restore the desktop brand lockup in the one-row mobile banner."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OLD_AUTH = "  .sitenav .navauth{margin-left:5px}"
NEW_AUTH = "  .sitenav .navauth{margin-left:auto}"
MARKER = "/* ---- cards & type ---- */"

BRAND_CSS = '''/* Desktop's compact brand lockup belongs on phones too. Stack the tagline under
   DATA DAWGS so it costs height, not horizontal room. The dog-only fallback remains
   below 360px, where the full lockup and six domains cannot coexist legibly. */
@media(min-width:360px) and (max-width:519px){
  .sitenav .brand{display:grid;grid-template-columns:22px auto;
    grid-template-rows:auto auto;column-gap:5px;row-gap:0;align-items:center;
    margin-left:-8px}
  .sitenav .brand img{grid-column:1;grid-row:1/3}
  .sitenav .brand .logo{display:block;grid-column:2;grid-row:1;
    font-size:9.5px;line-height:1;letter-spacing:-.3px;white-space:nowrap}
  .sitenav .brand .tag{display:block;grid-column:2;grid-row:2;
    font-size:5.5px;line-height:1;letter-spacing:.04em;white-space:nowrap}
  .sitenav .links{gap:4px}
  .sitenav .links .navgrp:first-child{margin-left:auto}
  .sitenav .navauth{margin-left:auto}
}
@media(min-width:360px) and (max-width:379px){
  .sitenav{gap:0 6px}
  .sitenav .brand{grid-template-columns:20px auto;column-gap:4px}
  .sitenav .brand img{width:20px;height:25px}
  .sitenav .brand .logo{font-size:8.5px}
  .sitenav .brand .tag{font-size:5px}
  .sitenav .links{gap:3px}
  .sitenav .links a,.sitenav .links .grpbtn{padding:3px 1px;font-size:9.5px}
  .sitenav .navauth .authbtn{padding:3px 4px;font-size:9px;max-width:58px}
  .sitenav .links .theme-btn{margin-left:0;padding:3px 4px;font-size:11px}
}
@media(min-width:380px) and (max-width:419px){
  .sitenav .links{gap:5px}
  .sitenav .links a,.sitenav .links .grpbtn{padding:4px 1px;font-size:10.5px}
}
'''

changed = []
for path in sorted(ROOT.glob("*.html")):
    text = path.read_text(encoding="utf-8")
    if "const NAV = [" not in text:
        continue
    assert text.count(OLD_AUTH) == 1, f"{path.name}: mobile auth rule drifted"
    assert text.count(MARKER) == 1, f"{path.name}: cards marker drifted"
    assert "Desktop's compact brand lockup" not in text, f"{path.name}: lockup already present"
    text = text.replace(OLD_AUTH, NEW_AUTH, 1)
    text = text.replace(MARKER, BRAND_CSS + MARKER, 1)
    path.write_text(text, encoding="utf-8")
    changed.append(path.name)

assert len(changed) == 28, f"expected 28 shared-nav pages, changed {len(changed)}"
print(f"restored mobile brand lockup in {len(changed)} pages")
