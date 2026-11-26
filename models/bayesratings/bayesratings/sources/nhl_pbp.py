"""NHL shot locations and a logistic expected-goals model.

Play-by-play: https://api-web.nhle.com/v1/gamecenter/{gameId}/play-by-play
Box score (time on ice): https://api-web.nhle.com/v1/gamecenter/{gameId}/boxscore

Shots are stored in nhl_shots. A plain logistic regression (numpy IRLS, the
same algorithm as hybrid.py) is fit on unblocked shots that have a distance
and an angle, excluding the shootout. Coefficients live in nhl_xg_model.
Skater xG and xG per 60, and goalie GSAx, live in nhl_player_xg.

Nothing here is read by the forecast, the NHL player model, or any page.

The nightly job (prelog nhl-pbp, 07:20 CT) fetches finished regular-season
and playoff games from the last 3 days that are not stored yet. The
multi-season pull is scripts/backfill_nhl_shots.py, which writes a
standalone SQLite file. scripts/load_nhl_shots.py ATTACHes that file into
the main database.

    python -m bayesratings.sources.nhl_pbp --db data/bayesratings.db
    python -m bayesratings.sources.nhl_pbp --db data/nhl_shots.db --refit
"""

import argparse
import hashlib
import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import numpy as np

from .. import db, espn
from ..teamcodes import canon
from ..prelog import Tx, _now
from .common import Missing, http_get, resolved, robots_allowed, unmatched

API = "https://api-web.nhle.com"
PBP_URL = API + "/v1/gamecenter/{game_id}/play-by-play"
BOX_URL = API + "/v1/gamecenter/{game_id}/boxscore"
SCHED_URL = API + "/v1/schedule/{day}"
SOURCE = "nhlapi"

# NHL rink: center ice is (0, 0), goal lines are 89 feet from center.
GOAL_LINE = 89.0
REBOUND_SEC = 3
RUSH_SEC = 4
RECENT_DAYS = 3
MIN_FIT = 100
FINISHED_STATES = {"OFF", "FINAL"}
SHOT_KEYS = {"goal", "shot-on-goal", "missed-shot", "blocked-shot"}
RESET_KEYS = {"faceoff", "stoppage", "period-start", "period-end", "game-end", "penalty"}
RESULTS = {"goal": "goal", "shot-on-goal": "shot", "missed-shot": "miss", "blocked-shot": "block"}

# Design-matrix order. Wrist and even strength are the baselines.
FEATURES = (
    "intercept", "distance", "angle", "rebound", "rush",
    "shot_snap", "shot_slap", "shot_backhand", "shot_tip", "shot_wrap", "shot_other",
    "strength_powerplay", "strength_shorthanded", "strength_empty",
)
FIT_NOTES = (
    "Logistic regression on unblocked shots with coordinates, shootout excluded. "
    "Distance is feet to the goal line (89 from center) and angle is degrees off center. "
    "When a play has no homeTeamDefendingSide, the net is the sign of that team's "
    "offensive-zone shots in the period. Rebound: same team, within 3 seconds of a "
    "prior shot that was not a goal. Rush: within 4 seconds of a same-team takeaway "
    "or an opponent giveaway, and not a rebound. L2 1e-6 on the non-intercept "
    "coefficients, for separation. Blocks are stored and not fit."
)

GAME_COLS = ("nhl_game_id", "season", "game_type", "game_date", "start_time_utc",
             "home_nhl_id", "away_nhl_id", "home_abbrev", "away_abbrev", "home_score",
             "away_score", "espn_event_id", "content_hash", "fetched_at", "n_shots")
SHOT_COLS = ("nhl_game_id", "event_id", "sort_order", "period", "period_type", "clock_sec",
             "situation_code", "strength", "result", "shot_type", "x_coord", "y_coord",
             "zone_code", "distance", "angle", "rebound", "rush", "shooter_id", "goalie_id",
             "team_nhl_id", "opp_nhl_id", "is_home", "xg")
PLAYER_COLS = ("nhl_game_id", "player_id", "role", "team_nhl_id", "is_home", "name",
               "position", "toi_sec", "shots", "goals", "xg", "xg_per_60", "gsax")
MODEL_COLS = ("model_id", "fit_at", "n_shots", "n_goals", "features", "coef", "intercept", "notes")


def _digest(body: bytes) -> str:
    return hashlib.sha1(body).hexdigest()


def _clock(text):
    if text is None or ":" not in str(text):
        return None
    mins, _, secs = str(text).partition(":")
    try:
        return int(mins) * 60 + int(secs)
    except ValueError:
        return None


def _coord(v):
    if v is None or v == "":
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def _situation(v):
    if v is None or v == "":
        return None
    text = str(v).strip()
    return text.zfill(4) if text.isdigit() else text


