"""Player-level adjustment: who is actually playing vs the team's usual players.

Applied in the daily run after the team model and the starter adjustment
(starters.py) and before the Elo stack (bayes_elo.py). The team rating already
reflects a team's usual players; this adds what today's players are worth
relative to that usual level. Every value is a team QUALITY number relative
to the team's own recent average, positive = stronger than usual:

  NBA  x = -(missing value - team's decayed average missing value).
       Missing value: sum over the team's rotation players listed Out or
       Doubtful (not Questionable) on the latest official NBA injury report
       known at forecast time, of max(rate - replacement, 0) * expected
       minutes. Rate: Game Score per minute (decayed, shrunk to replacement).
       The team average is over earlier games' report-based missing value
       (report 30 minutes before the start). No report covering the game:
       no adjustment.
  NHL  Same form for skaters (rate: 0.5 goals + 0.5 shots * league shooting
       %, per 60; forwards and defense separately). Out = rotation players
       not in the team's latest Daily Faceoff lines (f1-f4, d1-d4), else
       players listed Out / Injured Reserve / Suspension on the ESPN roster.
       Players no longer on the team's current roster are not counted. The
       team average is over earlier games' who-played missing value. On top
       of the goalie adjustment (starters.py).
  NFL  x = starting QB value - team's decayed average starter value. QB
       value: shrunk ANY/A per dropback minus league, times 34 dropbacks.
       Starter: the highest QB on the current depth chart who is not Out or
       Doubtful on this week's injury report, Out/IR/suspended on the roster,
       or on the game's inactive list; else last game's starter.
  MLB  x1 = lineup value - team's decayed average lineup value (sum over the
       nine starters of shrunk linear-weights runs per PA minus league, times
       the slot's expected PA). Lineup: the posted lineup (MLB Stats API, else
       ESPN), else the team's most recent lineup. x2 = bullpen value (usage-
       weighted shrunk relief runs per out vs league, times 9.5 outs),
       team-relative the same way. On top of the starting pitcher.

Only box lines from dates before the forecast day are used.

  win:    the published chance shifts by
          logit += sum_k WIN_k * (x_home_k - x_away_k).
          NBA, NHL and MLB solve that shift through p_logit. NFL adds it
          to the blended chance and leaves p_logit at the team chance.
  total:  total  += TOTAL_k  * (x_home_k + x_away_k)
  margin: margin += MARGIN_k * (x_home_k - x_away_k); team totals follow.

WIN/TOTAL/MARGIN are the stored walk-forward coefficients (NBA, NFL, and
MLB fit through 2025, NHL through 2025-26). They were fit on the published
(Elo-stacked) win chance. For NBA,
NHL and MLB the term goes into the logit chance before the stack, so
p_logit is solved for the backtested shift in the published chance:
  p_logit' = (sigmoid(logit(p_pub) + WIN * xd) - w * p_elo) / (1 - w),
w = the row's Elo weight (exact unless p_logit hits 0.0001 / 0.9999; on an
Elo fallback, w = 0, it is the plain logit shift). NFL adds the same shift
to the blended chance and leaves p_logit at the pre-player team chance, so
the solve cannot pin it at 0 or 1. A side with no player information gets
x = 0 (no adjustment).

refresh() re-applies the term to today's not-yet-started game-day forecasts
and to the early forecasts of later games (upcoming_forecasts) when new injury
reports, lines, depth charts or lineups arrive (prelog `pregame` and `nbainj`
jobs), from the stored pre-player values. The margin then follows the
stacked win chance again (forecast.carry_margin). NBA rows are handed to
nba_player.refresh: the injury term still runs here as the current path,
and the ridge replaces the published chance when that row is ridge_b or
ridge_c. NHL rows are handed to nhl_player.refresh the same way: this
term still runs as the current path, and the player ridge replaces the
published chance when that row is ridge_b or ridge_c. NFL rows are handed
to nfl_player.refresh: this term still runs as the current path, and the
quarterback ridge replaces the published chance when both starters are
confirmed. MLB rows are handed to mlb_player.refresh: this term still
runs as the current path, and the player stack replaces the published
chance when both lineups are posted and both starters are known.
"""

import math
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

LEAGUES = ("nba", "nfl", "nhl", "mlb")
DAY0 = pd.Timestamp("2000-01-01")
CHICAGO = ZoneInfo("America/Chicago")

# tuned settings from the walk-forward fit
PARAMS = {
    "nba": {"hl": 180.0, "k": 1000.0, "repl": 0.8, "min_u": 10.0, "hl_u": 30.0,
            "team_hl": 120.0, "lead_min": 30, "years": 3},
    "nhl": {"hl": 365.0, "k": 200.0, "repl": 0.5, "min_u": 8.0, "hl_u": 30.0,
            "team_hl": 180.0, "years": 4},
    "nfl": {"hl": 365.0, "k": 600.0, "pen": 2.0, "team_hl": 180.0, "exp_db": 34.0,
            "years": 8},
    "mlb": {"hl": 1460.0, "k": 500.0, "pen": 0.95, "team_hl": 180.0,
            "hl_b": 365.0, "k_b": 150.0, "recent_hl": 14.0, "pen_outs": 9.5,
            "years": 8},
}
# walk-forward coefficients, latest fit, one per feature (MLB: lineup, bullpen)
COEFS = {
    "nba": {"win": (0.071020,), "total": (0.154115,), "margin": (0.555800,)},
    "nhl": {"win": (0.010739,), "total": (0.005846,), "margin": (0.016001,)},
    "nfl": {"win": (0.021160,), "total": (0.059160,), "margin": (0.113250,)},
    "mlb": {"win": (0.255074, 0.199575), "total": (0.506161, 0.931034),
            "margin": (0.601723, 0.600174)},
}
NBA_OUT = ("Out", "Doubtful")
NHL_LINE_GROUPS = ("f1", "f2", "f3", "f4", "d1", "d2", "d3", "d4")
NHL_ROSTER_OUT = ("Out", "Injured Reserve", "Suspension")
NFL_REPORT_OUT = ("Out", "Doubtful")
NFL_ROSTER_OUT = ("Out", "Doubtful", "Injured Reserve", "Suspension")
SLOT_PA = {1: 4.65, 2: 4.55, 3: 4.45, 4: 4.35, 5: 4.25, 6: 4.15, 7: 4.05, 8: 3.95, 9: 3.85}
STATE_AT = "valid_from <= :as_of AND (valid_to IS NULL OR valid_to > :as_of)"
LOCK_MARGIN = timedelta(minutes=5)      # refresh stops this long before the start

