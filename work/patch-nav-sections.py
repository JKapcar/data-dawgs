"""
Two new top-level nav sections: Prediction Markets and A.I.

Sitewide, so per AGENTS.md rule 2 this is one string-replace across glob("*.html") with an
`assert count == 1` per file per anchor, dry-run across every file before a byte is
written. Idempotent: a file carrying the sentinel is skipped, and every non-HTML edit
checks for its own result first.

Run:  python3 work/patch-nav-sections.py        (from the repo root)

═══════════════════════════════════════════════════════════════════════════════════════
⚠️ THE BAR FAILS THREE DIFFERENT WAYS AT THREE DIFFERENT WIDTHS, AND ONLY ONE OF THEM
   HAD A TEST. That is the whole story of this patch.

  >=761    DESKTOP — it WRAPS. Extra row. No test saw it.
  420-760  ONE ROW — it SQUEEZES and spills LEFT over the brand and the sign-in chip
           without ever overflowing the document. test-nav-fit.mjs sees this one.
  <=419    WRAPPING — it WRAPS. Extra row. No test saw it.

`-backlog.md` D4b said the header cluster was full and to re-measure before adding to it.
Measured, all three bands, index.html, bar height in px and element-vs-element overlap:

  band      six groups                    eight, unfixed              eight, this patch
  1440      69                            125                         69
  1280      69                            125                         69
  1100      69                            125                         123   <- the one cost
  1000      125                           125                         123
  761       125                           162                         123
  520       54  no overlap                54  overlap 25.8px          54  no overlap
  440       54  no overlap                54  overlap 13.3px          54  no overlap
  420       54  no overlap                54  overlap 33.3px          54  no overlap
  390       82                            108                         82
  360       82                            109                         82
  320       109                           109                         109

⚠️ THE ONLY THING THIS PATCH DOES NOT RESTORE IS 1100-1199px, WHICH KEEPS TWO ROWS WHERE
IT USED TO HAVE ONE. That band is the price of the word "Prediction". Measured with the
nav label shortened to "Markets" and every other value identical, 1100 returns to 69 and
the whole desktop curve matches the six-group baseline. It is a one-word change in
NEW_GROUPS below if that band ever matters more than the label; the page title and the
section name stay "Prediction Markets" either way.

⚠️ EIGHT IS THE CEILING FOR THIS MECHANISM. A ninth group was measured with every
tightening applied at once — 9.5px font, zero gap, smaller theme button and sign-in chip —
and still collides at 420 (12.5px) and 520 (5px). Section nine is an overflow menu, not
another array entry. Do not discover that by shipping a collision.

⚠️ IF YOU ADD TO THIS BAR AGAIN, MEASURE BOTH THINGS. Height above 761 and below 420,
overlap between 420 and 760. Neither check sees the other's failure, and both row-count
regressions above were found by looking at a screenshot after a fully green suite.
═══════════════════════════════════════════════════════════════════════════════════════
"""
import glob, pathlib, sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SENTINEL = 'key:"markets"'

# ---------------------------------------------------------------- 1. NAV ----
# `short:` is the phone label; both render and CSS picks one, so nothing reflows on rotate.
# Receipts was the widest item in the one-row band at 52.9px, which is why it gets one too.
RCPT_OLD = '    {label:"Receipts", href:"receipts.html", key:"receipts", items:['
RCPT_NEW = '    {label:"Receipts", short:"Rcpt", href:"receipts.html", key:"receipts", items:['

NFL_ANCHOR = '    {label:"NFL", href:"nfl.html", key:"nfl", items:['
NEW_GROUPS = '''    /* Two sections that are not football, placed where they were asked for: after the
       games people play against each other, before the sport pages. Both are EMPTY today
       and their pages say so above the fold — a nav entry pointing at a page with nothing
       on it is only honest while the page admits it. See work/build_section_hub.py. */
    {label:"Prediction Markets", short:"Mkts", href:"markets.html", key:"markets", items:[
      ["markets.html","The markets work","markets"],
    ]},
    {label:"A.I.", href:"ai.html", key:"ai", items:[
      ["ai.html","The AI work","ai"],
    ]},
'''