def strength_of(code, is_home) -> str:
    """even, powerplay, shorthanded, or empty.

    situationCode is four digits: away goalie, away skaters, home skaters,
    home goalie. An empty opposing net wins over the skater count.
    """
    if not code or len(code) != 4 or not code.isdigit():
        return "even"
    away_g, away_sk, home_sk, home_g = (int(c) for c in code)
    if is_home:
        skaters, opp, opp_goalie = home_sk, away_sk, away_g
    else:
        skaters, opp, opp_goalie = away_sk, home_sk, home_g
    if opp_goalie == 0:
        return "empty"
    if skaters > opp:
        return "powerplay"
    if skaters < opp:
        return "shorthanded"
    return "even"


def _net_from_side(side, is_home):
    side = (side or "").lower()
    if side == "left":
        home_net = -GOAL_LINE
    elif side == "right":
        home_net = GOAL_LINE
    else:
        return None
    return -home_net if is_home else home_net


def shot_geometry(x, y, net_x):
    """Distance in feet and the absolute angle off the center of the net."""
    if x is None or y is None or net_x is None:
        return None, None
    dx = float(net_x) - float(x)
    dy = float(y)
    return math.hypot(dx, dy), math.degrees(math.atan2(abs(dy), abs(dx)))


def _attacking_nets(plays, home_id, away_id):
    """(period, team) -> goal x. The play's defending side wins. Without it,
    the net is the sign of that team's offensive-zone x coordinates."""
    explicit, off_x = {}, {}
    for play in plays:
        if play.get("typeDescKey") not in SHOT_KEYS:
            continue
        det = play.get("details") or {}
        owner = det.get("eventOwnerTeamId")
        if owner is None:
            continue
        team = int(owner)
        period = (play.get("periodDescriptor") or {}).get("number")
        net = _net_from_side(play.get("homeTeamDefendingSide"), team == home_id)
        if net is not None:
            explicit[(period, team)] = net
        if det.get("zoneCode") == "O" and det.get("xCoord") is not None:
            off_x.setdefault((period, team), []).append(float(det["xCoord"]))
    nets = dict(explicit)
    for key, xs in off_x.items():
        if key not in nets:
            med = sorted(xs)[len(xs) // 2]
            nets[key] = GOAL_LINE if med >= 0 else -GOAL_LINE
    for period in {p for p, _ in list(nets)}:
        for a, b in ((home_id, away_id), (away_id, home_id)):
            if (period, a) not in nets and (period, b) in nets:
                nets[(period, a)] = -nets[(period, b)]
    return nets


def _shot_flags(shot_type):
    flags = {k: 0.0 for k in ("shot_snap", "shot_slap", "shot_backhand",
                              "shot_tip", "shot_wrap", "shot_other")}
    kind = (shot_type or "").lower()
    if kind == "wrist":
        return flags
    if kind == "snap":
        flags["shot_snap"] = 1.0
    elif kind == "slap":
        flags["shot_slap"] = 1.0
    elif kind == "backhand":
        flags["shot_backhand"] = 1.0
    elif kind in ("tip-in", "deflected"):
        flags["shot_tip"] = 1.0
    elif kind == "wrap-around":
        flags["shot_wrap"] = 1.0
    else:
        flags["shot_other"] = 1.0
    return flags


def design_row(shot):
    flags = _shot_flags(shot.get("shot_type"))
    strength = shot.get("strength") or "even"
    values = {
        "intercept": 1.0,
        "distance": float(shot["distance"]),
        "angle": float(shot["angle"]),
        "rebound": float(shot.get("rebound") or 0),
        "rush": float(shot.get("rush") or 0),
        "strength_powerplay": 1.0 if strength == "powerplay" else 0.0,
        "strength_shorthanded": 1.0 if strength == "shorthanded" else 0.0,
        "strength_empty": 1.0 if strength == "empty" else 0.0,
        **flags,
    }
    return [float(values[name]) for name in FEATURES]


def _header(payload):
    home, away = payload.get("homeTeam") or {}, payload.get("awayTeam") or {}
    if home.get("id") is None or away.get("id") is None:
        raise ValueError("play-by-play has no home or away team")
    if not home.get("abbrev") or not away.get("abbrev"):
        raise ValueError("play-by-play has no team abbreviation")
    game_id = payload.get("id")
    if game_id is None:
        raise ValueError("play-by-play has no game id")
    season = payload.get("season")
    return {
        "nhl_game_id": int(game_id),
        "season": int(str(season)[:4]) if season else int(str(game_id)[:4]),
        "game_type": int(payload.get("gameType") or 0),
        "game_date": payload.get("gameDate"),
        "start_time_utc": payload.get("startTimeUTC"),
        "home_nhl_id": int(home["id"]),
        "away_nhl_id": int(away["id"]),
        "home_abbrev": home.get("abbrev"),
        "away_abbrev": away.get("abbrev"),
        "home_score": home.get("score"),
        "away_score": away.get("score"),
    }


def parse_game(payload) -> tuple:
    """(header, shots) from one play-by-play payload. Shots are in play order."""
    header = _header(payload)
    home_id, away_id = header["home_nhl_id"], header["away_nhl_id"]
    plays = sorted(payload.get("plays") or [],
                   key=lambda p: (p.get("sortOrder") is None, p.get("sortOrder") or 0,
                                  p.get("eventId") or 0))
    nets = _attacking_nets(plays, home_id, away_id)
    shots, seen = [], {}
    prev = None          # period, clock, team, result
    rush_at = None       # period, clock, team that just gained the puck
    for play in plays:
        key = play.get("typeDescKey")
        period = (play.get("periodDescriptor") or {}).get("number")
        period_type = (play.get("periodDescriptor") or {}).get("periodType") or ""
        clock = _clock(play.get("timeInPeriod"))
        if prev and period != prev[0]:
            prev = None
            rush_at = None
        if key in RESET_KEYS:
            prev = None
            rush_at = None
            continue
        det = play.get("details") or {}
        if key == "takeaway":
            owner = det.get("eventOwnerTeamId")
            if owner is not None and clock is not None:
                rush_at = (period, clock, int(owner))
            continue
        if key == "giveaway":
            owner = det.get("eventOwnerTeamId")
            if owner is not None and clock is not None:
                owner = int(owner)
                other = away_id if owner == home_id else home_id if owner == away_id else None
                if other is not None:
                    rush_at = (period, clock, other)
            continue
        if key not in SHOT_KEYS:
            continue
        event_id = play.get("eventId")
        owner = det.get("eventOwnerTeamId")
        if event_id is None or owner is None:
            continue
        team = int(owner)
        is_home = team == home_id
        opp = away_id if is_home else home_id if team == away_id else None
        if key == "goal":
            shooter = det.get("scoringPlayerId") or det.get("shootingPlayerId")
        else:
            shooter = det.get("shootingPlayerId")
        result = RESULTS[key]
        code = _situation(play.get("situationCode"))
        strength = strength_of(code, is_home)
        # A block is not a shot faced. An empty net is not a shot faced either,
        # even when the payload still names the goalie who was pulled.
        goalie = None if key == "blocked-shot" or strength == "empty" else det.get("goalieInNetId")
        shootout = period_type == "SO"
        rebound = rush = 0
        if not shootout and clock is not None and prev and prev[0] == period and prev[2] == team \
                and prev[3] != "goal" and prev[1] is not None:
            dt = clock - prev[1]
            if 0 <= dt <= REBOUND_SEC:
                rebound = 1
        if not shootout and not rebound and rush_at and rush_at[0] == period and rush_at[2] == team \
                and clock is not None and rush_at[1] is not None:
            dt = clock - rush_at[1]
            if 0 <= dt <= RUSH_SEC:
                rush = 1
        side_net = _net_from_side(play.get("homeTeamDefendingSide"), is_home)
        net = side_net if side_net is not None else nets.get((period, team))
        x, y = _coord(det.get("xCoord")), _coord(det.get("yCoord"))
        distance, angle = shot_geometry(x, y, net)
        row = {
            "nhl_game_id": header["nhl_game_id"],
            "event_id": int(event_id),
            "sort_order": play.get("sortOrder"),
            "period": period,
            "period_type": period_type or None,
            "clock_sec": clock,
            "situation_code": code,
            "strength": strength,
            "result": result,
            "shot_type": det.get("shotType"),
            "x_coord": x,
            "y_coord": y,
            "zone_code": det.get("zoneCode"),
            "distance": distance,
            "angle": angle,
            "rebound": rebound,
            "rush": rush,
            "shooter_id": int(shooter) if shooter is not None else None,
            "goalie_id": int(goalie) if goalie is not None else None,
            "team_nhl_id": team,
            "opp_nhl_id": opp,
            "is_home": int(is_home),
            "xg": None,
        }
        seen[row["event_id"]] = row
        if row["event_id"] not in shots:
            shots.append(row["event_id"])
        prev = (period, clock, team, result)
        rush_at = None
    return header, [seen[e] for e in shots]


def roster_names(payload) -> dict:
    names = {}
    for spot in payload.get("rosterSpots") or []:
        pid = spot.get("playerId")
        if pid is None:
            continue
        first = ((spot.get("firstName") or {}).get("default") or "").strip()
        last = ((spot.get("lastName") or {}).get("default") or "").strip()
        name = f"{first} {last}".strip()
        if name:
            names[int(pid)] = name
    return names


def parse_box(payload, home_id, away_id) -> dict:
    """NHL player id -> toi, name, position, team, role (skater or goalie)."""
    out = {}
    stats = (payload or {}).get("playerByGameStats") or {}
    for side, team_id in (("homeTeam", home_id), ("awayTeam", away_id)):
        block = stats.get(side) or {}
        for group, role in (("forwards", "skater"), ("defense", "skater"), ("goalies", "goalie")):
            for player in block.get(group) or []:
                pid = player.get("playerId")
                if pid is None:
                    continue
                out[int(pid)] = {
                    "role": role,
                    "team_nhl_id": team_id,
                    "is_home": int(team_id == home_id),
                    "name": (player.get("name") or {}).get("default"),
                    "position": player.get("position"),
                    "toi_sec": _clock(player.get("toi")),
                }
    return out


def scoreable(shot) -> bool:
    if shot.get("period_type") == "SO" or shot.get("result") == "block":
        return False
    if shot.get("result") not in ("goal", "shot", "miss"):
        return False
    return shot.get("distance") is not None and shot.get("angle") is not None


def fit_logistic(X, y, max_iter=100, tol=1e-8, l2=1e-6):
    """Binomial IRLS. A small L2 penalty on the non-intercept terms keeps an
    empty-net coefficient finite when the outcomes separate."""
    y = np.asarray(y, dtype=float)
    n_col = X.shape[1]
    beta = np.zeros(n_col)
    pen = np.eye(n_col)
    pen[0, 0] = 0.0
    for _ in range(max_iter):
        eta = np.clip(X @ beta, -30.0, 30.0)
        mu = 1.0 / (1.0 + np.exp(-eta))
        var_w = np.clip(mu * (1.0 - mu), 1e-6, None)
        z = eta + (y - mu) / var_w
        xtw = X.T * var_w
        a = xtw @ X + l2 * pen
        try:
            beta_new = np.linalg.solve(a, xtw @ z)
        except np.linalg.LinAlgError:
            beta_new = np.linalg.lstsq(a, xtw @ z, rcond=None)[0]
        if np.max(np.abs(beta_new - beta)) < tol:
            return beta_new
        beta = beta_new
    return beta


def fit_shots(shots):
    """Coefficient vector, or None when there are not enough of both outcomes."""
    usable = [s for s in shots if scoreable(s)]
    if len(usable) < MIN_FIT:
        return None
    y = np.array([1.0 if s["result"] == "goal" else 0.0 for s in usable])
    if y.sum() < 1 or y.sum() == len(y):
        return None
    X = np.vstack([design_row(s) for s in usable])
    return fit_logistic(X, y)


def score_shots(shots, model):
    """Set xg on scoreable shots. Blocks, shootout shots, and shots with no
    distance stay null."""
    coef = np.asarray(model["coef"], dtype=float)
    usable = [i for i, s in enumerate(shots) if scoreable(s)]
    for shot in shots:
        shot["xg"] = None
    if not usable:
        return
    X = np.vstack([design_row(shots[i]) for i in usable])
    eta = np.clip(X @ coef, -30.0, 30.0)
    prob = 1.0 / (1.0 + np.exp(-eta))
    for i, p in zip(usable, prob):
        shots[i]["xg"] = float(p)


def build_player_rows(nhl_game_id, shots, people, names=None, skater_ids=None, goalie_ids=None):
    """Skater xG / per-60 and goalie GSAx for one game.

    GSAx is the sum of xG on unblocked shots faced minus goals allowed.
    Shootout shots are not included. xg_per_60 is set only when TOI is
    present and xG is. A block is not a shot faced.
    """
    names = names or {}
    counted = [s for s in shots if s.get("period_type") != "SO"]
    by_shooter, by_goalie = defaultdict(list), defaultdict(list)
    for shot in counted:
        if shot.get("shooter_id"):
            by_shooter[int(shot["shooter_id"])].append(shot)
        if shot.get("result") != "block" and shot.get("strength") != "empty" and shot.get("goalie_id"):
            by_goalie[int(shot["goalie_id"])].append(shot)
    skaters = set(by_shooter) | set(skater_ids or [])
    skaters |= {pid for pid, info in people.items() if info.get("role") == "skater"}
    goalies = set(by_goalie) | set(goalie_ids or [])
    goalies |= {pid for pid, info in people.items() if info.get("role") == "goalie"}
    rows = []
    for pid in sorted(skaters):
        info = people.get(pid) or {}
        mine = by_shooter.get(pid) or []
        unblocked = [s for s in mine if s.get("result") != "block"]
        known = [s["xg"] for s in unblocked if s.get("xg") is not None]
        if known:
            xg = float(sum(known))
        elif unblocked:
            xg = None
        else:
            xg = 0.0
        toi = info.get("toi_sec")
        team = info.get("team_nhl_id")
        is_home = info.get("is_home")
        if team is None and mine:
            team = mine[0].get("team_nhl_id")
            is_home = mine[0].get("is_home")
        rows.append({
            "nhl_game_id": nhl_game_id, "player_id": pid, "role": "skater",
            "team_nhl_id": team, "is_home": is_home,
            "name": info.get("name") or names.get(pid), "position": info.get("position"),
            "toi_sec": toi, "shots": len(mine),
            "goals": sum(1 for s in mine if s.get("result") == "goal"),
            "xg": xg, "xg_per_60": (xg * 3600.0 / toi) if (xg is not None and toi) else None,
            "gsax": None,
        })
    for pid in sorted(goalies):
        info = people.get(pid) or {}
        faced = by_goalie.get(pid) or []
        known = [s["xg"] for s in faced if s.get("xg") is not None]
        goals = sum(1 for s in faced if s.get("result") == "goal")
        if known:
            xg = float(sum(known))
            gsax = xg - goals
        elif faced:
            xg, gsax = None, None
        else:
            xg, gsax = 0.0, 0.0
        team = info.get("team_nhl_id")
        is_home = info.get("is_home")
        if team is None and faced:
            team = faced[0].get("opp_nhl_id")
            is_home = 0 if faced[0].get("is_home") else 1
        rows.append({
            "nhl_game_id": nhl_game_id, "player_id": pid, "role": "goalie",
            "team_nhl_id": team, "is_home": is_home,
            "name": info.get("name") or names.get(pid), "position": info.get("position") or "G",
            "toi_sec": info.get("toi_sec"), "shots": len(faced), "goals": goals,
            "xg": xg, "xg_per_60": None, "gsax": gsax,
        })
    return rows


def _stored_hash(conn, nhl_game_id):
    row = conn.execute("SELECT content_hash FROM nhl_games WHERE nhl_game_id = ?",
                       (int(nhl_game_id),)).fetchone()
    return row[0] if row else None


def _link(conn, nhl_game_id, espn_event_id):
    if not espn_event_id:
        return
    with Tx(conn):
        conn.execute("UPDATE nhl_games SET espn_event_id = ? WHERE nhl_game_id = ? "
                     "AND espn_event_id IS NULL", (int(espn_event_id), int(nhl_game_id)))


def _put_meta(conn, nhl_game_id, digest, at):
    conn.execute("INSERT OR REPLACE INTO src_meta (key, value, updated_at) VALUES (?,?,?)",
                 (f"nhl_pbp:{int(nhl_game_id)}", digest, at))


def _insert_rows(conn, table, cols, rows):
    if not rows:
        return
    sql = (f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})")
    conn.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])