AUDIT_COLS = ("home_player_x", "away_player_x", "home_player_x2", "away_player_x2",
              "home_player_id", "away_player_id", "home_player_src", "away_player_src",
              "player_prob_base", "player_spread_base", "player_total_base",
              "player_home_total_base", "player_away_total_base", "player_inputs")
DB_COLUMNS = {c: ("INTEGER" if c.endswith("_id") else
                  "TEXT" if c.endswith("_src") or c == "player_inputs" else "REAL")
              for c in AUDIT_COLS}


# ------------------------------------------------------------------ helpers

class Dec:
    """Exponentially decayed running sums keyed by anything."""
    def __init__(self, hl, n=1):
        self.lam = math.log(2) / hl
        self.n = n
        self.s = {}

    def get(self, key, day):
        v = self.s.get(key)
        if v is None:
            return np.zeros(self.n)
        return v[0] * math.exp(-self.lam * (day - v[1]))

    def add(self, key, day, vals):
        self.s[key] = (self.get(key, day) + np.asarray(vals, float), day)


def day_of(dates):
    return (pd.to_datetime(pd.Series(dates).astype(str).str[:10]) - DAY0).dt.days.to_numpy()


def _day(d) -> int:
    return int((pd.Timestamp(str(d)[:10]) - DAY0).days)


def _q(conn, sql, params=None):
    try:
        return pd.read_sql_query(sql, conn, params=params or {})
    except (sqlite3.OperationalError, pd.errors.DatabaseError):
        return None                     # logging table missing on an old DB


def _since(today, years):
    return (pd.Timestamp(str(today)[:10]) - pd.DateOffset(years=years)).date().isoformat()


class TeamAvg:
    """Team's decayed average of a value over EARLIER days."""
    def __init__(self, hl):
        self.d = Dec(hl, 2)

    def add(self, team, day, v):
        if v is not None and np.isfinite(v):
            self.d.add(team, day, [v, 1.0])

    def avg(self, team, day):
        s, w = self.d.get(team, day)
        return s / w if w > 1e-9 else 0.0


def _history_games(conn, league, since, today):
    g = pd.read_sql_query(
        "SELECT espn_event_id, game_date, start_time_utc, home_team_id, away_team_id FROM games "
        "WHERE league = ? AND season_type IN (2, 3) AND completed = 1 "
        "AND game_date >= ? AND game_date < ? ORDER BY game_date, start_time_utc, espn_event_id",
        conn, params=(league, since, today))
    g["day"] = day_of(g["game_date"]) if len(g) else []
    return g


# ------------------------------------------------- NBA / NHL missing value

class Rotation:
    """Running per-player state; rotation and player values as of a day."""
    def __init__(self, p):
        self.p = p
        self.pl, self.lg = Dec(p["hl"], 2), Dec(p["hl"], 2)
        self.au = Dec(p.get("hl_u", 30.0), 2)
        self.grp, self.last_team, self.last_idx = {}, {}, {}
        self.roster = defaultdict(set)
        self.tidx = defaultdict(int)

    def values(self, team, day):
        """{athlete: value} for the team's rotation as of `day`."""
        p, out = self.p, {}
        for aid in self.roster[team]:
            if self.tidx[team] - self.last_idx[aid] > 10:
                continue
            su, sn = self.au.get((aid, team), day)
            if sn <= 1e-9 or su / sn < p["min_u"]:
                continue
            lP, lU = self.lg.get(self.grp[aid], day)
            if lU <= 0:
                continue
            repl = p["repl"] * lP / lU
            P, U = self.pl.get(aid, day)
            rate = (P + p["k"] * repl) / (U + p["k"])
            out[aid] = max(rate - repl, 0.0) * su / sn
        return out

    def add_day(self, day, teams, lines):
        for t in teams:
            self.tidx[t] += 1
        if lines is None:
            return
        for aid, team, gp, ply, U, P in zip(lines["athlete_id"], lines["team_id"], lines["grp"],
                                            lines["played"], lines["U"], lines["P"]):
            if not ply or not (U > 0):
                continue
            self.grp[aid] = gp
            self.pl.add(aid, day, [P, U])
            self.lg.add(gp, day, [P, U])
            self.au.add((aid, team), day, [U, 1.0])
            if self.last_team.get(aid) not in (None, team):
                self.roster[self.last_team[aid]].discard(aid)
            self.last_team[aid] = team
            self.roster[team].add(aid)
            self.last_idx[aid] = self.tidx[team]