# ------------------------------------------------------- 2. CSS, three bands ----
# (a) 420-760, the one-row band. This is the one that stops the OVERLAP.
# Labels alone still miss by 11.1px at 420 and 3.6px at 520; 1px per side closes it. Font
# size, the wordmark breakpoints, the sign-in chip and the group count are untouched here.
PAD_OLD = "  .sitenav .links a,.sitenav .links .grpbtn{padding:4px 3px;font-size:10px;"
PAD_NEW = "  .sitenav .links a,.sitenav .links .grpbtn{padding:4px 2px;font-size:10px;"

# (b) <=419, the wrapping band. Not overlap — ROW COUNT.
# Two more groups pushed the theme button onto a third row at 360/375/390/393 (iPhone SE
# through iPhone 16) with every overlap assertion still green. 2px of padding and 2px of
# gap put every width from 340 up back to its six-group height. 320 is 109px either way.
PHONE_PAD_OLD = "  .sitenav .links a,.sitenav .links .grpbtn{padding:4px 4px;font-size:11px}"
PHONE_PAD_NEW = "  .sitenav .links a,.sitenav .links .grpbtn{padding:4px 2px;font-size:11px}"
PHONE_GAP_OLD = "  .sitenav .links{flex:1 1 100%;margin-left:0;justify-content:flex-start;flex-wrap:wrap;gap:2px 5px;padding-top:3px}"
PHONE_GAP_NEW = "  .sitenav .links{flex:1 1 100%;margin-left:0;justify-content:flex-start;flex-wrap:wrap;gap:2px 3px;padding-top:3px}"

# (c) >=761, desktop. Also row count. The six-group bar already used two rows below 1100;
# eight groups pushed the one-row threshold past 1440 and added a third row at 761-820.
DESK_GAP_OLD = ".sitenav .links{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap;align-items:center}"
DESK_GAP_NEW = ".sitenav .links{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap;align-items:center}"
DESK_A_OLD = ".sitenav .links a{color:var(--ink-2);text-decoration:none;padding:6px 12px;border-radius:8px;font-size:14px;font-weight:550}"
DESK_A_NEW = ".sitenav .links a{color:var(--ink-2);text-decoration:none;padding:6px 6px;border-radius:8px;font-size:13px;font-weight:550}"
DESK_B_OLD = ".grpbtn{background:none;border:none;color:var(--ink-2);padding:6px 12px;border-radius:8px;font-size:14px;font-weight:550;cursor:pointer;font-family:inherit;"
DESK_B_NEW = ".grpbtn{background:none;border:none;color:var(--ink-2);padding:6px 6px;border-radius:8px;font-size:13px;font-weight:550;cursor:pointer;font-family:inherit;"

# ⚠️ The baseline note inside .grpbtn quotes the old type size, and it is load-bearing —
# it is the reason display:block and line-height:1.55 are both there. It ships corrected in
# the same commit rather than left describing a size that no longer exists. The dropdown
# items (.grpmenu a) stay at 14px on purpose: the menu has a whole panel to itself.
DESK_NOTE_OLD = """     upward) and <button> to inline-block with line-height:normal (~16px vs the 21.7px
     a 14px/1.55 link gets). Both drifted. Do not drop either declaration. */"""
DESK_NOTE_NEW = """     upward) and <button> to inline-block with line-height:normal (~16px vs the 20.2px
     a 13px/1.55 link gets — 14px until 2026-08-11, when an eight-group bar took the type
     down a point). Both drifted. Do not drop either declaration. */"""

# ------------------------------------------------- 3. comments this falsifies ----
# AGENTS.md: ship the copy that describes the site in the same commit as the change that
# falsifies it. Both of these state measurements this patch invalidates.
SLACK_OLD = """  /* ⚠️ Measured at 360px the one-row nav had ~28px of slack (see the 419px note below).
     🙃 used to spend most of it. It moved to the footer row on 2026-08-08, so that slack
     is unspent again — the first nav item added back gets it. Re-measure here first. */"""