def store_game(conn, pbp_body: bytes, box_body: bytes = None, at=None,
               espn_event_id=None, model=None) -> int:
    """Replace one game's shots and player rows. The same body is a no-op
    and returns 0. Returns the shot count when the game is written."""
    payload = json.loads(pbp_body)
    header, shots = parse_game(payload)
    digest = _digest(bytes(pbp_body))
    gid = header["nhl_game_id"]
    if _stored_hash(conn, gid) == digest:
        _link(conn, gid, espn_event_id)
        return 0
    box = json.loads(box_body) if box_body else None
    people = parse_box(box, header["home_nhl_id"], header["away_nhl_id"]) if box else {}
    names = roster_names(payload)
    for pid, name in names.items():
        if pid in people and name:
            people[pid]["name"] = name
    if model:
        score_shots(shots, model)
    players = build_player_rows(gid, shots, people, names)
    at = at or _now()
    game = {**header, "espn_event_id": int(espn_event_id) if espn_event_id else None,
            "content_hash": digest, "fetched_at": at, "n_shots": len(shots)}
    with Tx(conn):
        conn.execute("DELETE FROM nhl_shots WHERE nhl_game_id = ?", (gid,))
        conn.execute("DELETE FROM nhl_player_xg WHERE nhl_game_id = ?", (gid,))
        conn.execute("DELETE FROM nhl_games WHERE nhl_game_id = ?", (gid,))
        _insert_rows(conn, "nhl_games", GAME_COLS, [game])
        _insert_rows(conn, "nhl_shots", SHOT_COLS, shots)
        _insert_rows(conn, "nhl_player_xg", PLAYER_COLS, players)
        _put_meta(conn, gid, digest, at)
    return len(shots)


