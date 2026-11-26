"""Per-player model values, saved once a day.

The player adjustment (player_adj.py) and the starter adjustment
(starters.py) value every player they use, add the values up per team and
keep only the team totals. This module runs the same running sums again
after the day's forecasts are saved and keeps each player's value in
`player_values`. It only reads the model's state: nothing here feeds a
forecast, and a failure never fails the daily run.

Values are per game, in the units each adjustment uses:

  NBA  role P   Game Score per game above replacement (rate per minute,
                shrunk to replacement, times usual minutes); 0 = replacement.
  NHL  role F/D goal value per 60 minutes above replacement times usual
                minutes (player_adj units; divide by 60 for goals per game).
       role G   goals saved per game vs a league-average goalie.
  NFL  role QB  adjusted net yards per game vs a league-average QB (shrunk
                adjusted yards per dropback minus league, times 34 dropbacks).
  MLB  role H   runs per game vs a league-average hitter (shrunk linear-weight
                runs per PA minus league, times his lineup slot's PA).
       role SP  runs saved per start vs a league-average starter.
       role RP  runs saved per appearance vs a league-average reliever.

value_lo / value_hi: a 90% range from the rate's shrunk estimate (normal
approximation: per-unit spread of the league's box lines over the last year,
divided by the player's decayed sample plus the prior weight). A player
with little history gets a wide range around the prior, so a short hot
streak never looks bigger than it is.

win_logit: what a win term would move for his team when he plays
rather than the fallback, in logit units. Skaters, hitters and quarterbacks
use the player-adjustment coefficients. Goalies and starting pitchers use
the old outside starter coefficients in starters.COEFS. Those are display
only: the forecast's starter term is estimated inside the rating fit and
does not read COEFS.
  NBA, NHL F/D  WIN * value (fallback: replacement level)
  NHL G         starter WIN * (value - team's next goalie)
  NFL QB        WIN * (value - team's next QB on the depth chart)
  MLB H         lineup WIN * value above the shrinkage prior level
  MLB SP        starter WIN * (value - team's recent average starter)
  MLB RP        none (the bullpen term is usage-weighted; no single cost)
is_out: 1 when the model's own sources count him out for the team's next
game (NBA official report Out/Doubtful; NHL not in the latest lines or on
the injured list; NFL injury report / roster / inactives; MLB injured list),
0 when he's available, NULL when there's no source. NBA before the official
report for the next game is out: ESPN's injury list (out_src 'roster'), which
the forecast doesn't use until the report arrives.
"""

import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import db
from . import player_adj as pa
from . import starters

LEAGUES = ("nba", "nhl", "nfl", "mlb")
RECENT_DAYS = 30            # leagues with a completed game this recently get values
Z90 = 1.645
COLS = ("snapshot_date", "league", "team_id", "athlete_id", "role", "value", "value_lo",
        "value_hi", "usage", "sample", "win_logit", "is_out", "out_src")


def _f(x):
    return None if x is None or not np.isfinite(x) else float(x)


def _var_per_unit(P, U):
    """Per-unit variance of P around the pooled rate (box lines)."""
    P, U = np.asarray(P, float), np.asarray(U, float)
    m = U > 0
    if not m.any():
        return None
    r = P[m].sum() / U[m].sum()
    return float(((P[m] - r * U[m]) ** 2).sum() / U[m].sum())


def _next_games(conn, league, today):
    """{team_id: (espn_event_id, start_time_utc)} next unplayed game from today."""
    out = {}
    for e, h, a, st in conn.execute(
            "SELECT espn_event_id, home_team_id, away_team_id, start_time_utc FROM games "
            "WHERE league = ? AND completed = 0 AND season_type IN (2, 3) AND game_date >= ? "
            "ORDER BY start_time_utc", (league, today)):
        for t in (h, a):
            out.setdefault(int(t), (int(e), st))
    return out


def _roster_out(conn, league, as_of, statuses):
    r = pa._q(conn, f"SELECT team_id, athlete_id, injury_status FROM roster_states "
                    f"WHERE league = :lg AND {pa.STATE_AT}", {"lg": league, "as_of": as_of})
    if r is None:
        return set()
    return set(r.athlete_id[r.injury_status.isin(statuses)].dropna().astype(int))


# ---------------------------------------------------------------- NBA / NHL