SLACK_NEW = """  /* ⚠️ THE SLACK IS SPENT. The ~28px that 🙃 freed when it moved to the footer row on
     2026-08-08 was taken on 2026-08-11 by the Prediction Markets and A.I. groups, along
     with 1px per side off the padding below and two `short:` labels (Rcpt, Mkts). Eight
     groups now fit with nothing left over: a ninth collides at 420 and 520 even with the
     font at 9.5px, the gap at zero and the theme button and sign-in chip tightened. The
     next section is an overflow menu, not another entry.
     ⚠️ Re-measure with an element-vs-element overlap check, never a bounds check —
     work/test-nav-fit.mjs explains why a bounds check cannot see this failure. */"""

MEAS_OLD = """  /* ⚠️ Measured at 320px BEFORE this tightening: the links run needed 243.4px inside a
     244.0px box — 0.6px of margin, which is not margin. Two pixels off each link's
     horizontal padding buys 12px back. At 360px (the width the one-row layout was
     designed against) there is 40px spare, and the tightest point on the whole curve is
     420px — the last width that still shows the wordmark — where 11px separates the
     wordmark from the first nav item. Every figure here was measured while 🙃 still sat
     in this row; since 2026-08-08 it does not, so they are floors, not ceilings.
     Re-measure all three if anything is ever added to this row again. */"""
MEAS_NEW = """  /* ⚠️ Measured at 320px BEFORE this tightening: the links run needed 243.4px inside a
     244.0px box — 0.6px of margin, which is not margin. Two pixels off each link's
     horizontal padding buys 12px back. Every figure in this note was taken with six
     groups and while 🙃 still sat in this row; both changed, so read them as history.
     ⚠️ RE-MEASURED 2026-08-11 WITH EIGHT GROUPS, AND THIS BLOCK FAILS DIFFERENTLY FROM
     THE ONE ABOVE. Here the links WRAP rather than collide, so the failure is not overlap
     — it is an extra ROW. Two more groups took the bar from 82px to 108px at 360, 375,
     390 and 393 with every overlap assertion still green, because the theme button simply
     moved to a third line. It was caught by looking at a screenshot. The 2px padding and
     3px gap are why, and together they put every width from 340 up back to its six-group
     height; 320px is 109px, which is what it was before as well.
     ⚠️ Add anything here again and measure the bar's HEIGHT below 420 and above 761, and
     its OVERLAP between 420 and 760. They are different failures and no one check sees
     more than one of them. */"""

# (old, new, name, required). `required=False` means "exactly one or exactly zero".
#
# ⚠️ FINDING, AND THE DRY RUN IS THE ONLY REASON IT WAS SEEN: the inlined nav CSS is NOT
# byte-identical across the 25 pages, even though the NAV array is. bozo.html carries a
# SHORTENED variant of the .grpbtn baseline comment — same meaning, three lines instead of
# four — and, usefully here, its version never mentions a type size at all, so the 14px it
# does not state cannot go stale. Every other page has the long form.
# test-pound-contracts.js asserts the NAV ARRAY is one block across all pages; nothing
# asserts the same about the CSS around it, and this is what that gap looks like. The
# correct fix is to converge the two comments, but that is a separate change with its own
# blast radius — folding it into a nav patch would hide it. Recorded here instead.
HTML_EDITS = [
    (RCPT_OLD, RCPT_NEW, "Receipts entry", True),
    (NFL_ANCHOR, NEW_GROUPS + NFL_ANCHOR, "NFL entry", True),
    (PAD_OLD, PAD_NEW, "one-row link padding", True),
    (PHONE_PAD_OLD, PHONE_PAD_NEW, "wrapping link padding", True),
    (PHONE_GAP_OLD, PHONE_GAP_NEW, "wrapping links gap", True),
    (DESK_GAP_OLD, DESK_GAP_NEW, "desktop links gap", True),
    (DESK_A_OLD, DESK_A_NEW, "desktop link", True),
    (DESK_B_OLD, DESK_B_NEW, "desktop group button", True),
    (DESK_NOTE_OLD, DESK_NOTE_NEW, "desktop baseline note", False),
    (SLACK_OLD, SLACK_NEW, "slack comment", True),
    (MEAS_OLD, MEAS_NEW, "measurement comment", True),
]