def nba_lines(conn, since, today):
    b = pd.read_sql_query(
        "SELECT espn_event_id, game_date, team_id, athlete_id, did_not_play, minutes, pts, fgm, fga, "
        "ftm, fta, oreb, dreb, ast, tov, stl, blk, pf FROM player_game_nba "
        "WHERE season_type IN (2, 3) AND game_date >= ? AND game_date < ?",
        conn, params=(since, today))
    z = b.fillna(0)
    b["played"] = ((z.did_not_play == 0) & (z.minutes > 0)).astype(int)
    b["P"] = (z.pts + 0.4 * z.fgm - 0.7 * z.fga - 0.4 * (z.fta - z.ftm) + 0.7 * z.oreb
              + 0.3 * z.dreb + z.stl + 0.7 * z.ast + 0.7 * z.blk - 0.4 * z.pf - z.tov)
    b["U"] = z.minutes
    b["grp"] = "all"
    return b


def nhl_lines(conn, since, today):
    b = pd.read_sql_query(
        "SELECT espn_event_id, game_date, team_id, athlete_id, position, toi_sec, g, shots "
        "FROM player_game_nhl_skater WHERE season_type IN (2, 3) AND game_date >= ? AND game_date < ?",
        conn, params=(since, today))
    z = b.fillna(0)
    b["U"] = z.toi_sec / 60.0
    b["played"] = (b["U"] > 0).astype(int)
    sh = z.g.sum() / max(z.shots.sum(), 1)
    b["P"] = (0.5 * z.g + 0.5 * z.shots * sh) * 60.0
    b["grp"] = np.where(b["position"] == "D", "D", "F")
    return b


def nba_report_outs(conn, event_ids, as_of_by_event):
    """{(event, team): athletes Out/Doubtful} on the report state at each
    event's as-of time; events no report state covers are left out."""
    if not len(event_ids):
        return {}
    ids = ",".join(str(int(e)) for e in event_ids)
    inj = _q(conn, "SELECT espn_event_id, team_id, athlete_id, status, valid_from, valid_to "
                   f"FROM nba_injury_states WHERE espn_event_id IN ({ids})")
    if inj is None or not len(inj):
        return {}
    inj = inj.dropna(subset=["espn_event_id", "team_id"])
    inj["t"] = inj["espn_event_id"].astype(int).map(as_of_by_event)
    cur = inj[(inj.valid_from <= inj.t) & (inj.valid_to.isna() | (inj.valid_to > inj.t))]
    out = {}
    for e in set(cur["espn_event_id"].astype(int)):
        out[e] = defaultdict(set)
    sel = cur[cur.status.isin(NBA_OUT) & cur.athlete_id.notna()]
    for e, tm, a in zip(sel.espn_event_id.astype(int), sel.team_id.astype(int), sel.athlete_id.astype(int)):
        out[e][tm].add(a)
    return out


def _iso(ts):
    return ts.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def missing_state(conn, league, today):
    """Replay box lines before `today`: (Rotation at today, TeamAvg at today)."""
    p = PARAMS[league]
    since = _since(today, p["years"])
    g = _history_games(conn, league, since, today)
    lines = (nba_lines if league == "nba" else nhl_lines)(conn, since, today)
    lines["day"] = day_of(lines["game_date"]) if len(lines) else []
    by_day = {d: x for d, x in lines.groupby("day")}
    played = {k: set(x.athlete_id[x.played == 1])
              for k, x in lines.groupby(["espn_event_id", "team_id"])}
    reports = None
    if league == "nba":
        st = pd.to_datetime(g["start_time_utc"], utc=True) - pd.Timedelta(minutes=p["lead_min"])
        reports = nba_report_outs(conn, g["espn_event_id"].tolist(),
                                  dict(zip(g["espn_event_id"].astype(int), st.map(_iso))))
    rot, avg = Rotation(p), TeamAvg(p["team_hl"])
    for d, gd in g.groupby("day", sort=True):
        vals = []
        for e, h, a in zip(gd.espn_event_id.astype(int), gd.home_team_id, gd.away_team_id):
            for team in (h, a):
                v = rot.values(team, d)
                if league == "nba":
                    rep = reports.get(e)
                    m = None if rep is None else sum(v.get(x, 0.0) for x in rep.get(team, ()))
                else:
                    pl = played.get((e, team))
                    m = None if pl is None else sum(val for x, val in v.items() if x not in pl)
                vals.append((team, m))
        for team, m in vals:
            avg.add(team, d, m)
        rot.add_day(d, list(gd.home_team_id) + list(gd.away_team_id), by_day.get(d))
    return rot, avg


def _current_roster(conn, league, as_of):
    r = _q(conn, f"SELECT team_id, athlete_id, injury_status FROM roster_states "
                 f"WHERE league = :lg AND {STATE_AT}", {"lg": league, "as_of": as_of})
    return r if r is not None else pd.DataFrame(columns=["team_id", "athlete_id", "injury_status"])


def nhl_outs(conn, teams, as_of):
    """{team: (out athletes, src, current roster or None)} for NHL teams."""
    lines = _q(conn, f"SELECT team_id, athlete_id, group_id, last_seen FROM nhl_line_states "
                     f"WHERE {STATE_AT}", {"as_of": as_of})
    roster = _current_roster(conn, "nhl", as_of)
    fresh = _iso(pd.Timestamp(as_of) - pd.Timedelta(days=3))
    out = {}
    for t in teams:
        ros = roster[roster.team_id == t]
        members = set(ros.athlete_id.dropna().astype(int)) or None
        if lines is not None:
            lt = lines[(lines.team_id == t) & lines.group_id.isin(NHL_LINE_GROUPS)]
            dressed = set(lt.athlete_id.dropna().astype(int))
            if len(dressed) >= 15 and str(lt.last_seen.max()) >= fresh:
                out[t] = ("lines", dressed, members)
                continue
        if members:
            inj = set(ros.athlete_id[ros.injury_status.isin(NHL_ROSTER_OUT)].dropna().astype(int))
            out[t] = ("roster", inj, members)
    return out


