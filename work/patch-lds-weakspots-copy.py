"""
Weak Spots V2: stop calling it Planned, because it is built.

Three places claimed these components did not exist. Leaving any of them would make the
page lie about itself in the direction of under-promising, which is still lying.

    cd work && py patch-lds-weakspots-copy.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"
s = PAGE.read_text(encoding="utf-8")

# 1 -- the sheet's own subtitle and static legend
old = ('<h2>Weak Spots <span class="samp">V1 &middot; volatility + floor</span></h2>')
new = ('<h2>Weak Spots <span class="samp">V2 &middot; roster shape + observed swing</span></h2>')
assert s.count(old) == 1, "weak spots heading"
s = s.replace(old, new, 1)

old = ('<p class="legend">V1 uses observed team-score volatility and observed low-week floor. '
       'Injury, bye-week, positional-depth and player-concentration components are '
       '<span class="gx-planned">Planned</span>.</p>')
new = ('<p class="legend" id="gxFragilityNote">Injury, bye, positional-depth and star-reliance components are '
       'roster-derived and work before the season starts. Observed volatility and floor '
       'need two completed weeks.</p>')
assert s.count(old) == 1, "weak spots legend"
s = s.replace(old, new, 1)

# 2 -- the honesty card's Planned list
old = (', and injury, bye-week, positional-depth and player-concentration fragility '
       'components are all <span class="gx-planned">Planned</span>.')
new = (' are <span class="gx-planned">Planned</span>. Weak Spots reads injury designations '
       'and byes from Sleeper&rsquo;s season projections and the site&rsquo;s own schedule, and '
       'measures depth and star reliance off projected lineups &mdash; it cannot see '
       'depth-chart roles, snap share or a coach&rsquo;s intent, and none of it is a prediction.')
assert s.count(old) == 1, "honesty card planned list"
s = s.replace(old, new, 1)

# 3 -- Toto's surface: it described a V1 that no longer matches the sheet
old = "- PROJECTION MODE:"
new = ("- WEAK SPOTS is V2. Four ROSTER-DERIVED components, each a share where higher means more "
       "fragile: injury (share of projected starter points carrying a designation, severity-weighted), "
       "bye risk (worst single week of the next four), depth drop (fall from each starter to his best "
       "same-slot replacement; an empty bench scores maximum), and star reliance (top two starters' "
       "share, normalised to this league's slot count). They render before the season because they need "
       "rosters, not scores. Observed volatility and floor still need two completed weeks. Describe them "
       "as descriptive measures of roster shape, never as predictions or as injury forecasts." + NL +
       "- PROJECTION MODE:")
assert s.count(old) == 1, "toto projection-mode bullet"
s = s.replace(old, new, 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-weakspots-copy: ok")
