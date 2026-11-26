"""Venue coordinates and the trip since a team's previous game.

`bayesratings/data/venues.csv` is one row per building that appears in
`games.venue` (MLB, NBA, NFL, NHL), including neutral venues and renamed or
relocated buildings. Latitude and longitude are copied from the source named
in that column (a Wikipedia article, or Wikidata when that article has no
coordinate). `tz` is the IANA time zone of that coordinate. `init_db` loads
the file into `venue_coords` / `venue_aliases`. Nothing here calls the network.

`team_games` is one row per team per game: the previous game's venue, the
great-circle distance in kilometres, the time-zone hours shifted, and days
of rest. The NBA and NHL training frames carry the home and away copies of
those columns. They are not inputs to a fitted model.

Days of rest are the Central `game_date` gap (the same clock as
`games.game_date`). 1 means the previous game was yesterday. 0 is a same-day
doubleheader. The first game in the schedule is NULL.

Time-zone hours are the current game's UTC offset minus the previous game's,
each offset taken at that game's start. Eastward travel inside the US is
positive. A daylight-saving change between the two starts is included. NULL
when either zone or either start is missing.

Distance uses the IUGG mean Earth radius, 6371.0088 km. NULL when either
building has no coordinate. The same building is 0.
"""

import csv
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

CSV_PATH = Path(__file__).resolve().parent / "data" / "venues.csv"
EARTH_RADIUS_KM = 6371.0088

# Home and away copies merged onto a game-level training frame.
HOME_AWAY_COLS = (
    "h_prev_venue", "a_prev_venue",
    "h_travel_km", "a_travel_km",
    "h_tz_shift_hours", "a_tz_shift_hours",
    "h_rest_days", "a_rest_days",
)

_SPACE = re.compile(r"\s+")