def missing_x(conn, league, sched, as_of, state=None):
    """Per schedule row: (x_home, x_away, src_home, src_away)."""
    today = str(sched["date"].min())[:10]
    rot, avg = state or missing_state(conn, league, today)
    teams = set(sched.home_team.astype(int)) | set(sched.away_team.astype(int))
    if league == "nba":
        rep = nba_report_outs(conn, sched["espn_event_id"].tolist(),
                              {int(e): as_of for e in sched["espn_event_id"]})
    else:
        nh = nhl_outs(conn, teams, as_of)
    res = []
    for e, d, h, a in zip(sched.espn_event_id.astype(int), sched.date, sched.home_team.astype(int),
                          sched.away_team.astype(int)):
        day, row = _day(d), []
        for team in (h, a):
            v = rot.values(team, day)
            if league == "nba":
                r = rep.get(e)
                if r is None:
                    row.append((None, None)); continue
                m, src = sum(v.get(x, 0.0) for x in r.get(team, ())), "report"
            else:
                info = nh.get(team)
                if info is None or not v:
                    row.append((None, None)); continue
                src, ids, members = info
                if members:
                    v = {x: val for x, val in v.items() if x in members}
                m = (sum(val for x, val in v.items() if x not in ids) if src == "lines"
                     else sum(v.get(x, 0.0) for x in ids))
            row.append((-(m - avg.avg(team, day)), src))
        res.append((row[0][0], row[1][0], row[0][1], row[1][1]))
    return res


# ------------------------------------------------------------------ NFL QB

def nfl_state(conn, today):
    p = PARAMS["nfl"]
    b = pd.read_sql_query(
        "SELECT espn_event_id, game_date, team_id, athlete_id, qb_starter, att, yds, td, ints, "
        "sacks, sack_yds FROM player_game_nfl_passing WHERE season_type IN (2, 3) "
        "AND game_date >= ? AND game_date < ? ORDER BY game_date",
        conn, params=(_since(today, p["years"]), today)).fillna(0)
    b["day"] = day_of(b["game_date"]) if len(b) else []
    D = (b.att + b.sacks).to_numpy(float)
    P = (b.yds - b.sack_yds + 20 * b.td - 45 * b.ints).to_numpy(float)
    pl, lg, avg = Dec(p["hl"], 2), Dec(p["hl"], 2), TeamAvg(p["team_hl"])
    last = {}
    st = {"pl": pl, "lg": lg, "avg": avg, "last": last, "p": p}
    ix = b.groupby("day").indices
    for d in sorted(ix):
        idx = ix[d]
        x = b.iloc[idx]
        seen = set()
        for e, tm, aid, qs in zip(x.espn_event_id, x.team_id, x.athlete_id, x.qb_starter):
            if qs == 1 and (e, tm) not in seen:
                seen.add((e, tm))
                q = qb_value(st, aid, d)
                avg.add(tm, d, q)
                last[tm] = (int(aid), d)
        for i in idx:
            if D[i] > 0:
                pl.add(b.athlete_id.iat[i], d, [P[i], D[i]])
                lg.add("lg", d, [P[i], D[i]])
    return st


def qb_value(st, aid, day):
    p = st["p"]
    lP, lD = st["lg"].get("lg", day)
    if lD <= 0:
        return None
    lr = lP / lD
    P, D = st["pl"].get(aid, day)
    rate = (P + p["k"] * (lr - p["pen"])) / (D + p["k"])
    return (rate - lr) * p["exp_db"]


def nfl_pick(conn, event_id, team, start, as_of, last):
    """(athlete_id, src) of the expected starting QB, or (None, None)."""
    a = {"as_of": as_of, "t": int(team)}
    depth = _q(conn, f"SELECT athlete_id, MIN(depth) AS depth FROM nfl_depth_states WHERE team_id = :t "
                     f"AND slot = 'qb' AND athlete_id IS NOT NULL AND {STATE_AT} "
                     "GROUP BY athlete_id ORDER BY depth", a)
    excl = set()
    rep = _q(conn, f"SELECT athlete_id, season, week, report_status, valid_from FROM "
                   f"nfl_injury_report_states WHERE team_id = :t AND {STATE_AT}", a)
    if rep is not None and len(rep):
        top = rep.sort_values(["season", "week"]).iloc[-1]
        wk = rep[(rep.season == top.season) & (rep.week == top.week)]
        if str(wk.valid_from.max()) >= _iso(pd.Timestamp(start) - pd.Timedelta(days=6)):
            excl |= set(wk.athlete_id[wk.report_status.isin(NFL_REPORT_OUT)].dropna().astype(int))
    ros = _q(conn, f"SELECT athlete_id FROM roster_states WHERE league = 'nfl' AND team_id = :t "
                   f"AND injury_status IN ({','.join(repr(s) for s in NFL_ROSTER_OUT)}) AND {STATE_AT}", a)
    if ros is not None:
        excl |= set(ros.athlete_id.dropna().astype(int))
    ina = _q(conn, "SELECT athlete_id FROM nfl_inactives WHERE espn_event_id = :e AND team_id = :t "
                   "AND fetched_at = (SELECT MAX(fetched_at) FROM nfl_inactives WHERE espn_event_id = :e "
                   "AND team_id = :t AND fetched_at <= :as_of)", {**a, "e": int(event_id)})
    if ina is not None:
        excl |= set(ina.athlete_id.dropna().astype(int))
    if depth is not None:
        for aid in depth.athlete_id.astype(int):
            if aid not in excl:
                return aid, "depth"
    if team in last:
        return last[team][0], "last"
    return None, None