def _rotation_rows(conn, league, today, as_of):
    p = pa.PARAMS[league]
    rot, _ = pa.missing_state(conn, league, today)
    day = pa._day(today)
    since = (pd.Timestamp(today) - pd.Timedelta(days=365)).date().isoformat()
    lines = (pa.nba_lines if league == "nba" else pa.nhl_lines)(conn, since, today)
    lines = lines[lines.played == 1]
    var = {g: _var_per_unit(x.P, x.U) for g, x in lines.groupby("grp")}
    win = pa.COEFS[league]["win"][0]
    nxt = _next_games(conn, league, today)
    outs, srcs, members = {}, {}, {}
    if league == "nba":
        for t, (e, _st) in nxt.items():
            rep = pa.nba_report_outs(conn, [e], {e: as_of}).get(e)
            if rep is not None:
                outs[t], srcs[t] = rep.get(t, set()), "report"
        # no official report for the next game yet: ESPN's injury list (display only;
        # the forecast makes no adjustment until the report is out)
        r = pa._q(conn, f"SELECT team_id, athlete_id, injury_status FROM roster_states "
                        f"WHERE league = 'nba' AND {pa.STATE_AT}", {"as_of": as_of})
        if r is not None:
            for t, x in r.groupby("team_id"):
                if int(t) not in outs:
                    outs[int(t)] = set(x.athlete_id[x.injury_status.isin(("Out",))].dropna().astype(int))
                    srcs[int(t)] = "roster"
    else:
        for t, (src, ids, mem) in pa.nhl_outs(conn, set(nxt), as_of).items():
            if mem:
                members[t] = mem
            if src == "lines":
                outs[t] = {x for x in rot.roster[t] if x not in ids}
            else:
                outs[t] = ids
            srcs[t] = src
    rows = []
    for team in list(rot.roster):
        for aid in rot.roster[team]:
            if int(team) in members and aid not in members[int(team)]:
                continue            # no longer on the team's roster (as the model does)
            if rot.tidx[team] - rot.last_idx[aid] > 10:
                continue
            su, sn = rot.au.get((aid, team), day)
            if sn <= 1e-9 or su / sn < p["min_u"]:
                continue
            g = rot.grp[aid]
            lP, lU = rot.lg.get(g, day)
            if lU <= 0:
                continue
            repl = p["repl"] * lP / lU
            P, U = rot.pl.get(aid, day)
            rate = (P + p["k"] * repl) / (U + p["k"])
            use = su / sn
            sd = math.sqrt(var[g] / (U + p["k"])) if var.get(g) else 0.0
            val = max(rate - repl, 0.0) * use
            lo = max(rate - Z90 * sd - repl, 0.0) * use
            hi = max(rate + Z90 * sd - repl, 0.0) * use
            t = int(team)
            o = None if t not in outs else int(aid in outs[t])
            role = "P" if league == "nba" else g
            rows.append((t, int(aid), role, val, lo, hi, use, U, win * val, o, srcs.get(t)))
    if league == "nhl":
        rows += _goalie_rows(conn, today, as_of, nxt)
    return rows


def _starter_q(conn, league, cands, today):
    """{(team, athlete): row of starters.quality} for candidate starters today."""
    if not len(cands):
        return {}
    lines = starters.load_lines(conn, league)
    ps = pd.DataFrame({"espn_event_id": -np.arange(1, len(cands) + 1),
                       "game_date": today, "team_id": [c[0] for c in cands],
                       "athlete_id": [c[1] for c in cands]})
    st = starters.quality(pd.concat([lines, starters.pseudo_lines(ps, league)], ignore_index=True),
                          league)
    st = st[st["pseudo"] == 1]
    return {(int(r.team_id), int(r.athlete_id)): r for r in st.itertuples(index=False)}


