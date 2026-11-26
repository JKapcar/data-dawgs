# Data contract for the sport-agnostic pipeline.
#
# Every function consumes one canonical games DataFrame:
#   season     int      league-defined season label (e.g. 2025)
#   date       datetime game date
#   home_team  str      canonical team name (any league)
#   away_team  str
#   home_score float    NaN = not yet played
#   away_score float    NaN = not yet played
#
# Ties are coded as home losses.
# fit_bt_ratings warns when present. Exact duplicate rows are legal
# (doubleheaders) and count as two games.

import pandas as pd

REQUIRED_GAME_COLS = [
    "season", "date", "home_team", "away_team", "home_score", "away_score",
]


def validate_games(games: pd.DataFrame) -> pd.DataFrame:
    """Check + coerce a games DataFrame to the contract. Raises on structural
    problems; returns a typed copy."""
    if not isinstance(games, pd.DataFrame):
        raise TypeError("`games` must be a DataFrame.")

    missing = [c for c in REQUIRED_GAME_COLS if c not in games.columns]
    if missing:
        raise ValueError(
            "`games` is missing required columns: " + ", ".join(missing)
        )

    g = games.copy()

    # team columns must not be NA before we stringify (str(NaN) == 'nan')
    if g["home_team"].isna().any() or g["away_team"].isna().any():
        raise ValueError("`games` team columns contain NA.")

    g["season"] = pd.to_numeric(g["season"], errors="coerce")
    g["date"] = pd.to_datetime(g["date"], errors="coerce")
    g["home_team"] = g["home_team"].astype(str)
    g["away_team"] = g["away_team"].astype(str)
    g["home_score"] = pd.to_numeric(g["home_score"], errors="coerce")
    g["away_score"] = pd.to_numeric(g["away_score"], errors="coerce")
    # optional: 1 = neutral site (no home edge). Missing column means none.
    g["neutral"] = (pd.to_numeric(g["neutral"], errors="coerce").fillna(0).astype(int).clip(0, 1)
                    if "neutral" in g.columns else 0)

    if g["season"].isna().any():
        raise ValueError("`games$season` contains NA.")
    g["season"] = g["season"].astype(int)

    if g["date"].isna().any():
        raise ValueError("`games$date` contains NA or unparseable dates.")
    if (g["home_team"] == g["away_team"]).any():
        raise ValueError("`games` contains rows where a team plays itself.")

    # a game must have both scores or neither
    if (g["home_score"].isna() ^ g["away_score"].isna()).any():
        raise ValueError("`games` contains rows with exactly one score missing.")

    return g.reset_index(drop=True)


def completed_games(games: pd.DataFrame) -> pd.DataFrame:
    mask = games["home_score"].notna() & games["away_score"].notna()
    return games[mask].reset_index(drop=True)


def upcoming_games(games: pd.DataFrame, from_date=None, to_date=None) -> pd.DataFrame:
    """Unplayed games, optionally restricted to a date window."""
    mask = games["home_score"].isna() | games["away_score"].isna()
    out = games[mask]
    if from_date is not None:
        out = out[out["date"] >= pd.to_datetime(from_date)]
    if to_date is not None:
        out = out[out["date"] <= pd.to_datetime(to_date)]
    return out.reset_index(drop=True)
