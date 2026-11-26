"""MLB Stats API box scores for the counts ESPN's box does not keep.

https://statsapi.mlb.com/api/v1/game/{gamePk}/boxscore

Batting: doubles, triples, home runs, hit by pitch, sacrifice flies and
bunts, plus plate appearances, total bases, stolen bases, caught stealing,
intentional walks and grounded into a double play. Pitching (the p_ columns):
the same extra-base hits and sacrifices allowed, hit batsmen, wild pitches,
balks, batters faced, ground and air outs, stolen bases, inherited runners,
and the decision counts. A player who hits and pitches is one row.

Rows live in mlb_box_players, keyed by gamePk and the MLB player id.
mlb_box_games is the header. The Tuesday MLB stack reads these rows.
The nightly pass does not itself change a published forecast, and no page
reads them.

The nightly job (prelog mlb-extra, 07:05 CT) fetches finished regular-season
and playoff games from the last 3 days that are not stored yet. Seasons
start in 2006. The multi-season pull writes a standalone file; see
scripts/backfill_mlb_extra.py.
"""

import hashlib
import json
from datetime import timedelta

from .. import db, espn
from ..teamcodes import canon
from ..prelog import Tx, _now
from .common import Players, get_ids, http_get, norm_team, robots_allowed, resolved, unmatched

API = "https://statsapi.mlb.com/api/v1"
SOURCE = "mlb_box"
GAME_TYPES = {"R", "F", "D", "L", "W"}
SKIP_DETAIL = {"Postponed", "Cancelled", "Canceled", "Suspended"}
FIRST_SEASON = 2006
RECENT_DAYS = 3
# Franchise abbreviations that differ from the current ESPN abbreviation.
_ABBR = {"FLA": "MIA", "ANA": "LAA"}
_NAMES = {
    "florida marlins": "miami marlins",
    "cleveland indians": "cleveland guardians",
    "oakland athletics": "athletics",
    "tampa bay devil rays": "tampa bay rays",
}

BAT_MAP = {
    "doubles": "doubles", "triples": "triples", "homeRuns": "home_runs",
    "hitByPitch": "hit_by_pitch", "sacFlies": "sac_flies", "sacBunts": "sac_bunts",
    "plateAppearances": "plate_appearances", "totalBases": "total_bases",
    "stolenBases": "stolen_bases", "caughtStealing": "caught_stealing",
    "intentionalWalks": "intentional_walks", "groundIntoDoublePlay": "gidp",
}
PIT_MAP = {
    "doubles": "p_doubles", "triples": "p_triples", "hitBatsmen": "p_hit_batters",
    "sacFlies": "p_sac_flies", "sacBunts": "p_sac_bunts",
    "intentionalWalks": "p_intentional_walks", "wildPitches": "p_wild_pitches",
    "balks": "p_balks", "battersFaced": "p_batters_faced",
    "groundOuts": "p_ground_outs", "airOuts": "p_air_outs",
    "stolenBases": "p_stolen_bases", "caughtStealing": "p_caught_stealing",
    "inheritedRunners": "p_inherited_runners", "inheritedRunnersScored": "p_inherited_scored",
    "wins": "p_wins", "losses": "p_losses", "saves": "p_saves", "holds": "p_holds",
    "blownSaves": "p_blown_saves", "gamesStarted": "p_games_started",
}

GAME_COLS = (
    "game_pk", "season", "game_type", "game_number", "game_date", "start_time_utc",
    "home_mlb_id", "away_mlb_id", "home_abbrev", "away_abbrev", "home_name", "away_name",
    "home_score", "away_score", "espn_event_id", "content_hash", "fetched_at", "n_players",
)
PLAYER_COLS = (
    "game_pk", "mlb_person_id", "side", "team_mlb_id", "is_home", "name", "position",
    "bat_order",
    "doubles", "triples", "home_runs", "hit_by_pitch", "sac_flies", "sac_bunts",
    "plate_appearances", "total_bases", "stolen_bases", "caught_stealing",
    "intentional_walks", "gidp",
    "p_doubles", "p_triples", "p_hit_batters", "p_sac_flies", "p_sac_bunts",
    "p_intentional_walks", "p_wild_pitches", "p_balks", "p_batters_faced",
    "p_ground_outs", "p_air_outs", "p_stolen_bases", "p_caught_stealing",
    "p_inherited_runners", "p_inherited_scored",
    "p_wins", "p_losses", "p_saves", "p_holds", "p_blown_saves", "p_games_started",
    "athlete_id",
)


