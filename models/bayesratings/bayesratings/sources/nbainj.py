"""NBA official injury report (the PDFs official.nba.com links to on
ak-static.cms.nba.com; robots.txt allows /referee/injury/). Published every
15 minutes in season as Injury-Report_YYYY-MM-DD_HH_MMAM.pdf (US/Eastern);
until mid-2025-26 hourly as Injury-Report_YYYY-MM-DD_HHPM.pdf. We fetch the
latest one each run, parse game / team / player / status / reason and keep
change-only states, plus each report's extracted text (and the PDF itself
for the 5 PM ET report and anything that failed to parse)."""

import gzip
import hashlib
import io
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ..prelog import Tx, _now, track, _add
from .common import (Missing, Players, Teams, first_last, game_for, http_get, js, resolved,
                     robots_allowed, unmatched)

BASE = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_"
EASTERN = ZoneInfo("America/New_York")
SRC = "nbainj"
NYS = "(NOT YET SUBMITTED)"
COLS = ("game_date", "game_time", "matchup", "team", "player", "status", "reason")
_HEAD = {"Game": None, "Matchup": "matchup", "Team": "team", "Player": "player",
         "Current": "status", "Reason": "reason"}
_TITLE = re.compile(r"Injury Report:\s*(\d\d/\d\d/\d\d)\s+(\d\d:\d\d\s*[AP]M)")
STATUSES = ("Out", "Doubtful", "Questionable", "Probable", "Available")
# Historical archive: one file per day, the noon Eastern report when it
# exists (before a typical tip), else 11:00, 1:00 or 5:00.
ARCHIVE_TIMES = ((12, 0), (11, 0), (13, 0), (17, 0))
# First season the official PDF archive covers (end year: 2019 is 2018-19).
ARCHIVE_FIRST = 2019


def slot_urls(slot: datetime) -> list:
    """Both filename patterns for an Eastern report time."""
    d = slot.strftime("%Y-%m-%d")
    h12, ap = slot.strftime("%I"), slot.strftime("%p")
    urls = [f"{BASE}{d}_{h12}_{slot:%M}{ap}.pdf"]
    if slot.minute == 0:
        urls.append(f"{BASE}{d}_{h12}{ap}.pdf")
    return urls


def latest_slot(now: datetime) -> datetime:
    e = now.astimezone(EASTERN).replace(second=0, microsecond=0)
    return e.replace(minute=e.minute - e.minute % 15)


# ------------------------------------------------------------- PDF parsing

def pdf_lines(pdf_bytes) -> list:
    """[(page, top, [(x0, text), ...]), ...] words grouped into printed lines."""
    import pdfplumber                       # imported here: only this pass needs it
    out = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pno, page in enumerate(pdf.pages):
            lines = {}
            for w in page.extract_words(x_tolerance=1, keep_blank_chars=False):
                key = round(w["top"] / 2)   # same printed line within ~2pt
                lines.setdefault(key, []).append((w["x0"], w["top"], w["text"]))
            for key in sorted(lines):
                ws = sorted(lines[key])
                out.append((pno, min(t for _, t, _ in ws), [(x, t) for x, _, t in ws]))
    return out


