"""Make the same Pound navigation change on every HTML page carrying shared NAV."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD = '    {label:"The Pound", short:"Pound", href:"index.html#tiers", key:"pound"},'
NEW = '''    {label:"The Pound", short:"Pound", href:"pound.html", key:"pound", items:[
      ["pound.html","Tools & Scoreboard","pound","hot"],
      ["pound.html#calculators","Calculators","pound-calculators"],
      ["pound.html#inventory","Tool Inventory","pound-inventory"],
      ["pound.html#provenance","Provenance","pound-provenance"],
    ]},'''
OLD_COMMENT = '''     ⚠️ The Pound is a plain link, not a dropdown — it is empty, and an empty menu reads
     as broken. Give it an `items` array the day something actually gets shelved. */'''
NEW_COMMENT = '''     The Pound now has a shelf: scoreboard, deterministic calculators, inventory and
     provenance. Keep this group identical on every page; the flattened HTML is the source. */'''

changed = []
for path in sorted(ROOT.glob("*.html")):
    text = path.read_text(encoding="utf-8")
    if "const NAV = [" not in text:
        continue
    if text.count(NEW) == 1 and text.count(NEW_COMMENT) == 1:
        changed.append(path.name)
        continue
    assert text.count(OLD) == 1, f"Pound nav drift in {path.name}: {text.count(OLD)} old / {text.count(NEW)} new"
    assert text.count(OLD_COMMENT) == 1, f"Pound comment drift in {path.name}: {text.count(OLD_COMMENT)} matches"
    text = text.replace(OLD, NEW).replace(OLD_COMMENT, NEW_COMMENT)
    path.write_text(text, encoding="utf-8", newline="\n")
    changed.append(path.name)

assert len(changed) >= 19, f"expected shared nav on at least 19 pages, found {len(changed)}"
print(f"patched Pound nav on {len(changed)} pages")

sitemap = ROOT / "sitemap.xml"
text = sitemap.read_text(encoding="utf-8")
text = text.replace("<lastmod>2026-08-06</lastmod>", "<lastmod>2026-08-07</lastmod>")
entry = '  <url><loc>https://datadawgs216.com/pound.html</loc><lastmod>2026-08-07</lastmod></url>\n'
if entry not in text:
    marker = '  <url><loc>https://datadawgs216.com/nfelo.html</loc>'
    assert marker in text, "sitemap insertion marker drifted"
    text = text.replace(marker, entry + marker, 1)
for name in ["pound-tools.json", "model-contracts.json", "upstream-models.json"]:
    entry = f'  <url><loc>https://datadawgs216.com/data/{name}</loc><lastmod>2026-08-07</lastmod></url>\n'
    if entry not in text:
        marker = '  <url><loc>https://datadawgs216.com/data/surfaces.json</loc>'
        assert marker in text, "data sitemap insertion marker drifted"
        text = text.replace(marker, entry + marker, 1)
sitemap.write_text(text, encoding="utf-8", newline="\n")
print("updated sitemap dates and Pound surfaces")