def load_model(conn):
    try:
        row = conn.execute("SELECT features, coef, n_shots, intercept FROM nhl_xg_model "
                           "ORDER BY model_id DESC LIMIT 1").fetchone()
    except Exception:
        return None
    if not row:
        return None
    features = json.loads(row[0])
    coef = [float(c) for c in json.loads(row[1])]
    if list(features) != list(FEATURES) or len(coef) != len(FEATURES):
        return None
    return {"coef": coef, "n_shots": row[2], "intercept": row[3]}


def refit(conn, at=None, log=print) -> dict:
    """Fit on every stored scoreable shot, replace nhl_xg_model, and rescore."""
    shots = [dict(r) for r in conn.execute("SELECT * FROM nhl_shots")]
    coef = fit_shots(shots)
    usable = [s for s in shots if scoreable(s)]
    if coef is None:
        log(f"nhl xg fit skipped ({len(usable)} scoreable shots)")
        return {"skipped": "not enough shots", "n_shots": len(usable)}
    coef = [float(c) for c in coef]
    n_goals = sum(1 for s in usable if s["result"] == "goal")
    at = at or _now()
    model = {"coef": coef}
    score_shots(shots, model)
    by_game = defaultdict(list)
    for shot in shots:
        by_game[shot["nhl_game_id"]].append(shot)
    info, names = defaultdict(dict), defaultdict(dict)
    skaters, goalies = defaultdict(set), defaultdict(set)
    for row in conn.execute("SELECT * FROM nhl_player_xg"):
        gid, pid = row["nhl_game_id"], row["player_id"]
        prev = info[gid].get(pid)
        if prev is None or (prev.get("toi_sec") is None and row["toi_sec"] is not None):
            info[gid][pid] = {"role": row["role"], "team_nhl_id": row["team_nhl_id"],
                              "is_home": row["is_home"], "name": row["name"],
                              "position": row["position"], "toi_sec": row["toi_sec"]}
        if row["name"]:
            names[gid][pid] = row["name"]
        (goalies if row["role"] == "goalie" else skaters)[gid].add(pid)
    players = []
    for gid, game_shots in by_game.items():
        players.extend(build_player_rows(gid, game_shots, info.get(gid) or {}, names.get(gid) or {},
                                          skaters.get(gid), goalies.get(gid)))
    with Tx(conn):
        conn.execute("DELETE FROM nhl_xg_model")
        _insert_rows(conn, "nhl_xg_model", MODEL_COLS, [{
            "model_id": None, "fit_at": at, "n_shots": len(usable), "n_goals": n_goals,
            "features": json.dumps(list(FEATURES)), "coef": json.dumps(coef),
            "intercept": coef[0], "notes": FIT_NOTES,
        }])
        conn.executemany("UPDATE nhl_shots SET xg = ? WHERE nhl_game_id = ? AND event_id = ?",
                         [(s["xg"], s["nhl_game_id"], s["event_id"]) for s in shots])
        conn.execute("DELETE FROM nhl_player_xg")
        _insert_rows(conn, "nhl_player_xg", PLAYER_COLS, players)
    log(f"nhl xg fit {len(usable)} shots {n_goals} goals")
    return {"n_shots": len(usable), "n_goals": n_goals, "intercept": coef[0]}