def canon_abbr(code) -> str:
    """MLB abbreviation as ESPN stores the franchise now."""
    c = (code or "").upper().strip()
    return canon("mlb", _ABBR.get(c, c))


def team_name_key(name) -> str:
    n = norm_team(name)
    return _NAMES.get(n, n)


def _int(v):
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None


def _digest(body: bytes) -> str:
    return hashlib.sha1(body).hexdigest()


def bat_slot(order):
    """MLB battingOrder is slot * 100 plus the sequence in that slot."""
    n = _int(order)
    if not n:
        return None
    slot = n // 100
    return slot or None


def teams_url(season):
    return f"{API}/teams?sportId=1&season={int(season)}"


def schedule_url(season=None, day=None):
    q = "sportId=1&gameTypes=R,F,D,L,W"
    if season is not None:
        q += f"&season={int(season)}"
    if day is not None:
        q += f"&date={day}"
    return f"{API}/schedule?{q}"


def box_url(game_pk):
    return f"{API}/game/{int(game_pk)}/boxscore"


def _fetch(url):
    return http_get(url, timeout=30)


def parse_teams(payload) -> dict:
    """{mlb team id: {abbreviation, name}}."""
    out = {}
    for team in payload.get("teams") or []:
        if team.get("id") is None:
            continue
        out[int(team["id"])] = {
            "abbreviation": team.get("abbreviation") or "",
            "name": team.get("name") or "",
        }
    return out


def finished_games(payload) -> list:
    """Final regular-season and playoff games on a schedule payload."""
    out = []
    for day in payload.get("dates") or []:
        for game in day.get("games") or []:
            status = game.get("status") or {}
            if status.get("abstractGameState") != "Final":
                continue
            if status.get("detailedState") in SKIP_DETAIL:
                continue
            if game.get("gameType") not in GAME_TYPES or game.get("gamePk") is None:
                continue
            home = (game.get("teams") or {}).get("home") or {}
            away = (game.get("teams") or {}).get("away") or {}
            ht, at = home.get("team") or {}, away.get("team") or {}
            if ht.get("id") is None or at.get("id") is None:
                continue
            gdate = game.get("officialDate") or day.get("date")
            if not gdate:
                continue
            season = game.get("season") or str(gdate)[:4]
            out.append({
                "game_pk": int(game["gamePk"]),
                "season": int(season),
                "game_type": game.get("gameType"),
                "game_number": int(game.get("gameNumber") or 1),
                "game_date": gdate,
                "start_time_utc": game.get("gameDate"),
                "home_mlb_id": int(ht["id"]),
                "away_mlb_id": int(at["id"]),
                "home_name": ht.get("name"),
                "away_name": at.get("name"),
                "home_score": _int(home.get("score")),
                "away_score": _int(away.get("score")),
                "home_abbrev": "",
                "away_abbrev": "",
            })
    return out


def apply_abbrevs(games, teams):
    for game in games:
        home = teams.get(game["home_mlb_id"]) or {}
        away = teams.get(game["away_mlb_id"]) or {}
        game["home_abbrev"] = home.get("abbreviation") or game.get("home_abbrev") or ""
        game["away_abbrev"] = away.get("abbreviation") or game.get("away_abbrev") or ""
        game["home_name"] = game.get("home_name") or home.get("name")
        game["away_name"] = game.get("away_name") or away.get("name")
    return games