def norm_name(value) -> str:
    """Case-folded venue spelling with the whitespace collapsed."""
    if _missing(value):
        return ""
    return _SPACE.sub(" ", str(value).strip()).casefold()


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in kilometres. Scalars or numpy arrays."""
    p1 = np.radians(np.asarray(lat1, dtype=float))
    p2 = np.radians(np.asarray(lat2, dtype=float))
    dphi = np.radians(np.asarray(lat2, dtype=float) - np.asarray(lat1, dtype=float))
    dl = np.radians(np.asarray(lon2, dtype=float) - np.asarray(lon1, dtype=float))
    a = np.sin(dphi / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2.0) ** 2
    return EARTH_RADIUS_KM * 2.0 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def _missing(value):
    if value is None or value == "":
        return True
    if isinstance(value, (str, datetime)):
        return False
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _utc(value):
    if _missing(value):
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc)


def offset_hours(tz_name, when):
    """UTC offset of `tz_name` at `when`, in hours. None when either is missing."""
    if _missing(tz_name) or when is None:
        return None
    try:
        off = when.astimezone(ZoneInfo(str(tz_name))).utcoffset()
    except (KeyError, ValueError, OSError):
        return None
    if off is None:
        return None
    return off.total_seconds() / 3600.0


def tz_shift_hours(prev_tz, prev_when, cur_tz, cur_when):
    """Current offset minus previous offset, in hours. None when either is unknown."""
    prev = offset_hours(prev_tz, _utc(prev_when) if not isinstance(prev_when, datetime) else prev_when)
    cur = offset_hours(cur_tz, _utc(cur_when) if not isinstance(cur_when, datetime) else cur_when)
    if prev is None or cur is None:
        return None
    return cur - prev


def read_rows(path=None):
    """Rows of the checked-in CSV. Comment lines are ignored."""
    text = Path(path or CSV_PATH).read_text(encoding="utf-8")
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    return list(csv.DictReader(lines))


def load_coords(conn, path=None) -> int:
    """Load `venue_coords` and `venue_aliases` from the CSV. Idempotent.

    One immediate transaction, and each row is inserted or updated in place,
    so two callers cannot each delete the table and then collide on the
    unique names. A building that left the file is removed after the upsert,
    once the new rows are in. The canonical name and every alias are both
    alias rows, so a game joins on the spelling ESPN used. Raises when two
    buildings share a spelling once case and whitespace are ignored.
    """
    from .db import immediate
    rows = read_rows(path)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    coords = []
    aliases = []
    seen = {}
    for i, r in enumerate(rows, start=1):
        name = (r.get("name") or "").strip()
        if not name:
            raise ValueError(f"venue csv row {i} has no name")
        lat, lon = float(r["lat"]), float(r["lon"])
        tz = (r.get("tz") or "").strip()
        ZoneInfo(tz)  # reject a zone the runtime cannot use
        coords.append((i, name, (r.get("city") or "").strip() or None,
                       (r.get("region") or "").strip() or None, lat, lon, tz,
                       (r.get("source") or "").strip(), now))
        names = [name] + [a.strip() for a in (r.get("aliases") or "").split("|") if a.strip()]
        for alias in names:
            key = norm_name(alias)
            if key in seen and seen[key] != i:
                raise ValueError(f"venue spelling {alias!r} matches two buildings")
            seen[key] = i
            aliases.append((alias, i))
    ids = [c[0] for c in coords]
    spellings = [a[0] for a in aliases]
    with immediate(conn):
        conn.executemany(
            "INSERT INTO venue_coords (venue_id, name, city, region, lat, lon, tz, "
            "source, loaded_at) VALUES (?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(venue_id) DO UPDATE SET name=excluded.name, city=excluded.city, "
            "region=excluded.region, lat=excluded.lat, lon=excluded.lon, tz=excluded.tz, "
            "source=excluded.source, loaded_at=excluded.loaded_at", coords)
        conn.executemany(
            "INSERT INTO venue_aliases (alias, venue_id) VALUES (?,?) "
            "ON CONFLICT(alias) DO UPDATE SET venue_id=excluded.venue_id", aliases)
        if spellings:
            q = ",".join("?" * len(spellings))
            conn.execute(f"DELETE FROM venue_aliases WHERE alias NOT IN ({q})", spellings)
        if ids:
            q = ",".join("?" * len(ids))
            conn.execute(f"DELETE FROM venue_coords WHERE venue_id NOT IN ({q})", ids)
    return len(coords)


def coord_index(conn) -> dict:
    """``norm_name`` of every stored spelling -> ``(lat, lon, tz, canonical name)``.

    An empty dict when the tables are not there yet.
    """
    try:
        rows = conn.execute(
            "SELECT a.alias, c.lat, c.lon, c.tz, c.name FROM venue_aliases a "
            "JOIN venue_coords c ON c.venue_id = a.venue_id").fetchall()
    except sqlite3.OperationalError:
        return {}
    return {norm_name(r[0]): (r[1], r[2], r[3], r[4]) for r in rows}


def attach_coords(games, conn):
    """Copy `games` with `venue_lat`, `venue_lon` and `venue_tz` filled from the table.

    A spelling that is not stored leaves the three columns null. The row
    count does not change.
    """
    out = games.copy() if games is not None else pd.DataFrame()
    idx = coord_index(conn) if conn is not None else {}
    if "venue" not in out.columns:
        out["venue_lat"] = np.nan
        out["venue_lon"] = np.nan
        out["venue_tz"] = pd.Series([None] * len(out), dtype=object)
        return out

    def one(name):
        return idx.get(norm_name(name))

    got = out["venue"].map(one)
    out["venue_lat"] = [g[0] if g else np.nan for g in got]
    out["venue_lon"] = [g[1] if g else np.nan for g in got]
    out["venue_tz"] = [g[2] if g else None for g in got]
    return out


def _hidden():
    from . import db
    return set(db.HIDDEN_STATUSES)


def _as_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return np.nan
    return number


def team_games(games) -> pd.DataFrame:
    """One row per team per game, with the trip since that team's previous game.

    `games` is a schedule (the games table, or the frame a model already
    loaded). Postponed, canceled, suspended, forfeited and removed games are
    left out, so a game that was not played is not the previous stop.
    """
    empty = pd.DataFrame(columns=[
        "espn_event_id", "league", "team_id", "is_home", "game_date", "start_time_utc",
        "venue", "venue_lat", "venue_lon", "venue_tz", "prev_espn_event_id", "prev_venue",
        "travel_km", "tz_shift_hours", "rest_days"])
    if games is None or not len(games):
        return empty
    g = games.copy()
    if "status" in g.columns:
        hidden = _hidden()
        status = g["status"]
        g = g[status.isna() | ~status.isin(hidden)].copy()
    if not len(g):
        return empty
    for col, fill in (("venue", None), ("venue_lat", np.nan), ("venue_lon", np.nan),
                      ("venue_tz", None), ("league", None), ("start_time_utc", None)):
        if col not in g.columns:
            g[col] = fill
    g["espn_event_id"] = pd.to_numeric(g["espn_event_id"], errors="coerce")
    home = g.rename(columns={"home_team_id": "team_id"}).assign(is_home=1)
    away = g.rename(columns={"away_team_id": "team_id"}).assign(is_home=0)
    keep = ["espn_event_id", "league", "team_id", "is_home", "game_date", "start_time_utc",
            "venue", "venue_lat", "venue_lon", "venue_tz"]
    long = pd.concat([home[keep], away[keep]], ignore_index=True)
    long = long[long["team_id"].notna() & long["espn_event_id"].notna()].copy()
    long["team_id"] = long["team_id"].astype(int)
    long["espn_event_id"] = long["espn_event_id"].astype(int)
    long = long.drop_duplicates(["espn_event_id", "team_id"])
    long["_start"] = long["start_time_utc"].map(_utc)
    long["_ord"] = long["_start"].map(lambda t: t.timestamp() if t is not None else np.nan)
    long = long.sort_values(["team_id", "_ord", "espn_event_id"], kind="mergesort")
    grp = long.groupby("team_id", sort=False)
    long["prev_espn_event_id"] = grp["espn_event_id"].shift()
    long["prev_venue"] = grp["venue"].shift()
    long["prev_lat"] = grp["venue_lat"].shift()
    long["prev_lon"] = grp["venue_lon"].shift()
    long["prev_tz"] = grp["venue_tz"].shift()
    long["prev_start"] = grp["start_time_utc"].shift()
    long["prev_date"] = grp["game_date"].shift()
    dates = pd.to_datetime(long["game_date"], errors="coerce")
    prev_dates = pd.to_datetime(long["prev_date"], errors="coerce")
    long["rest_days"] = (dates - prev_dates).dt.days
    lat = long["venue_lat"].map(_as_number).to_numpy()
    lon = long["venue_lon"].map(_as_number).to_numpy()
    plat = long["prev_lat"].map(_as_number).to_numpy()
    plon = long["prev_lon"].map(_as_number).to_numpy()
    dist = haversine_km(plat, plon, lat, lon)
    ok = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(plat) & np.isfinite(plon)
    long["travel_km"] = np.where(ok, dist, np.nan)
    shifts = [
        tz_shift_hours(pt, ps, ct, cs)
        for pt, ps, ct, cs in zip(long["prev_tz"], long["prev_start"], long["venue_tz"], long["start_time_utc"])
    ]
    long["tz_shift_hours"] = [np.nan if s is None else s for s in shifts]
    return long.drop(columns=["_start", "_ord", "prev_lat", "prev_lon", "prev_tz",
                              "prev_start", "prev_date"]).reset_index(drop=True)


def home_away(games) -> pd.DataFrame:
    """One row per game: home and away travel columns from `team_games`."""
    cols = ["espn_event_id", *HOME_AWAY_COLS]
    long = team_games(games)
    if not len(long):
        return pd.DataFrame(columns=cols)
    home = long[long["is_home"] == 1].drop_duplicates("espn_event_id").set_index("espn_event_id")
    away = long[long["is_home"] == 0].drop_duplicates("espn_event_id").set_index("espn_event_id")
    ids = pd.unique(long["espn_event_id"])
    out = pd.DataFrame({"espn_event_id": ids})
    for frame, prefix in ((home, "h_"), (away, "a_")):
        for src, dest in (("prev_venue", "prev_venue"), ("travel_km", "travel_km"),
                          ("tz_shift_hours", "tz_shift_hours"), ("rest_days", "rest_days")):
            out[prefix + dest] = out.espn_event_id.map(frame[src]) if len(frame) else np.nan
    return out[cols]


def merge_travel(frame, games):
    """Left-join `home_away` onto a game-level frame. Rows are not dropped.

    An empty frame is returned as it was. Fitted columns already on `frame`
    are left as they are; only the travel columns are replaced.
    """
    if frame is None or not len(frame) or "espn_event_id" not in getattr(frame, "columns", []):
        return frame
    extra = home_away(games)
    out = frame.drop(columns=[c for c in HOME_AWAY_COLS if c in frame.columns]).copy()
    if not len(extra):
        for c in HOME_AWAY_COLS:
            out[c] = np.nan
        return out
    out["espn_event_id"] = pd.to_numeric(out["espn_event_id"], errors="coerce").astype(int)
    extra["espn_event_id"] = extra["espn_event_id"].astype(int)
    return out.merge(extra, on="espn_event_id", how="left")


def unmatched_games(conn):
    """Playable games whose venue spelling is not in `venue_aliases`.

    Each item is ``(espn_event_id, league, game_date, venue)``. A blank venue
    is included. An empty list when the coordinate tables are missing: the
    caller reports that separately.
    """
    from . import db
    idx = coord_index(conn)
    if not idx:
        return []
    rows = conn.execute(
        "SELECT espn_event_id, league, game_date, venue FROM games g "
        f"WHERE {db.playable_sql('g')}").fetchall()
    out = []
    for r in rows:
        if norm_name(r["venue"]) not in idx:
            out.append((r["espn_event_id"], r["league"], r["game_date"], r["venue"]))
    return out


def coverage_check(conn):
    """``(level, message)`` for the morning data check. WARN, never a failure.

    ``level`` is OK when every playable game matches a coordinate, or when
    there are no games. WARN when the table was not loaded or a venue spelling
    has no coordinate.
    """
    try:
        n = conn.execute("SELECT COUNT(*) FROM venue_coords").fetchone()[0]
    except sqlite3.OperationalError:
        n = 0
    games = 0
    try:
        games = conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
    except sqlite3.OperationalError:
        games = 0
    if not n:
        if not games:
            return "OK", "no games"
        return "WARN", "venue coordinates are not loaded"
    missing = unmatched_games(conn)
    if not missing:
        from . import db
        total = conn.execute(
            f"SELECT COUNT(*) FROM games g WHERE {db.playable_sql('g')}").fetchone()[0]
        return "OK", f"all {total} games have venue coordinates"
    from collections import Counter
    counts = Counter((v if v else "(no venue)") for *_rest, v in missing)
    shown = [f"{name} ({k})" for name, k in counts.most_common(8)]
    more = len(counts) - len(shown)
    tail = f" +{more} more" if more else ""
    return ("WARN",
            f"{len(missing)} games, {len(counts)} venues without coordinates: "
            + "; ".join(shown) + tail)