def nfl_x(conn, sched, as_of, state=None):
    today = str(sched["date"].min())[:10]
    st = state or nfl_state(conn, today)
    starts = _starts(conn, sched)
    res = []
    for e, d, h, a in zip(sched.espn_event_id.astype(int), sched.date, sched.home_team.astype(int),
                          sched.away_team.astype(int)):
        day, row = _day(d), []
        for team in (h, a):
            aid, src = nfl_pick(conn, e, team, starts.get(e, as_of), as_of, st["last"])
            q = qb_value(st, aid, day) if aid is not None else None
            row.append((None if q is None else q - st["avg"].avg(team, day), src, aid))
        res.append(row)
    return res


def _starts(conn, sched):
    ids = ",".join(str(int(e)) for e in sched["espn_event_id"]) or "NULL"
    g = pd.read_sql_query(f"SELECT espn_event_id, start_time_utc FROM games WHERE espn_event_id IN ({ids})", conn)
    return {int(e): _iso(pd.Timestamp(s).tz_convert("UTC") if pd.Timestamp(s).tzinfo else
                         pd.Timestamp(s).tz_localize("UTC"))
            for e, s in zip(g.espn_event_id, g.start_time_utc)}


# ------------------------------------------------------- MLB lineup + bullpen

def mlb_state(conn, today):
    p = PARAMS["mlb"]
    since = _since(today, p["years"])
    b = pd.read_sql_query(
        "SELECT espn_event_id, game_date, team_id, athlete_id, starter, bat_order, ab, h, hr, bb "
        "FROM player_game_mlb_batting WHERE season_type IN (2, 3) AND game_date >= ? AND game_date < ? "
        "ORDER BY game_date", conn, params=(since, today)).fillna(0)
    b["day"] = day_of(b["game_date"]) if len(b) else []
    PA = (b.ab + b.bb).to_numpy(float)
    P = (0.69 * b.bb + 0.95 * (b.h - b.hr) + 2.0 * b.hr).to_numpy(float)
    st = {"pl": Dec(p["hl"], 2), "lg": Dec(p["hl"], 2), "avg": TeamAvg(p["team_hl"]),
          "last": {}, "p": p}
    ix = b.groupby("day").indices
    for d in sorted(ix):
        idx = ix[d]
        x = b.iloc[idx]
        s = x[(x.starter == 1) & x.bat_order.between(1, 9)]
        for (e, tm), y in s.groupby(["espn_event_id", "team_id"]):
            lu = list(zip(y.athlete_id.astype(int), y.bat_order.astype(int)))
            st["avg"].add(tm, d, lineup_value(st, lu, d))
            st["last"][int(tm)] = (lu, d)
        for i in idx:
            if PA[i] > 0:
                st["pl"].add(b.athlete_id.iat[i], d, [P[i], PA[i]])
                st["lg"].add("lg", d, [P[i], PA[i]])
    # bullpen
    pt = pd.read_sql_query(
        "SELECT game_date, team_id, athlete_id, r, outs FROM player_game_mlb_pitching "
        "WHERE season_type IN (2, 3) AND pitch_order > 1 AND game_date >= ? AND game_date < ? "
        "ORDER BY game_date", conn, params=(since, today)).fillna(0)
    pt["day"] = day_of(pt["game_date"]) if len(pt) else []
    g = _history_games(conn, "mlb", since, today)
    bp = {"pl": Dec(p["hl_b"], 2), "lg": Dec(p["hl_b"], 2), "use": Dec(p["recent_hl"], 1),
          "pitchers": defaultdict(set), "avg": TeamAvg(p["team_hl"]), "p": p}
    by_day = {d: x for d, x in pt.groupby("day")}
    for d, gd in g.groupby("day", sort=True):
        vals = [(tm, bullpen_value(bp, tm, d)) for tm in list(gd.home_team_id) + list(gd.away_team_id)]
        for tm, v in vals:
            bp["avg"].add(tm, d, v)
        x = by_day.get(d)
        if x is None:
            continue
        for aid, tm, R, O in zip(x.athlete_id, x.team_id, x.r, x.outs):
            bp["pl"].add(aid, d, [R, O]); bp["lg"].add("lg", d, [R, O])
            bp["use"].add((tm, aid), d, [O]); bp["pitchers"][tm].add(aid)
    st["bp"] = bp
    return st


def lineup_value(st, lineup, day):
    p = st["p"]
    lP, lA = st["lg"].get("lg", day)
    if lA <= 0:
        return None
    lr = lP / lA
    L = 0.0
    for aid, slot in lineup:
        P, A = st["pl"].get(aid, day)
        L += ((P + p["k"] * lr * p["pen"]) / (A + p["k"]) - lr) * SLOT_PA[int(slot)]
    return L


def bullpen_value(bp, tm, day):
    p = bp["p"]
    lR, lO = bp["lg"].get("lg", day)
    if lO <= 0:
        return None
    lr = lR / lO
    num = den = 0.0
    for aid in list(bp["pitchers"][tm]):
        w = bp["use"].get((tm, aid), day)[0]
        if w < 0.5:
            if w < 0.01:
                bp["pitchers"][tm].discard(aid)     # long gone from this bullpen
            continue
        R, O = bp["pl"].get(aid, day)
        num += w * (R + p["k_b"] * lr * 1.05) / (O + p["k_b"])
        den += w
    return (lr - num / den) * p["pen_outs"] if den > 0 else None


