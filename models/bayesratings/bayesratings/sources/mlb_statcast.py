"""Statcast batted balls from Baseball Savant's public CSV export.

The search is a direct CSV GET through the same HTTP client as the other
sources (no pybaseball, no new package). Pitches are dropped.
Stored events are balls in play (type X): game_pk, batter, pitcher, date,
events, launch speed, launch angle, hit distance, bb_type, estimated BA,
estimated wOBA, and wOBA. Foul balls are not stored.

mlb_batted_players holds one row per batter and one per pitcher for each
game: batted balls, average exit velocity, hard-hit balls (95 mph or more),
barrels, and the xwOBA sum and count. A barrel is Savant's
launch_speed_angle code 6. When that code is absent, the published
exit-velocity and launch-angle window is used.

Savant caps a response, so a pull is a window of at most 3 days and a
response at the cap is split. Seasons start in 2015. The Tuesday MLB stack
reads the player totals. The nightly pass does not itself change a
published forecast, and no page reads them.

The nightly job (prelog mlb-extra, 07:05 CT) pulls official dates in the
last 3 days that are not stored yet and that had a finished game. A date
is stored only when the export covers every finished game that day.
"""

import csv
import hashlib
import io
import json
import urllib.parse
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from .. import db, espn
from ..prelog import Tx, _now
from .common import Players, first_last, get_ids, http_get, robots_allowed
from .mlb_box import (
    GAME_TYPES, _athlete, _fetch, _insert, _int, canon_abbr, choose_one,
    finished_games, our_teams, schedule_url,
)

SAVANT = "https://baseballsavant.mlb.com/statcast_search/csv"
SOURCE = "mlb_statcast"
FIRST_SEASON = 2015
RECENT_DAYS = 3
WINDOW_DAYS = 3
# A response this long is the public cap, not a complete window.
ROW_CAP = 25000
HARD_HIT = 95.0

BALL_COLS = (
    "game_pk", "at_bat_number", "pitch_number", "game_date", "season", "game_type",
    "batter", "pitcher", "events", "launch_speed", "launch_angle", "hit_distance",
    "bb_type", "estimated_ba_using_speedangle", "estimated_woba_using_speedangle",
    "woba_value",
)
GAME_COLS = (
    "game_pk", "season", "game_type", "game_date", "home_abbrev", "away_abbrev",
    "home_score", "away_score", "espn_event_id", "n_batted",
)
PLAYER_COLS = (
    "game_pk", "mlb_person_id", "role", "game_date", "season", "team_abbrev", "is_home",
    "name", "batted_balls", "avg_ev", "ev_n", "hard_hit", "barrels", "xwoba_sum",
    "xwoba_n", "athlete_id",
)
DATE_COLS = ("game_date", "season", "fetched_at", "n_events", "n_games", "content_hash")


def _float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def barrel_window(ev):
    """(low, high) launch angle for a barrel at this exit velocity, or None.

    At 98 mph the window is 26-30 degrees. At 99 it is 25-31. From 100 mph
    the lower bound falls one degree per mph and the upper bound rises one
    and a half, until 116 mph, where any angle from 8 to 50 is a barrel.
    """
    if ev is None or ev < 98:
        return None
    if ev >= 116:
        return (8.0, 50.0)
    if ev < 99:
        return (26.0, 30.0)
    if ev < 100:
        return (25.0, 31.0)
    return (max(8.0, 24.0 - (ev - 100.0)), min(50.0, 33.0 + (ev - 100.0) * 1.5))


def is_barrel(ev, la, code) -> int:
    """1 when Savant coded the ball a barrel, else the published window."""
    if code not in (None, ""):
        try:
            return int(float(code) == 6)
        except (TypeError, ValueError):
            pass
    window = barrel_window(ev)
    if window is None or la is None:
        return 0
    return int(window[0] <= la <= window[1])