# ------------------------------------- 4. everything that is not an HTML page ----
# ⚠️ These live in the same script ON PURPOSE. A nav change that adds pages also changes
# the sitemap and four assertions, and the failure mode when they are separate scripts is
# that one of them does not get run.
#
# ⚠️ llms.txt IS DELIBERATELY NOT TOUCHED, AND THAT IS A DECISION, NOT AN OMISSION.
# The obvious entry — one line saying both sections exist and are empty — was written,
# measured and backed out. llms.txt was already 5,102 bytes against the validator's
# 5,120-byte cap BEFORE this change, so the shortest honest version of that line fails
# `node tools/validate-data.js`. The two ways to make it fit are trimming someone else's
# carefully worded machine contract or raising the cap, and both are Kap's call rather
# than a side effect of a nav change. Nothing is hidden by leaving it out: both pages are
# in sitemap.xml, both are in the nav, and each states its own emptiness above the fold.
# What an agent loses is the chance to learn "empty" without fetching the page.
# ⚠️ The next person to add ANY line to llms.txt hits this same wall — 18 bytes of room on
# a file that grows every time the site does.
SIDECARS = [
    ("sitemap.xml",
     '  <url><loc>https://datadawgs216.com/arena.html</loc><lastmod>2026-08-10</lastmod></url>\n',
     '  <url><loc>https://datadawgs216.com/ai.html</loc><lastmod>2026-08-11</lastmod></url>\n'
     '  <url><loc>https://datadawgs216.com/arena.html</loc><lastmod>2026-08-10</lastmod></url>\n',
     "sitemap ai.html"),
    ("sitemap.xml",
     '  <url><loc>https://datadawgs216.com/master.html</loc><lastmod>2026-08-10</lastmod></url>\n',
     '  <url><loc>https://datadawgs216.com/master.html</loc><lastmod>2026-08-10</lastmod></url>\n'
     '  <url><loc>https://datadawgs216.com/markets.html</loc><lastmod>2026-08-11</lastmod></url>\n',
     "sitemap markets.html"),

    ("work/test-nav-fit.mjs",
     "const WIDTHS = [320, 340, 360, 390, 419, 420, 460, 500, 519, 520, 600, 760, 761, 900, 1280];",
     "const WIDTHS = [320, 340, 360, 390, 419, 420, 440, 460, 500, 519, 520, 560, 600, 760, 761, 900, 1280];",
     "nav-fit widths"),
    ("work/test-nav-fit.mjs",
     '    ok(tag + " all six groups are present", m.groups === 6, String(m.groups));',
     '    ok(tag + " all eight groups are present", m.groups === 8, String(m.groups));',
     "nav-fit group count"),
    ("work/test-nav-fit.mjs",
     """   Stage 7 took the bar from five groups to six, which is exactly the change the old 419px
   comment warned to re-measure after. It collided at 320, 340, 360, 420 and 460.
""",
     """   Stage 7 took the bar from five groups to six, which is exactly the change the old 419px
   comment warned to re-measure after. It collided at 320, 340, 360, 420 and 460.

   2026-08-11 took it from six to EIGHT — Prediction Markets and A.I. Eight groups at the
   shipped padding collide at 420 (33.3px), 440 (13.3px) and 520 (25.8px). What pays for
   them: `short:` labels on the two longest entries (Receipts -> Rcpt, Prediction Markets
   -> Mkts) plus 1px per side off the link padding in the max-width:760px block. Labels
   alone still miss by 11.1px at 420 and 3.6px at 520, so both halves are load-bearing.

   ⚠️ EIGHT IS THE CEILING. A ninth group was measured with every tightening applied at
   once — 9.5px font, zero gap, smaller theme button and sign-in chip — and still collides
   at 420 (12.5px) and 520 (5px). A ninth section needs an overflow menu, not another
   array entry, and this suite is where that gets caught.

   ⚠️ THIS SUITE ONLY SEES OVERLAP, AND OVERLAP IS ONLY HOW THE 420-760 BAND FAILS.
   Outside it the bar WRAPS instead, so the failure is an extra ROW and every assertion
   here stays green through it. Eight groups added a row at 360/375/390/393 and another at
   761/820, and this file reported 205 passed while both were live. Both were caught by
   looking at a screenshot. The height table is in work/patch-nav-sections.py; if you
   change this bar, measure height below 420 and above 761 as well as overlap here.
""",
     "nav-fit header note"),
    ("work/test-nav-fit.mjs",
     """   both sides of every one: 419/420 (the wordmark), 519/520 (its new ceiling), 760/761
   (the one-row phone layout). Testing 320/390/1280 alone would have missed the 420-519
   band entirely, which is where the worst collision was.
""",
     """   both sides of every one: 419/420 (the wordmark), 519/520 (its new ceiling), 760/761
   (the one-row phone layout). Testing 320/390/1280 alone would have missed the 420-519
   band entirely, which is where the worst collision was.
   440 and 560 were added on 2026-08-11 and are not padding: at eight groups the run
   collided at 440 while 419, 460 and 500 were all clean, so a list that stepped over it
   would have shipped a collision on a width nobody was watching.
""",
     "nav-fit width-list note"),

    ("work/test-nav-fit.mjs",
     "const WIDTHS = [320, 340, 360, 390, 419, 420, 440, 460, 500, 519, 520, 560, 600, 760, 761, 900, 1280];",
     """const WIDTHS = [320, 340, 360, 390, 419, 420, 440, 460, 500, 519, 520, 560, 600, 760, 761, 900, 1024, 1100, 1280];

/* ⚠️ HEIGHT, NOT OVERLAP — the second failure mode, added 2026-08-11.
   Outside 420-760 this bar does not collide, it WRAPS, so growing it costs a ROW and
   every overlap assertion above stays green. That happened twice in one change and both
   times it was caught by looking at a screenshot rather than by this file. These are the
   six-group heights measured on index.html at b2b7003; the bar may never exceed them.
   Cap, not equality: shorter is always fine, and this patch is 2px shorter above 761.
   ⚠️ 1100 IS THE ONE DELIBERATE EXCEPTION AND IT IS 54px. Six groups fitted one row at
   1100; eight do not, and no combination of padding, gap and type size recovers it while
   the nav label reads "Prediction Markets" — shortening that label to "Markets" is the
   only thing that does. It is allowed here explicitly rather than by loosening the whole
   table, so that if 1100 ever returns to one row this assertion says so. */
const MAX_H = {320:109, 340:108, 360:82, 390:82, 419:82, 420:54, 440:54, 460:54, 500:54,
               519:54, 520:54, 560:54, 600:54, 760:54, 761:125, 900:125, 1024:125,
               1100:123,   /* was 69 with six groups — see above */
               1280:69};""",
     "nav-fit height table"),
    ("work/test-nav-fit.mjs",
     """    ok(tag + " and the document still does not scroll sideways", m.docOverflow === false);""",
     """    ok(tag + " and the document still does not scroll sideways", m.docOverflow === false);
    ok(tag + " the bar is no taller than its six-group baseline", m.navH <= MAX_H[W] + 0.5,
       `${m.navH} > ${MAX_H[W]}`);""",
     "nav-fit height assertion"),
    ("work/test-nav-fit.mjs",
     """  const navR = nav.getBoundingClientRect();""",
     """  const navR = nav.getBoundingClientRect();
  const navH = Math.round(navR.height);""",
     "nav-fit height measure"),
    ("work/test-nav-fit.mjs",
     """    hits, outside, boxes: boxes.length,""",
     """    hits, outside, boxes: boxes.length, navH,""",
     "nav-fit height return"),
    ("work/test-pound-contracts.js",
     "  assert.equal(covered, 25, 'the nav page set changed');",
     "  assert.equal(covered, 27, 'the nav page set changed');   // +markets.html +ai.html, 2026-08-11",
     "pound-contracts nav page set"),
    ("work/test-pound-contracts.js",
     "  assert.equal(covered, 25);\n  assert.equal(blocks.size, 1",
     "  assert.equal(covered, 27);\n  assert.equal(blocks.size, 1",
     "pound-contracts nav identity count"),
    ("work/test-pound-contracts.js",
     "  const ORDER = ['Receipts', 'Arena', 'NFL', 'CFB', 'Data', 'Dawgs'];",
     """  /* ⚠️ Two sections were inserted between Arena and NFL on 2026-08-11, which is where
     Kap asked for them. The ORDER is asserted, not just the membership: the bar is a claim
     about what this site is about, and "not football" sitting ahead of the football groups
     is part of that claim. Both pages are empty and say so above the fold. */
  const ORDER = ['Receipts', 'Arena', 'Prediction Markets', 'A.I.', 'NFL', 'CFB', 'Data', 'Dawgs'];""",
     "pound-contracts nav order"),
    ("work/test-pound-contracts.js",
     "  assert.equal(withChip.length, 10, 'the set of pages carrying a tier chip moved: ' + withChip.join(','));",
     """  /* 12 since 2026-08-11: markets.html and ai.html joined as Pups. Both are empty section
     hubs, and a Pup chip on an empty page is only honest because the page also carries a
     "Nothing here is built yet" banner above the fold — the chip says unvalidated, the
     banner says unbuilt, and those are different claims. */
  assert.equal(withChip.length, 12, 'the set of pages carrying a tier chip moved: ' + withChip.join(','));""",
     "pound-contracts tier chip set"),
]


