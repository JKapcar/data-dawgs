"""
Wire teamdraft.html into the site — the sitewide half of the team-draft stage.

Four surfaces have to learn about a new page, and one of them is every HTML file:

  1. the NAV, which is inlined into all 28 pages that carry it
  2. /data/surfaces.json, which is what arena.html renders its cards from
  3. sitemap.xml and llms.txt, the two indexes
  4. sw.js — the precache list, and the VERSION that invalidates it

⚠️ A sitewide change is the same edit applied to every *.html, with an assert-once per
file. The assert is the point: a page that has drifted fails here instead of silently
missing the nav entry.

Run AFTER work/build_teamdraft.py (teamdraft.html has to exist to be hashed):

    cd work && python3 build_teamdraft.py && python3 patch-teamdraft-wiring.py
"""
import hashlib
import json
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent

PAGE = "teamdraft.html"
LABEL = "NFL Team Draft"
KEY = "teamdraft"
TODAY = "2026-08-12"


def sub1(text, old, new, what):
    n = text.count(old)
    assert n == 1, f"anchor {what!r} appears {n} times, expected 1"
    return text.replace(old, new, 1)


# ------------------------------------------------------------------ 1 · nav ----
# The Arena group is ordered by href, so teamdraft.html lands after survivor.html.
NAV_OLD = '      ["survivor.html","Survivor","survivor"],\n'
NAV_NEW = NAV_OLD + f'      ["{PAGE}","{LABEL}","{KEY}"],\n'

touched, skipped = [], []
for f in sorted(REPO.glob("*.html")):
    s = f.read_text(encoding="utf-8")
    if NAV_OLD not in s:
        # draft-leagues.html, pound.html and survivor-settings.html carry no nav by
        # design. Anything else missing the anchor has drifted and must be looked at.
        skipped.append(f.name)
        continue
    f.write_text(sub1(s, NAV_OLD, NAV_NEW, f"nav group in {f.name}"), encoding="utf-8")
    touched.append(f.name)

assert set(skipped) == {"draft-leagues.html", "pound.html", "survivor-settings.html"}, \
    f"unexpected pages without the nav anchor: {sorted(set(skipped))}"
assert PAGE in touched, "the new page must carry the nav entry too"
print(f"  nav: {len(touched)} pages patched, {len(skipped)} intentionally navless")

# ------------------------------------------------------- 2 · surfaces.json ----
sp = REPO / "data" / "surfaces.json"
surfaces = json.loads(sp.read_text(encoding="utf-8"))
assert not any(r["id"] == "team-draft-2026" for r in surfaces["data"]), "row already present"

row = {
    "id": "team-draft-2026",
    "domain": "arena",
    "name": "The 32-team draft — an eight-person NFL wins pool",
    "page": "/" + PAGE,
    "machine": [{
        "kind": "json",
        "url": "/data/draft-2026.json",
        "status": "live",
        "covers": "the whole surface — 32 teams with posted line, devigged expected wins, "
                  "season SD, the 0-17 win distribution and a 17-game schedule; the sparse "
                  "head-to-head matrix; the draft log; and the derived rosters, board and "
                  "diagnostics",
    }],
    "planned": [],
    "gap": "The draft is in progress and the payload says how many picks are in. Expected wins "
           "are a dated market snapshot, not a forecast this site has graded, and no game has "
           "been played — the wins tracker is all zeroes by construction. The per-game "
           "probabilities are internally consistent and reproduce the league's 272 wins, but "
           "they do not re-add to each team's own expected-wins figure; the page's Diagnostics "
           "sheet measures that drift rather than hiding it.",
    "tier": "labs",
}
# Slotted next to the other Arena rows so the file stays readable as a grouped list.
last_arena = max(i for i, r in enumerate(surfaces["data"]) if r.get("domain") == "arena")
surfaces["data"].insert(last_arena + 1, row)
surfaces["as_of"] = TODAY
surfaces["built"] = TODAY
if isinstance(surfaces.get("counts"), dict) and "surfaces" in surfaces["counts"]:
    surfaces["counts"]["surfaces"] = len(surfaces["data"])
sp.write_text(json.dumps(surfaces, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"  surfaces.json: added team-draft-2026 ({len(surfaces['data'])} rows)")

# -------------------------------------------------------------- 3 · indexes ----
smp = REPO / "sitemap.xml"
sm = smp.read_text(encoding="utf-8")
anchor = "  <url><loc>https://datadawgs216.com/survivor.html</loc>"
line = sm[sm.index(anchor):sm.index("\n", sm.index(anchor)) + 1]
smp.write_text(sub1(sm, line, line + f"  <url><loc>https://datadawgs216.com/{PAGE}</loc>"
                                     f"<lastmod>{TODAY}</lastmod></url>\n", "sitemap row"),
               encoding="utf-8")
print("  sitemap.xml: row added")

lp = REPO / "llms.txt"
llms = lp.read_text(encoding="utf-8")
llms = sub1(
    llms,
    "- [2026 strategy](/data/strategy.md):",
    f"- [32-team wins pool](/{PAGE}) ([data](/data/draft-2026.json)): eight drafters, four NFL "
    "teams each, all 32 owned, so expected wins are conserved at 272 and par is 34.00. Carries "
    "posted lines beside devigged expected wins, the head-to-head matrix, and a diagnostics "
    "block that measures where the payload disagrees with itself. Nothing graded; no game "
    "played.\n- [2026 strategy](/data/strategy.md):",
    "llms.txt draft section")
lp.write_text(llms, encoding="utf-8")
print("  llms.txt: entry added")

# ------------------------------------------------------------------ 4 · sw ----
swp = REPO / "sw.js"
sw = swp.read_text(encoding="utf-8")
sw = sub1(sw, '"/arena.html"', f'"/arena.html", "/{PAGE}"', "sw precache list")

# VERSION is a cache key; it only has to change. Convention: md5 of every *.html
# concatenated in sorted order, first 10 hex. Computed AFTER the nav pass above so it
# reflects the bytes actually being shipped.
h = hashlib.md5()
for f in sorted(REPO.glob("*.html")):
    h.update(f.read_bytes())
new_ver = h.hexdigest()[:10]
old_ver = sw.split('const VERSION = "')[1].split('"')[0]
sw = sub1(sw, f'const VERSION = "{old_ver}"', f'const VERSION = "{new_ver}"', "sw VERSION")
swp.write_text(sw, encoding="utf-8")
print(f"  sw.js: precached /{PAGE}, VERSION {old_ver} -> {new_ver}")

print("\n  next: node tools/data-manifest.js && node tools/validate-data.js")