def mlb_posted(conn, event_id, team, as_of):
    a = {"as_of": as_of, "t": int(team), "e": int(event_id)}
    s = _q(conn, f"SELECT slot, athlete_id FROM mlb_lineup_states WHERE espn_event_id = :e AND team_id = :t "
                 f"AND slot BETWEEN 1 AND 9 AND athlete_id IS NOT NULL AND {STATE_AT}", a)
    if s is not None and s.slot.nunique() == 9:
        return list(zip(s.athlete_id.astype(int), s.slot.astype(int))), "posted"
    s = _q(conn, "SELECT order_no AS slot, athlete_id FROM pregame_lineups WHERE espn_event_id = :e "
                 "AND team_id = :t AND role = 'lineup' AND order_no BETWEEN 1 AND 9 AND athlete_id IS NOT NULL "
                 "AND fetched_at = (SELECT MAX(fetched_at) FROM pregame_lineups WHERE espn_event_id = :e "
                 "AND team_id = :t AND role = 'lineup' AND fetched_at <= :as_of)", a)
    if s is not None and s.slot.nunique() == 9:
        return list(zip(s.athlete_id.astype(int), s.slot.astype(int))), "posted"
    return None, None


def mlb_x(conn, sched, as_of, state=None):
    today = str(sched["date"].min())[:10]
    st = state or mlb_state(conn, today)
    res = []
    for e, d, h, a in zip(sched.espn_event_id.astype(int), sched.date, sched.home_team.astype(int),
                          sched.away_team.astype(int)):
        day, row = _day(d), []
        for team in (h, a):
            lu, src = mlb_posted(conn, e, team, as_of)
            if lu is None and team in st["last"]:
                lu, src = st["last"][team][0], "usual"
            L = lineup_value(st, lu, day) if lu else None
            x1 = None if L is None else L - st["avg"].avg(team, day)
            B = bullpen_value(st["bp"], team, day)
            x2 = None if B is None else B - st["bp"]["avg"].avg(team, day)
            row.append((x1, x2, src))
        res.append(row)
    return res


# ---------------------------------------------------------------- applying

def player_values(conn, league, sched, as_of, state=None) -> pd.DataFrame:
    """Per schedule row: home/away x (and x2 for MLB), ids, src."""
    n = len(sched)
    out = pd.DataFrame({c: [None] * n for c in AUDIT_COLS[:8]})
    if not n:
        return out
    if league in ("nba", "nhl"):
        for i, (xh, xa, sh, sa) in enumerate(missing_x(conn, league, sched, as_of, state)):
            out.loc[i, ["home_player_x", "away_player_x", "home_player_src", "away_player_src"]] = \
                [xh, xa, sh, sa]
    elif league == "nfl":
        for i, ((xh, sh, ih), (xa, sa, ia)) in enumerate(nfl_x(conn, sched, as_of, state)):
            out.loc[i, ["home_player_x", "away_player_x", "home_player_src", "away_player_src",
                        "home_player_id", "away_player_id"]] = [xh, xa, sh, sa, ih, ia]
    elif league == "mlb":
        for i, ((h1, h2, sh), (a1, a2, sa)) in enumerate(mlb_x(conn, sched, as_of, state)):
            out.loc[i, ["home_player_x", "away_player_x", "home_player_x2", "away_player_x2",
                        "home_player_src", "away_player_src"]] = [h1, a1, h2, a2, sh, sa]
    return out


def _xs(f, league, side):
    cols = [f"{side}_player_x", f"{side}_player_x2"][:len(COEFS[league]["win"])]
    return np.column_stack([pd.to_numeric(f[c], errors="coerce").fillna(0.0).to_numpy(float)
                            for c in cols])


def _logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def _sig(x):
    return 1 / (1 + np.exp(-x))


def shift(f, league, w, p_elo=None):
    """Forecast with the player term applied from the base columns
    (player_*_base) and the stored x values. w = Elo weight per row.

    Without p_elo (before the stack) the logit chance gets the provisional
    shift WIN / (1 - w) * xd, except NFL, which waits for restack. With
    p_elo (restack, after the stack) the logit chance is solved so the
    published chance (1 - w) * p_logit + w * p_elo moves exactly by the
    backtested logit shift WIN * xd (as far as p_logit's 0.0001-0.9999
    range allows), and that chance is published. NFL applies the shift to
    the blended chance instead and leaves p_logit at the team chance.
    Rows whose x are all zero keep the base values."""
    from .forecast import apply_home_probs
    co = COEFS[league]
    f = f.reset_index(drop=True).copy()
    xh, xa = _xs(f, league, "home"), _xs(f, league, "away")
    xd, xs = xh - xa, xh + xa
    w = np.clip(np.nan_to_num(np.asarray(w, float), nan=0.0), 0.0, 0.95)
    dl = xd @ np.asarray(co["win"])                    # backtested logit shift
    p0 = f["player_prob_base"].to_numpy(float)
    t0 = f["player_total_base"].to_numpy(float)
    m0 = -f["player_spread_base"].to_numpy(float)
    changed = (np.abs(xd) + np.abs(xs)).sum(axis=1) > 0
    if p_elo is None:
        if league == "nfl":
            # The win term is applied to the blended chance in restack.
            # Dividing by (1 - w) here pushes this chance to 0 or 1.
            p = p0
        else:
            p = np.where(changed, _sig(_logit(p0) + dl / (1 - w)), p0)
        f = apply_home_probs(f, np.round(p, 4))
    else:
        pe = np.asarray(p_elo, float)
        use = np.isfinite(pe) & (w > 0)
        pe0 = np.nan_to_num(pe)
        pub0 = np.where(use, (1 - w) * p0 + w * pe0, p0)
        target = _sig(_logit(pub0) + dl)
        if league == "nfl":
            # Same shift, on the blended chance. Solving for the logit
            # component pins it at 0 or 1 when the weight is high. The
            # fallback (no stack) keeps the plain shift, clipped so the
            # stored logit chance stays inside the published range.
            pl = np.where(use, p0, np.clip(target, 0.0001, 0.9999))
            pl = np.round(np.where(changed, pl, p0), 4)
            pub = np.where(changed, np.where(use, target, pl), pub0)
        else:
            pl = np.where(use, (target - w * pe0) / np.where(use, 1 - w, 1.0), target)
            pl = np.round(np.clip(np.where(changed, pl, p0), 0.0001, 0.9999), 4)
            pub = np.where(use, (1 - w) * pl + w * pe0, pl)
        f["p_logit"] = pl
        f = apply_home_probs(f, pub)
    total = np.maximum(t0 + xs @ np.asarray(co["total"]), 0.0)
    margin = m0 + xd @ np.asarray(co["margin"])
    home_t = np.clip((total + margin) / 2, 0, total)
    f["total_pred"] = np.where(changed, np.round(total, 1), t0)
    f["home_spread"] = np.where(changed, np.round(-margin, 1), -m0)
    if "away_spread" in f:
        f["away_spread"] = -f["home_spread"]
    f["home_total_pred"] = np.where(changed, np.round(home_t, 1), f["player_home_total_base"])
    f["away_total_pred"] = np.where(changed, np.round(total - home_t, 1), f["player_away_total_base"])
    return f


