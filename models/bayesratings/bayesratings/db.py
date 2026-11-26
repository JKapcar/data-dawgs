# SQLite storage layer for bayesRatings.
#
# One file on disk, stdlib sqlite3, no server. The daily pipeline is the only
# writer; the model and site read. Keeps the model pure — it takes/returns
# DataFrames; this module is the only thing that knows SQL.

import fcntl
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import pandas as pd

SCHEMA_FILE = Path(__file__).resolve().parent / "schema.sql"

# leagues we cover; team keys the model sees are stable (our team_id as string)
LEAGUES = ("mlb", "nfl", "nba", "nhl")

# team display columns updated on re-ingest (id fields are the join keys)
_TEAM_DISPLAY_COLS = ("location", "name", "abbreviation", "color",
                      "alternate_color", "logo")


def connect(path) -> sqlite3.Connection:
    """Open (creating if needed) the SQLite DB with sane pragmas."""
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")  # replay runs leagues in parallel
    return conn


# The flock file lives in BAYESRATINGS_LOCK_DIR (default: the repo data/
# directory). Resolved on first use, never at import.
_LOCK = threading.RLock()
_LOCK_LOCAL = threading.local()
_TXN_DEPTH = threading.local()


def _repo_data_dir() -> str:
    return str(Path(__file__).resolve().parent.parent / "data")


def _under_tmp(raw: str) -> bool:
    path = os.path.normpath(raw or "")
    return path == "/tmp" or path.startswith("/tmp" + os.sep)


def _prepare_dir(raw: str) -> bool:
    """mkdir 0775 and report whether this process can write there."""
    try:
        os.makedirs(raw, mode=0o775, exist_ok=True)
    except OSError:
        return False
    try:
        os.chmod(raw, 0o775)
    except OSError:
        pass
    return os.access(raw, os.W_OK)


def resolve_lock_dir() -> str:
    """Directory for the flock file.

    ``BAYESRATINGS_LOCK_DIR`` when it can be created, otherwise the repo
    ``data/`` directory. Never raises.
    """
    from .config import lock_dir
    raw = lock_dir()
    if raw and not _under_tmp(raw) and _prepare_dir(raw):
        return raw
    data = _repo_data_dir()
    _prepare_dir(data)
    return data


def resolve_lock_path() -> str:
    """The flock file. ``BAYESRATINGS_LOCK`` overrides the whole path.

    Does not raise. A parent directory that cannot be created still
    returns the requested path.
    """
    env = os.environ.get("BAYESRATINGS_LOCK")
    if env:
        parent = os.path.dirname(env)
        if parent:
            try:
                os.makedirs(parent, mode=0o775, exist_ok=True)
            except OSError:
                pass
        return env
    return os.path.join(resolve_lock_dir(), "write.lock")


def _active_lock_path() -> str:
    """The path writer_lock uses. A test may assign ``LOCK_PATH``."""
    assigned = globals().get("LOCK_PATH")
    if isinstance(assigned, str) and assigned:
        return assigned
    return resolve_lock_path()


def __getattr__(name):
    if name == "LOCK_PATH":
        return resolve_lock_path()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _flock_wait(fd, timeout):
    if timeout is None:
        fcntl.flock(fd, fcntl.LOCK_EX)
        return
    deadline = time.monotonic() + timeout
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"write lock busy: waited {timeout}s")
            time.sleep(0.02)


@contextmanager
def writer_lock(timeout=60, path=None):
    """Exclusive lock shared by refresh, prelog, and the daily job.

    Hold it around the SQLite write only. Fetch HTTP outside this block.
    The same thread can enter again (a write helper called from another)
    without locking a second time. ``timeout`` None waits until it is free.
    """
    depth = getattr(_LOCK_LOCAL, "depth", 0)
    if depth:
        _LOCK_LOCAL.depth = depth + 1
        try:
            yield
        finally:
            _LOCK_LOCAL.depth = depth
        return
    lock_path = path or _active_lock_path()
    got = _LOCK.acquire() if timeout is None else _LOCK.acquire(timeout=timeout)
    if not got:
        raise TimeoutError(f"write lock busy: waited {timeout}s")
    fd = None
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o664)
        _flock_wait(fd, timeout)
        _LOCK_LOCAL.depth = 1
        try:
            yield
        finally:
            _LOCK_LOCAL.depth = 0
    finally:
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)
        _LOCK.release()


