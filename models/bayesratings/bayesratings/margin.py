"""Margin scale for carrying a change in win chance into the margin.

``SD_MARGIN`` is a typical game margin for each league (runs, points, or
goals). ``SLOPE`` is that margin per unit of home logit, from matching a
normal of that width to a logistic at an even game:
``sd * sqrt(2 * pi) / 4``.
"""

import math

SD_MARGIN = {"mlb": 4.60, "nba": 14.28, "nfl": 12.35, "nhl": 2.80}
SLOPE = {lg: sd * math.sqrt(2 * math.pi) / 4 for lg, sd in SD_MARGIN.items()}