def finished_games(payload) -> list:
    """Finished regular-season and playoff games on a schedule payload."""
    out = []
    for day in payload.get("gameWeek") or []:
        for game in day.get("games") or []:
            state = (game.get("gameState") or "").upper()
            sched = (game.get("gameScheduleState") or "OK").upper()
            if state not in FINISHED_STATES or sched != "OK":
                continue
            if game.get("gameType") not in (2, 3) or game.get("id") is None:
                continue
            home, away = game.get("homeTeam") or {}, game.get("awayTeam") or {}
            if not home.get("abbrev") or not away.get("abbrev"):
                continue
            season = game.get("season")
            out.append({
                "nhl_game_id": int(game["id"]),
                "season": int(str(season)[:4]) if season else int(str(game["id"])[:4]),
                "game_type": int(game["gameType"]),
                "game_date": game.get("gameDate") or day.get("date"),
                "home_abbrev": home.get("abbrev"),
                "away_abbrev": away.get("abbrev"),
            })
    return out


def match_game(games, home_abbr, away_abbr, game_date):
    """NHL game id for this ESPN home/away pair. Exact date wins. A single
    game within one day is used when the Central date and the NHL date differ.
    Two candidates is no match."""
    want = (canon("nhl", home_abbr), canon("nhl", away_abbr))

    def pair(game):
        return (canon("nhl", game["home_abbrev"]), canon("nhl", game["away_abbrev"]))

    exact = [g for g in games if pair(g) == want and g.get("game_date") == game_date]
    if len(exact) == 1:
        return exact[0]["nhl_game_id"]
    if len(exact) > 1:
        return None
    try:
        want_date = date.fromisoformat(game_date)
    except (TypeError, ValueError):
        return None
    near = []
    for game in games:
        if pair(game) != want or not game.get("game_date"):
            continue
        try:
            dist = abs((date.fromisoformat(game["game_date"]) - want_date).days)
        except ValueError:
            continue
        if dist <= 1:
            near.append(game)
    if len(near) == 1:
        return near[0]["nhl_game_id"]
    return None