def _txn_depths():
    depths = getattr(_TXN_DEPTH, "by_conn", None)
    if depths is None:
        depths = {}
        _TXN_DEPTH.by_conn = depths
    return depths


def _finish_open_txn(conn):
    """Commit a transaction this call did not start, so BEGIN can run.

    ``_migrate`` can leave one open (the Central game_date update). A
    commit that fails is rolled back; either way the connection is idle
    before ``BEGIN IMMEDIATE``.
    """
    try:
        if conn.in_transaction:
            conn.commit()
    except sqlite3.OperationalError:
        try:
            conn.rollback()
        except sqlite3.OperationalError:
            pass
    try:
        conn.commit()
    except sqlite3.OperationalError:
        pass
    if conn.in_transaction:
        conn.rollback()


@contextmanager
def immediate(conn, timeout=60):
    """``writer_lock``, then one short ``BEGIN IMMEDIATE``.

    Commits on the way out and rolls back on an exception. Do not fetch
    HTTP inside the block: the write lock is held until it ends.

    A nested call on the same connection, while this one is open, does
    not lock again and does not ``BEGIN`` again. The outer call commits
    or rolls back. Safe when ``isolation_level`` is None (autocommit),
    where ``with conn`` would commit each statement on its own.

    A connection that is already inside a transaction (a plain ``BEGIN``)
    is joined: the write lock is taken, and this call does not commit or
    roll that transaction back. The caller that opened it still owns it.
    """
    depths = _txn_depths()
    key = id(conn)
    if depths.get(key, 0):
        depths[key] += 1
        try:
            yield conn
        finally:
            depths[key] -= 1
        return
    with writer_lock(timeout=timeout):
        joined = bool(conn.in_transaction)
        if not joined:
            _finish_open_txn(conn)
            conn.execute("BEGIN IMMEDIATE")
        depths[key] = 1
        try:
            try:
                yield conn
            except BaseException:
                if not joined and conn.in_transaction:
                    conn.rollback()
                raise
            else:
                if not joined and conn.in_transaction:
                    conn.commit()
        finally:
            depths[key] = 0


def init_db(conn: sqlite3.Connection) -> None:
    """Apply the schema and reload the static venue coordinates.

    Idempotent. `bayesratings/data/venues.csv` is reference data, so a
    later `init` picks up a new building. The write lock is held for the
    migrate and the venue load.
    """
    with writer_lock():
        conn.executescript(SCHEMA_FILE.read_text())
        _migrate(conn)
        _finish_open_txn(conn)
        from .travel import load_coords
        load_coords(conn)


# starter adjustment audit (bayesratings/starters.py); NULL on older rows
_STARTER_AUDIT = {"home_starter_id": "INTEGER", "away_starter_id": "INTEGER",
                  "home_starter_src": "TEXT", "away_starter_src": "TEXT",
                  "home_starter_rel": "REAL", "away_starter_rel": "REAL",
                  "home_prob_base": "REAL", "total_pred_base": "REAL",
                  "starter_coef": "REAL"}

# win-chance stack audit (bayesratings/bayes_elo.py); NULL on older rows
_STACK_AUDIT = {"p_logit": "REAL", "p_elo": "REAL", "elo_weight": "REAL",
                "model_version": "TEXT"}

# NBA player ridge audit (bayesratings/nba_player.py); NULL on older rows and other leagues
_NBA_RIDGE_AUDIT = {"nba_model_src": "TEXT", "nba_ridge_prob": "REAL",
                    "nba_team_prob": "REAL", "nba_ridge_fit_id": "INTEGER",
                    "nba_inputs": "TEXT"}

# NHL player ridge audit (bayesratings/nhl_player.py); NULL on older rows and other leagues
_NHL_RIDGE_AUDIT = {"nhl_model_src": "TEXT", "nhl_ridge_prob": "REAL",
                    "nhl_team_prob": "REAL", "nhl_ridge_fit_id": "INTEGER",
                    "nhl_inputs": "TEXT"}

