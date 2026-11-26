"""Daily Faceoff (dailyfaceoff.com): starting goalies with their status
(Confirmed / Likely / Unconfirmed), when it was posted and the reporter, and
team line combinations. HTML pages (robots.txt allows them; /api/ is
disallowed and not used); the data is the page's embedded __NEXT_DATA__
JSON. Fetched at low frequency with an identifying
User-Agent. Names map to ESPN by name + team; misses go to ext_unmatched."""

import json
import re
import time
from datetime import datetime, timedelta, timezone

from .. import espn
from ..prelog import Tx, _now, _teams, track, _add
from .common import (Players, RobotsDisallowed, Teams, game_for, http_get, js, resolved,
                     robots_allowed, store_raw, unmatched)

BASE = "https://www.dailyfaceoff.com"
SRC = "dfo"
GAP = 3.0                      # extra seconds between Daily Faceoff requests
PRE_REFRESH = timedelta(minutes=30)   # pre-game refetch at most this often
_NEXT = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)


def next_data(html: str) -> dict:
    m = _NEXT.search(html)
    if not m:
        raise ValueError("no __NEXT_DATA__ on the page (layout changed?)")
    return json.loads(m.group(1))["props"]["pageProps"]


def _get_page(conn, pace, url, fetch):
    if not robots_allowed(conn, url, pace, fetch):
        raise RobotsDisallowed(url)
    time.sleep(GAP if fetch is http_get else 0)
    return pace(fetch, url, accept="text/html").decode("utf-8", "replace")


# ------------------------------------------------------------- goalies

def parse_goalies(pp) -> list:
    out = []
    for g in pp.get("data") or []:
        for side in ("home", "away"):
            def f(k):
                return g.get(f"{side}{k}")
            if f("TeamId") is None:
                continue
            out.append(dict(
                game_date=g.get("date"), game_time_utc=g.get("dateGmt"), side=side,
                dfo_team_id=f("TeamId"), team_name=f("TeamName"),
                opp_name=g.get(f"{'away' if side == 'home' else 'home'}TeamName"),
                dfo_goalie_id=f("GoalieId"), goalie_name=f("GoalieName"),
                strength=f("NewsStrengthName") or ("Unconfirmed" if f("GoalieName") else None),
                news_created_at=f("NewsCreatedAt"), news_details=(f("NewsDetails") or "").strip() or None,
                source_name=f("NewsSourceName"), source_url=f("NewsSourceUrl"),
                raw_json=js({k: v for k, v in g.items() if k.startswith(side) and not any(
                    x in k for x in ("Logo", "Headshot", "FaceUrl", "Jersey"))})))
    return out


GOALIE_FIELDS = ("dfo_goalie_id", "goalie_name", "strength", "news_created_at", "news_details",
                 "source_name", "game_time_utc")


def store_goalies(conn, rows, date, at) -> dict:
    T, P = Teams(conn, "nhl"), Players(conn, "nhl")
    st = {"games": len({(r["game_time_utc"], r["team_name"]) for r in rows if r["side"] == "home"})}
    by_game = {}
    for r in rows:
        r["league"] = "nhl"
        r["team_id"] = T.by(r["team_name"])
        by_game.setdefault((r["game_time_utc"], r["team_name"] if r["side"] == "home" else r["opp_name"]),
                           []).append(r)
    with Tx(conn):
        for rs in by_game.values():
            home = next((r["team_id"] for r in rs if r["side"] == "home"), None)
            ids = [r["team_id"] for r in rs]
            eid = game_for(conn, "nhl", ids, rs[0]["game_time_utc"], hours=6, home=home) \
                if rs[0]["game_time_utc"] and None not in ids else None
            for r in rs:
                r["espn_event_id"] = eid
            if eid is None:
                st["unmatched_games"] = st.get("unmatched_games", 0) + 1
                unmatched(conn, SRC, "nhl", "game", f"{date}:{rs[0]['team_name']}",
                          " @ ".join(r["team_name"] or "?" for r in rs), None, rs[0]["game_time_utc"], at)
        for r in rows:
            if r["team_id"] is None:
                unmatched(conn, SRC, "nhl", "team", r["dfo_team_id"], r["team_name"], at=at)
            r["athlete_id"], _ = P.match(r["goalie_name"], r["team_id"]) if r["goalie_name"] else (None, None)
            if r["goalie_name"]:
                key = r["dfo_goalie_id"] or r["goalie_name"]
                if r["athlete_id"]:
                    st["matched"] = st.get("matched", 0) + 1
                    resolved(conn, SRC, "nhl", "player", key, at)
                else:
                    st["unmatched"] = st.get("unmatched", 0) + 1
                    unmatched(conn, SRC, "nhl", "player", key, r["goalie_name"], r["team_name"],
                              "starting goalie", at)
            st[r["strength"] or "none"] = st.get(r["strength"] or "none", 0) + 1
        _add(st, track(conn, "nhl_goalie_states", ("game_date", "dfo_team_id"), GOALIE_FIELDS, rows,
                       {"game_date": date}, at))
    return st