def parse_box(payload, meta) -> list:
    """Player rows for one box. Bench players (not in batters or pitchers) are left out.
    A player on both lists is one row. Batting columns stay null when he did not bat."""
    teams = payload.get("teams") or {}
    rows = []
    for side, is_home, want_key in (("home", 1, "home_mlb_id"), ("away", 0, "away_mlb_id")):
        block = teams.get(side) or {}
        team = block.get("team") or {}
        if team.get("id") is None or int(team["id"]) != int(meta[want_key]):
            raise ValueError(f"box {side} team {team.get('id')} != {meta.get(want_key)}")
        batters = {int(x) for x in (block.get("batters") or [])}
        pitchers = {int(x) for x in (block.get("pitchers") or [])}
        roster = block.get("players") or {}
        for pid in sorted(batters | pitchers):
            raw = roster.get(f"ID{pid}") or roster.get(str(pid)) or {}
            person = raw.get("person") or {}
            row = {col: None for col in PLAYER_COLS}
            row.update({
                "game_pk": int(meta["game_pk"]),
                "mlb_person_id": pid,
                "side": side,
                "team_mlb_id": int(team["id"]),
                "is_home": is_home,
                "name": person.get("fullName"),
                "position": (raw.get("position") or {}).get("abbreviation"),
            })
            if pid in batters:
                stats = (raw.get("stats") or {}).get("batting") or {}
                row["bat_order"] = bat_slot(raw.get("battingOrder"))
                for src, col in BAT_MAP.items():
                    row[col] = _int(stats.get(src))
            if pid in pitchers:
                stats = (raw.get("stats") or {}).get("pitching") or {}
                for src, col in PIT_MAP.items():
                    row[col] = _int(stats.get(src))
                if row["p_hit_batters"] is None:
                    row["p_hit_batters"] = _int(stats.get("hitByPitch"))
            rows.append(row)
    if not rows:
        raise ValueError(f"box {meta.get('game_pk')} has no batters or pitchers")
    return rows


def _stored_hash(conn, game_pk):
    row = conn.execute("SELECT content_hash FROM mlb_box_games WHERE game_pk = ?",
                       (int(game_pk),)).fetchone()
    return row[0] if row else None


def _insert(conn, table, cols, rows):
    if not rows:
        return
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
    conn.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])


def _link_event(conn, game_pk, espn_event_id):
    if not espn_event_id:
        return
    conn.execute("UPDATE mlb_box_games SET espn_event_id = ? WHERE game_pk = ? "
                 "AND espn_event_id IS NULL", (int(espn_event_id), int(game_pk)))


def store_game(conn, body: bytes, meta: dict, at=None, espn_event_id=None, link=True) -> int:
    """Replace one game. The same body is a no-op and returns 0.
    Returns the player count when the game is written."""
    if not meta.get("home_abbrev") or not meta.get("away_abbrev"):
        raise ValueError(f"box {meta.get('game_pk')} has no team abbreviation")
    digest = _digest(bytes(body))
    gid = int(meta["game_pk"])
    if _stored_hash(conn, gid) == digest:
        with Tx(conn):
            _link_event(conn, gid, espn_event_id)
            conn.execute("INSERT OR REPLACE INTO src_meta (key, value, updated_at) VALUES (?,?,?)",
                         (f"mlb_box:{gid}", digest, at or _now()))
        if link:
            link_box_players(conn, game_pk=gid)
        return 0
    players = parse_box(json.loads(body), meta)
    at = at or _now()
    game = {col: meta.get(col) for col in GAME_COLS}
    game.update({
        "game_pk": gid,
        "espn_event_id": int(espn_event_id) if espn_event_id else None,
        "content_hash": digest,
        "fetched_at": at,
        "n_players": len(players),
    })
    with Tx(conn):
        conn.execute("DELETE FROM mlb_box_players WHERE game_pk = ?", (gid,))
        conn.execute("DELETE FROM mlb_box_games WHERE game_pk = ?", (gid,))
        _insert(conn, "mlb_box_games", GAME_COLS, [game])
        _insert(conn, "mlb_box_players", PLAYER_COLS, players)
        conn.execute("INSERT OR REPLACE INTO src_meta (key, value, updated_at) VALUES (?,?,?)",
                     (f"mlb_box:{gid}", digest, at))
    if link:
        link_box_players(conn, game_pk=gid)
    return len(players)


