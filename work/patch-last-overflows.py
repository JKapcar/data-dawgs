"""
The last two sideways overflows at 320: dataviz.html (+21) and dfs.html (+9).

    python3 work/patch-last-overflows.py        (from the repo root)

Both were found with the bisect technique rather than a rect scan — walk the DOM setting
display:none on each child and watch documentElement.scrollWidth, recursing only into the
subtree whose removal drops it. A rect scan is useless on its own here because most
elements that stick out sit inside an overflow-x:hidden parent and never grow the page.

⚠️ dataviz.html — the money-pile chart draws at a 300px MINIMUM so the fourteen bars stay
distinguishable, then set that number as the svg's width ATTRIBUTE. At 320 the card is
238px wide, so a 300px svg hung 62px past it and the document grew by the 21 that were
outside the viewport. The floor is right and stays; what was wrong is rendering at it.
width:100% with the same viewBox scales the drawing down instead, which is what the two
other charts in this same file already do.

⚠️ dfs.html — .grid2 is repeat(auto-fit, minmax(290px, 1fr)). auto-fit drops to one column
at 320, but the column is still at least 290px while the card is 242, so every field in it
overhung by 48 and the page by 9. minmax(min(290px,100%), 1fr) is the fix: identical above
290px of available width, and it stops the track being wider than its own container below
it. Three copies, because this page restates its chart-ish rules in two media blocks.

⚠️ NOT SWEPT SITEWIDE. There are ~20 other minmax(Npx,1fr) tracks across the site with N
larger than a 320-phone card. None of them overflows today, and work/test-udfoot.mjs now
asserts all 21 pages at 320 with no exemptions, so the day one does it fails a test rather
than needing a speculative sweep now.
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# --------------------------------------------------------------- dataviz.html
DV = ROOT / "dataviz.html"
s = DV.read_text()
OLD = '  const svg=svgEl("svg",{width:W,height:H,viewBox:`0 0 ${W} ${H}`,style:"display:block"});\n  const grid=css("--grid"), ink3=css("--ink-3"), ink2=css("--ink-2"), surf=css("--surface-1");\n  const good=css("--good"), accent=css("--accent"), bad=css("--bad");\n'
NEW = '  // ⚠️ width:100%, not width:W. W has a 300px FLOOR so fourteen bars stay apart, and on a\n  // 320 phone the card is 238 — rendering at the attribute width hung the svg 62px past\n  // its card and grew the document. The viewBox keeps the drawing; only the box scales.\n  const svg=svgEl("svg",{width:"100%",height:H,viewBox:`0 0 ${W} ${H}`,style:"display:block"});\n  const grid=css("--grid"), ink3=css("--ink-3"), ink2=css("--ink-2"), surf=css("--surface-1");\n  const good=css("--good"), accent=css("--accent"), bad=css("--bad");\n'
if NEW not in s:
    assert s.count(OLD) == 1, "moneyPileChart svg line is not unique (%d)" % s.count(OLD)
    s = s.replace(OLD, NEW, 1)
    DV.write_text(s)
    print("dataviz.html: money-pile svg renders at 100%")
else:
    print("dataviz.html: already fixed")

# ⚠️ the OTHER chart in this file that sets a numeric width is deliberate — it lives in a
# horizontal scroll container and is meant to be wider than the card. Prove it survived.
assert s.count('const svg=svgEl("svg",{width:W,height:H,viewBox:`0 0 ${W} ${H}`,style:"display:block"});') == 1, \
    "expected exactly one remaining numeric-width chart (the scrolling value ladder)"

# ------------------------------------------------------------------ dfs.html
DF = ROOT / "dfs.html"
d = DF.read_text()
G_OLD = ".grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}"
G_NEW = ".grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(290px,100%),1fr));gap:16px}"
if G_NEW not in d:
    assert d.count(G_OLD) == 3, "expected three .grid2 rules, found %d" % d.count(G_OLD)
    d = d.replace(G_OLD, G_NEW)
    assert d.count(G_NEW) == 3
    DF.write_text(d)
    print("dfs.html: .grid2 tracks can no longer exceed their container (3 copies)")
else:
    print("dfs.html: already fixed")

# --------------------------------------------------------- the test stops exempting them
T = ROOT / "work" / "test-udfoot.mjs"
t = T.read_text()
T_OLD = '''  const KNOWN=new Set(["dataviz.html@320","dfs.html@320"]);
  if(!KNOWN.has(tag)) ok(tag+" no sideways scroll",r.hoverflow===false);
'''
T_NEW = '''  /* ⚠️ NO EXEMPTIONS LEFT. dataviz@320 and dfs@320 were the last two and are fixed; the
     KNOWN set is gone rather than emptied, so re-adding one is a visible decision. */
  ok(tag+" no sideways scroll",r.hoverflow===false);
'''
if "const KNOWN=new Set(" in t:
    assert t.count(T_OLD) == 1, "the KNOWN exemption block is not where it was"
    t = t.replace(T_OLD, T_NEW, 1)
    T.write_text(t)
    print("work/test-udfoot.mjs: the KNOWN exemption set is gone")
else:
    print("work/test-udfoot.mjs: already unexempted")

# ------------------------------------- the deploy resolver, corrected while it is fresh
M = ROOT / "work" / "make-deploy-payload.py"
m = M.read_text()
R_OLD = '''    const unref = s => s.split("\\x00").map((part, i) => {
      if (i % 2 === 0) return part;
      const [f, b, n] = part.split("\\x1f");
      return OUT[f].substr(+b, +n);
    }).join("");
'''
R_NEW = '''    const CP = {};                       // code points, NOT UTF-16 units — see below
    for (const f of Object.keys(P.patches)) CP[f] = Array.from(OUT[f]);
    const unref = s => s.split("\\x00").map((part, i) => {
      if (i % 2 === 0) return part;
      const [f, b, n] = part.split("\\x1f");
      return CP[f].slice(+b, +b + +n).join("");
    }).join("");

⚠️ THE OFFSETS ARE PYTHON CODE POINTS. JavaScript strings index UTF-16 units, and
dfs.html contains 🙃, so substr() lands one unit short for every ref past it. The first
version of this docstring said substr() and the SHA check caught it mid-deploy on
2026-08-09 — which is the entire argument for hashing every file before uploading it
rather than trusting that the reconstruction worked.
'''
if "code points, NOT UTF-16 units" not in m:
    assert m.count(R_OLD) == 1, "the docstring resolver is not where it was"
    m = m.replace(R_OLD, R_NEW, 1)
    M.write_text(m)
    print("work/make-deploy-payload.py: docstring resolver corrected to code points")
else:
    print("work/make-deploy-payload.py: docstring already corrected")

# --------------------------------------------------------------------- sw VERSION
html = sorted(p.name for p in ROOT.glob("*.html"))
h = hashlib.md5()
for name in html:
    h.update((ROOT / name).read_bytes())
ver = h.hexdigest()[:10]
SW = ROOT / "sw.js"
sw = SW.read_text()
mm = re.search(r'const VERSION = "([0-9a-f]{10})"', sw)
assert mm, "sw.js VERSION not found in the expected shape"
SW.write_text(sw.replace(mm.group(0), 'const VERSION = "%s"' % ver, 1))
print("sw.js: VERSION %s -> %s  (%d html files)" % (mm.group(1), ver, len(html)))
