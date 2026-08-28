"""
The static money glossary stops defining the wrong currency.

Three sentences on the chart pages are plain HTML, not templates, so they could not take
MONEY_LABEL: dataviz's "MV = Market Value ... on a 12-team, $200 basis", its scatter note
"bought below market value", and report's footer/intro "Every number here is built on
Market Value (MV)".

In this room those pages now draw DataDawg$ on a 14-team, $2,800 basis. Leaving an MV
definition underneath them does not merely go stale — it tells the reader the numbers
above are a 12-team market consensus when they are neither. That is the version someone
believes and bids on.

The glossary is rewritten at runtime only when the room is active; every other league
keeps the MV wording, which is correct there.

Run:  cd work && python3 patch-rig-money-glossary.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

RELABEL = '''
/* ⚠️ The money glossary below the charts is static HTML written for MV. This room draws
   DataDawg$ on a 14-team, $2,800 basis, so an MV definition under it describes the
   numbers wrongly rather than merely stalely. Rewritten only when the room is active;
   every other league keeps the MV wording, which is right there. */
if (DD_ROOM) {
  const DDEF = "<b>DataDawg$</b> = this site's own conversion of the ETR board into this room "
    + "(14 teams, $200, no kicker), summing to $2,800. It is <b>not</b> MV \\u2014 MV is the "
    + "generic 12-team market snapshot, and these are different numbers.";
  document.querySelectorAll("p, footer").forEach(el => {
    if (/Market Value \\(MV\\)/.test(el.innerHTML) || /<b>MV<\\/b> = Market Value/.test(el.innerHTML)) {
      el.innerHTML = DDEF;
    } else if (/bought below market value/.test(el.textContent)) {
      el.innerHTML = el.innerHTML.replace(/market value/g, "DataDawg$");
    }
  });
}
'''

EDITS = {
  "dataviz.html": "const val=p=>+p[MONEYK()]||0;",
  "report.html":  "const byName={}; POOL.forEach(p=>byName[p.name]=p);",
}

staged = {}
for name, anchor in EDITS.items():
    p = REPO / name
    s = p.read_text(encoding="utf-8")
    if s.count(anchor) != 1:
        sys.exit(f"FAIL {name}: anchor matched {s.count(anchor)} times, expected 1")
    staged[name] = s.replace(anchor, anchor + "\n" + RELABEL, 1)

for name, s in staged.items():
    (REPO / name).write_text(s, encoding="utf-8", newline="\n")
    print(f"  {name}: money glossary follows the room")