def our_teams(conn):
    """(by canon abbreviation, by normalized name, by MLB team id) -> team_id."""
    by_abbr, by_name, by_mlb = {}, {}, {}
    for team_id, abbr, name in conn.execute(
            "SELECT team_id, abbreviation, name FROM teams WHERE league = 'mlb'"):
        if abbr:
            by_abbr[canon_abbr(abbr)] = team_id
        if name:
            by_name[team_name_key(name)] = team_id
    for ext, team_id in conn.execute(
            "SELECT ext_id, team_id FROM ext_ids WHERE source = 'mlbam' AND league = 'mlb' "
            "AND kind = 'team' AND team_id IS NOT NULL"):
        n = _int(ext)
        if n is not None and team_id is not None:
            by_mlb[n] = team_id
    return by_abbr, by_name, by_mlb


def _parse_utc(text):
    from datetime import datetime, timezone
    d = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def choose_one(cands, start_utc=None, game_date=None, home_score=None, away_score=None):
    """One game out of candidates that already share the two teams.

    The nearest start within 6 hours wins when it is at least an hour closer
    than the next one (a doubleheader). Otherwise the final score breaks the
    tie. Two games the same distance apart, with the same score, is no match.
    """
    if not cands:
        return None

    def score_ok(c):
        if home_score is None or away_score is None:
            return False
        return c.get("home_score") == home_score and c.get("away_score") == away_score

    pool = list(cands)
    if start_utc:
        st = _parse_utc(start_utc)
        near = []
        for c in pool:
            if not c.get("start_time_utc"):
                continue
            delta = abs((_parse_utc(c["start_time_utc"]) - st).total_seconds())
            if delta <= 6 * 3600:
                near.append((delta, c))
        if len(near) == 1:
            return near[0][1]
        if len(near) > 1:
            near.sort(key=lambda item: item[0])
            if near[1][0] - near[0][0] >= 3600:
                return near[0][1]
            scored = [c for _, c in near if score_ok(c)]
            return scored[0] if len(scored) == 1 else None
    exact = [c for c in pool if c.get("game_date") == game_date]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        scored = [c for c in exact if score_ok(c)]
        return scored[0] if len(scored) == 1 else None
    if len(pool) == 1:
        return pool[0]
    scored = [c for c in pool if score_ok(c)]
    return scored[0] if len(scored) == 1 else None


def _our_side(game, our, side):
    by_abbr, by_name, by_mlb = our
    return (by_mlb.get(game.get(f"{side}_mlb_id"))
            or by_abbr.get(canon_abbr(game.get(f"{side}_abbrev")))
            or by_name.get(team_name_key(game.get(f"{side}_name"))))


def _athlete(known, players, pid, name, team_id):
    hit = known.get(str(pid))
    if hit and hit[0]:
        return hit[0]
    if name and team_id is not None:
        eid, _method = players.match(name, team_id)
        return eid
    return None


def link_box_players(conn, game_pk=None) -> int:
    """Fill athlete_id from ext_ids, else the player name and team. Nulls only."""
    our = our_teams(conn)
    known = get_ids(conn, "mlbam", "mlb", "player")
    players = Players(conn, "mlb")
    q = ("SELECT game_pk, mlb_person_id, name, team_mlb_id FROM mlb_box_players "
         "WHERE athlete_id IS NULL")
    args = []
    if game_pk is not None:
        q += " AND game_pk = ?"
        args.append(int(game_pk))
    updates = []
    for gid, pid, name, mlb_team in conn.execute(q, args):
        team_id = our[2].get(mlb_team)
        if team_id is None:
            team_id = _team_id_from_game(conn, gid, our, pid)
        eid = _athlete(known, players, pid, name, team_id)
        if eid:
            updates.append((eid, gid, pid))
    if updates:
        with Tx(conn):
            conn.executemany("UPDATE mlb_box_players SET athlete_id = ? "
                             "WHERE game_pk = ? AND mlb_person_id = ? AND athlete_id IS NULL",
                             updates)
    return len(updates)