def elo_weights(league, sched):
    from .bayes_elo import weight_for
    return np.array([weight_for(league, int(s))[0] or 0.0 for s in sched["season"]], float)


def inputs_key(conn, league, today) -> str:
    """Cheap fingerprint of the pre-game player inputs for a league."""
    q = {"nba": ("SELECT MAX(valid_from) || MAX(COALESCE(valid_to, '')) FROM nba_injury_states",),
         "nhl": ("SELECT MAX(valid_from) || MAX(COALESCE(valid_to, '')) FROM nhl_line_states",
                 "SELECT MAX(valid_from) || MAX(COALESCE(valid_to, '')) FROM roster_states WHERE league = 'nhl'"),
         "nfl": ("SELECT MAX(valid_from) || MAX(COALESCE(valid_to, '')) FROM nfl_depth_states",
                 "SELECT MAX(valid_from) || MAX(COALESCE(valid_to, '')) FROM nfl_injury_report_states",
                 "SELECT MAX(valid_from) || MAX(COALESCE(valid_to, '')) FROM roster_states WHERE league = 'nfl'",
                 "SELECT MAX(fetched_at) FROM nfl_inactives"),
         "mlb": ("SELECT MAX(valid_from) || MAX(COALESCE(valid_to, '')) FROM mlb_lineup_states",
                 "SELECT MAX(p.fetched_at) FROM pregame_lineups p JOIN games g ON "
                 "g.espn_event_id = p.espn_event_id WHERE g.league = 'mlb' AND p.role = 'lineup'")}[league]
    parts = [str(today)]
    for sql in q:
        try:
            parts.append(str(conn.execute(sql).fetchone()[0]))
        except sqlite3.Error:
            parts.append("-")
    return "|".join(parts)


def adjust_forecast(conn, league, sched, forecast, as_of, state=None):
    """Forecast with the player term and AUDIT_COLS attached, row-aligned
    with `sched`. The win term uses the Elo weight the stack will apply;
    restack() makes it exact after the stack."""
    f = forecast.reset_index(drop=True).copy()
    s = sched.reset_index(drop=True)
    f["player_prob_base"] = f["home_prob"].to_numpy(float)
    f["player_spread_base"] = f["home_spread"].to_numpy(float)
    f["player_total_base"] = f["total_pred"].to_numpy(float)
    f["player_home_total_base"] = f["home_total_pred"].to_numpy(float)
    f["player_away_total_base"] = f["away_total_pred"].to_numpy(float)
    pv = player_values(conn, league, s, as_of, state)
    for c in pv.columns:
        f[c] = pv[c].values
    f["player_inputs"] = inputs_key(conn, league, str(s["date"].min())[:10])
    return shift(f, league, elo_weights(league, s))


def restack(f, league):
    """After the Elo stack: redo the player term with the weight actually
    used per row (elo_weight, 0 on an Elo fallback) and restack."""
    if "player_prob_base" not in f or not len(f):
        return f
    w = pd.to_numeric(f["elo_weight"], errors="coerce").fillna(0.0).to_numpy(float)
    return shift(f, league, w, p_elo=pd.to_numeric(f["p_elo"], errors="coerce").to_numpy(float))


def counts(f) -> str:
    def n(c):
        return int(f[c].notna().sum()) if c in f else 0
    return f"players {n('home_player_x') + n('away_player_x')}/{2 * len(f)} sides"


# ------------------------------------------------------------- intraday

STATE_FN = {"nba": lambda c, t: missing_state(c, "nba", t), "nhl": lambda c, t: missing_state(c, "nhl", t),
            "nfl": nfl_state, "mlb": mlb_state}


def refresh(conn, leagues=LEAGUES, now=None, log=print, errors=None) -> dict:
    """Re-apply the player term to today's game-day forecasts and the early
    forecasts of later games (upcoming_forecasts) that haven't started (and
    aren't already locked) when the league's player inputs changed
    since they were computed. Returns {league: rows changed}.
    A league that fails is logged (and appended to `errors`); the others
    still run."""
    now = now or datetime.now(timezone.utc)
    out = {}
    for lg in leagues:
        try:
            n = _refresh_league(conn, lg, now, log)
        except Exception as e:
            import traceback
            log(f"players refresh {lg} FAILED {type(e).__name__}: {e}\n{traceback.format_exc()}")
            if errors is not None:
                errors.append(lg)
            continue
        if n is not None:
            out[lg] = n
    return out


# forecast tables the refresh re-applies the player term to: today's game-day
# forecasts, and the early forecasts of later games (display only, never graded)
REFRESH_TABLES = (
    ("forecast_snapshots", "f.snapshot_date = :today AND ", ("snapshot_date", "espn_event_id")),
    ("upcoming_forecasts", "", ("espn_event_id",)),
)