# NFL quarterback ridge audit (bayesratings/nfl_player.py); NULL on older rows and other leagues
_NFL_RIDGE_AUDIT = {"nfl_model_src": "TEXT", "nfl_ridge_prob": "REAL",
                    "nfl_team_prob": "REAL", "nfl_ridge_fit_id": "INTEGER",
                    "nfl_inputs": "TEXT"}

# MLB player stack audit (bayesratings/mlb_player.py); NULL on older rows and other leagues
_MLB_RIDGE_AUDIT = {"mlb_model_src": "TEXT", "mlb_ridge_prob": "REAL",
                    "mlb_team_prob": "REAL", "mlb_ridge_fit_id": "INTEGER",
                    "mlb_inputs": "TEXT"}

# player-level adjustment audit (bayesratings/player_adj.py); NULL on older rows
_PLAYER_AUDIT = {"home_player_x": "REAL", "away_player_x": "REAL",
                 "home_player_x2": "REAL", "away_player_x2": "REAL",
                 "home_player_id": "INTEGER", "away_player_id": "INTEGER",
                 "home_player_src": "TEXT", "away_player_src": "TEXT",
                 "player_prob_base": "REAL", "player_spread_base": "REAL",
                 "player_total_base": "REAL", "player_home_total_base": "REAL",
                 "player_away_total_base": "REAL", "player_inputs": "TEXT"}

# columns added after the first schema; CREATE IF NOT EXISTS won't add them to
# an existing DB file, so add any that are missing
_ADDED_COLUMNS = {
    "games": {"ending": "TEXT", "covid_2020": "INTEGER NOT NULL DEFAULT 0",
              "notes": "TEXT", "if_necessary": "INTEGER NOT NULL DEFAULT 0",
              "series_summary": "TEXT",
              "series_completed": "INTEGER NOT NULL DEFAULT 0",
              "venue_city": "TEXT", "venue_state": "TEXT", "venue_country": "TEXT"},
    "teams": {"franchise_team_id": "INTEGER REFERENCES teams (team_id)"},
    "rating_snapshots": {"backfilled": "INTEGER NOT NULL DEFAULT 0"},
    "forecast_snapshots": {"backfilled": "INTEGER NOT NULL DEFAULT 0",
                           **_STARTER_AUDIT, **_PLAYER_AUDIT, **_STACK_AUDIT,
                           **_NBA_RIDGE_AUDIT, **_NHL_RIDGE_AUDIT, **_NFL_RIDGE_AUDIT,
                           **_MLB_RIDGE_AUDIT},
    "upcoming_forecasts": {**_STARTER_AUDIT, **_PLAYER_AUDIT, **_STACK_AUDIT,
                           **_NBA_RIDGE_AUDIT, **_NHL_RIDGE_AUDIT, **_NFL_RIDGE_AUDIT,
                           **_MLB_RIDGE_AUDIT},
    # raw MLB Stats API "espn" xref, kept even when it isn't an ESPN athlete id
    "ext_ids": {"xref_id": "INTEGER"},
    # in-sample publish check (mlb_player.py). NULL on a fit stored before it.
    "mlb_ridge_fits": {"sd_p": "REAL", "sd_team": "REAL",
                       "mean_p": "REAL", "win_rate": "REAL"},
}


def _migrate(conn: sqlite3.Connection) -> None:
    for table, cols in _ADDED_COLUMNS.items():
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for col, decl in cols.items():
            if col not in have:
                try:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
                except sqlite3.OperationalError as e:
                    # another process (parallel replay) added it first
                    if "duplicate column" not in str(e):
                        raise
    # one team's history, and one event's forecast
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rating_snap_team ON "
                 "rating_snapshots (league, team_id, snapshot_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_forecast_snap_event ON "
                 "forecast_snapshots (espn_event_id)")
    # Lookups by athlete. These tables were indexed by team,
    # date, or the source's own person id.
    for sql in (
            "CREATE INDEX IF NOT EXISTS idx_mlb_roster_athlete ON mlb_roster_states (athlete_id, valid_to)",
            "CREATE INDEX IF NOT EXISTS idx_mlb_tx_athlete ON mlb_transactions (athlete_id, txn_date)",
            "CREATE INDEX IF NOT EXISTS idx_nba_inj_athlete ON nba_injury_states (athlete_id, game_date)",
            "CREATE INDEX IF NOT EXISTS idx_nfl_injrep_athlete ON nfl_injury_report_states (athlete_id, season, week)",
            "CREATE INDEX IF NOT EXISTS idx_nfl_depth_athlete ON nfl_depth_states (athlete_id, valid_to)",
            "CREATE INDEX IF NOT EXISTS idx_nhl_line_athlete ON nhl_line_states (athlete_id, valid_to)"):
        try:
            conn.execute(sql)
        except sqlite3.OperationalError:
            pass
    if conn.execute("PRAGMA user_version").fetchone()[0] < 1:
        _central_game_dates(conn)       # one-time: Eastern -> Central game_date
        conn.execute("PRAGMA user_version = 1")