def _team_id_from_game(conn, game_pk, our, pid):
    row = conn.execute("SELECT team_mlb_id, is_home FROM mlb_box_players "
                       "WHERE game_pk = ? AND mlb_person_id = ?", (game_pk, pid)).fetchone()
    if not row:
        return None
    game = conn.execute("SELECT home_mlb_id, away_mlb_id, home_abbrev, away_abbrev, "
                        "home_name, away_name FROM mlb_box_games WHERE game_pk = ?",
                        (game_pk,)).fetchone()
    if not game:
        return None
    side = "home" if row["is_home"] else "away"
    fake = {f"{side}_mlb_id": game[f"{side}_mlb_id"], f"{side}_abbrev": game[f"{side}_abbrev"],
            f"{side}_name": game[f"{side}_name"]}
    return _our_side(fake, our, side)


def link_box_games(conn) -> int:
    """Fill espn_event_id from games, by team and start, then date and score."""
    our = our_teams(conn)
    taken = {r[0] for r in conn.execute(
        "SELECT espn_event_id FROM mlb_box_games WHERE espn_event_id IS NOT NULL")}
    updates = []
    for game in conn.execute("SELECT * FROM mlb_box_games WHERE espn_event_id IS NULL"):
        game = dict(game)
        home, away = _our_side(game, our, "home"), _our_side(game, our, "away")
        if home is None or away is None:
            continue
        cands = [dict(r) for r in conn.execute(
            "SELECT espn_event_id, start_time_utc, game_date, home_score, away_score "
            "FROM games g WHERE league = 'mlb' AND completed = 1 AND season_type IN (2, 3) "
            f"AND {db.playable_sql('g')} AND home_team_id = ? AND away_team_id = ? "
            "AND game_date BETWEEN date(?, '-1 day') AND date(?, '+1 day')",
            (home, away, game["game_date"], game["game_date"]))]
        cands = [c for c in cands if c["espn_event_id"] not in taken]
        chosen = choose_one(cands, start_utc=game["start_time_utc"], game_date=game["game_date"],
                            home_score=game["home_score"], away_score=game["away_score"])
        if not chosen:
            continue
        taken.add(chosen["espn_event_id"])
        updates.append((chosen["espn_event_id"], game["game_pk"]))
    if updates:
        with Tx(conn):
            conn.executemany("UPDATE mlb_box_games SET espn_event_id = ? WHERE game_pk = ? "
                             "AND espn_event_id IS NULL", updates)
    return len(updates)


def _require_robots(conn, pace, fetch):
    if not robots_allowed(conn, API + "/", pace, fetch):
        raise RuntimeError("robots.txt disallows the MLB Stats API")


def pending_games(conn, today, days=RECENT_DAYS):
    """Completed MLB games in the window whose ESPN id is not stored yet."""
    start = (today - timedelta(days=days - 1)).isoformat()
    end = today.isoformat()
    return [dict(r) for r in conn.execute(
        "SELECT g.espn_event_id, g.season, g.game_date, g.start_time_utc, "
        "g.home_team_id, g.away_team_id, g.home_score, g.away_score "
        "FROM games g WHERE g.league = 'mlb' AND g.completed = 1 AND g.season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND g.game_date >= ? AND g.game_date <= ? "
        "AND NOT EXISTS (SELECT 1 FROM mlb_box_games b WHERE b.espn_event_id = g.espn_event_id)",
        (start, end))]


def _pair(pending, schedule, our):
    """The schedule game for this ESPN game, or None."""
    cands = []
    for game in schedule:
        if _our_side(game, our, "home") == pending["home_team_id"] and \
                _our_side(game, our, "away") == pending["away_team_id"]:
            cands.append(game)
    return choose_one(cands, start_utc=pending["start_time_utc"], game_date=pending["game_date"],
                      home_score=pending["home_score"], away_score=pending["away_score"])