def _require_robots(conn, pace, fetch):
    if not robots_allowed(conn, API + "/v1/gamecenter/", pace, fetch):
        raise RuntimeError("robots.txt disallows the NHL API")


def _fetch_store(conn, pace, fetch, nhl_game_id, espn_event_id, model, log):
    body = pace(fetch, PBP_URL.format(game_id=nhl_game_id))
    box = None
    try:
        box = pace(fetch, BOX_URL.format(game_id=nhl_game_id))
    except Missing:
        log(f"nhl box {nhl_game_id} missing")
    except Exception as e:
        log(f"nhl box {nhl_game_id} {type(e).__name__}: {e}")
    n = store_game(conn, body, box, espn_event_id=espn_event_id, model=model)
    log(f"nhl pbp {nhl_game_id} {n} shots")
    return n


def pending_games(conn, today, days=RECENT_DAYS):
    """Completed NHL games in the window whose ESPN id is not stored yet."""
    start = (today - timedelta(days=days - 1)).isoformat()
    end = today.isoformat()
    return [dict(r) for r in conn.execute(
        "SELECT g.espn_event_id, g.game_date, th.abbreviation AS home_abbr, "
        "ta.abbreviation AS away_abbr FROM games g "
        "JOIN teams th ON th.team_id = g.home_team_id "
        "JOIN teams ta ON ta.team_id = g.away_team_id "
        "WHERE g.league = 'nhl' AND g.completed = 1 AND g.season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND g.game_date >= ? AND g.game_date <= ? "
        "AND NOT EXISTS (SELECT 1 FROM nhl_games n WHERE n.espn_event_id = g.espn_event_id)",
        (start, end))]


