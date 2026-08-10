#!/usr/bin/env python3
"""The collar on the three hero chips, with tierOf() moved off chip TEXT.

THE BUG THIS EXISTS TO PREVENT: tools/build-data.js tierOf() read a page's tier from its
hero chip's TEXT. A Working Dawg's chip becoming a GLYPH therefore removes the word
"Dawg" and silently demotes dashboard, nfelo and stats to labs in every /data/ envelope.
So the attribute and the glyph must land in the SAME commit.

What this does:
  1. tierOf() reads data-tier from the chip TAG. Text parsing survives only as a fallback
     for a chip that has not been migrated.
  2. data-tier="..." is added to all 10 real tierchips, so the fallback is dead code today.
  3. The three "Dawg" chips become the collar glyph, with .collar CSS added to those pages.

Survey every file, build every output in memory, check each, only then write.
"""
import sys, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
edits, out = [], {}


def stage(name, s, old, new, why):
    n = s.count(old)
    assert n == 1, "%s: anchor x%d (want 1) for %s\n  %r" % (name, n, why, old[:100])
    edits.append("%-22s %s" % (name, why))
    return s.replace(old, new, 1)


# ---------------------------------------------------------- 1. tierOf()
BD = "tools/build-data.js"
s = (ROOT / BD).read_text(encoding="utf-8")

OLD_FN = '''  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  if (!chip) return TIERS.labs;                       // no chip = implicitly Labs
  const label = chip[1].trim().toLowerCase();'''
NEW_FN = '''  /* ⚠️ data-tier ON THE CHIP TAG IS AUTHORITATIVE, and the reason is load-bearing.
     This used to read the chip's TEXT. A Working Dawg's chip is now a COLLAR GLYPH with
     no word in it, so text-parsing would report labs for dashboard, nfelo and stats and
     silently demote three validated surfaces in every /data/ envelope. Tier is data; the
     chip is presentation; they stopped being the same string on 2026-08-10. */
  const tag = html.match(/<[a-z]+[^>]*class="tierchip[^"]*"[^>]*>/);
  if (tag) {
    const a = tag[0].match(/data-tier="([a-z]+)"/);
    if (a && TIERS[a[1]]) return TIERS[a[1]];
  }
  const chip = html.match(/class="tierchip[^"]*"[^>]*>([^<]+)</);
  if (!chip) return TIERS.labs;                       // no chip = implicitly Labs
  /* Fallback only, for a chip that has not been migrated to data-tier. */
  const label = chip[1].trim().toLowerCase();'''
s = stage(BD, s, OLD_FN, NEW_FN, "tierOf reads data-tier, text is fallback")
out[BD] = s


# ------------------------------------------- 2. data-tier on every real chip
CHIPS = [
    ("Why this page is in Labs", "Labs", "labs", ["arena.html", "data.html", "nfl.html"], "tierchip"),
    ("Why this work is in Labs", "Labs", "labs", ["calculators.html"], "tierchip"),
    ("Why this work is in The DawgHouse", "The DawgHouse", "pound", ["dawghouse.html"], "tierchip"),
    ("What the tiers mean", "Labs", "labs", ["receipts.html", "survivor.html"], "tierchip lab"),
]
for title, text, tier, pages, cls in CHIPS:
    old = '<a class="%s" href="index.html#tiers" title="%s">%s</a>' % (cls, title, text)
    new = '<a class="%s" data-tier="%s" href="index.html#tiers" title="%s">%s</a>' % (cls, tier, title, text)
    for p in pages:
        src = out.get(p) or (ROOT / p).read_text(encoding="utf-8")
        out[p] = stage(p, src, old, new, 'data-tier="%s"' % tier)


# ------------------------------------- 3. the three hero chips become the collar
COLLAR_SVG = ('<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">'
              '<ellipse cx="12" cy="9.5" rx="7.4" ry="5.4" fill="none" stroke="currentColor" stroke-width="2.4"></ellipse>'
              '<circle cx="12" cy="17.6" r="3.1" fill="currentColor"></circle></svg>')
HERO_OLD = '<a class="tierchip" href="index.html#tiers" title="What the tiers mean">Dawg</a>'
HERO_NEW = ('<a class="tierchip tierchip-collar" data-tier="dawg" href="index.html#tiers"'
            ' title="Working Dawg — earned its collar. Criteria: /data/receipts-method.md">'
            '<span class="collar" role="img" aria-label="Working Dawg — earned its collar">'
            + COLLAR_SVG + '</span></a>')

CSS_OLD = ".tierchip:hover{border-color:var(--good)}"
CSS_NEW = (".tierchip:hover{border-color:var(--good)}\n"
           "/* CEP-5A — the collar on a HERO chip. The glyph carries the tier visually;\n"
           "   data-tier on the tag carries it to tools/build-data.js. Do not put the word\n"
           "   back: the accessible name comes from the span's aria-label. */\n"
           ".collar{display:inline-flex;align-items:center;color:var(--good);vertical-align:middle}\n"
           ".collar svg{display:block}\n"
           ".tierchip-collar{padding:3px 7px;line-height:0}")

for p in ["dashboard.html", "nfelo.html", "stats.html"]:
    src = out.get(p) or (ROOT / p).read_text(encoding="utf-8")
    src = stage(p, src, HERO_OLD, HERO_NEW, "hero chip -> collar glyph")
    src = stage(p, src, CSS_OLD, CSS_NEW, ".collar CSS")
    out[p] = src


# ------------------------------------------------------------------ checks
# ⚠️ Scope this to the CHIP TAG. data-tier is already used, legitimately, on the
# <article class="tool"> cards arena.html and nfl.html render from surfaces.json — a
# file-wide count reads those as a defect and fails on a correct file.
CHIPTAG = re.compile(r'<[a-z]+[^>]*class="tierchip[^"]*"[^>]*>')
for p, s in out.items():
    if not p.endswith(".html"):
        continue
    tags = CHIPTAG.findall(s)
    assert len(tags) == 1, "%s: %d tierchip tags (want 1)" % (p, len(tags))
    assert 'data-tier="' in tags[0], "%s: the tierchip tag carries no data-tier" % p
for p in ["dashboard.html", "nfelo.html", "stats.html"]:
    assert ">Dawg</a>" not in out[p], "%s still has the word Dawg in its chip" % p
    assert 'data-tier="dawg"' in out[p], "%s lost its data-tier" % p
    assert out[p].count(".collar{") == 1, "%s: .collar CSS x%d" % (p, out[p].count(".collar{"))
assert 'data-tier="pound"' in out["dawghouse.html"]

if "--check" in sys.argv:
    print("\n".join(edits)); print("\n%d edits across %d files (nothing written)" % (len(edits), len(out)))
    sys.exit(0)

for p, s in out.items():
    (ROOT / p).write_text(s, encoding="utf-8")
print("\n".join(edits))
print("\n%d edits written across %d files" % (len(edits), len(out)))
