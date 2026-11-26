"""Shared plumbing for the gap sources: polite HTTP, robots.txt, raw payload
storage, ESPN id mapping and the unmatched log."""

import gzip
import hashlib
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timedelta, timezone

from ..config import user_agent
from ..prelog import Tx, _now

# Some hosts stall a User-Agent that contains a URL, so the default does not.
ROBOTS_TTL = timedelta(hours=24)


class Missing(Exception):
    """The resource isn't there (403/404): an expected outcome for files
    published on a schedule, not an error."""


class RobotsDisallowed(Exception):
    pass


def http_get(url, accept="*/*", timeout=30, retries=3, headers=None) -> bytes:
    """GET bytes with a polite User-Agent and backoff on 429/5xx. Raises
    Missing for 403/404 (a not-yet-published file), HTTPError otherwise."""
    h = {"User-Agent": user_agent(), "Accept": accept, "Accept-Encoding": "gzip"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise Missing(f"{e.code} {url}") from None
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            raise
    raise RuntimeError(f"unreachable retry loop for {url}")


def get_json(url, params=None, accept="application/json", **kw):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(
            {k: v for k, v in params.items() if v is not None})
    return json.loads(http_get(url, accept=accept, **kw).decode())


# ------------------------------------------------------------- robots.txt

def robots_allowed(conn, url, pace, fetch=None) -> bool:
    """robots.txt check, cached a day per host in src_meta. RFC 9309: a 4xx
    robots.txt means no rules; an unreachable / 5xx one means stay out."""
    fetch = fetch or http_get
    p = urllib.parse.urlsplit(url)
    host = f"{p.scheme}://{p.netloc}"
    key = f"robots:{host}"
    row = conn.execute("SELECT value, updated_at FROM src_meta WHERE key = ?", (key,)).fetchone()
    text = None
    if row and _utc(row[1]) > datetime.now(timezone.utc) - ROBOTS_TTL:
        text = row[0]
    else:
        try:
            text = pace(fetch, host + "/robots.txt").decode("utf-8", "replace")
        except Missing:
            text = ""                                   # no robots.txt: no rules
        except Exception:
            if row:
                text = row[0]                           # keep yesterday's rules
            else:
                return False
        with Tx(conn):
            conn.execute("INSERT OR REPLACE INTO src_meta (key, value, updated_at) VALUES (?,?,?)",
                         (key, text, _now()))
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    return rp.can_fetch(user_agent(), url)


def _utc(s):
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


# ------------------------------------------------------------- raw storage

def store_raw(conn, source, key, body: bytes, fetched_at, content_type=None) -> bool:
    """Keep the payload when it differs from the last one stored for
    (source, key); otherwise just move last_seen. Returns True when new.
    Call inside a transaction."""
    h = hashlib.sha1(body).hexdigest()
    last = conn.execute("SELECT id, content_hash FROM src_raw WHERE source = ? AND raw_key = ? "
                        "ORDER BY fetched_at DESC, id DESC LIMIT 1", (source, key)).fetchone()
    if last and last[1] == h:
        conn.execute("UPDATE src_raw SET last_seen = ? WHERE id = ?", (fetched_at, last[0]))
        return False
    conn.execute("INSERT INTO src_raw (source, raw_key, content_hash, fetched_at, last_seen, "
                 "content_type, n_bytes, body_gz) VALUES (?,?,?,?,?,?,?,?)",
                 (source, key, h, fetched_at, fetched_at, content_type, len(body),
                  gzip.compress(body, mtime=0)))
    return True


# ------------------------------------------------------------- names

_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")


def norm_name(s) -> str:
    """'Moore Jr., Wendell' and 'Wendell Moore Jr.' -> 'wendell moore';
    accents, punctuation and suffixes dropped."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    if "," in s:                                  # 'Last, First' -> 'First Last'
        last, _, first = s.partition(",")
        s = f"{first} {last}"
    s = re.sub(r"[.'`\-]", " ", s)
    s = _SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def first_last(s) -> str:
    """'Moore Jr., Wendell' -> 'Wendell Moore Jr.'"""
    if s and "," in s:
        last, _, first = s.partition(",")
        return f"{first.strip()} {last.strip()}".strip()
    return (s or "").strip()


def norm_team(s) -> str:
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", str(s or ""))
                  .encode("ascii", "ignore").decode().lower()).strip()


class Teams:
    """Our teams for one league: by ESPN id, normalized name and abbreviation."""

    def __init__(self, conn, league):
        self.by_name, self.by_abbr, self.by_espn = {}, {}, {}
        for r in conn.execute("SELECT team_id, espn_id, name, abbreviation, location FROM teams "
                              "WHERE league = ?", (league,)):
            self.by_espn[r[1]] = r[0]
            if r[2]:
                self.by_name[norm_team(r[2])] = r[0]
            if r[3]:
                self.by_abbr[r[3].upper()] = r[0]

    def by(self, name=None, abbr=None):
        if name and norm_team(name) in self.by_name:
            return self.by_name[norm_team(name)]
        if abbr and abbr.upper() in self.by_abbr:
            return self.by_abbr[abbr.upper()]
        return None


class Players:
    """Name + team -> ESPN athlete id, from the current ESPN rosters
    (roster_states), then box-score history (players, player_team_seasons),
    then a league-wide unique name."""

    def __init__(self, conn, league, season=None):
        self.team, self.box, self.league_wide = {}, {}, {}
        for tid, aid, name in conn.execute(
                "SELECT team_id, athlete_id, name FROM roster_states WHERE league = ? "
                "AND valid_to IS NULL", (league,)):
            self.team[(tid, norm_name(name))] = aid
        q = ("SELECT s.team_id, p.athlete_id, p.name FROM player_team_seasons s JOIN players p "
             "USING (league, athlete_id) WHERE s.league = ?")
        args = [league]
        if season:
            q += " AND s.season >= ?"
            args.append(season - 1)
        for tid, aid, name in conn.execute(q, args):
            self.box.setdefault((tid, norm_name(name)), aid)
        for aid, name in conn.execute("SELECT athlete_id, name FROM players WHERE league = ?", (league,)):
            self.league_wide.setdefault(norm_name(name), set()).add(aid)
        for (tid, nm), aid in self.team.items():
            self.league_wide.setdefault(nm, set()).add(aid)

    def match(self, name, team_id):
        n = norm_name(name)
        if not n:
            return None, None
        if team_id is not None and (team_id, n) in self.team:
            return self.team[(team_id, n)], "name_team"
        if team_id is not None and (team_id, n) in self.box:
            return self.box[(team_id, n)], "name_box"
        ids = self.league_wide.get(n) or set()
        if len(ids) == 1:
            return next(iter(ids)), "name_league"
        return None, None


# ------------------------------------------------------------- id map + unmatched

def save_id(conn, source, league, kind, ext_id, espn_id, method, name=None, team_id=None, at=None):
    at = at or _now()
    conn.execute(
        "INSERT INTO ext_ids (source, league, kind, ext_id, espn_id, team_id, name, method, "
        "first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT (source, league, kind, ext_id) DO UPDATE SET espn_id = excluded.espn_id, "
        "team_id = COALESCE(excluded.team_id, team_id), name = COALESCE(excluded.name, name), "
        "method = excluded.method, last_seen = excluded.last_seen",
        (source, league, kind, str(ext_id), espn_id, team_id, name, method, at, at))


def get_ids(conn, source, league, kind) -> dict:
    return {r[0]: (r[1], r[2], r[3]) for r in conn.execute(
        "SELECT ext_id, espn_id, method, last_seen FROM ext_ids WHERE source = ? AND league = ? "
        "AND kind = ?", (source, league, kind))}


def unmatched(conn, source, league, kind, ext_key, name=None, team=None, context=None, at=None):
    """Record (or bump) something we could not map. Call inside a transaction."""
    at = at or _now()
    conn.execute(
        "INSERT INTO ext_unmatched (source, league, kind, ext_key, name, team, context, "
        "first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT (source, league, kind, ext_key) DO UPDATE SET last_seen = excluded.last_seen, "
        "n_seen = n_seen + 1, resolved_at = NULL, context = COALESCE(excluded.context, context)",
        (source, league, kind, str(ext_key), name, team, context, at, at))


def resolved(conn, source, league, kind, ext_key, at=None):
    conn.execute("UPDATE ext_unmatched SET resolved_at = ? WHERE source = ? AND league = ? "
                 "AND kind = ? AND ext_key = ? AND resolved_at IS NULL",
                 (at or _now(), source, league, kind, str(ext_key)))


def game_for(conn, league, team_ids, start_utc, hours=8, home=None):
    """ESPN event id of the game involving these teams whose start is
    nearest start_utc (within `hours`)."""
    want = {t for t in team_ids if t is not None}
    if not want:
        return None
    st = _utc(start_utc)
    lo = (st - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M")
    hi = (st + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%MZ")
    best = None
    for eid, s, h, a in conn.execute(
            "SELECT espn_event_id, start_time_utc, home_team_id, away_team_id FROM games "
            "WHERE league = ? AND start_time_utc BETWEEN ? AND ?", (league, lo, hi)):
        if not want <= {h, a}:
            continue
        if home is not None and h != home:
            continue
        d = abs((_utc(s) - st).total_seconds())
        if best is None or d < best[0]:
            best = (d, eid)
    return best[1] if best else None


def js(x) -> str:
    return json.dumps(x, separators=(",", ":"), sort_keys=True, default=str)