def _goalie_rows(conn, today, as_of, nxt):
    since = (pd.Timestamp(today) - pd.Timedelta(days=365)).date().isoformat()
    g = pd.read_sql_query(
        "SELECT team_id, athlete_id, game_date, sa, ga, goalie_order FROM player_game_nhl_goalie "
        "WHERE season_type IN (2, 3) AND game_date >= ? AND game_date < ?", conn, params=(since, today))
    if not len(g):
        return []
    last = g.sort_values("game_date").groupby("athlete_id").tail(1)
    recent = (pd.Timestamp(today) - pd.Timedelta(days=60)).date().isoformat()
    cands = [(int(t), int(a)) for t, a, d in zip(last.team_id, last.athlete_id, last.game_date)
             if d >= recent]
    q = _starter_q(conn, "nhl", cands, today)
    lg_sv = 1 - g.ga.sum() / max(g.sa.sum(), 1)
    spg = g[g.goalie_order == 1].sa.mean()
    k = starters.PARAMS["nhl"]["k_sv"]
    win = starters.COEFS["nhl"]["win"]
    out = _roster_out(conn, "nhl", as_of, pa.NHL_ROSTER_OUT)
    starts = g[g.goalie_order == 1].groupby("athlete_id").size()
    rows = []
    for (t, a), r in q.items():
        if not np.isfinite(r.q):
            continue
        sd = spg * math.sqrt(lg_sv * (1 - lg_sv) / (r.prior_w + k))
        rows.append([t, a, "G", r.q, r.q - Z90 * sd, r.q + Z90 * sd, float(starts.get(a, 0)),
                     r.prior_w, None, int(a in out), "roster"])
    by_team = {}
    for x in rows:
        by_team.setdefault(x[0], []).append(x)
    for xs in by_team.values():
        for x in xs:
            others = [y[3] for y in xs if y is not x and not y[9]]
            x[8] = win * (x[3] - max(others)) if others else None
    return [tuple(x) for x in rows]


# ---------------------------------------------------------------- NFL

def _nfl_out(conn, team, event_id, start, as_of):
    """Athletes the QB pick skips (same sources as player_adj.nfl_pick)."""
    a = {"as_of": as_of, "t": int(team)}
    excl = set()
    rep = pa._q(conn, f"SELECT athlete_id, season, week, report_status, valid_from FROM "
                      f"nfl_injury_report_states WHERE team_id = :t AND {pa.STATE_AT}", a)
    if rep is not None and len(rep):
        top = rep.sort_values(["season", "week"]).iloc[-1]
        wk = rep[(rep.season == top.season) & (rep.week == top.week)]
        if start and str(wk.valid_from.max()) >= pa._iso(pd.Timestamp(start) - pd.Timedelta(days=6)):
            excl |= set(wk.athlete_id[wk.report_status.isin(pa.NFL_REPORT_OUT)].dropna().astype(int))
    ros = pa._q(conn, f"SELECT athlete_id FROM roster_states WHERE league = 'nfl' AND team_id = :t "
                      f"AND injury_status IN ({','.join(repr(s) for s in pa.NFL_ROSTER_OUT)}) "
                      f"AND {pa.STATE_AT}", a)
    if ros is not None:
        excl |= set(ros.athlete_id.dropna().astype(int))
    if event_id is not None:
        ina = pa._q(conn, "SELECT athlete_id FROM nfl_inactives WHERE espn_event_id = :e AND team_id = :t "
                          "AND fetched_at = (SELECT MAX(fetched_at) FROM nfl_inactives WHERE "
                          "espn_event_id = :e AND team_id = :t AND fetched_at <= :as_of)",
                    {**a, "e": int(event_id)})
        if ina is not None:
            excl |= set(ina.athlete_id.dropna().astype(int))
    return excl