def search_url(start, end):
    """Inclusive official-date window. hfSea is set when the window is one year."""
    sea = f"{start.year}|" if start.year == end.year else ""
    params = [
        ("all", "true"), ("hfPT", ""), ("hfAB", ""), ("hfBBT", ""), ("hfPR", ""),
        ("hfZ", ""), ("stadium", ""), ("hfBBL", ""), ("hfNewZones", ""),
        ("hfGT", "R|F|D|L|W|"), ("hfSea", sea), ("hfSit", ""),
        ("player_type", "batter"), ("hfOuts", ""), ("opponent", ""),
        ("pitcher_throws", ""), ("batter_stands", ""), ("hfSA", ""),
        ("game_date_gt", start.isoformat()), ("game_date_lt", end.isoformat()),
        ("hfInfield", ""), ("team", ""), ("position", ""), ("hfOutfield", ""),
        ("hfRO", ""), ("home_road", ""), ("hfFlag", ""), ("hfPull", ""),
        ("metric_1", ""), ("hfInn", ""), ("min_pitches", "0"), ("min_results", "0"),
        ("group_by", "name"), ("sort_col", "pitches"),
        ("player_event_sort", "h_launch_speed"), ("sort_order", "desc"),
        ("min_pas", "0"), ("type", "details"),
    ]
    return SAVANT + "?" + urllib.parse.urlencode(params)


def _header(name):
    return (name or "").replace("\ufeff", "").strip().strip('"')


def csv_text(body: bytes) -> str:
    if not body or body[:1] in (b"<", b"{"):
        raise ValueError("statcast response is not a csv")
    text = body.decode("utf-8-sig", "replace")
    head = text.lstrip()[:80].lower()
    if "pitch_type" not in head and "game_date" not in head:
        raise ValueError("statcast response is not a csv")
    return text


def _side(top, home, away, batting):
    """(team abbrev, is_home) for the batter when batting else the pitcher."""
    if batting:
        return (away, 0) if top else (home, 1)
    return (home, 1) if top else (away, 0)


def parse_csv(text) -> tuple:
    """(events, games, n_rows) from one export.

    n_rows counts every pitch, which is what the row cap applies to.
    games carries the final score from the highest post-score on any pitch.
    events are batted balls in play only.
    """
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames:
        reader.fieldnames = [_header(n) for n in reader.fieldnames]
    events, games = [], {}
    n_rows = 0
    for raw in reader:
        n_rows += 1
        pk = _int(raw.get("game_pk"))
        if pk is None:
            continue
        gtype = (raw.get("game_type") or "").strip()
        if gtype and gtype not in GAME_TYPES:
            continue
        gdate = (raw.get("game_date") or "")[:10]
        game = games.get(pk)
        if game is None:
            game = {
                "game_pk": pk,
                "season": _int(raw.get("game_year")) or _int(gdate[:4]),
                "game_type": gtype or "R",
                "game_date": gdate,
                "home_abbrev": (raw.get("home_team") or "").strip(),
                "away_abbrev": (raw.get("away_team") or "").strip(),
                "home_score": None,
                "away_score": None,
                "espn_event_id": None,
                "n_batted": 0,
            }
            games[pk] = game
        for key, col in (("post_home_score", "home_score"), ("post_away_score", "away_score")):
            n = _int(raw.get(key))
            if n is not None and (game[col] is None or n > game[col]):
                game[col] = n
        if (raw.get("type") or "").strip().upper() != "X":
            continue
        ab, pitch = _int(raw.get("at_bat_number")), _int(raw.get("pitch_number"))
        batter, pitcher = _int(raw.get("batter")), _int(raw.get("pitcher"))
        if None in (ab, pitch, batter, pitcher) or not gdate:
            raise ValueError(f"batted ball in {pk} is missing a key")
        ev, la = _float(raw.get("launch_speed")), _float(raw.get("launch_angle"))
        top = (raw.get("inning_topbot") or "").lower().startswith("top")
        bat_team, bat_home = _side(top, game["home_abbrev"], game["away_abbrev"], True)
        pit_team, pit_home = _side(top, game["home_abbrev"], game["away_abbrev"], False)
        events.append({
            "game_pk": pk, "at_bat_number": ab, "pitch_number": pitch,
            "game_date": gdate, "season": game["season"], "game_type": game["game_type"],
            "batter": batter, "pitcher": pitcher,
            "events": (raw.get("events") or "").strip() or None,
            "launch_speed": ev, "launch_angle": la,
            "hit_distance": _float(raw.get("hit_distance_sc") or raw.get("hit_distance")),
            "bb_type": (raw.get("bb_type") or "").strip() or None,
            "estimated_ba_using_speedangle": _float(raw.get("estimated_ba_using_speedangle")),
            "estimated_woba_using_speedangle": _float(raw.get("estimated_woba_using_speedangle")),
            "woba_value": _float(raw.get("woba_value")),
            "barrel": is_barrel(ev, la, raw.get("launch_speed_angle")),
            "batter_name": first_last(raw.get("player_name")) or None,
            "bat_team": bat_team, "bat_home": bat_home,
            "pit_team": pit_team, "pit_home": pit_home,
        })
    deduped = {}
    for event in events:
        deduped[(event["game_pk"], event["at_bat_number"], event["pitch_number"])] = event
    events = list(deduped.values())
    counts = defaultdict(int)
    for event in events:
        counts[event["game_pk"]] += 1
    for pk, n in counts.items():
        games[pk]["n_batted"] = n
    kept = {e["game_pk"] for e in events}
    games = {pk: g for pk, g in games.items() if pk in kept and g["home_abbrev"] and g["away_abbrev"]}
    return events, games, n_rows


