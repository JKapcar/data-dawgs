"""Give the one-row phone banner a meaningful brand/domains/account hierarchy."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

OLD = '''  .sitenav{flex-wrap:nowrap;gap:0 4px}
  .sitenav .links{flex:1 1 auto;margin-left:0;justify-content:flex-end;
    flex-wrap:nowrap;gap:0;padding-top:0}
  .sitenav .links .theme-btn{margin-left:1px}
  .sitenav .navauth{margin-left:0}
  .sitenav .navauth .authbtn{padding:3px 6px;font-size:10px;max-width:72px}
  .sitenav .links a,.sitenav .links .grpbtn{
    padding:4px 1px;font-size:10px;letter-spacing:-.3px}'''

NEW = '''  .sitenav{flex-wrap:nowrap;gap:0 10px}
  .sitenav .links{flex:1 1 auto;margin-left:0;justify-content:flex-start;
    flex-wrap:nowrap;gap:4px;padding-top:0}
  .sitenav .links .theme-btn{margin-left:2px}
  .sitenav .navauth{margin-left:auto}
  .sitenav .navauth .authbtn{padding:3px 6px;font-size:10px;max-width:72px}
  .sitenav .links a,.sitenav .links .grpbtn{
    padding:4px 1px;font-size:11px;letter-spacing:-.2px}'''

OLD_NARROW = '''  .sitenav{gap:0 2px}
  .sitenav .brand img{width:20px;height:25px}
  .sitenav .navauth .authbtn{padding:3px 5px;font-size:9.5px;max-width:64px}
  .sitenav .links{justify-content:flex-end}
  .sitenav .links a,.sitenav .links .grpbtn{padding:3px 1px;font-size:9px}'''

NEW_NARROW = '''  .sitenav{gap:0 6px}
  .sitenav .brand img{width:20px;height:25px}
  .sitenav .navauth .authbtn{padding:3px 5px;font-size:9.5px;max-width:64px}
  .sitenav .links{justify-content:flex-start;gap:2px}
  .sitenav .links a,.sitenav .links .grpbtn{padding:3px 1px;font-size:9.5px}'''

OLD_AUTH = '''  nav.appendChild(authSec);
  window.DDAuth.render();'''

NEW_AUTH = '''  // The account chip joins the domain run after the six groups below.
  window.DDAuth.render();'''

OLD_LINKS = '''  nav.appendChild(links);
  document.addEventListener("click", ()=>{'''

NEW_LINKS = '''  links.appendChild(authSec);
  nav.appendChild(links);
  document.addEventListener("click", ()=>{'''

changed = []
for path in sorted(ROOT.glob("*.html")):
    text = path.read_text(encoding="utf-8")
    if OLD not in text and OLD_NARROW not in text:
        continue
    for old, label in ((OLD, "main phone rule"), (OLD_NARROW, "narrow phone rule"),
                       (OLD_AUTH, "auth insertion"), (OLD_LINKS, "links insertion")):
        assert text.count(old) == 1, f"{path.name}: {label} drifted"
    text = text.replace(OLD, NEW, 1).replace(OLD_NARROW, NEW_NARROW, 1)
    text = text.replace(OLD_AUTH, NEW_AUTH, 1).replace(OLD_LINKS, NEW_LINKS, 1)
    path.write_text(text, encoding="utf-8")
    changed.append(path.name)

assert len(changed) == 28, f"expected 28 shared-nav pages, changed {len(changed)}"
print(f"fixed mobile nav hierarchy in {len(changed)} pages")
