#!/usr/bin/env python3
"""
Move the whole dark ramp up together — page field AND cards — to candidate B.

⚠️ WHY THE CARDS MOVE TOO. theme_tokens.md warned that "going lighter loses the step
immediately, because the cards are only ~7% lightness and there is no headroom above
them". That is true only if the FIELD moves alone. Kap's complaint (8/8) was that
`--page:#0b0802` still reads as pure black on his desktop: at 2.55% lightness its
contrast against #000 is 1.0498, which is below what an eye can use, so no amount of
saturation rescues the hue. Moving page and cards together fixes the visibility WITHOUT
trading the step away — measured, the page-vs-card step IMPROVES from 1.0730 to 1.1238.

Kap picked candidate B from a measured swatch page (8/9), after the 52af998 mistake of
choosing a near-black from renders without measuring. Numbers, all computed:

  --page       #0b0802 (L 2.55%)  ->  #161009 (L 6.08%, hue 32.3, sat 41.9%)
  --surface-1  #16120d (L 6.86%)  ->  #241c12 (L 10.59%)
  page vs card step    1.0730     ->  1.1238        (better)
  page vs pure black   1.0498     ->  1.1122        (the actual complaint)

⚠️ COLOUR HIDES IN FIVE PLACES BEYOND `:root`, and every one of them is handled here:
  * `.ud-ov` (Upside Down overlay) hardcodes the dark tokens ON PURPOSE and must never
    become var(--page). It is moved by hand — literal to literal — so it stays matched.
  * `.ud-chip` / `.ud-note` / `.ud-body` carry the card colour as literals, same reason.
  * bozo `.machine` and `.verdict` also carry the card colour as literals.
  * bozo `.tboard` sits +3/+2/+0 off the field. Left alone it would go DARKER than the
    new field and the draft board would stop reading as a raised surface. Moved to keep
    the same offset: #0e0a02 -> #191209, still lighter than the field (verified).
  * draft-leagues.html runs a SEPARATE palette (--paper/--card). Its card is moved to
    #241f19, which preserves its own step (1.1562 -> 1.1554) and its hue/sat character
    (33.3deg/17.6% -> 32.7deg/18.0%) rather than being snapped to the main card.
  * survivor-settings.html has no tokens; its body background is a hardcoded literal.
  * draft-leagues' `<meta name="theme-color">` is moved to the new field so the mobile
    browser chrome matches the page. It was #11110f, which never matched the old paper
    either; this is stated rather than silently repaired.

AGENTS.md rule 2 says assert one match per file. A colour literal legitimately appears
more than once per file, so the assertion here is stricter than "== 1": every file must
carry EXACTLY the count surveyed at cf16285, and the script writes nothing at all if any
single file disagrees. A drifted page aborts the whole sweep, which is the point.

Run:  python3 work/sweep-theme-ramp-b.py --dry     (from the repo ROOT)
      python3 work/sweep-theme-ramp-b.py --apply
"""
import sys, glob, os

PAGE_OLD, PAGE_NEW = "#0b0802", "#161009"
CARD_OLD, CARD_NEW = "#16120d", "#241c12"

# Every themed page carries its own :root copy (1 page + 1 card) plus the four .ud-*
# literals (1 page in .ud-ov, 3 card in .ud-chip/.ud-note/.ud-body).
STD = {PAGE_OLD: 2, CARD_OLD: 4}

EXPECT = {f: dict(STD) for f in [
    "auction.html", "bigboard.html", "board.html", "cfb.html", "connect.html",
    "dashboard.html", "dataviz.html", "dawgs.html", "dfs.html", "guillotine.html",
    "index.html", "master.html", "nfelo.html", "pound.html", "receipts.html",
    "report.html", "signon.html", "strategy.html", "survivor.html",
]}
# stats.html carries TWO :root blocks (one page + one card each), plus the four .ud-*
EXPECT["stats.html"] = {PAGE_OLD: 3, CARD_OLD: 5}
# bozo.html adds .machine and .verdict on top of the four .ud-*, and owns .tboard
EXPECT["bozo.html"] = {PAGE_OLD: 2, CARD_OLD: 6, "#0e0a02": 1}
# draft-leagues.html: separate palette, no .ud-* overlay, plus the theme-color meta
EXPECT["draft-leagues.html"] = {PAGE_OLD: 1, "#1e1a15": 1, "#11110f": 1}
# survivor-settings.html: no tokens at all, one hardcoded body background
EXPECT["survivor-settings.html"] = {PAGE_OLD: 1}

REPLACE = {
    PAGE_OLD: PAGE_NEW,
    CARD_OLD: CARD_NEW,
    "#0e0a02": "#191209",   # bozo .tboard, offset preserved
    "#1e1a15": "#241f19",   # draft-leagues --card, own step preserved
    "#11110f": PAGE_NEW,    # draft-leagues theme-color, now matches its field
}

def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("--dry", "--apply"):
        sys.exit(__doc__)
    apply = sys.argv[1] == "--apply"

    if not os.path.exists("AGENTS.md"):
        sys.exit("run me from the repo ROOT (AGENTS.md not found here)")

    on_disk = set(glob.glob("*.html"))
    listed = set(EXPECT)
    if on_disk != listed:
        sys.exit(f"page set drifted.\n  new on disk: {sorted(on_disk-listed)}"
                 f"\n  missing:     {sorted(listed-on_disk)}")

    # ---- pass 1: verify EVERY file before writing ANY file ----
    staged, problems = {}, []
    for f in sorted(EXPECT):
        s = open(f, encoding="utf-8").read()
        for lit, want in EXPECT[f].items():
            got = s.count(lit)
            if got != want:
                problems.append(f"{f}: expected {want} x {lit}, found {got}")
        # a literal we did not expect in this file is drift too
        for lit in REPLACE:
            if lit not in EXPECT[f] and s.count(lit):
                problems.append(f"{f}: unexpected {s.count(lit)} x {lit}")
        out = s
        for lit, want in EXPECT[f].items():
            out = out.replace(lit, REPLACE[lit])
        for lit in EXPECT[f]:
            if lit in out:
                problems.append(f"{f}: {lit} survived the replacement")
        staged[f] = out

    if problems:
        print("ABORTED — nothing written:")
        for p in problems:
            print("  ⚠️ " + p)
        sys.exit(1)

    total = sum(sum(v.values()) for v in EXPECT.values())
    print(f"{len(EXPECT)} files, {total} literal replacements, all counts as expected.")
    for f in sorted(EXPECT):
        print(f"  {f:24} " + "  ".join(f"{n}x{l}" for l, n in EXPECT[f].items()))

    if not apply:
        print("\nDRY RUN — nothing written.")
        return
    for f, out in staged.items():
        open(f, "w", encoding="utf-8").write(out)
    print("\nWRITTEN.")

main()