def nhl_dates_today(conn, now):
    """CT dates (today, and tomorrow before 4 AM CT for late games) with
    regular/postseason NHL games still to start or under way."""
    today = now.astimezone(espn.CENTRAL).date()
    return [r[0] for r in conn.execute(
        "SELECT DISTINCT game_date FROM games WHERE league = 'nhl' AND season_type IN (2, 3) "
        "AND game_date = ? AND completed = 0", (today.isoformat(),))]


def goalies_pass(conn, pace, now=None, log=print, fetch=None, force=False) -> dict:
    fetch = fetch or http_get
    now = now or datetime.now(timezone.utc)
    dates = nhl_dates_today(conn, now)
    if not dates and not force:
        return {"errors": 0, "skipped": "no NHL games today"}
    st = {"errors": 0}
    for d in dates or [now.astimezone(espn.CENTRAL).date().isoformat()]:
        url = f"{BASE}/starting-goalies/{d}"
        html = _get_page(conn, pace, url, fetch)
        at = now.isoformat(timespec="seconds")
        pp = next_data(html)
        with Tx(conn):
            store_raw(conn, SRC, f"starting-goalies/{d}",
                      json.dumps(pp.get("data"), sort_keys=True).encode(), at, "application/json")
        rows = parse_goalies(pp)
        if not rows:
            raise ValueError(f"no goalies parsed for {d}")
        _add(st, store_goalies(conn, rows, d, at))
    return st


def pregame_goalies(conn, pace, now=None, log=print, fetch=None) -> dict:
    """Refetch before puck drop: when an NHL game starts within 100 min and
    the last goalies fetch is older than PRE_REFRESH."""
    now = now or datetime.now(timezone.utc)
    soon = conn.execute(
        "SELECT COUNT(*) FROM games WHERE league = 'nhl' AND completed = 0 AND season_type IN (2, 3) "
        "AND start_time_utc BETWEEN ? AND ?",
        (now.strftime("%Y-%m-%dT%H:%M"), (now + timedelta(minutes=100)).strftime("%Y-%m-%dT%H:%MZ"))
    ).fetchone()[0]
    if not soon:
        return {"errors": 0, "skipped": "no NHL game within 100 min"}
    last = conn.execute("SELECT MAX(last_seen) FROM nhl_goalie_states").fetchone()[0]
    if last and datetime.fromisoformat(last) > now - PRE_REFRESH:
        return {"errors": 0, "skipped": "fetched recently"}
    return goalies_pass(conn, pace, now, log, fetch)


# ------------------------------------------------------------- line combos

def parse_lines(pp) -> list:
    c = pp.get("combinations") or {}
    out = []
    for p in c.get("players") or []:
        if p.get("playerId") is None or not p.get("groupIdentifier"):
            continue
        out.append(dict(
            league="nhl", dfo_team_id=c.get("teamId"), team_name=c.get("teamName"),
            group_id=p["groupIdentifier"], category=p.get("categoryIdentifier"),
            dfo_player_id=p["playerId"], name=p.get("name"), position_id=p.get("positionIdentifier"),
            injury_status=p.get("injuryStatus"), gtd=int(bool(p.get("gameTimeDecision"))),
            dfo_updated_at=c.get("updatedAt"), dfo_source=c.get("sourceName"),
            raw_json=js({k: v for k, v in p.items() if not any(
                x in k for x in ("Url", "url", "Color", "cap", "rating"))})))
    return out


LINE_FIELDS = ("position_id", "injury_status", "gtd", "category")