def sub1(text, old, new, what, fname):
    n = text.count(old)
    assert n == 1, f"{fname}: anchor {what!r} appears {n} times, expected 1"
    return text.replace(old, new, 1)


def patch_sidecars():
    done, already = 0, 0
    for name, old, new, what in SIDECARS:
        f = REPO / name
        t = f.read_text(encoding="utf-8")
        # ⚠️ The presence of NEW is the only safe idempotence test. Also checking
        # `old not in t` is wrong whenever new CONTAINS old — true of every append here
        # and of every comment that extends the sentence above it. That version silently
        # re-applied five of these on a second run and duplicated them.
        if new in t:
            already += 1
            continue
        assert t.count(old) == 1, f"{name}: anchor {what!r} appears {t.count(old)} times, expected 1"
        f.write_text(t.replace(old, new, 1), encoding="utf-8")
        done += 1
    print(f"sidecars: {done} applied, {already} already in place")


def main():
    files = sorted(glob.glob(str(REPO / "*.html")))
    assert files, "no html found — wrong cwd?"

    # ⚠️ Dry-run EVERY anchor across EVERY file before writing a byte. One anchor written
    # against a drifted file has aborted a run half-way through before, leaving the site
    # inconsistent with itself.
    targets, skipped, problems, optional_skips = [], [], [], []
    for f in files:
        p = pathlib.Path(f)
        s = p.read_text(encoding="utf-8")
        if "const NAV = [" not in s:
            skipped.append(p.name + " (no nav)")
            continue
        if SENTINEL in s:
            skipped.append(p.name + " (already patched)")
            continue
        for old, _new, what, required in HTML_EDITS:
            n = s.count(old)
            if n > 1 or (required and n != 1):
                problems.append(f"{p.name}: {what} appears {n}x")
        targets.append(p)

    if problems:
        print("DRY RUN FAILED — nothing written:")
        for x in problems:
            print("  " + x)
        return 1

    for p in targets:
        s = p.read_text(encoding="utf-8")
        for old, new, what, required in HTML_EDITS:
            if not required and old not in s:
                optional_skips.append(f"{p.name}: {what}")
                continue
            s = sub1(s, old, new, what, p.name)
        assert s.count(SENTINEL) == 1
        assert "\r" not in s
        p.write_text(s, encoding="utf-8")

    patch_sidecars()
    print(f"patched {len(targets)} files")
    for x in optional_skips:
        print(f"  ⚠️ optional anchor absent (page has drifted) — {x}")
    for n in skipped:
        print("  skipped " + n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