def parse_report(pdf_bytes) -> dict:
    """{'title_ts': ET datetime or None, 'rows': [...], 'text': str}."""
    lines = pdf_lines(pdf_bytes)
    text = "\n".join(f"{p}\t{top:.0f}\t" + " ".join(f"{x:.0f}:{t}" for x, t in ws)
                     for p, top, ws in lines)
    title = None
    for _, _, ws in lines[:5]:
        m = _TITLE.search(" ".join(t for _, t in ws))
        if m:
            title = datetime.strptime(f"{m.group(1)} {m.group(2).replace(' ', '')}",
                                      "%m/%d/%y %I:%M%p").replace(tzinfo=EASTERN)
            break
    rows, carry = [], {}
    pages = {}
    for p, top, ws in lines:
        pages.setdefault(p, []).append((top, ws))
    order, head_top = None, None
    for p in sorted(pages):
        plines = pages[p]
        # column starts from the header line ("Game Date Game Time Matchup ...");
        # continuation pages print no header and reuse the last one
        head = next(((top, ws) for top, ws in plines if any(t == "Matchup" for _, t in ws)
                     and any(t == "Reason" for _, t in ws)), None)
        if head is not None:
            hx = [x for x, t in head[1]]
            ht = [t for x, t in head[1]]
            starts = {"game_date": hx[0]}
            for i, t in enumerate(ht):
                if t == "Game" and i > 0 and "game_time" not in starts and hx[i] > hx[0] + 10:
                    starts["game_time"] = hx[i]
                elif t in _HEAD and _HEAD[t] and _HEAD[t] not in starts:
                    starts[_HEAD[t]] = hx[i]
            if len(starts) < 7:
                raise ValueError(f"page {p}: header columns not found ({sorted(starts)})")
            order = sorted(starts.items(), key=lambda kv: kv[1])
            head_top = head[0]
        elif order is None:
            continue
        else:
            head_top = -1

        def col(x):
            c = order[0][0]
            for name, sx in order:
                if x >= sx - 3:
                    c = name
            return c

        body = []
        for top, ws in plines:
            if top <= head_top + 1:
                continue
            txt = " ".join(t for _, t in ws)
            if txt.startswith("Page ") or _TITLE.search(txt):
                continue
            cells = {}
            for x, t in ws:
                cells.setdefault(col(x), []).append(t)
            body.append((top, {k: " ".join(v) for k, v in cells.items()}))
        anchors = [i for i, (_, c) in enumerate(body)
                   if c.get("player") or (c.get("status") or c.get("reason") or "").startswith("NOT YET")]
        reason_bits = {i: [] for i in anchors}
        for i, (top, c) in enumerate(body):
            if i not in reason_bits and c.get("reason") and anchors:
                near = min(anchors, key=lambda a: (abs(body[a][0] - top), body[a][0] < top))
                reason_bits[near].append((top, c["reason"]))
        for i, (top, c) in enumerate(body):
            # date / time / matchup / team print once per block and carry down
            for k in ("game_date", "game_time", "matchup", "team"):
                if c.get(k):
                    carry[k] = c[k]
            if i not in reason_bits:
                continue
            parts = sorted(reason_bits[i] + ([(top, c["reason"])] if c.get("reason") else []))
            reason = " ".join(t for _, t in parts).strip()
            status = c.get("status")
            if (status or "").startswith("NOT YET") or reason.startswith("NOT YET"):
                player, status, reason = NYS, "NOT YET SUBMITTED", None
            else:
                player = c.get("player")
            rows.append(dict(game_date=carry.get("game_date"), game_time=carry.get("game_time"),
                             matchup=carry.get("matchup"), team=carry.get("team"),
                             player=player, status=status, reason=reason or None))
    return {"title_ts": title, "rows": rows, "text": text}


# ------------------------------------------------------------- storing

FIELDS = ("status", "reason", "matchup", "game_time")


def _iso_date(s):
    try:
        return datetime.strptime(s, "%m/%d/%Y").date().isoformat()
    except (TypeError, ValueError):
        return None