def _central_game_dates(conn: sqlite3.Connection) -> int:
    """game_date used to be the US/Eastern date; it is now America/Chicago
    (America/Chicago). Only starts between 04:00 and 06:59 UTC (11pm-1am
    Central) can differ, so only those rows are checked. Idempotent."""
    from .espn import central_date
    fix = [(central_date(r[1]), r[0]) for r in conn.execute(
        "SELECT game_id, start_time_utc, game_date FROM games "
        "WHERE substr(start_time_utc, 12, 2) IN ('04', '05', '06')")
        if central_date(r[1]) != r[2]]
    if fix:
        conn.executemany("UPDATE games SET game_date = ? WHERE game_id = ?", fix)
    return len(fix)


# Games that are not going to be played as listed: never forecast, never shown
# on a slate. STATUS_REMOVED is ours: ESPN stopped listing the event (an "if
# necessary" playoff game after a clinch, or a dropped fixture). Rows are kept.
REMOVED = "STATUS_REMOVED"
HIDDEN_STATUSES = ("STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_CANCELLED",
                   "STATUS_SUSPENDED", "STATUS_FORFEIT", REMOVED)
HIDDEN_SQL = ", ".join(f"'{s}'" for s in HIDDEN_STATUSES)   # constants, safe to inline


def playable_sql(alias: str = "") -> str:
    """SQL condition (no leading AND): the game is not hidden by its status."""
    p = f"{alias}." if alias else ""
    return f"COALESCE({p}status, '') NOT IN ({HIDDEN_SQL})"


# Pandemic-affected seasons (season labels per league convention): shortened
# MLB, bubble NBA/NHL finishes and 2020-21 limited crowds, empty NFL stands.
COVID_SEASONS = {"mlb": {2020}, "nfl": {2020}, "nba": {2020, 2021},
                 "nhl": {2020, 2021}}

# Relocations where ESPN issued a new team id: old espn_id -> successor
# espn_id. The old team keeps its own row; franchise_team_id links it.
FRANCHISE_SUCCESSORS = {"nhl": {24: 129764}}   # Arizona Coyotes -> Utah


def upsert_teams(conn: sqlite3.Connection, league: str, teams: list) -> dict:
    """Insert/update teams for a league. `teams` is a list of dicts with
    `espn_id` plus any display columns. Returns {espn_id: team_id}."""
    # COALESCE so a partial payload (the scoreboard lacks location/alternate
    # color) never nulls out fuller data a /teams fetch already populated
    set_clause = ", ".join(f"{c} = COALESCE(excluded.{c}, teams.{c})"
                           for c in _TEAM_DISPLAY_COLS)
    cols = ("league", "espn_id", *_TEAM_DISPLAY_COLS)
    placeholders = ", ".join("?" for _ in cols)
    sql = (f"INSERT INTO teams ({', '.join(cols)}) VALUES ({placeholders}) "
           f"ON CONFLICT (league, espn_id) DO UPDATE SET {set_clause}")
    rows = [(league, t["espn_id"], *(t.get(c) for c in _TEAM_DISPLAY_COLS))
            for t in teams]
    with immediate(conn):
        conn.executemany(sql, rows)
    return team_id_map(conn, league)


