"""Render the shared account pill only after it is attached to the nav DOM."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

OLD_EARLY = '''  // The account chip joins the domain run after the six groups below.
  window.DDAuth.render();
  document.addEventListener("keydown", e=>{ if(e.key === "Escape") window.DDAuth.close(); });'''

NEW_EARLY = '''  // The account chip joins the domain run after the six groups below.
  document.addEventListener("keydown", e=>{ if(e.key === "Escape") window.DDAuth.close(); });'''

OLD_ATTACHED = '''  links.appendChild(authSec);
  nav.appendChild(links);
  document.addEventListener("click", ()=>{'''

NEW_ATTACHED = '''  links.appendChild(authSec);
  nav.appendChild(links);
  // render() resolves the button by id, so it must run after nav is in the document.
  window.DDAuth.render();
  document.addEventListener("click", ()=>{'''

changed = []
for path in sorted(ROOT.glob("*.html")):
    text = path.read_text(encoding="utf-8")
    if "const NAV = [" not in text:
        continue
    assert text.count(OLD_EARLY) == 1, f"{path.name}: early auth render drifted"
    assert text.count(OLD_ATTACHED) == 1, f"{path.name}: attached auth block drifted"
    text = text.replace(OLD_EARLY, NEW_EARLY, 1)
    text = text.replace(OLD_ATTACHED, NEW_ATTACHED, 1)
    path.write_text(text, encoding="utf-8")
    changed.append(path.name)

assert len(changed) == 28, f"expected 28 shared-nav pages, changed {len(changed)}"
print(f"fixed account-pill render order in {len(changed)} pages")