def store_report(conn, slot, url, pdf, parsed, fetched_at, backfill=False, keep_pdf=False,
                 players=None, link=True) -> dict:
    """One nba_injury_reports row + change-only nba_injury_states for the
    game dates the report covers. States use the report's own time.

    `link=False` leaves team, player and game ids empty. The historical
    file is loaded that way and linked on the main database afterwards.
    """
    T = Teams(conn, "nba") if link else None
    title = parsed["title_ts"] or slot
    seen = title.astimezone(timezone.utc).isoformat(timespec="seconds")
    st = {"reports": 1, "rows": 0}
    P = players if players is not None else (Players(conn, "nba", season=_season(title.date())) if link else None)
    rows = []
    for r in parsed["rows"]:
        gd = _iso_date(r["game_date"])
        if not gd or not r["team"] or not r["player"]:
            st["skipped_rows"] = st.get("skipped_rows", 0) + 1
            continue
        tid = T.by(r["team"]) if T else None
        name = None if r["player"] == NYS else first_last(r["player"])
        rows.append(dict(league="nba", game_date=gd, team_name=r["team"], player_key=r["player"],
                         team_id=tid, matchup=r["matchup"], game_time=r["game_time"],
                         player_name=name, status=r["status"], reason=r["reason"],
                         report_slot=slot.strftime("%Y-%m-%d %H:%M"), raw_json=js(r)))
    n_unm = 0
    with Tx(conn):
        games = {}
        if link:
            for r in rows:
                if r["team_id"] is None:
                    unmatched(conn, SRC, "nba", "team", r["team_name"], r["team_name"], at=fetched_at)
                    n_unm += 1
                    continue
                k = (r["game_date"], r["team_id"])
                if k not in games:
                    games[k] = _game(conn, r["game_date"], r["game_time"], r["team_id"])
                r["espn_event_id"] = games[k]
                if r["player_name"]:
                    r["athlete_id"], _ = _player(P, r["player_key"], r["team_id"])
                    if r["athlete_id"]:
                        st["matched"] = st.get("matched", 0) + 1
                        resolved(conn, SRC, "nba", "player", f"{r['team_id']}:{r['player_key']}", fetched_at)
                    else:
                        n_unm += 1
                        unmatched(conn, SRC, "nba", "player", f"{r['team_id']}:{r['player_key']}",
                                  r["player_name"], r["team_name"], f"report {r['report_slot']}", fetched_at)
            for k, eid in games.items():
                if eid is not None:
                    resolved(conn, SRC, "nba", "game", f"{k[0]}:{k[1]}", fetched_at)
                else:
                    unmatched(conn, SRC, "nba", "game", f"{k[0]}:{k[1]}", None, str(k[1]),
                              "no ESPN game for report row", fetched_at)
            st["unmatched_games"] = sum(1 for v in games.values() if v is None)
        for gd in sorted({r["game_date"] for r in rows}):
            _add(st, track(conn, "nba_injury_states", ("league", "game_date", "team_name", "player_key"),
                           FIELDS, [r for r in rows if r["game_date"] == gd],
                           {"league": "nba", "game_date": gd}, seen))
        text = parsed["text"].encode()
        conn.execute(
            "INSERT OR REPLACE INTO nba_injury_reports (report_slot, report_ts_utc, url, fetched_at, "
            "backfill, n_rows, n_unmatched, text_sha1, text_gz, pdf_gz) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (slot.strftime("%Y-%m-%d %H:%M"), seen, url, fetched_at, int(backfill), len(rows), n_unm,
             hashlib.sha1(text).hexdigest(), gzip.compress(text, mtime=0),
             gzip.compress(pdf, mtime=0) if keep_pdf else None))
    st["rows"] = len(rows)
    st["unmatched"] = n_unm
    return st


def _season(d: date) -> int:
    """NBA season label (end year): Oct 2026 -> 2027."""
    return d.year + 1 if d.month >= 8 else d.year


def _game(conn, gd, game_time, team_id):
    """ESPN event for a report row: the team's game whose start is nearest
    the printed ET tip time on that date. The report prints 12-hour times
    without AM/PM ('11:00 (ET)' is an 11 PM West Coast tip): try the PM
    reading first (NBA tips are afternoon/evening), then the AM one."""
    starts = []
    try:
        hm = datetime.strptime(f"{gd} {game_time.split()[0]}", "%Y-%m-%d %H:%M")
        pm = hm + timedelta(hours=12) if hm.hour < 12 else hm
        starts = [pm] + ([hm] if hm.hour < 12 else [])
        starts = [t.replace(tzinfo=EASTERN).astimezone(timezone.utc).isoformat() for t in starts]
    except (AttributeError, ValueError, IndexError):
        starts = [datetime.strptime(gd, "%Y-%m-%d").replace(hour=23, tzinfo=timezone.utc).isoformat()]
    for start in starts:
        eid = game_for(conn, "nba", [team_id], start, hours=8)
        if eid:
            return eid
    return None


def _player(P, player_key, team_id):
    """(athlete_id, method) for a printed 'Last, First' name: first as
    'First Last', then in the printed order without the comma, for names
    ESPN keeps family-name first ('Yang, Hansen' -> ESPN 'Yang Hansen')."""
    aid, how = P.match(first_last(player_key), team_id)
    if aid is None and "," in (player_key or ""):
        aid, how = P.match(player_key.replace(",", " "), team_id)
    return aid, how