def aggregate(events) -> list:
    """Batter and pitcher rows. avg_ev is None when no ball was tracked."""
    buckets = {}
    for event in events:
        sides = (
            ("batter", event["batter"], event["bat_team"], event["bat_home"], event.get("batter_name")),
            ("pitcher", event["pitcher"], event["pit_team"], event["pit_home"], None),
        )
        for role, pid, team, is_home, name in sides:
            key = (event["game_pk"], pid, role)
            row = buckets.get(key)
            if row is None:
                row = {
                    "game_pk": event["game_pk"], "mlb_person_id": pid, "role": role,
                    "game_date": event["game_date"], "season": event["season"],
                    "team_abbrev": team, "is_home": is_home, "name": name,
                    "batted_balls": 0, "ev_sum": 0.0, "ev_n": 0, "hard_hit": 0,
                    "barrels": 0, "xwoba_sum": 0.0, "xwoba_n": 0, "athlete_id": None,
                }
                buckets[key] = row
            elif name and not row["name"]:
                row["name"] = name
            row["batted_balls"] += 1
            ev = event.get("launch_speed")
            if ev is not None:
                row["ev_sum"] += ev
                row["ev_n"] += 1
                if ev >= HARD_HIT:
                    row["hard_hit"] += 1
            row["barrels"] += int(event.get("barrel") or 0)
            xw = event.get("estimated_woba_using_speedangle")
            if xw is not None:
                row["xwoba_sum"] += xw
                row["xwoba_n"] += 1
    out = []
    for row in buckets.values():
        row["avg_ev"] = (row.pop("ev_sum") / row["ev_n"]) if row["ev_n"] else None
        out.append(row)
    return out