def _nfl_rows(conn, today, as_of):
    p = pa.PARAMS["nfl"]
    st = pa.nfl_state(conn, today)
    day = pa._day(today)
    since = (pd.Timestamp(today) - pd.Timedelta(days=365)).date().isoformat()
    b = pd.read_sql_query(
        "SELECT att, yds, td, ints, sacks, sack_yds FROM player_game_nfl_passing "
        "WHERE season_type IN (2, 3) AND game_date >= ? AND game_date < ?",
        conn, params=(since, today)).fillna(0)
    var = _var_per_unit(b.yds - b.sack_yds + 20 * b.td - 45 * b.ints, b.att + b.sacks)
    depth = pa._q(conn, f"SELECT team_id, athlete_id, MIN(depth) AS depth FROM nfl_depth_states "
                        f"WHERE slot = 'qb' AND athlete_id IS NOT NULL AND {pa.STATE_AT} "
                        "GROUP BY team_id, athlete_id", {"as_of": as_of})
    teams = {}
    if depth is not None:
        for t, a, d in zip(depth.team_id, depth.athlete_id, depth.depth):
            teams.setdefault(int(t), {})[int(a)] = int(d)
    for t, (a, _d) in st["last"].items():
        teams.setdefault(int(t), {}).setdefault(int(a), 0)
    nxt = _next_games(conn, "nfl", today)
    lP, lD = st["lg"].get("lg", day)
    win = pa.COEFS["nfl"]["win"][0]
    rows = []
    for t, qbs in teams.items():
        e, start = nxt.get(t, (None, None))
        excl = _nfl_out(conn, t, e, start, as_of)
        vals = {}
        for a in qbs:
            v = pa.qb_value(st, a, day)
            if v is None:
                continue
            P, D = st["pl"].get(a, day)
            sd = math.sqrt(var / (D + p["k"])) * p["exp_db"] if var else 0.0
            vals[a] = (v, v - Z90 * sd, v + Z90 * sd, D)
        order = sorted(vals, key=lambda a: (qbs[a], -vals[a][0]))
        for a in order:
            v, lo, hi, D = vals[a]
            nxt_qb = [vals[b][0] for b in order if b != a and b not in excl]
            wl = win * (v - nxt_qb[0]) if nxt_qb else None
            rows.append((t, a, "QB", v, lo, hi, p["exp_db"], D, wl, int(a in excl), "depth"))
    return rows


# ---------------------------------------------------------------- MLB

def _mlb_rows(conn, today, as_of):
    p = pa.PARAMS["mlb"]
    st = pa.mlb_state(conn, today)
    day = pa._day(today)
    lP, lA = st["lg"].get("lg", day)
    if lA <= 0:
        return []
    lr = lP / lA
    since = (pd.Timestamp(today) - pd.Timedelta(days=365)).date().isoformat()
    b = pd.read_sql_query(
        "SELECT game_date, team_id, athlete_id, starter, bat_order, ab, h, hr, bb "
        "FROM player_game_mlb_batting WHERE season_type IN (2, 3) AND game_date >= ? AND game_date < ?",
        conn, params=(since, today)).fillna(0)
    var = _var_per_unit(0.69 * b.bb + 0.95 * (b.h - b.hr) + 2.0 * b.hr, b.ab + b.bb)
    win_h, win_b = pa.COEFS["mlb"]["win"]
    out = set()
    r = pa._q(conn, f"SELECT athlete_id, status_code FROM mlb_roster_states WHERE {pa.STATE_AT}",
              {"as_of": as_of})
    if r is not None:
        out = set(r.athlete_id[r.status_code.astype(str).str.match(r"D\d+")].dropna().astype(int))
    rows = []
    # hitters: the team's last 30 games
    for t, x in b.groupby("team_id"):
        dates = sorted(x.game_date.unique())[-30:]
        y = x[x.game_date.isin(dates)]
        s = y[(y.starter == 1) & y.bat_order.between(1, 9)]
        if not len(s):
            continue
        for a, z in s.groupby("athlete_id"):
            if len(z) < 5:
                continue
            slot = int(z.bat_order.mode().iloc[0])
            P, A = st["pl"].get(a, day)
            rate = (P + p["k"] * lr * p["pen"]) / (A + p["k"])
            sd = math.sqrt(var / (A + p["k"])) if var else 0.0
            pa_g = pa.SLOT_PA[slot]
            v = (rate - lr) * pa_g
            rows.append((int(t), int(a), "H", v, v - Z90 * sd * pa_g, v + Z90 * sd * pa_g, pa_g, A,
                         win_h * (rate - lr * p["pen"]) * pa_g, int(int(a) in out), "roster"))
    # starters
    pt = pd.read_sql_query(
        "SELECT game_date, team_id, athlete_id, pitch_order, outs, r FROM player_game_mlb_pitching "
        "WHERE season_type IN (2, 3) AND game_date >= ? AND game_date < ?",
        conn, params=(since, today)).fillna(0)
    rvar = _var_per_unit(pt.r, pt.outs)
    cands = []
    for t, x in pt.groupby("team_id"):
        dates = sorted(x.game_date.unique())[-30:]
        y = x[x.game_date.isin(dates) & (x.pitch_order == 1)]
        cands += [(int(t), int(a)) for a in y.athlete_id.unique()]
    q = _starter_q(conn, "mlb", cands, today)
    sp = starters.PARAMS["mlb"]
    k_eff = sp["w_fip"] * sp["k_fip"] + (1 - sp["w_fip"]) * sp["k_ra"]
    so = pt[pt.pitch_order == 1].groupby("athlete_id").outs.mean()
    for (t, a), r in q.items():
        if not np.isfinite(r.q):
            continue
        eo = float(so.get(a, 15.0))
        sd = math.sqrt(rvar / (r.prior_w + k_eff)) * eo if rvar else 0.0
        rows.append((t, a, "SP", r.q, r.q - Z90 * sd, r.q + Z90 * sd, eo, r.prior_w,
                     starters.COEFS["mlb"]["win"] * r.rel, int(a in out), "roster"))
    # relievers: the bullpen the model weights today
    bp = st["bp"]
    lR, lO = bp["lg"].get("lg", day)
    if lO > 0:
        lrr = lR / lO
        app = pt[pt.pitch_order > 1].groupby("athlete_id").outs.mean()
        for t, ps in bp["pitchers"].items():
            for a in list(ps):
                w = bp["use"].get((t, a), day)[0]
                if w < 0.5:
                    continue
                R, O = bp["pl"].get(a, day)
                rate = (R + p["k_b"] * lrr * 1.05) / (O + p["k_b"])
                eo = float(app.get(a, 3.0))
                sd = math.sqrt(rvar / (O + p["k_b"])) * eo if rvar else 0.0
                v = (lrr - rate) * eo
                rows.append((int(t), int(a), "RP", v, v - Z90 * sd, v + Z90 * sd, eo, O, None,
                             int(int(a) in out), "roster"))
    return rows