def rematch(conn, log=print) -> dict:
    """Re-try the open unmatched report games and players against stored
    states with the current matching rules. Fills only NULL espn_event_id /
    athlete_id on nba_injury_states rows and marks the keys resolved; never
    deletes. Safe to re-run."""
    at = _now()
    st = {"games": 0, "games_resolved": 0, "players": 0, "players_resolved": 0}
    open_ = conn.execute("SELECT kind, ext_key FROM ext_unmatched WHERE source = ? AND league = 'nba' "
                         "AND resolved_at IS NULL AND kind IN ('game', 'player')", (SRC,)).fetchall()
    Ps = {}
    with Tx(conn):
        for kind, key in open_:
            if kind == "game":
                st["games"] += 1
                gd, _, tid = key.partition(":")
                r = conn.execute("SELECT game_time FROM nba_injury_states WHERE game_date = ? AND team_id = ? "
                                 "AND game_time IS NOT NULL LIMIT 1", (gd, int(tid))).fetchone()
                eid = _game(conn, gd, r[0] if r else None, int(tid))
                if eid:
                    conn.execute("UPDATE nba_injury_states SET espn_event_id = ? WHERE game_date = ? "
                                 "AND team_id = ? AND espn_event_id IS NULL", (eid, gd, int(tid)))
                    resolved(conn, SRC, "nba", "game", key, at)
                    st["games_resolved"] += 1
            else:
                st["players"] += 1
                tid, _, pkey = key.partition(":")
                rows = conn.execute("SELECT DISTINCT game_date FROM nba_injury_states WHERE team_id = ? "
                                    "AND player_key = ? AND athlete_id IS NULL", (int(tid), pkey)).fetchall()
                season = _season(date.fromisoformat(max(r[0] for r in rows))) if rows else None
                P = Ps.setdefault(season, Players(conn, "nba", season=season))
                aid, _ = _player(P, pkey, int(tid))
                if aid:
                    conn.execute("UPDATE nba_injury_states SET athlete_id = ? WHERE team_id = ? "
                                 "AND player_key = ? AND athlete_id IS NULL", (aid, int(tid), pkey))
                    resolved(conn, SRC, "nba", "player", key, at)
                    st["players_resolved"] += 1
    log(f"nbainj rematch: {st}")
    return st


# ------------------------------------------------------------- passes

def nba_days(conn, now) -> bool:
    """NBA regular/postseason games today or tomorrow (CT)."""
    from .. import espn
    today = now.astimezone(espn.CENTRAL).date()
    return conn.execute(
        "SELECT 1 FROM games WHERE league = 'nba' AND season_type IN (2, 3) AND game_date BETWEEN ? AND ? "
        "LIMIT 1", (today.isoformat(), (today + timedelta(days=1)).isoformat())).fetchone() is not None


def fetch_slot(conn, pace, slot, fetch):
    """(url, bytes) of the first pattern that exists for this slot, or None."""
    for url in slot_urls(slot):
        if not robots_allowed(conn, url, pace, fetch):
            raise RuntimeError(f"robots.txt disallows {url}")
        try:
            return url, pace(fetch, url, accept="application/pdf")
        except Missing:
            continue
    return None


def report_pass(conn, pace, now=None, log=print, fetch=None, force=False, lookback=2) -> dict:
    """Fetch the newest published report not yet stored (this slot, else up
    to `lookback` earlier slots)."""
    fetch = fetch or http_get
    now = now or datetime.now(timezone.utc)
    if not force and not nba_days(conn, now):
        return {"errors": 0, "skipped": "no NBA games today/tomorrow"}
    slot = latest_slot(now)
    for back in range(lookback + 1):
        s = slot - timedelta(minutes=15 * back)
        key = s.strftime("%Y-%m-%d %H:%M")
        if conn.execute("SELECT 1 FROM nba_injury_reports WHERE report_slot = ?", (key,)).fetchone():
            return {"errors": 0, "skipped": f"already have {key}"}
        got = fetch_slot(conn, pace, s, fetch)
        if got is None:
            continue
        url, pdf = got
        at = now.isoformat(timespec="seconds")
        try:
            parsed = parse_report(pdf)
            prev = conn.execute("SELECT text_sha1 FROM nba_injury_reports ORDER BY report_slot DESC "
                                "LIMIT 1").fetchone()
            keep = s.strftime("%H:%M") == "17:00" or not parsed["rows"]
            st = store_report(conn, s, url, pdf, parsed, at, keep_pdf=keep)
            st["unchanged_text"] = int(bool(prev) and prev[0] == hashlib.sha1(parsed["text"].encode()).hexdigest())
        except Exception as e:
            # keep the PDF so the parser can be fixed and the report replayed
            with Tx(conn):
                conn.execute("INSERT OR REPLACE INTO nba_injury_reports (report_slot, url, fetched_at, "
                             "n_rows, pdf_gz) VALUES (?,?,?,0,?)", (key, url, at, gzip.compress(pdf, mtime=0)))
            log(f"nba injury report {key} PARSE ERROR {type(e).__name__}: {e}")
            return {"errors": 1, "parse_error": key}
        return dict(st, errors=0, slot=key)
    return {"errors": 0, "missing": slot.strftime("%Y-%m-%d %H:%M")}