def link_franchises(conn: sqlite3.Connection, league: str) -> None:
    """Set franchise_team_id for known relocations with new ESPN ids."""
    ids = team_id_map(conn, league)
    with immediate(conn):
        for old, new in FRANCHISE_SUCCESSORS.get(league, {}).items():
            if old in ids and new in ids:
                conn.execute("UPDATE teams SET franchise_team_id = ? "
                             "WHERE team_id = ?", (ids[new], ids[old]))


def team_id_map(conn: sqlite3.Connection, league: str) -> dict:
    cur = conn.execute("SELECT espn_id, team_id FROM teams WHERE league = ?",
                       (league,))
    return {r["espn_id"]: r["team_id"] for r in cur.fetchall()}


def upsert_games(conn: sqlite3.Connection, rows: list) -> int:
    """Insert/update games. Each row is a dict with all games columns except
    game_id. Upserts on espn_event_id — results/status fill in on re-scrape."""
    if not rows:
        return 0
    cols = ("espn_event_id", "league", "season", "season_type",
            "start_time_utc", "game_date", "home_team_id", "away_team_id",
            "home_score", "away_score", "completed", "status", "venue",
            "neutral_site", "ending", "covid_2020", "notes", "if_necessary",
            "series_summary", "series_completed",
            "venue_city", "venue_state", "venue_country")
    update_cols = cols[2:6] + cols[8:]   # everything but the keys and teams
    set_clause = ", ".join(f"{c} = excluded.{c}" for c in update_cols)
    # Teams change only on a game not yet played: ESPN lists a playoff game
    # with a placeholder ("Rays/Guardians") until the series that feeds it ends.
    # Uses the stored row's completed flag, so finished games never change teams.
    set_clause += "".join(
        f", {c} = CASE WHEN games.completed = 0 THEN excluded.{c} ELSE games.{c} END"
        for c in ("home_team_id", "away_team_id"))
    placeholders = ", ".join("?" for _ in cols)
    sql = (f"INSERT INTO games ({', '.join(cols)}) VALUES ({placeholders}) "
           f"ON CONFLICT (espn_event_id) DO UPDATE SET {set_clause}")
    with immediate(conn):
        conn.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])
    return len(rows)


def ingest_scoreboard(conn: sqlite3.Connection, league: str, parsed: dict) -> int:
    """Write a parsed scoreboard's games into the games table, resolving teams
    against the CANONICAL teams table (which must be seeded first from the
    /teams endpoint — see upsert_teams). Games whose teams aren't canonical
    franchises are skipped and warned: this is how All-Star / exhibition games
    (NBA All-Star ingests as season.type=2 with fake team ids) get excluded
    without a special case. Returns games written."""
    id_map = team_id_map(conn, league)
    if not id_map:
        raise RuntimeError(
            f"no canonical teams for '{league}' — seed them first via "
            f"upsert_teams(conn, '{league}', parse_teams(fetch_teams('{league}')))")
    # Teams that appear in real (non-All-Star) games but are missing from the
    # current /teams list are former franchises (e.g. Arizona Coyotes): add
    # them so their history is kept rather than skipped.
    real = [g for g in parsed["games"]
            if g.get("comp_type") != "ALLSTAR" and not g.get("exhibition")]
    seen = {e for g in real for e in (g["home_espn_id"], g["away_espn_id"])}
    missing = [t for t in parsed.get("teams", [])
               if t["espn_id"] in seen and t["espn_id"] not in id_map]
    if missing:
        id_map = upsert_teams(conn, league, missing)
        link_franchises(conn, league)
    covid = COVID_SEASONS.get(league, set())
    rows = []
    skipped = []
    for g in real:
        home = id_map.get(g["home_espn_id"])
        away = id_map.get(g["away_espn_id"])
        if home is None or away is None:
            # non-franchise team (All-Star/exhibition) or unexpected id —
            # surface it, never drop silently
            skipped.append(g["espn_event_id"])
            continue
        rows.append({
            "espn_event_id": g["espn_event_id"], "league": league,
            "season": g["season"], "season_type": g["season_type"],
            "start_time_utc": g["start_time_utc"], "game_date": g["game_date"],
            "home_team_id": home, "away_team_id": away,
            "home_score": g["home_score"], "away_score": g["away_score"],
            "completed": int(g["completed"]), "status": g["status"],
            "venue": g["venue"], "neutral_site": int(g["neutral_site"]),
            "ending": g.get("ending"),
            "covid_2020": int(g["season"] in covid),
            "notes": g.get("notes"),
            "if_necessary": int(bool(g.get("if_necessary"))),
            "series_summary": g.get("series_summary"),
            "series_completed": int(bool(g.get("series_completed"))),
            "venue_city": g.get("venue_city"),
            "venue_state": g.get("venue_state"),
            "venue_country": g.get("venue_country"),
        })
    if skipped:
        import warnings
        warnings.warn(f"{league}: {len(skipped)} game(s) skipped — unresolved "
                      f"team ids (event ids: {skipped[:10]})")
    return upsert_games(conn, rows)