def _schedule_games(pace, fetch, day, cache):
    if day in cache:
        return cache[day]
    payload = json.loads(pace(fetch, SCHED_URL.format(day=day)))
    games = finished_games(payload)
    by_date = defaultdict(list)
    for game in games:
        by_date[game["game_date"]].append(game)
    for d, rows in by_date.items():
        cache.setdefault(d, [])
        have = {g["nhl_game_id"] for g in cache[d]}
        cache[d].extend(g for g in rows if g["nhl_game_id"] not in have)
    cache.setdefault(day, by_date.get(day, []))
    return games


def current_pass(conn, pace, now=None, log=print, fetch=None) -> dict:
    """Finished games from the last 3 days that are not stored yet.

    No such game returns skipped and makes no request. A game already stored
    under its NHL id is linked to the ESPN id and not downloaded again.
    """
    fetch = fetch or http_get
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(espn.CENTRAL).date()
    pending = pending_games(conn, today)
    if not pending:
        return {"skipped": "no new finished games"}
    _require_robots(conn, pace, fetch)
    model = load_model(conn)
    errors = stored = rows = linked = 0
    cache = {}
    seen_dates, bad_dates = set(), set()
    for game in pending:
        gdate = game["game_date"]
        if gdate in bad_dates:
            continue
        if gdate not in seen_dates:
            try:
                _schedule_games(pace, fetch, gdate, cache)
            except Exception as e:
                errors += sum(1 for g in pending if g["game_date"] == gdate)
                log(f"nhl schedule {gdate} FAILED {type(e).__name__}: {e}")
                bad_dates.add(gdate)
                seen_dates.add(gdate)
                continue
            seen_dates.add(gdate)
        pool = [g for rows in cache.values() for g in rows]
        nhl_id = match_game(pool, game["home_abbr"], game["away_abbr"], gdate)
        if nhl_id is None:
            errors += 1
            with Tx(conn):
                unmatched(conn, SOURCE, "nhl", "game", game["espn_event_id"],
                          name=f"{game['away_abbr']} at {game['home_abbr']}", context=gdate)
            log(f"nhl pbp unmatched espn {game['espn_event_id']}")
            continue
        if _stored_hash(conn, nhl_id) is not None:
            _link(conn, nhl_id, game["espn_event_id"])
            with Tx(conn):
                resolved(conn, SOURCE, "nhl", "game", game["espn_event_id"])
            linked += 1
            continue
        try:
            n = _fetch_store(conn, pace, fetch, nhl_id, game["espn_event_id"], model, log)
            stored += 1
            rows += n
            with Tx(conn):
                resolved(conn, SOURCE, "nhl", "game", game["espn_event_id"])
        except Exception as e:
            errors += 1
            log(f"nhl pbp {nhl_id} FAILED {type(e).__name__}: {e}")
    return {"rows": rows, "games": stored, "linked": linked, "errors": errors}


def backfill(conn, pace, season_from, season_to, fetch=None, log=print, fit=True) -> dict:
    """Pull every finished regular-season and playoff game in the season
    range into this connection. Seasons are NHL start years. A game already
    stored is not downloaded again. The fit runs once at the end."""
    fetch = fetch or http_get
    season_from, season_to = int(season_from), int(season_to)
    _require_robots(conn, pace, fetch)
    errors = games = rows = 0
    for season in range(season_from, season_to + 1):
        log(f"nhl pbp season {season}")
        day = date(season, 9, 1)
        end = date(season + 1, 7, 15)
        guard = 0
        while day <= end and guard < 500:
            guard += 1
            try:
                payload = json.loads(pace(fetch, SCHED_URL.format(day=day.isoformat())))
            except Exception as e:
                errors += 1
                log(f"nhl schedule {day} FAILED {type(e).__name__}: {e}")
                day = day + timedelta(days=7)
                continue
            for game in finished_games(payload):
                if not (season_from <= game["season"] <= season_to):
                    continue
                if _stored_hash(conn, game["nhl_game_id"]) is not None:
                    continue
                try:
                    rows += _fetch_store(conn, pace, fetch, game["nhl_game_id"], None, None, log)
                    games += 1
                except Exception as e:
                    errors += 1
                    log(f"nhl pbp {game['nhl_game_id']} FAILED {type(e).__name__}: {e}")
            nxt = payload.get("nextStartDate")
            if not nxt:
                break
            try:
                nxt_day = date.fromisoformat(str(nxt)[:10])
            except ValueError:
                nxt_day = day + timedelta(days=7)
            day = nxt_day if nxt_day > day else day + timedelta(days=7)
    model = refit(conn, log=log) if fit else {"skipped": "fit disabled"}
    return {"games": games, "rows": rows, "errors": errors, "model": model}


def link_all(conn) -> int:
    """Fill espn_event_id from games, by abbreviation and date. A team pair
    with two ESPN games on that date is left unset."""
    index, ambiguous = {}, set()
    for eid, gdate, home, away in conn.execute(
            "SELECT g.espn_event_id, g.game_date, th.abbreviation, ta.abbreviation "
            "FROM games g JOIN teams th ON th.team_id = g.home_team_id "
            "JOIN teams ta ON ta.team_id = g.away_team_id WHERE g.league = 'nhl'"):
        key = (canon("nhl", home), canon("nhl", away), gdate)
        if key in index:
            ambiguous.add(key)
        else:
            index[key] = eid
    for key in ambiguous:
        index.pop(key, None)
    updates = []
    for gid, gdate, home, away in conn.execute(
            "SELECT nhl_game_id, game_date, home_abbrev, away_abbrev FROM nhl_games "
            "WHERE espn_event_id IS NULL"):
        eid = index.get((canon("nhl", home), canon("nhl", away), gdate))
        if eid:
            updates.append((eid, gid))
    if updates:
        with Tx(conn):
            conn.executemany("UPDATE nhl_games SET espn_event_id = ? WHERE nhl_game_id = ? "
                             "AND espn_event_id IS NULL", updates)
    return len(updates)