def backfill(conn, pace, start: date, end: date, log=print, fetch=None,
             times=((17, 0), (17, 30), (18, 0))) -> dict:
    """One report per NBA game day (5 PM ET, else 5:30 / 6 PM) between start
    and end; days without regular/postseason games are skipped. Re-runnable:
    days already stored are skipped."""
    fetch = fetch or http_get
    st = {"errors": 0, "days": 0, "missing": 0}
    days = [r[0] for r in conn.execute(
        "SELECT DISTINCT game_date FROM games WHERE league = 'nba' AND season_type IN (2, 3) "
        "AND game_date BETWEEN ? AND ? ORDER BY game_date", (start.isoformat(), end.isoformat()))]
    P_by_season = {}
    for d in days:
        dd = date.fromisoformat(d)
        if conn.execute("SELECT 1 FROM nba_injury_reports WHERE substr(report_slot, 1, 10) = ? LIMIT 1",
                        (d,)).fetchone():
            continue
        got = None
        for hh, mm in times:
            slot = datetime(dd.year, dd.month, dd.day, hh, mm, tzinfo=EASTERN)
            got = fetch_slot(conn, pace, slot, fetch)
            if got:
                break
        if not got:
            st["missing"] += 1
            continue
        url, pdf = got
        try:
            parsed = parse_report(pdf)
            season = _season(dd)
            P = P_by_season.setdefault(season, Players(conn, "nba", season=season))
            _add(st, store_report(conn, slot, url, pdf, parsed, _now(), backfill=True,
                                  keep_pdf=not parsed["rows"], players=P))
            st["days"] += 1
        except Exception as e:
            st["errors"] += 1
            log(f"nba injury backfill {d} ERROR {type(e).__name__}: {e}")
    return st


def report_stored(conn, day) -> bool:
    """True when any report for this calendar date is already stored."""
    return conn.execute(
        "SELECT 1 FROM nba_injury_reports WHERE substr(report_slot, 1, 10) = ? LIMIT 1",
        (str(day)[:10],)).fetchone() is not None


def season_span(season: int):
    """(first, last) calendar dates of an NBA end-year season.

    2020 runs through the bubble in October. 2021 starts in December.
    """
    season = int(season)
    if season == 2020:
        return date(2019, 10, 1), date(2020, 10, 12)
    if season == 2021:
        return date(2020, 12, 1), date(2021, 7, 22)
    return date(season - 1, 10, 1), date(season, 7, 22)


def link_states(conn) -> dict:
    """Fill empty team, player and game ids on nba_injury_states.

    Safe to run again: a row that already has an id is left as stored.
    """
    T = Teams(conn, "nba")
    st = {"teams": 0, "players": 0, "games": 0}
    rows = conn.execute(
        "SELECT id, game_date, game_time, team_name, team_id, player_key, "
        "athlete_id, espn_event_id FROM nba_injury_states "
        "WHERE team_id IS NULL OR espn_event_id IS NULL "
        "OR (athlete_id IS NULL AND player_key != ?)", (NYS,)).fetchall()
    Ps, games = {}, {}
    with Tx(conn):
        for r in rows:
            tid = r["team_id"]
            if tid is None:
                tid = T.by(r["team_name"])
                if tid:
                    conn.execute("UPDATE nba_injury_states SET team_id = ? WHERE id = ?",
                                 (tid, r["id"]))
                    st["teams"] += 1
            if r["athlete_id"] is None and r["player_key"] != NYS and tid:
                try:
                    season = _season(date.fromisoformat(r["game_date"]))
                except ValueError:
                    season = None
                P = Ps.setdefault(season, Players(conn, "nba", season=season))
                aid, _how = _player(P, r["player_key"], tid)
                if aid:
                    conn.execute("UPDATE nba_injury_states SET athlete_id = ? WHERE id = ?",
                                 (aid, r["id"]))
                    st["players"] += 1
            if r["espn_event_id"] is None and tid:
                key = (r["game_date"], tid, r["game_time"])
                if key not in games:
                    games[key] = _game(conn, r["game_date"], r["game_time"], tid)
                if games[key]:
                    conn.execute("UPDATE nba_injury_states SET espn_event_id = ? WHERE id = ?",
                                 (games[key], r["id"]))
                    st["games"] += 1
    return st