def _refresh_league(conn, lg, now, log, force=False):
    if lg == "nba":
        from . import nba_player
        return nba_player.refresh(conn, now, log, force=force)
    if lg == "nhl":
        from . import nhl_player
        return nhl_player.refresh(conn, now, log, force=force)
    if lg == "nfl":
        from . import nfl_player
        return nfl_player.refresh(conn, now, log, force=force)
    if lg == "mlb":
        from . import mlb_player
        return mlb_player.refresh(conn, now, log, force=force)
    as_of = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    today = now.astimezone(CHICAGO).date().isoformat()
    key = state = total = None
    for table, where, pk in REFRESH_TABLES:
        try:
            rows = pd.read_sql_query(
                f"SELECT f.*, g.season, g.start_time_utc FROM {table} f "
                "JOIN games g ON g.espn_event_id = f.espn_event_id "
                f"WHERE {where}f.league = :lg AND f.player_prob_base IS NOT NULL "
                "AND g.completed = 0 AND f.espn_event_id NOT IN "
                "(SELECT espn_event_id FROM forecast_locks)", conn,
                params={"today": today, "lg": lg})
        except (sqlite3.OperationalError, pd.errors.DatabaseError):
            continue
        if not len(rows):
            continue
        # never a started game or one inside the lock margin
        st = pd.to_datetime(rows["start_time_utc"], utc=True)
        rows = rows[(st - pd.Timestamp(now).tz_convert("UTC")) > LOCK_MARGIN].reset_index(drop=True)
        key = key or inputs_key(conn, lg, today)
        if not len(rows) or (rows["player_inputs"] == key).all():
            continue
        if state is None:
            state = STATE_FN[lg](conn, today)
        n = _refresh_rows(conn, lg, rows, table, pk, as_of, key, state)
        total = (total or 0) + n
        if n:
            early = "" if table == "forecast_snapshots" else " early"
            log(f"players refresh {lg}{early}: {n} of {len(rows)} forecasts updated")
    return total


def _refresh_rows(conn, lg, rows, table, pk, as_of, key, state, adjust=None):
    """Re-apply the player term to `rows` of `table` (primary key `pk`) and
    write back the ones that changed. Returns the number rewritten.

    `adjust`, when set, maps the team-path frame to the frame that gets
    written. NBA passes the ridge overlay. It runs after carry_margin, so
    home_prob on the way in is still the current path.
    """
    from .forecast import carry_margin
    sched = pd.DataFrame({"espn_event_id": rows.espn_event_id, "season": rows.season,
                          "date": rows.game_date.astype(str).str[:10],
                          "home_team": rows.home_team_id.astype(int).astype(str),
                          "away_team": rows.away_team_id.astype(int).astype(str)})
    pv = player_values(conn, lg, sched, as_of, state)
    new = rows.copy()
    for c in pv.columns:
        new[c] = pv[c].values
    new = restack(new, lg)
    new = carry_margin(new, lg)          # the margin follows the stacked chance
    if adjust is not None:
        new = adjust(new)
    new["player_inputs"] = key
    cols = [c for c in rows.columns if c not in ("season", "start_time_utc", "neutral_site")]
    watch = ["home_prob", "home_spread", "total_pred", "home_total_pred", "away_total_pred",
             *AUDIT_COLS[:8]]
    for extra in ("nba_model_src", "nba_ridge_prob", "nba_team_prob", "nba_inputs",
                  "nhl_model_src", "nhl_ridge_prob", "nhl_team_prob", "nhl_inputs",
                  "nfl_model_src", "nfl_ridge_prob", "nfl_team_prob", "nfl_inputs",
                  "mlb_model_src", "mlb_ridge_prob", "mlb_team_prob", "mlb_inputs"):
        if extra in new.columns:
            watch.append(extra)
    where = " AND ".join(f"{c} = ?" for c in pk)
    n = 0
    from .prelog import Tx

    def _quiet(col, brow):
        """A null audit cell on the other league, or a team-path stamp, is not a new forecast."""
        family = ("nfl" if col.startswith("nfl_") else "nhl" if col.startswith("nhl_")
                  else "nba" if col.startswith("nba_") else "mlb" if col.startswith("mlb_")
                  else None)
        if family is None or f"{family}_model_src" not in brow.index:
            return True
        fam = brow[f"{family}_model_src"]
        return fam is None or (not isinstance(fam, str) and pd.isna(fam)) or fam == "team"

    def same_cell(col, old, new_v, brow):
        # A row saved before the ridge has null audit columns. Filling those
        # in with the current path, and no other change, is not a new
        # forecast. A ridge chance is a change even when the rounded
        # probability happens to match. The other league's null columns are
        # not a change.
        blank = old is None or (not isinstance(old, str) and pd.isna(old))
        if blank and col in ("nba_model_src", "nhl_model_src", "nfl_model_src",
                             "mlb_model_src") and new_v == "team":
            return True
        if blank and (col.startswith("nba_") or col.startswith("nhl_")
                      or col.startswith("nfl_") or col.startswith("mlb_")) and _quiet(col, brow):
            return True
        return (pd.isna(old) and pd.isna(new_v)) or old == new_v

    with Tx(conn):
        for i in range(len(new)):
            a, b = rows.loc[i, watch], new.loc[i, watch]
            same = all(same_cell(c, x, y, b) for c, x, y in zip(watch, a, b))
            if same:
                conn.execute(f"UPDATE {table} SET player_inputs = ? WHERE {where}",
                             (key, *[_py(new.loc[i, c]) for c in pk]))
                continue
            vals = [_py(new.loc[i, c]) for c in cols]
            conn.execute(f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) "
                         f"VALUES ({', '.join('?' * len(cols))})", vals)
            n += 1
    return n


def _py(v):
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v