def load_into(conn, src_path) -> dict:
    """ATTACH a shipped shots database and copy it into conn.

    Games, shots and player rows replace the same keys. The model is
    replaced only when the shipped file has one. src_meta digests for
    nhl_pbp are copied so a later store of the same body is a no-op.
    """
    from pathlib import Path
    path = Path(src_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))
    if "'" in str(path):
        raise ValueError("the shipped file path cannot contain a quote")
    db.init_db(conn)
    conn.commit()
    conn.execute(f"ATTACH DATABASE '{path}' AS nhl_src")
    try:
        counts = {}
        with Tx(conn):
            for table, cols in (("nhl_games", GAME_COLS), ("nhl_shots", SHOT_COLS),
                                ("nhl_player_xg", PLAYER_COLS)):
                conn.execute(f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) "
                             f"SELECT {', '.join(cols)} FROM nhl_src.{table}")
                counts[table] = conn.execute("SELECT changes()").fetchone()[0]
            n_model = conn.execute("SELECT COUNT(*) FROM nhl_src.nhl_xg_model").fetchone()[0]
            if n_model:
                conn.execute("DELETE FROM nhl_xg_model")
                conn.execute(f"INSERT INTO nhl_xg_model ({', '.join(MODEL_COLS)}) "
                             f"SELECT {', '.join(MODEL_COLS)} FROM nhl_src.nhl_xg_model")
                counts["nhl_xg_model"] = n_model
            conn.execute("INSERT OR REPLACE INTO src_meta (key, value, updated_at) "
                         "SELECT key, value, updated_at FROM nhl_src.src_meta "
                         "WHERE key LIKE 'nhl_pbp:%'")
        counts["linked"] = link_all(conn)
        return counts
    finally:
        conn.execute("DETACH DATABASE nhl_src")


def shot_freshness(conn, now):
    """(level, message) for yesterday's finished NHL games, or None when
    there were none. None means the check adds no line."""
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'games'").fetchone() is None:
        return None
    yesterday = (now.astimezone(espn.CENTRAL).date() - timedelta(days=1)).isoformat()
    rows = conn.execute(
        "SELECT espn_event_id FROM games g WHERE league = 'nhl' AND completed = 1 "
        "AND season_type IN (2, 3) "
        f"AND {db.playable_sql('g')} AND game_date = ?", (yesterday,)).fetchall()
    if not rows:
        return None
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nhl_games'").fetchone() is None:
        return ("FAIL", f"0/{len(rows)} finished NHL games have shots")
    ids = [r[0] for r in rows]
    have = conn.execute(
        f"SELECT COUNT(*) FROM nhl_games WHERE espn_event_id IN ({','.join('?' * len(ids))})",
        ids).fetchone()[0]
    if have == len(rows):
        return ("OK", f"{have} finished NHL games stored")
    return ("FAIL", f"{have}/{len(rows)} finished NHL games have shots")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="NHL shot locations and the xG fit")
    ap.add_argument("--db", required=True)
    ap.add_argument("--backfill", action="store_true")
    ap.add_argument("--from-season", type=int)
    ap.add_argument("--to-season", type=int)
    ap.add_argument("--rate", type=float, default=1.0)
    ap.add_argument("--load", help="ATTACH this SQLite file and copy it into --db")
    ap.add_argument("--refit", action="store_true")
    ap.add_argument("--no-fit", action="store_true")
    a = ap.parse_args(argv)
    from ..backfill import Pacer
    conn = db.connect(a.db)
    conn.isolation_level = None
    db.init_db(conn)
    if a.load:
        print(json.dumps(load_into(conn, a.load)))
        return 0
    if a.refit:
        st = refit(conn)
        print(json.dumps(st))
        return 0
    if a.backfill:
        if a.from_season is None or a.to_season is None:
            ap.error("--backfill needs --from-season and --to-season")
        st = backfill(conn, Pacer(a.rate), a.from_season, a.to_season, fit=not a.no_fit)
        # A fresh shots file has no games rows. Checkpoint it and leave a
        # single file to copy. A database that already holds games (the
        # production file) keeps WAL.
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        n_games = conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
        if not n_games:
            conn.execute("PRAGMA journal_mode = DELETE")
        print(json.dumps(st, default=str))
        return 1 if st.get("errors") else 0
    st = current_pass(conn, Pacer(a.rate))
    print(json.dumps(st, default=str))
    return 1 if st.get("errors") else 0


if __name__ == "__main__":
    raise SystemExit(main())
