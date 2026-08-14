"""Keep active dropdown items orange and bold without the top-nav underline."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OLD = '''.grpmenu a.on{color:var(--accent)}'''
NEW = '''/* Dropdown selection is a text treatment, not the top-level tab treatment.
   The stronger selectors override `.sitenav .links a.on`, whose inset shadow is the
   underline reserved for the active domain header. */
.sitenav .links .grpmenu a.on{color:var(--accent);font-weight:750;
  box-shadow:none;border-radius:7px}
:root[data-theme="light"] .sitenav .links .grpmenu a.on{
  color:var(--accent);font-weight:750;box-shadow:none;border-radius:7px}'''

changed = []
for path in sorted(ROOT.glob("*.html")):
    text = path.read_text(encoding="utf-8")
    if "const NAV = [" not in text:
        continue
    assert text.count(OLD) == 1, f"{path.name}: dropdown active rule drifted"
    path.write_text(text.replace(OLD, NEW, 1), encoding="utf-8")
    changed.append(path.name)

assert len(changed) == 28, f"expected 28 shared-nav pages, changed {len(changed)}"
print(f"removed active dropdown underline in {len(changed)} pages")
