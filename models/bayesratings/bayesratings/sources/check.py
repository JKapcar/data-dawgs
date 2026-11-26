"""End-to-end pipeline check: did every source log inside its expected
window, did per-game captures land for the games that started in the last
day, and did the player tables update after the 04:30 CT job?

    python -m bayesratings.prelog check [--status-file ...]

Prints one line per check (OK / WARN / FAIL) and appends a one-line
summary to the status file for the morning health routine. Exit 1 on FAIL.
The same check WARNs when an MLB game within 3 hours of first pitch has a
probable pitcher missing or last seen more than 150 minutes ago. No such
game (the off-season, and a morning with nothing starting soon) adds no line.
Yesterday's finished NHL games add an nhl_pbp line; a day with none adds nothing.
Yesterday's finished MLB games add an mlb_extra line; a day with none adds nothing.
Yesterday's finished NBA games add an inj_hist_nba line; a day with none adds nothing.
Yesterday's finished NFL games add an inj_hist_nfl line; a day with none adds nothing.
An unplayed NFL forecast whose quarterback-ridge chance differs from the team
chance by more than 10 points, or flips the favorite, adds an nfl_ridge WARN
naming the game. A day with no such game adds nothing.
An unplayed MLB forecast whose player-stack chance differs from the team
chance by more than 10 points, or flips the favorite, adds an mlb_ridge WARN
naming the game. A day with no such game adds nothing.
A venue with no coordinates adds a venue_coords WARN (travel.coverage_check).
It does not fail the check."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

from .. import db, espn
from ..config import status_path
from ..prelog import _teams, _utc

DAILY_STATUS = status_path("daily.log")


def _last_ok(conn, kind, league=None):
    q = "SELECT MAX(finished_at) FROM prelog_runs WHERE kind = ? AND errors = 0"
    a = [kind]
    if league:
        q += " AND league = ?"
        a.append(league)
    r = conn.execute(q, a).fetchone()[0]
    return _utc(r) if r else None


def _last_any(conn, kind):
    r = conn.execute("SELECT MAX(finished_at), errors, note FROM prelog_runs WHERE kind = ? "
                     "AND finished_at = (SELECT MAX(finished_at) FROM prelog_runs WHERE kind = ?)",
                     (kind, kind)).fetchone()
    return r


def _age(t, now):
    if not t:
        return "never"
    h = (now - t).total_seconds() / 3600
    return f"{h:.1f}h ago"


def _started(conn, league, now, hours=24, lag_min=60):
    """Regular/postseason games that started between `hours` ago and
    `lag_min` minutes ago (so the per-game passes have had their chance)."""
    a = (now - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M")
    b = (now - timedelta(minutes=lag_min)).strftime("%Y-%m-%dT%H:%MZ")
    return conn.execute(
        f"SELECT espn_event_id, start_time_utc, venue FROM games g WHERE league = ? AND season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND start_time_utc BETWEEN ? AND ?", (league, a, b)).fetchall()


def check(conn, now=None, daily_status=None) -> list:
    if daily_status is None:
        daily_status = DAILY_STATUS
    now = now or datetime.now(timezone.utc)
    out = []

    def add(src, level, msg):
        out.append((src, level, msg))

    in_season = {lg: bool(_teams(conn, lg, now.astimezone(espn.CENTRAL).date()))
                 for lg in ("mlb", "nba", "nfl", "nhl")}
    ct = now.astimezone(espn.CENTRAL)
    # The morning job runs at 04:30 CT. Player extracts from that run are
    # fresh; an older extract is fine when today's snapshot line exists.
    morning = ct.replace(hour=4, minute=30, second=0, microsecond=0)
    after_morning = ct.hour * 60 + ct.minute >= 7 * 60 + 25

    # daily sources: last success inside ~a day
    daily = [("rosters", None, None, 26), ("transactions", None, None, 26),
             ("mlb_roster", "mlb", "mlb", 26), ("mlb_tx", "mlb", "mlb", 26),
             ("nflverse", "nfl", "nfl", 26), ("nfl_pbp", "nfl", "nfl", 26),
             ("dfo_lines", "nhl", "nhl", 30)]
    for kind, lg, need, hours in daily:
        if need and not in_season[need]:
            add(kind, "OK", "off-season")
            continue
        if kind == "dfo_lines":
            times = [t for t in (_last_ok(conn, "dfo_lines"), _last_ok(conn, "dfo_slate")) if t]
            t = max(times) if times else None
        else:
            t = _last_ok(conn, kind, None)
        last = _last_any(conn, kind)
        if t and now - t <= timedelta(hours=hours):
            add(kind, "OK", f"last success {_age(t, now)}")
        else:
            note = f" (last run errors={last[1]} {last[2] or ''})" if last and last[0] else ""
            add(kind, "FAIL", f"no success in {hours}h, last {_age(t, now)}{note}")

    # NHL goalies on game days
    nhl_today = conn.execute("SELECT COUNT(*) FROM games WHERE league = 'nhl' AND season_type IN (2, 3) "
                             "AND game_date = ?", (ct.date().isoformat(),)).fetchone()[0]
    if nhl_today and ct.hour >= 10:
        t = conn.execute("SELECT MAX(last_seen) FROM nhl_goalie_states").fetchone()[0]
        t = _utc(t) if t else None
        lvl = "OK" if t and now - t <= timedelta(hours=4) else "FAIL"
        add("dfo_goalies", lvl, f"{nhl_today} NHL games today, last goalies fetch {_age(t, now)}")
    _per_game(conn, now, add)

    # NBA injury report on game days
    nba_today = conn.execute("SELECT COUNT(*) FROM games WHERE league = 'nba' AND season_type IN (2, 3) "
                             "AND game_date = ?", (ct.date().isoformat(),)).fetchone()[0]
    if nba_today and 10 <= ct.hour <= 22:
        r = conn.execute("SELECT MAX(fetched_at) FROM nba_injury_reports WHERE backfill = 0").fetchone()[0]
        t = _utc(r) if r else None
        add("nba_injury", "OK" if t and now - t <= timedelta(hours=2) else "FAIL",
            f"{nba_today} NBA games today, last report fetched {_age(t, now)}")

    _mlb_probables(conn, now, add)
    from .nhl_pbp import shot_freshness
    fresh = shot_freshness(conn, now)
    if fresh:
        add("nhl_pbp", fresh[0], fresh[1])
    from .mlb_extra import extra_freshness
    fresh = extra_freshness(conn, now)
    if fresh:
        add("mlb_extra", fresh[0], fresh[1])
    from .injhist import freshness as inj_freshness
    for name, level, msg in inj_freshness(conn, now):
        add(name, level, msg)

    # player tables after the 04:30 CT job.
    if after_morning:
        done = conn.execute(
            "SELECT COUNT(*) FROM games WHERE completed = 1 AND game_date = ? AND season_type IN (1, 2, 3)",
            ((ct.date() - timedelta(days=1)).isoformat(),)).fetchone()[0]
        lat = conn.execute("SELECT MAX(extracted_at) FROM player_extract_log").fetchone()[0]
        missing = conn.execute(
            "SELECT COUNT(*) FROM games g WHERE g.completed = 1 AND g.game_date = ? AND g.season_type IN (2, 3) "
            "AND EXISTS (SELECT 1 FROM game_summaries s WHERE s.espn_event_id = g.espn_event_id) "
            "AND NOT EXISTS (SELECT 1 FROM player_extract_log p WHERE p.espn_event_id = g.espn_event_id)",
            ((ct.date() - timedelta(days=1)).isoformat(),)).fetchone()[0] if _has(conn, "game_summaries") else 0
        p = Path(daily_status)
        snapshot_ok = False
        if p.exists():
            last = (p.read_text().strip().splitlines() or [""])[-1]
            snapshot_ok = f"snapshot={ct.date().isoformat()}" in last and " OK " in last
            add("daily", "OK" if snapshot_ok else "FAIL", last[:120] if not snapshot_ok else "4:30 AM job OK today")
            if snapshot_ok:
                _daily_elo_warn(last, add)
        else:
            add("daily", "WARN", f"no daily status file at {p}")
        fresh = bool(lat) and _utc(lat) >= morning.astimezone(timezone.utc)
        if not done:
            add("players", "OK", "no games completed yesterday")
        elif not missing and (fresh or snapshot_ok):
            when = _age(_utc(lat), now) if lat else "with today's snapshot"
            add("players", "OK", f"{done} games yesterday, player tables updated {when}")
        else:
            add("players", "FAIL", f"{done} games yesterday, last player extract {_age(_utc(lat) if lat else None, now)}"
                + (f", {missing} games without player rows" if missing else ""))

    from ..travel import coverage_check
    level, msg = coverage_check(conn)
    add("venue_coords", level, msg)
    swing = nfl_ridge_alerts(conn, ct.date().isoformat())
    if swing:
        add("nfl_ridge", "WARN", swing)
    swing = mlb_ridge_alerts(conn, ct.date().isoformat())
    if swing:
        add("mlb_ridge", "WARN", swing)

    # unmatched mappings
    for src, n in conn.execute("SELECT source, COUNT(*) FROM ext_unmatched WHERE resolved_at IS NULL "
                               "AND last_seen >= ? GROUP BY source",
                               ((now - timedelta(days=2)).isoformat(timespec="seconds"),)):
        add(f"unmatched/{src}", "WARN" if n else "OK", f"{n} open unmatched ids (last 48h)")
    return out


def _mlb_probables(conn, now, add):
    """WARN when a game inside 3 hours of first pitch has a stale or missing
    probable. No such game adds nothing, so the off-season and the 07:30
    check with nothing starting soon stay quiet."""
    from .mlb import SOON_PITCH, freshness_summary, probable_freshness
    # Wide on purpose: start_time_utc is stored with and without seconds and a
    # trailing Z, so the exact window is applied in Python below.
    lo = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
    hi = (now + SOON_PITCH + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")
    raw = conn.execute(
        "SELECT espn_event_id, start_time_utc FROM games g WHERE league = 'mlb' "
        "AND completed = 0 AND season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND start_time_utc > ? AND start_time_utc <= ?",
        (lo, hi)).fetchall()
    starts = {}
    for eid, iso in raw:
        try:
            st = _utc(iso)
        except (TypeError, ValueError, AttributeError):
            continue
        if now < st <= now + SOON_PITCH:
            starts[int(eid)] = st
    if not starts:
        return
    ids = list(starts)
    seen = {e: [] for e in ids}
    q = ("SELECT espn_event_id, last_seen FROM game_probables WHERE league = 'mlb' "
         f"AND kind = 'SP' AND valid_to IS NULL AND espn_event_id IN ({','.join('?' * len(ids))})")
    for eid, last in conn.execute(q, ids):
        try:
            seen[int(eid)].append(_utc(last) if last else None)
        except (TypeError, ValueError):
            seen[int(eid)].append(None)
    line = freshness_summary(probable_freshness(starts, seen, now))
    if line:
        add("mlb_probables", line[0], line[1])


def _daily_elo_warn(line, add):
    """WARN when the 6 AM run published the logit alone for a league because
    its BayesElo fit failed (daily status part '... WARN elo fallback')."""
    bad = [x.split()[0] for x in line.split(" | ") if "elo fallback" in x]
    if bad:
        add("daily/elo", "WARN", "BayesElo fallback (logit only): " + ", ".join(bad))


def _has(conn, table):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (table,)).fetchone() is not None


def nfl_ridge_alerts(conn, today):
    """Unplayed NFL games whose ridge chance moves more than 10 points from
    the team chance, or flips the favorite. The message names each game.
    None when there is nothing to flag."""
    if not _has(conn, "forecast_snapshots"):
        return None
    try:
        rows = conn.execute(
            "SELECT f.espn_event_id, ta.abbreviation, th.abbreviation, "
            "f.nfl_ridge_prob, f.nfl_team_prob, f.away_team_id, f.home_team_id "
            "FROM ("
            "SELECT espn_event_id, away_team_id, home_team_id, nfl_ridge_prob, nfl_team_prob "
            "FROM forecast_snapshots WHERE league = 'nfl' AND snapshot_date = ? "
            "AND nfl_model_src = 'ridge_qb' "
            "UNION ALL "
            "SELECT espn_event_id, away_team_id, home_team_id, nfl_ridge_prob, nfl_team_prob "
            "FROM upcoming_forecasts WHERE league = 'nfl' AND nfl_model_src = 'ridge_qb'"
            ") f "
            "JOIN games g ON g.espn_event_id = f.espn_event_id AND g.completed = 0 "
            "LEFT JOIN teams th ON th.team_id = f.home_team_id "
            "LEFT JOIN teams ta ON ta.team_id = f.away_team_id "
            "ORDER BY f.espn_event_id", (today,)).fetchall()
    except Exception:
        return None
    seen = set()
    names = []
    for eid, away, home, ridge, team, away_id, home_id in rows:
        if eid in seen or ridge is None or team is None:
            continue
        seen.add(eid)
        gap = abs(float(ridge) - float(team))
        flip = (float(ridge) - 0.5) * (float(team) - 0.5) < 0
        if gap <= 0.10 and not flip:
            continue
        a = (away or "").strip() or str(away_id)
        h = (home or "").strip() or str(home_id)
        why = []
        if gap > 0.10:
            why.append(f"{gap * 100:.1f} pts")
        if flip:
            why.append("favorite flips")
        names.append(f"{a}@{h} ({', '.join(why)})")
    if not names:
        return None
    return "ridge vs team: " + "; ".join(names)


def mlb_ridge_alerts(conn, today):
    """Unplayed MLB games whose stack chance moves more than 10 points from
    the team chance, or flips the favorite. The message names each game.
    None when there is nothing to flag. A gap of exactly 10 points does not."""
    if not _has(conn, "forecast_snapshots"):
        return None
    try:
        rows = conn.execute(
            "SELECT f.espn_event_id, ta.abbreviation, th.abbreviation, "
            "f.mlb_ridge_prob, f.mlb_team_prob, f.away_team_id, f.home_team_id "
            "FROM ("
            "SELECT espn_event_id, away_team_id, home_team_id, mlb_ridge_prob, mlb_team_prob "
            "FROM forecast_snapshots WHERE league = 'mlb' AND snapshot_date = ? "
            "AND mlb_model_src = 'stack_b' "
            "UNION ALL "
            "SELECT espn_event_id, away_team_id, home_team_id, mlb_ridge_prob, mlb_team_prob "
            "FROM upcoming_forecasts WHERE league = 'mlb' AND mlb_model_src = 'stack_b'"
            ") f "
            "JOIN games g ON g.espn_event_id = f.espn_event_id AND g.completed = 0 "
            "LEFT JOIN teams th ON th.team_id = f.home_team_id "
            "LEFT JOIN teams ta ON ta.team_id = f.away_team_id "
            "ORDER BY f.espn_event_id", (today,)).fetchall()
    except Exception:
        return None
    seen = set()
    names = []
    for eid, away, home, ridge, team, away_id, home_id in rows:
        if eid in seen or ridge is None or team is None:
            continue
        seen.add(eid)
        gap = abs(float(ridge) - float(team))
        flip = (float(ridge) - 0.5) * (float(team) - 0.5) < 0
        if gap <= 0.10 and not flip:
            continue
        a = (away or "").strip() or str(away_id)
        h = (home or "").strip() or str(home_id)
        why = []
        if gap > 0.10:
            why.append(f"{gap * 100:.1f} pts")
        if flip:
            why.append("favorite flips")
        names.append(f"{a}@{h} ({', '.join(why)})")
    if not names:
        return None
    return "ridge vs team: " + "; ".join(names)


def _per_game(conn, now, add):
    """Captures for games that started in the last 24 h."""
    # ESPN pre-game snapshots (all leagues)
    for lg in ("mlb", "nba", "nfl", "nhl"):
        gs = _started(conn, lg, now)
        if not gs:
            continue
        have = sum(1 for g in gs if conn.execute(
            "SELECT 1 FROM pregame_snapshots WHERE espn_event_id = ?", (g[0],)).fetchone())
        add(f"pregame/{lg}", "OK" if have == len(gs) else "WARN", f"{have}/{len(gs)} games snapshotted")
    gs = _started(conn, "mlb", now)
    if gs:
        have = sum(1 for g in gs if conn.execute(
            "SELECT COUNT(DISTINCT side) FROM mlb_lineup_states WHERE espn_event_id = ? AND slot > 0 "
            "AND valid_from < ?", (g[0], g[1].replace("Z", ""))).fetchone()[0] == 2)
        add("mlb_lineups", "OK" if have == len(gs) else "WARN", f"{have}/{len(gs)} games with both lineups before first pitch")
    gs = _started(conn, "nhl", now)
    if gs:
        have = sum(1 for g in gs if conn.execute(
            "SELECT COUNT(*) FROM nhl_goalie_states WHERE espn_event_id = ? AND valid_from < ?",
            (g[0], g[1].replace("Z", ""))).fetchone()[0] >= 2)
        add("dfo_goalies/games", "OK" if have == len(gs) else "WARN", f"{have}/{len(gs)} games with both goalies before puck drop")
    gs = _started(conn, "nfl", now)
    if gs:
        have = sum(1 for g in gs if conn.execute(
            "SELECT COUNT(DISTINCT team_id) FROM nfl_inactives WHERE espn_event_id = ?", (g[0],)).fetchone()[0] == 2)
        add("nfl_inactives", "OK" if have == len(gs) else "WARN", f"{have}/{len(gs)} games with inactives for both teams")
    gs = _started(conn, "nba", now)
    if gs:
        have = sum(1 for g in gs if conn.execute(
            "SELECT COUNT(*) FROM nba_starters WHERE espn_event_id = ?", (g[0],)).fetchone()[0] >= 10)
        add("nba_starters", "OK" if have == len(gs) else "WARN", f"{have}/{len(gs)} games with 10 starters")


def summary_line(results, now=None) -> str:
    now = now or datetime.now(timezone.utc)
    n = {lvl: sum(1 for r in results if r[1] == lvl) for lvl in ("OK", "WARN", "FAIL")}
    worst = "FAIL" if n["FAIL"] else ("WARN" if n["WARN"] else "OK")
    bad = [f"{s}: {m}" for s, lvl, m in results if lvl == "FAIL"]
    warn = [f"{s}: {m}" for s, lvl, m in results if lvl == "WARN"]
    return (f"{now.astimezone(espn.CENTRAL):%Y-%m-%d %H:%M} CT CHECK {worst} "
            f"{n['OK']}ok/{n['WARN']}warn/{n['FAIL']}fail"
            + (" | FAIL " + "; ".join(bad) if bad else "") + (" | WARN " + "; ".join(warn) if warn else ""))
