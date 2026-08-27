"""
Coverage for The Waiver Plan, and the rule amendment that has to ship with it.

Every fixture player is rostered, so the derived free-agent pool is empty and the plan
returns null -- green, and proving nothing. p7 is added as the one unrostered player so the
arithmetic has something to bite on.

Focus team is roster 2, whose only projectable player is p3 (RB 289/17 = 17.0). Slots are
QB/RB/WR/TE/FLEX, so the base lineup is 17.0. p7 is a WR at 340/17 = 20.0, who fills the
empty WR slot:

  gain    37.0 - 17.0                     = 20.0 /wk
  left    budget 100 - 40 used            = $60
  alloc   60 * 0.70 spend * (20/20 share) = $42
  range   +/-25%                          = $32-$53
  reserve 60 * 0.30                       = $18

    cd work && py patch-lds-waiverplan-tests.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
T = REPO / "work" / "test-guillotine.mjs"
PAGE = REPO / "guillotine.html"

# ---- 1. the fixture free agent ---------------------------------------------
s = T.read_text(encoding="utf-8")
old = '  ["p4", "WR", 272], ["p5", "TE", 204], ["p6", "WR", 221],'
new = (old + NL +
       '  // p7 is on NO roster: the derived free-agent pool is projections minus every\n'
       '  // rostered id, so without an unrostered player the plan has nothing to plan with.\n'
       '  ["p7", "WR", 340],')
assert s.count(old) == 1, "PROJ_ROWS rows"
s = s.replace(old, new, 1)

# ---- 2. assertions in the projection block (projections are up there) -------
anchor = 'ok("season Monte Carlo runs on projections too",'
assert s.count(anchor) == 1, "projection anchor"
block = '''/* ---------------------------- The Waiver Plan --------------------------- */
const PL = (GP || {}).plan;
ok("waiver plan is built for the focus team", !!PL && PL.steps.length === 1,
  PL && String(PL.steps.length));
ok("the target is the unrostered player, not someone already owned",
  PL && PL.steps[0].id === "p7", PL && PL.steps[0].id);
// ⚠️ The number is the LINEUP delta, not the player's projection: he fills an empty WR slot.
ok("gain is the lineup delta, not the projection",
  PL && Math.abs(PL.steps[0].gain - 20) < 0.05, PL && String(PL.steps[0].gain));
ok("bid is a RANGE, never a single figure",
  PL && PL.steps[0].lo === 32 && PL.steps[0].hi === 53,
  PL && (PL.steps[0].lo + "-" + PL.steps[0].hi));
ok("the plan holds a reserve back rather than going all-in",
  PL && PL.reserve === 18 && PL.left === 60, PL && (PL.reserve + "/" + PL.left));
ok("the card refuses to call the ranges prices", html.includes("ranges, not prices"));
ok("the card says what a bid model cannot see", html.includes("run on a position"));

'''
s = s.replace(anchor, block + anchor, 1)

# ---- 3. the observed block: projections are down, so no plan ---------------
anchor2 = 'ok("weak spots reports nothing when projections are unavailable, not a false zero",'
assert s.count(anchor2) == 1, "observed anchor"
s = s.replace(anchor2,
  'ok("no waiver plan either when projections are unavailable",' + NL +
  '  (G || {}).plan === null || (G || {}).plan === undefined);' + NL +
  anchor2, 1)

T.write_text(s, encoding="utf-8", newline=NL)

# ---- 4. amend the standing rule so page and Toto agree ---------------------
p = PAGE.read_text(encoding="utf-8")
old = ("The standing rule holds: never dress a specific bid recommendation up as maths.")
new = ("The standing rule is AMENDED as of 2026-08-27, and this is the amended form: never give a "
       "single-figure bid. The Waiver Plan gives RANGES with the allocation policy stated on the card "
       "— a share of remaining budget proportional to each step's modelled lineup gain, capped so a "
       "reserve is kept back. Quote them as modelled ranges, never as prices, and never as what a "
       "player will actually cost: the model cannot see what anyone else intends to bid, roster need "
       "around the league, or a run on a position.")
assert p.count(old) == 1, "standing rule"
p = p.replace(old, new, 1)

old = ("Projection-driven FAAB bid recommendations, full conditional waiver optimization, "
       "Universal Data Vault")
new = ("Universal Data Vault")
assert p.count(old) == 1, "planned list"
p = p.replace(old, new, 1)

old = "The observed FAAB module encodes a framework about dollar appreciation, not a guarantee."
new = ("The observed FAAB module encodes a framework about dollar appreciation, not a guarantee. "
       "The Waiver Plan sequences targets and prices them as ranges: each step assumes the steps "
       "above it were won, so the ordering carries more information than the dollars, and the "
       "dollars are modelled and ungraded rather than a bid engine.")
assert p.count(old) == 1, "faab honesty sentence"
p = p.replace(old, new, 1)

PAGE.write_text(p, encoding="utf-8", newline=NL)
print("patch-lds-waiverplan-tests: ok")
