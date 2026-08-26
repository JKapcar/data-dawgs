"""
Point the Sleeper projection read at the SEASON, not week 1.

The ESPN adapter in dawg-bot-worker.js already resolves ESPN's full-season split
(scoringPeriodId 0 / statSplitTypeId 0) and divides by the league's own week count.
The Sleeper path did not: it fetched projections/nfl/2026/1 and used one week's
numbers directly. The two providers therefore fed DIFFERENT semantics into the same
replacement level, VOR, trade gate and schedule simulation.

This aligns Sleeper to what ESPN already does, and fixes copy that asserted
"week 1" unconditionally on pages that were showing ESPN season numbers.

Units are unchanged on purpose: p stays a POINTS-PER-WEEK rate, so replacement(),
starterValues(), VOR_FLOOR and sigma keep their meaning. Only the source of that
rate changes -- one week's guess becomes a season projection spread over the
league's own regular season.

    cd work && py patch-warroom-season-proj.py
"""
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "fantasy-warroom.html"

EDITS = [
# 1 -- the endpoint. Sleeper's season projections need explicit position[] params;
#      without them the response is empty. order_by is required alongside them.
(
 "const API='https://api.sleeper.app/v1',PROJ='https://api.sleeper.app/projections/nfl/2026';",
 "const API='https://api.sleeper.app/v1',PROJ='https://api.sleeper.app/projections/nfl/2026';\n"
 "/* ⚠ SEASON, NOT WEEK 1. This used to read PROJ+'/1' and hand one week's projection to\n"
 "   replacement level, VOR, the trade gate and the schedule sim. ESPN's adapter in the\n"
 "   Worker has always resolved the full-season split and divided by the league's own week\n"
 "   count, so the two providers were feeding different things into identical math.\n"
 "   The season endpoint takes no /<week> segment and returns nothing at all unless every\n"
 "   position is named explicitly -- position[] is not optional here, and order_by must\n"
 "   accompany it. Verified 2026-08-26: 3,303 rows, same stats keys as the weekly payload,\n"
 "   so points() scores it unchanged. It carries no full_name; the first+last fallback in\n"
 "   the pool map already covers that, and DEF arrives as e.g. LAR / \"Los Angeles Rams\". */\n"
 "const PROJ_SEASON=PROJ+'?season_type=regular&order_by=pts_half_ppr'\n"
 "  +['QB','RB','WR','TE','K','DEF'].map(p=>'&position[]='+p).join('');"
),
# 2 -- the fetch
(
 "await Promise.all([fetchJson(PROJ+'/1?season_type=regular'),",
 "await Promise.all([fetchJson(PROJ_SEASON),"
),
# 3 -- the pool map: spread the season total over the league's own regular season,
#      mirroring espnProjection()'s `appliedTotal / wk`.
(
 "  const pool=players.filter(p=>p.player&&['QB','RB','WR','TE','K','DEF'].includes(p.player.position))"
 ".map(p=>({id:String(p.player_id),name:p.player.full_name||p.player.first_name+' '+p.player.last_name,"
 "pos:p.player.position==='DEF'?'DST':p.player.position,p:points(p,league.scoring_settings),team:p.team}));",
 "  /* Mirrors espnProjection()'s `appliedTotal / wk`: the league's own regular season, not a\n"
 "     flat 17. Keeping p in points-per-week is what lets replacement(), starterValues(),\n"
 "     VOR_FLOOR and sigma stay exactly as they were -- the divisor is constant across every\n"
 "     player, so it cannot reorder anyone or change a single VOR ratio. */\n"
 "  const REG_WEEKS=Math.max(1,playoffStart-1);\n"
 "  const pool=players.filter(p=>p.player&&['QB','RB','WR','TE','K','DEF'].includes(p.player.position))"
 ".map(p=>({id:String(p.player_id),name:p.player.full_name||p.player.first_name+' '+p.player.last_name,"
 "pos:p.player.position==='DEF'?'DST':p.player.position,p:points(p,league.scoring_settings)/REG_WEEKS,team:p.team}));"
),
# 4 -- provenance line. It named Week 1 for BOTH providers.
(
 "· Projections: Sleeper, Week 1 2026 · Seed: ",
 "· Projections: '+(state.ref.provider==='espn'?'ESPN season total':'Sleeper season total')"
 "+', 2026, spread over the league’s regular season · Seed: "
),
# 5 -- the simulation caveat, shown on every provider
(
 "<b>⚠️ Every simulated week uses the same week-1 projection.</b> No opponent adjustment, no bye, no",
 "<b>⚠️ Every simulated week uses the same season-average projection.</b> No opponent adjustment, no bye, no"
),
# 6 -- the same claim in the honesty card
(
 "why:'Every simulated week reuses the same week-1 projection. No byes, no opponent adjustment, no injuries, no waivers.',",
 "why:'Every simulated week reuses the same season-average projection — the season total spread evenly over the league’s regular season. No byes, no opponent adjustment, no injuries, no waivers.',"
),
# 7 -- the structural comment above the scatter
(
 "   The other chart plots market value against a WEEK-ONE PROJECTION over replacement, which",
 "   The other chart plots market value against a SEASON PROJECTION over replacement, which"
),
# 8 -- Toto's page context
(
 "Projections are Sleeper's own week-1 numbers, unaudited, and this page produces none of its own. ⚠️ EVERY SIMULATED WEEK REUSES THAT ONE WEEK-1 PROJECTION",
 "Projections are the provider's own full-season numbers — ESPN's season split, or Sleeper's season projection — unaudited, spread evenly over the league's regular season, and this page produces none of its own. ⚠️ EVERY SIMULATED WEEK REUSES THAT ONE SEASON AVERAGE"
),
]

s = PAGE.read_text(encoding="utf-8")
applied = present = 0
for old, new in EDITS:
    if new in s:
        present += 1
        continue
    n = s.count(old)
    assert n == 1, "anchor is not unique (%d matches): %.90s" % (n, old)
    s = s.replace(old, new, 1)
    applied += 1

PAGE.write_text(s, encoding="utf-8", newline="\n")
print("patch-warroom-season-proj: %d edit(s) applied, %d already present" % (applied, present))