def lines_pass(conn, pace, log=print, fetch=None, today=None, slugs=None) -> dict:
    """Every NHL team's line combinations (one page each, in season)."""
    fetch = fetch or http_get
    if not _teams(conn, "nhl", today):
        return {"errors": 0, "skipped": "no NHL games in window"}
    st = {"errors": 0, "teams": 0}
    T, P = Teams(conn, "nhl"), Players(conn, "nhl")
    queue = list(slugs or ["winnipeg-jets"])
    done = set()
    while queue:
        slug = queue.pop(0)
        if slug in done:
            continue
        done.add(slug)
        try:
            pp = next_data(_get_page(conn, pace, f"{BASE}/teams/{slug}/line-combinations", fetch))
            if slugs is None and len(done) == 1:   # the first page lists every team
                queue += [t["slug"] for t in pp.get("sortedTeams") or [] if t.get("slug")]
            rows = parse_lines(pp)
            if not rows:
                raise ValueError("no lines parsed")
            at = _now()
            tid = T.by(rows[0]["team_name"])
            with Tx(conn):
                store_raw(conn, SRC, f"lines/{slug}", json.dumps(pp.get("combinations"), sort_keys=True)
                          .encode(), at, "application/json")
                if tid is None:
                    unmatched(conn, SRC, "nhl", "team", rows[0]["dfo_team_id"], rows[0]["team_name"], at=at)
                for r in rows:
                    r["team_id"] = tid
                    r["athlete_id"], _ = P.match(r["name"], tid)
                    if r["athlete_id"]:
                        st["matched"] = st.get("matched", 0) + 1
                        resolved(conn, SRC, "nhl", "player", r["dfo_player_id"], at)
                    else:
                        st["unmatched"] = st.get("unmatched", 0) + 1
                        unmatched(conn, SRC, "nhl", "player", r["dfo_player_id"], r["name"],
                                  r["team_name"], f"lines {r['group_id']}", at)
                _add(st, track(conn, "nhl_line_states", ("dfo_team_id", "group_id", "dfo_player_id"),
                               LINE_FIELDS, rows, {"dfo_team_id": rows[0]["dfo_team_id"]}, at))
            st["teams"] += 1
        except RobotsDisallowed:
            raise
        except Exception as e:
            st["errors"] += 1
            log(f"dfo lines {slug} ERROR {type(e).__name__}: {e}")
    return st


# ------------------------------------------------------------- player-model slate

SLATE_EVERY = timedelta(minutes=45)


def _seen(conn, table):
    try:
        raw = conn.execute(f"SELECT MAX(last_seen) FROM {table}").fetchone()[0]
    except Exception:
        return None
    if not raw:
        return None
    d = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _merge_counts(tot, part):
    for k, v in (part or {}).items():
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            tot[k] = v
        else:
            tot[k] = tot.get(k, 0) + v
    return tot


def slate_pass(conn, pace, now=None, log=print, fetch=None, force=False) -> dict:
    """Lines and starting goalies for the player model, on NHL game days.

    Each feed is skipped when its newest row is under 45 minutes old, so a
    half-hour cron still requests about once an hour. robots.txt is checked
    and pages stay GAP seconds apart. A failure is returned, not raised:
    the forecast keeps the no-lineup version.
    """
    fetch = fetch or http_get
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    dates = nhl_dates_today(conn, now)
    if not dates and not force:
        return {"errors": 0, "skipped": "no NHL games today"}
    fresh = now - SLATE_EVERY
    goalie_age, line_age = _seen(conn, "nhl_goalie_states"), _seen(conn, "nhl_line_states")
    need_g = force or goalie_age is None or goalie_age <= fresh
    need_l = force or line_age is None or line_age <= fresh
    if not need_g and not need_l:
        return {"errors": 0, "skipped": "fetched recently"}
    st = {"errors": 0}
    if need_g:
        try:
            _merge_counts(st, goalies_pass(conn, pace, now, log=log, fetch=fetch, force=True))
        except Exception as e:
            st["errors"] = st.get("errors", 0) + 1
            st["goalies_error"] = f"{type(e).__name__}: {e}"[:160]
            log(f"dfo slate goalies ERROR {type(e).__name__}: {e}")
            if isinstance(e, RobotsDisallowed):
                st["lines"] = "skipped: robots"
                return st
    else:
        st["goalies"] = "cached"
    if need_l:
        try:
            _merge_counts(st, lines_pass(conn, pace, log=log, fetch=fetch))
        except Exception as e:
            st["errors"] = st.get("errors", 0) + 1
            st["lines_error"] = f"{type(e).__name__}: {e}"[:160]
            log(f"dfo slate lines ERROR {type(e).__name__}: {e}")
    else:
        st["lines"] = "cached"
    return st