def current_pass(conn, pace, now=None, log=print, fetch=None) -> dict:
    """Finished games from the last 3 days that are not stored yet.

    No such game returns skipped and makes no request. A game already stored
    under its gamePk is linked and not downloaded again.
    """
    from datetime import datetime, timezone
    fetch = fetch or _fetch
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(espn.CENTRAL).date()
    pending = pending_games(conn, today)
    if not pending:
        return {"skipped": "no new finished games"}
    _require_robots(conn, pace, fetch)
    errors = stored = rows = linked = 0
    bad_seasons = set()
    abbrevs = {}
    for season in sorted({p["season"] for p in pending}):
        try:
            abbrevs.update(parse_teams(json.loads(pace(fetch, teams_url(season)))))
        except Exception as e:
            bad_seasons.add(season)
            errors += sum(1 for p in pending if p["season"] == season)
            log(f"mlb box teams {season} FAILED {type(e).__name__}: {e}")
    our = our_teams(conn)
    by_date = {}
    for game in pending:
        if game["season"] in bad_seasons:
            continue
        by_date.setdefault(game["game_date"], []).append(game)
    for gdate, games in by_date.items():
        try:
            schedule = finished_games(json.loads(pace(fetch, schedule_url(day=gdate))))
            apply_abbrevs(schedule, abbrevs)
        except Exception as e:
            errors += len(games)
            log(f"mlb box schedule {gdate} FAILED {type(e).__name__}: {e}")
            continue
        for game in games:
            mlb = _pair(game, schedule, our)
            if mlb is None or not mlb.get("home_abbrev"):
                errors += 1
                with Tx(conn):
                    unmatched(conn, SOURCE, "mlb", "game", game["espn_event_id"],
                              context=gdate)
                log(f"mlb box unmatched espn {game['espn_event_id']}")
                continue
            if _stored_hash(conn, mlb["game_pk"]) is not None:
                with Tx(conn):
                    _link_event(conn, mlb["game_pk"], game["espn_event_id"])
                    resolved(conn, SOURCE, "mlb", "game", game["espn_event_id"])
                link_box_players(conn, game_pk=mlb["game_pk"])
                linked += 1
                continue
            try:
                body = pace(fetch, box_url(mlb["game_pk"]))
                n = store_game(conn, body, mlb, espn_event_id=game["espn_event_id"])
                stored += 1
                rows += n
                with Tx(conn):
                    resolved(conn, SOURCE, "mlb", "game", game["espn_event_id"])
                log(f"mlb box {mlb['game_pk']} {n} players")
            except Exception as e:
                errors += 1
                log(f"mlb box {mlb['game_pk']} FAILED {type(e).__name__}: {e}")
    return {"rows": rows, "games": stored, "linked": linked, "errors": errors}


def backfill(conn, pace, season_from, season_to, fetch=None, log=print) -> dict:
    """Pull every final regular-season and playoff game in the season range.
    A game already stored is not downloaded again."""
    fetch = fetch or _fetch
    season_from, season_to = int(season_from), int(season_to)
    lo = max(season_from, FIRST_SEASON)
    if lo > season_to:
        return {"games": 0, "rows": 0, "errors": 0}
    _require_robots(conn, pace, fetch)
    errors = games = rows = 0
    for season in range(lo, season_to + 1):
        log(f"mlb box season {season}")
        try:
            abbrevs = parse_teams(json.loads(pace(fetch, teams_url(season))))
            schedule = finished_games(json.loads(pace(fetch, schedule_url(season=season))))
            apply_abbrevs(schedule, abbrevs)
        except Exception as e:
            errors += 1
            log(f"mlb box season {season} FAILED {type(e).__name__}: {e}")
            continue
        for game in schedule:
            if _stored_hash(conn, game["game_pk"]) is not None:
                continue
            if not game["home_abbrev"] or not game["away_abbrev"]:
                errors += 1
                log(f"mlb box {game['game_pk']} has no abbreviation")
                continue
            try:
                body = pace(fetch, box_url(game["game_pk"]))
                rows += store_game(conn, body, game, link=False)
                games += 1
            except Exception as e:
                errors += 1
                log(f"mlb box {game['game_pk']} FAILED {type(e).__name__}: {e}")
    return {"games": games, "rows": rows, "errors": errors}