def _digest(events) -> str:
    slim = [{k: e.get(k) for k in BALL_COLS} for e in sorted(
        events, key=lambda e: (e["game_pk"], e["at_bat_number"], e["pitch_number"]))]
    return hashlib.sha1(json.dumps(slim, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def _stored_hash(conn, gdate):
    row = conn.execute("SELECT content_hash FROM mlb_statcast_dates WHERE game_date = ?",
                       (gdate,)).fetchone()
    return row[0] if row else None


def _replace_day(conn, gdate, events, games, at, complete) -> int:
    """Replace one date. A complete date whose rows match the stored hash is a no-op."""
    digest = _digest(events)
    if complete and _stored_hash(conn, gdate) == digest:
        return 0
    players = aggregate(events)
    pks = sorted({e["game_pk"] for e in events} | {g["game_pk"] for g in games})
    marks = ",".join("?" * len(pks)) if pks else "NULL"
    with Tx(conn):
        conn.execute(f"DELETE FROM mlb_batted_balls WHERE game_date = ? OR game_pk IN ({marks})",
                     [gdate, *pks])
        conn.execute(f"DELETE FROM mlb_batted_players WHERE game_date = ? OR game_pk IN ({marks})",
                     [gdate, *pks])
        conn.execute(f"DELETE FROM mlb_statcast_games WHERE game_date = ? OR game_pk IN ({marks})",
                     [gdate, *pks])
        _insert(conn, "mlb_statcast_games", GAME_COLS, games)
        _insert(conn, "mlb_batted_balls", BALL_COLS, events)
        _insert(conn, "mlb_batted_players", PLAYER_COLS, players)
        if complete:
            season = events[0]["season"]
            conn.execute("INSERT OR REPLACE INTO mlb_statcast_dates "
                         f"({', '.join(DATE_COLS)}) VALUES ({', '.join('?' * len(DATE_COLS))})",
                         (gdate, season, at, len(events), len(games), digest))
            conn.execute("INSERT OR REPLACE INTO src_meta (key, value, updated_at) VALUES (?,?,?)",
                         (f"mlb_statcast:{gdate}", digest, at))
        else:
            conn.execute("DELETE FROM mlb_statcast_dates WHERE game_date = ?", (gdate,))
            conn.execute("DELETE FROM src_meta WHERE key = ?", (f"mlb_statcast:{gdate}",))
    return len(events)


def store_parsed(conn, events, games, dates, expected=None, at=None) -> dict:
    """Write the dates in this window.

    `expected` is {date: finished games that day}. A date with fewer games
    than that is stored but not marked, so the next pull retries it.
    """
    at = at or _now()
    expected = expected or {}
    rows = games_n = marked = errors = 0
    by_date = defaultdict(list)
    for event in events:
        by_date[event["game_date"]].append(event)
    game_by_date = defaultdict(list)
    for game in games.values():
        game_by_date[game["game_date"]].append(game)
    for gdate in dates:
        day_events = by_date.get(gdate) or []
        day_games = game_by_date.get(gdate) or []
        need = expected.get(gdate)
        complete = bool(day_events) and (need is None or len(day_games) >= need)
        if not day_events or not complete:
            errors += 1
            if day_events:
                rows += _replace_day(conn, gdate, day_events, day_games, at, complete=False)
            continue
        n = _replace_day(conn, gdate, day_events, day_games, at, complete=True)
        rows += n
        games_n += len(day_games)
        marked += 1
    return {"rows": rows, "games": games_n, "dates": marked, "errors": errors}


def date_windows(dates, days=WINDOW_DAYS):
    """[(start, end, [dates])] covering `dates` in windows of `days`."""
    got = sorted({d if isinstance(d, date) else date.fromisoformat(str(d)[:10]) for d in dates})
    out, i = [], 0
    while i < len(got):
        start, j = got[i], i
        while j + 1 < len(got) and (got[j + 1] - start).days < days:
            j += 1
        out.append((start, got[j], [d.isoformat() for d in got[i:j + 1]]))
        i = j + 1
    return out


def _fetch_csv(url):
    return http_get(url, timeout=120, accept="text/csv,*/*")


def _require_robots(conn, pace, fetch):
    if not robots_allowed(conn, "https://baseballsavant.mlb.com/statcast_search", pace, fetch):
        raise RuntimeError("robots.txt disallows Baseball Savant")


def pull_window(conn, pace, fetch, dates, expected=None, log=print) -> dict:
    """Download one window, splitting it when the response is at the row cap."""
    if not dates:
        return {"rows": 0, "games": 0, "dates": 0, "errors": 0}
    start, end = date.fromisoformat(dates[0]), date.fromisoformat(dates[-1])
    try:
        text = csv_text(pace(fetch, search_url(start, end)))
        events, games, n_rows = parse_csv(text)
    except Exception as e:
        log(f"mlb statcast {dates[0]}..{dates[-1]} FAILED {type(e).__name__}: {e}")
        return {"rows": 0, "games": 0, "dates": 0, "errors": len(dates)}
    if n_rows >= ROW_CAP:
        if len(dates) == 1:
            log(f"mlb statcast {dates[0]} hit the row cap ({n_rows})")
            return {"rows": 0, "games": 0, "dates": 0, "errors": 1}
        mid = len(dates) // 2
        log(f"mlb statcast {dates[0]}..{dates[-1]} capped at {n_rows}; splitting")
        left = pull_window(conn, pace, fetch, dates[:mid], expected, log)
        right = pull_window(conn, pace, fetch, dates[mid:], expected, log)
        return {k: left[k] + right[k] for k in ("rows", "games", "dates", "errors")}
    want = [e for e in events if e["game_date"] in set(dates)]
    keep = {e["game_pk"] for e in want}
    got = {pk: g for pk, g in games.items() if pk in keep and g["game_date"] in set(dates)}
    st = store_parsed(conn, want, got, dates, expected)
    log(f"mlb statcast {dates[0]}..{dates[-1]} {st['rows']} batted balls")
    return st


def _open_dates(conn, today, days=RECENT_DAYS):
    """Official dates in the window with a finished game and no stored export."""
    start = (today - timedelta(days=days - 1)).isoformat()
    end = today.isoformat()
    rows = conn.execute(
        "SELECT g.game_date, COUNT(*) FROM games g WHERE g.league = 'mlb' AND g.completed = 1 "
        "AND g.season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND g.game_date >= ? AND g.game_date <= ? "
        "AND NOT EXISTS (SELECT 1 FROM mlb_statcast_dates d WHERE d.game_date = g.game_date) "
        "GROUP BY g.game_date ORDER BY g.game_date", (start, end)).fetchall()
    return {r[0]: r[1] for r in rows}


def current_pass(conn, pace, now=None, log=print, fetch=None) -> dict:
    """Dates in the last 3 days that had a finished game and are not stored.

    No such date returns skipped and makes no request.
    """
    fetch = fetch or _fetch_csv
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(espn.CENTRAL).date()
    expected = _open_dates(conn, today)
    rows = games = dates = errors = 0
    if expected:
        _require_robots(conn, pace, fetch)
        for _start, _end, days in date_windows(expected):
            st = pull_window(conn, pace, fetch, days, expected, log)
            rows += st["rows"]
            games += st["games"]
            dates += st["dates"]
            errors += st["errors"]
    # Local only. A partial day, or a date stored before its ESPN game or box
    # arrived, still gets its event id and athlete id. No request.
    link_statcast_games(conn)
    link_batted_players(conn)
    if not expected:
        return {"skipped": "no new finished games"}
    return {"rows": rows, "games": games, "dates": dates, "errors": errors}


def _schedule_counts(payload):
    games = finished_games(payload)
    counts = defaultdict(int)
    for game in games:
        counts[game["game_date"]] += 1
    return counts


def _dispatch(url):
    if "statcast_search" in url:
        return _fetch_csv(url)
    return _fetch(url)


def backfill(conn, pace, season_from, season_to, fetch=None, log=print) -> dict:
    """Pull batted balls for every final game date in the season range.
    A date already stored is not downloaded again. Seasons before 2015 are skipped."""
    fetch = fetch or _dispatch
    season_from, season_to = int(season_from), int(season_to)
    lo = max(season_from, FIRST_SEASON)
    if lo > season_to:
        return {"games": 0, "rows": 0, "dates": 0, "errors": 0}
    _require_robots(conn, pace, fetch)
    rows = games = dates = errors = 0
    for season in range(lo, season_to + 1):
        log(f"mlb statcast season {season}")
        try:
            counts = _schedule_counts(json.loads(pace(fetch, schedule_url(season=season))))
        except Exception as e:
            errors += 1
            log(f"mlb statcast schedule {season} FAILED {type(e).__name__}: {e}")
            continue
        missing = []
        for gdate in sorted(counts):
            if _stored_hash(conn, gdate) is None:
                missing.append(gdate)
        for _start, _end, days in date_windows(missing):
            st = pull_window(conn, pace, fetch, days, counts, log)
            rows += st["rows"]
            games += st["games"]
            dates += st["dates"]
            errors += st["errors"]
    return {"games": games, "rows": rows, "dates": dates, "errors": errors}


def link_statcast_games(conn) -> int:
    """Fill espn_event_id from games, by abbreviation, date, and final score."""
    our = our_teams(conn)
    by_abbr = our[0]
    taken = {r[0] for r in conn.execute(
        "SELECT espn_event_id FROM mlb_statcast_games WHERE espn_event_id IS NOT NULL")}
    updates = []
    for game in conn.execute("SELECT * FROM mlb_statcast_games WHERE espn_event_id IS NULL"):
        game = dict(game)
        home, away = by_abbr.get(canon_abbr(game["home_abbrev"])), by_abbr.get(canon_abbr(game["away_abbrev"]))
        if home is None or away is None:
            continue
        cands = [dict(r) for r in conn.execute(
            "SELECT espn_event_id, start_time_utc, game_date, home_score, away_score "
            "FROM games g WHERE league = 'mlb' AND completed = 1 AND season_type IN (2, 3) "
            f"AND {db.playable_sql('g')} AND home_team_id = ? AND away_team_id = ? "
            "AND game_date BETWEEN date(?, '-1 day') AND date(?, '+1 day')",
            (home, away, game["game_date"], game["game_date"]))]
        cands = [c for c in cands if c["espn_event_id"] not in taken]
        chosen = choose_one(cands, game_date=game["game_date"],
                            home_score=game["home_score"], away_score=game["away_score"])
        if not chosen:
            continue
        taken.add(chosen["espn_event_id"])
        updates.append((chosen["espn_event_id"], game["game_pk"]))
    if updates:
        with Tx(conn):
            conn.executemany("UPDATE mlb_statcast_games SET espn_event_id = ? WHERE game_pk = ? "
                             "AND espn_event_id IS NULL", updates)
    return len(updates)


def link_batted_players(conn) -> int:
    """Fill athlete_id from ext_ids, a box-score name, or the batter name and team."""
    our = our_teams(conn)
    known = get_ids(conn, "mlbam", "mlb", "player")
    players = Players(conn, "mlb")
    box_names = {}
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'mlb_box_players'").fetchone():
        for pid, name in conn.execute(
                "SELECT mlb_person_id, name FROM mlb_box_players WHERE name IS NOT NULL"):
            box_names.setdefault(pid, name)
    updates, names = [], []
    for row in conn.execute("SELECT game_pk, mlb_person_id, role, name, team_abbrev "
                            "FROM mlb_batted_players WHERE athlete_id IS NULL"):
        name = row["name"] or box_names.get(row["mlb_person_id"])
        if name and not row["name"]:
            names.append((name, row["game_pk"], row["mlb_person_id"], row["role"]))
        team_id = our[0].get(canon_abbr(row["team_abbrev"]))
        eid = _athlete(known, players, row["mlb_person_id"], name, team_id)
        if eid:
            updates.append((eid, row["game_pk"], row["mlb_person_id"], row["role"]))
    if names or updates:
        with Tx(conn):
            if names:
                conn.executemany("UPDATE mlb_batted_players SET name = ? "
                                 "WHERE game_pk = ? AND mlb_person_id = ? AND role = ? AND name IS NULL",
                                 names)
            if updates:
                conn.executemany("UPDATE mlb_batted_players SET athlete_id = ? "
                                 "WHERE game_pk = ? AND mlb_person_id = ? AND role = ? "
                                 "AND athlete_id IS NULL", updates)
    return len(updates)