# ---------------------------------------------------------------- run

FN = {"nba": lambda c, t, a: _rotation_rows(c, "nba", t, a),
      "nhl": lambda c, t, a: _rotation_rows(c, "nhl", t, a),
      "nfl": _nfl_rows, "mlb": _mlb_rows}


def recent(conn, league, today) -> bool:
    lo = (pd.Timestamp(today) - pd.Timedelta(days=RECENT_DAYS)).date().isoformat()
    return conn.execute("SELECT COUNT(*) FROM games WHERE league = ? AND completed = 1 "
                        "AND season_type IN (2, 3) AND game_date >= ? AND game_date <= ?",
                        (league, lo, today)).fetchone()[0] > 0


def compute(conn, league, today, as_of) -> list:
    """[row tuple in COLS order] for one league as of `today` (ISO date)."""
    rows = FN[league](conn, today, as_of)
    return [(today, league, *(int(r[0]), int(r[1]), r[2]), *map(_f, r[3:9]),
             None if r[9] is None else int(r[9]), r[10]) for r in rows]


def store(conn, league, today, rows) -> int:
    with db.immediate(conn):
        conn.execute("DELETE FROM player_values WHERE snapshot_date = ? AND league = ?", (today, league))
        conn.executemany(f"INSERT OR REPLACE INTO player_values ({', '.join(COLS)}) VALUES "
                         f"({', '.join('?' * len(COLS))})", rows)
    return len(rows)


def run(conn, leagues, today, as_of=None, log=print) -> dict:
    """Compute and save today's values for each league that played in the
    last RECENT_DAYS days. {league: rows | 'error'}; never raises."""
    as_of = as_of or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    out = {}
    for lg in leagues:
        if lg not in FN or not recent(conn, lg, today):
            continue
        try:
            out[lg] = store(conn, lg, today, compute(conn, lg, today, as_of))
        except Exception as e:
            import traceback
            log(f"player values {lg} FAILED {type(e).__name__}: {e}\n{traceback.format_exc()}")
            out[lg] = "error"
    return out


def status_part(res) -> str:
    return "values " + (",".join(f"{lg}{n}" for lg, n in res.items()) or "none")


if __name__ == "__main__":
    import argparse
    from zoneinfo import ZoneInfo
    from . import db
    ap = argparse.ArgumentParser(description="Save today's per-player model values")
    ap.add_argument("--db", default="data/bayesratings.db")
    ap.add_argument("--leagues", default=",".join(LEAGUES))
    ap.add_argument("--date", default=None)
    ap.add_argument("--as-of", default=None)
    a = ap.parse_args()
    c = db.connect(a.db)
    db.init_db(c)
    d = a.date or datetime.now(ZoneInfo("America/Chicago")).date().isoformat()
    print(run(c, [x for x in a.leagues.split(",") if x], d, a.as_of))