# A real franchise plays dozens of games a season; exhibition squads (NHL
# All-Star divisions, 4 Nations countries) appear in at most a handful of
# games in the whole history. Games involving such teams are left out of the
# model. Rows stay in the DB.
MIN_TEAM_GAMES = 5


def exhibition_team_ids(conn: sqlite3.Connection, league: str = None) -> set:
    """Team ids with fewer than MIN_TEAM_GAMES regular/postseason games in
    their league (All-Star squads, 4 Nations countries). Same rule read_games
    uses for the model."""
    q = ("SELECT t FROM (SELECT home_team_id t FROM games WHERE season_type "
         "IN (2,3) {w} UNION ALL SELECT away_team_id FROM games WHERE "
         "season_type IN (2,3) {w}) GROUP BY t HAVING COUNT(*) < ?")
    if league:
        rows = conn.execute(q.format(w="AND league = ?"),
                            (league, league, MIN_TEAM_GAMES))
    else:
        rows = conn.execute(q.format(w=""), (MIN_TEAM_GAMES,))
    return {r[0] for r in rows}


def not_exhibition_sql(ids, alias: str = "") -> str:
    """SQL condition (no leading AND) excluding games with any team in
    `ids`. Ids are ints from the DB, inlined safely."""
    if not ids:
        return "1=1"
    lst = ", ".join(str(int(i)) for i in sorted(ids))
    p = f"{alias}." if alias else ""
    return (f"{p}home_team_id NOT IN ({lst}) AND "
            f"{p}away_team_id NOT IN ({lst})")


def read_games(conn: sqlite3.Connection, league: str, seasons=None,
               season_types=(2, 3), exclude_exhibition=True,
               event_id: bool = False) -> pd.DataFrame:
    """Return games in the model's contract (season, date, home_team,
    away_team, home_score, away_score) for a league, plus neutral and ending.
    Team columns are the stable canonical team_id as a string — never the
    abbreviation, which changes. Regular + postseason by default; preseason
    (1) excluded. `ending` is regulation / ot / shootout for NHL and empty
    otherwise. Overtime and shootout count fully on the win term.
    `event_id` adds `espn_event_id` so a starter line can join the right
    game of a doubleheader. The rating model does not require it."""
    id_sql = "espn_event_id, " if event_id else ""
    q = [f"SELECT {id_sql}season, game_date AS date, "
         "CAST(home_team_id AS TEXT) AS home_team, "
         "CAST(away_team_id AS TEXT) AS away_team, "
         "home_score, away_score, neutral_site AS neutral, ending "
         "FROM games WHERE league = ?"]
    params = [league]
    if season_types:
        q.append(f"AND season_type IN ({', '.join('?' * len(season_types))})")
        params += list(season_types)
    if seasons:
        q.append(f"AND season IN ({', '.join('?' * len(seasons))})")
        params += list(seasons)
    if exclude_exhibition:
        st = ", ".join(str(int(x)) for x in (season_types or (1, 2, 3)))
        q.append(
            "AND home_team_id NOT IN (SELECT team_id FROM exh) "
            "AND away_team_id NOT IN (SELECT team_id FROM exh)")
        q.insert(0, (
            "WITH apps AS (SELECT home_team_id AS team_id FROM games "
            f"WHERE league = ? AND season_type IN ({st}) UNION ALL "
            "SELECT away_team_id FROM games "
            f"WHERE league = ? AND season_type IN ({st})), "
            "exh AS (SELECT team_id FROM apps GROUP BY team_id "
            f"HAVING COUNT(*) < {MIN_TEAM_GAMES})"))
        params = [league, league] + params
    q.append("ORDER BY start_time_utc")
    return pd.read_sql_query(" ".join(q), conn, params=params)


