"""
Coverage for Weak Spots V2.

Without these the feature passes green while proving nothing: the harness has no
/data/nfl-schedule.json stub, so byeWeeks() catches its own fetch error and every bye risk
reads 0. A silent zero that looks like a pass is worse than a red test -- and chasing that
zero is what surfaced the real bug that a cached rejection pinned bye risk at 0% for the
whole session.

Assertions sit in the OBSERVED-mode block (3 completed weeks). V2 is roster-derived and has
to compute in both modes -- if it only worked in projection mode it would go dark the moment
the season started, which is backwards -- so projection mode gets its own check later.

Roster 1 is QB p1 (306/17 = 18.0) + RB p2 (255/17 = 15.0) with an empty bench under
QB/RB/WR/TE/FLEX, so every component is exactly predictable:
  injury  p1 Questionable -> 18*0.40 / 33            = 21.8%
  bye     p2 on BUF, bye week 5, horizon 4..7        = 15 / 33 = 45.5%
  depth   nothing on the bench at either slot        = 100%
  conc    two starters, so the "top two" IS the lineup = 0%, not 100%

That last one is the assertion worth having: a naive top-two share reports a two-man roster
as maximally star-reliant, which is meaningless rather than alarming.

    cd work && py patch-lds-weakspots-tests.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
T = REPO / "work" / "test-guillotine.mjs"
s = T.read_text(encoding="utf-8")

# ---- 1. fixtures: a team and an injury designation on the projection rows ----
old = ('].map(([id, pos, pts]) => ({ player_id: id, player: { position: pos }, '
       'stats: { pts_half_ppr: pts, gp: 17 } }));')
new = ('].map(([id, pos, pts]) => ({ player_id: id,' + NL +
       '  player: { position: pos, team: PROJ_TEAM[id] || "KC", injury_status: PROJ_INJ[id] || "" },' + NL +
       '  stats: { pts_half_ppr: pts, gp: 17 } }));')
assert s.count(old) == 1, "PROJ_ROWS map"
s = s.replace(old, new, 1)

old = "const PROJ_ROWS = ["
new = ('let schedMode = "up";' + NL +
       '/* p2 sits on the one team with a bye inside the four-week horizon; p1 carries a' + NL +
       '   designation that is NOT an absence, so severity weighting has something to prove. */' + NL +
       'const PROJ_TEAM = { p1: "KC", p2: "BUF", p3: "KC", p4: "KC", p5: "KC", p6: "KC" };' + NL +
       'const PROJ_INJ  = { p1: "Questionable" };' + NL +
       '/* Weeks 1-4. BUF is absent in week 2, so byeWeeks() derives BUF -> 2 and gives KC' + NL +
       '   no bye at all -- the same derivation it runs on the real 272-game schedule. */' + NL +
       'const SCHED = { data: { games: [1, 2, 3, 4].flatMap(w =>' + NL +
       '  [{ week: w, season_type: "REG", away_team: "KC", home_team: "SEA" }]' + NL +
       '    .concat(w === 2 ? [] : [{ week: w, season_type: "REG", away_team: "BUF", home_team: "MIA" }])) } };' + NL +
       'const schedRes = () => new Response(JSON.stringify(SCHED),' + NL +
       '  { status: 200, headers: { "Content-Type": "application/json" } });' + NL +
       old)
assert s.count(old) == 1, "PROJ_ROWS head"
s = s.replace(old, new, 1)

# ---- 2. serve the schedule from BOTH stubs that can see it ------------------
old = ('  if (url.includes("/projections/nfl/")) return projMode === "up" ? j(PROJ_ROWS) '
       ': new Response("x", { status: 500 });')
new = (old + NL +
       '  if (url.includes("/data/nfl-schedule.json"))' + NL +
       '    return schedMode === "up" ? schedRes() : new Response("x", { status: 500 });')
assert s.count(old) == 1, "projections stub line"
s = s.replace(old, new, 1)

# the preseason stub falls through to the real fetch, which in node cannot resolve a
# relative URL -- without this the projection-mode run silently loses its byes
old = ('    return new Response(JSON.stringify({ week: 0, display_week: 0, season_type: "pre" }), '
       '{ status: 200 });')
# BOTH fallthrough stubs need it -- either one reached by the schedule request would
# otherwise hit the real fetch, fail on a relative URL, and zero the byes.
assert s.count(old) == 2, "preseason stub"
s = s.replace(old, old + NL + '  if (url.includes("/data/nfl-schedule.json")) return schedRes();')

# ---- 3. observed block: projections are deliberately DOWN there ------------
anchor = 'const faabHtml = byId("gxFaabTab").innerHTML;'
assert s.count(anchor) == 1, "observed-mode anchor"
block = """/* ⚠ projMode is "down" through this block on purpose -- the page must work with no
   projections at all. V2 needs them, so the honest assertion here is that it degrades to
   nothing rather than to a sturdy-looking zero. The components are proved in the
   projection-mode block below, where the endpoint is up. */
ok("weak spots reports nothing when projections are unavailable, not a false zero",
  (G || {}).ws === null || (G || {}).ws === undefined);

"""
s = s.replace(anchor, block + anchor, 1)

# ---- 4. and one check that it survives into projection mode -----------------
anchor2 = 'ok("season Monte Carlo runs on projections too",'
assert s.count(anchor2) == 1, "projection-mode anchor"
block2 = """/* --------------------------- Weak Spots V2 ---------------------------- */
/* Roster 1 is QB p1 (306/17 = 18.0) + RB p2 (255/17 = 15.0), empty bench, QB/RB/WR/TE/FLEX.
   done = 0 here, so the bye horizon is weeks 1-4 and BUF's week-2 bye lands inside it. */
const WS = (GP || {}).ws || {}, w1 = WS[1];
ok("weak spots computes once projections are available", !!w1);
ok("injury is severity-weighted, not a binary absence",
  w1 && Math.abs(w1.inj - (18 * 0.4) / 33) < 0.01, w1 && String(w1.inj));
ok("bye risk finds the week inside the horizon and names it",
  w1 && Math.abs(w1.bye - 15 / 33) < 0.01 && w1.byeWk === 2, w1 && (w1.bye + " wk" + w1.byeWk));
// An empty bench IS the fragility; skipping the row would score it as sturdy.
ok("an empty bench scores the maximum depth drop",
  w1 && Math.abs(w1.depth - 1) < 0.001, w1 && String(w1.depth));
// With two starters the "top two" is the whole lineup - a raw share would say 100%.
ok("star reliance is normalised, so a two-man lineup is not 100% concentrated",
  w1 && w1.conc === 0, w1 && String(w1.conc));
ok("a roster with no projectable players reports nothing, not a sturdy zero",
  WS[6] === null || WS[6] === undefined);
ok("the sheet renders the four component columns",
  byId("gxFragilityTab").innerHTML.includes("Star reliance"));
ok("Weak Spots no longer advertises the components as Planned",
  !/injury, bye-week, positional-depth and player-concentration fragility/.test(html));
ok("the page says what these measures cannot see", html.includes("snap share"));

"""
s = s.replace(anchor2, block2 + anchor2, 1)

T.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-weakspots-tests: ok")