def log_run(conn: sqlite3.Connection, league: str, mode: str, started_at: str,
            finished_at: str, games_written: int, status: str,
            notes: str = None) -> None:
    with immediate(conn):
        conn.execute(
            "INSERT INTO scraper_runs (league, mode, started_at, finished_at, "
            "games_written, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (league, mode, started_at, finished_at, games_written, status, notes))


# ------------------------------------------------- schedule reconciliation

def _drop_forecasts(conn: sqlite3.Connection, ids, today: str) -> None:
    """Remove display forecasts for games that won't be played: every early
    forecast and game-day forecasts from `today` on. Past graded rows stay."""
    if not ids:
        return
    q = ",".join("?" * len(ids))
    try:
        conn.execute(f"DELETE FROM upcoming_forecasts WHERE espn_event_id IN ({q})",
                     list(ids))
    except sqlite3.OperationalError:     # table not created yet
        pass
    conn.execute(f"DELETE FROM forecast_snapshots WHERE espn_event_id IN ({q}) "
                 "AND snapshot_date >= ?", [*ids, today])


def _set_removed(conn: sqlite3.Connection, ids, today: str) -> None:
    if not ids:
        return
    q = ",".join("?" * len(ids))
    with immediate(conn):
        conn.execute(f"UPDATE games SET status = ? WHERE espn_event_id IN ({q})",
                     [REMOVED, *ids])
        _drop_forecasts(conn, ids, today)


def mark_removed(conn: sqlite3.Connection, league: str, espn_date: str,
                 seen_ids, today: str) -> list:
    """ESPN's scoreboard for `espn_date` (its own Eastern bucket) no longer
    lists these unplayed games: set status STATUS_REMOVED (rows are never
    deleted; a game ESPN lists again is restored by the next upsert) and drop
    their display forecasts. Returns the removed event ids."""
    from .espn import eastern_date
    seen = {int(i) for i in seen_ids}
    gone = [r[0] for r in conn.execute(
        "SELECT espn_event_id, start_time_utc FROM games WHERE league = ? "
        "AND completed = 0 AND COALESCE(status, '') != ? "
        "AND game_date BETWEEN date(?, '-1 day') AND date(?, '+1 day')",
        (league, REMOVED, espn_date, espn_date))
        if eastern_date(r[1]) == espn_date and r[0] not in seen]
    _set_removed(conn, gone, today)
    return gone


def mark_clinched(conn: sqlite3.Connection, league: str, today: str) -> list:
    """Unplayed "if necessary" playoff games whose series is already decided
    (ESPN marks the series completed on the game itself or on a finished game
    between the same two teams that season): STATUS_REMOVED, forecasts
    dropped. Returns the event ids."""
    done = conn.execute(
        "SELECT g.espn_event_id FROM games g WHERE g.league = ? AND g.completed = 0 "
        "AND g.if_necessary = 1 AND COALESCE(g.status, '') != ? AND ("
        " g.series_completed = 1 OR EXISTS (SELECT 1 FROM games f WHERE "
        " f.league = g.league AND f.season = g.season AND f.season_type = 3 "
        " AND f.completed = 1 AND f.series_completed = 1 "
        " AND f.start_time_utc < g.start_time_utc AND ("
        "  (f.home_team_id = g.home_team_id AND f.away_team_id = g.away_team_id) OR "
        "  (f.home_team_id = g.away_team_id AND f.away_team_id = g.home_team_id))))",
        (league, REMOVED)).fetchall()
    gone = [r[0] for r in done]
    _set_removed(conn, gone, today)
    return gone


def drop_hidden_forecasts(conn: sqlite3.Connection, today: str) -> int:
    """Display forecasts for unplayed games now postponed/canceled/removed."""
    ids = [r[0] for r in conn.execute(
        f"SELECT espn_event_id FROM games WHERE completed = 0 AND status IN ({HIDDEN_SQL}) "
        "AND game_date >= date(?, '-1 day')", (today,))]
    with immediate(conn):
        _drop_forecasts(conn, ids, today)
    return len(ids)
