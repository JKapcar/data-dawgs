#!/usr/bin/env python3
"""Data Dawgs adapter for the vendored bayesratings-models pipeline.

The model code lives, unmodified, in models/bayesratings/ (WalrusQuant/bayesratings-models,
AGPL-3.0-only). This script is Data Dawgs code. It never imports that package: it reads
the SQLite file the pipeline writes and turns it into a /data/ envelope and contract-shaped
prospective receipt candidates. Standard library only, so CI can validate it without
CmdStan.

Commands
  lock            rewrite models/bayesratings.lock.json from the vendored tree
  verify-vendor   fail if the vendored tree differs from the lock (added, changed, missing)
  export          SQLite -> data/bayesratings-nfl.json (ratings, forecasts, receipt candidates)
  validate        check an exported file against the contract rules used here

Receipt candidates are NOT appended to /data/model-receipts.json by this script. That
ledger is append-only and owned by the receipts workflow; appending is a separate,
reviewed step.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "models" / "bayesratings"
LOCK = ROOT / "models" / "bayesratings.lock.json"
SCHEDULE = ROOT / "data" / "nfl-schedule.json"
OUT = ROOT / "data" / "bayesratings-nfl.json"

UPSTREAM_REPO = "WalrusQuant/bayesratings-models"
MODEL_ID = "bayesratings-nfl"
MODEL_NAME = "bayesRatings NFL (Bayesian Bradley-Terry + Elo)"
DEFAULT_INPUTS = "ESPN scoreboards"
METHODOLOGY_URL = "https://datadawgs216.com/models/bayesratings/docs/model.md"
LICENSE_STATUS = "verified-license-file"
CANONICAL_URL = "https://datadawgs216.com/data/bayesratings-nfl.json"

# ESPN abbreviation -> Data Dawgs canonical (nflverse) abbreviation. Everything else matches.
ESPN_TO_CANONICAL = {"WSH": "WAS", "LA": "LAR"}
CANONICAL_TEAMS = {
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
    "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
    "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
}
SKIP_PARTS = {".git", "__pycache__", ".pytest_cache", ".venv"}
SKIP_SUFFIXES = {".pyc", ".db", ".db-wal", ".db-shm", ".log"}


# ---------------------------------------------------------------- vendoring

def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def vendored_files(base: Path = VENDOR) -> dict[str, str]:
    out = {}
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(base)
        if any(part in SKIP_PARTS for part in rel.parts) or p.suffix in SKIP_SUFFIXES:
            continue
        # Stan builds compiled binaries next to the sources on first run; never tracked.
        if rel.parts[0] == "stan" and p.suffix not in {".stan"}:
            continue
        if rel.parts[0] == "data" and rel.parts[:2] == ("data", "status"):
            continue
        out[rel.as_posix()] = sha256_bytes(p.read_bytes())
    return out


def tree_digest(files: dict[str, str]) -> str:
    text = "".join(f"{h}  {name}\n" for name, h in sorted(files.items()))
    return "sha256:" + sha256_bytes(text.encode())


def cmd_lock(args) -> int:
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    files = vendored_files()
    lock.update({
        "upstream_repository": UPSTREAM_REPO,
        "upstream_commit": args.commit or lock.get("upstream_commit"),
        "license": "AGPL-3.0-only",
        "path": "models/bayesratings",
        "modified": lock.get("modified", False),
        "files": len(files),
        "tree_sha256": tree_digest(files),
        "sha256": files,
    })
    LOCK.write_text(json.dumps(lock, indent=1) + "\n")
    print(f"locked {len(files)} files {lock['tree_sha256']}")
    return 0


def verify_vendor(base: Path = VENDOR, lock_path: Path = LOCK) -> list[str]:
    lock = json.loads(lock_path.read_text())
    want = lock["sha256"]
    have = vendored_files(base)
    problems = []
    for name in sorted(set(want) - set(have)):
        problems.append(f"missing: {name}")
    for name in sorted(set(have) - set(want)):
        problems.append(f"added: {name}")
    for name in sorted(set(want) & set(have)):
        if want[name] != have[name]:
            problems.append(f"changed: {name}")
    if "LICENSE" not in have:
        problems.append("the AGPL LICENSE file must stay in the vendored tree")
    if problems and not lock.get("modified"):
        problems.append(
            "The vendored tree is locked as unmodified upstream. A local change makes this a "
            "modified version under AGPL-3.0 section 5: add a dated change notice to "
            "models/README.md, set \"modified\": true, then run `lock`.")
    return problems


def cmd_verify_vendor(args) -> int:
    problems = verify_vendor()
    lock = json.loads(LOCK.read_text())
    if problems and not lock.get("modified"):
        print("\n".join(problems))
        return 1
    print(f"vendored tree ok: {lock['files']} files at {lock['upstream_commit'][:12]}")
    return 0


# ---------------------------------------------------------------- export

def canonical(abbr: str | None) -> str | None:
    if abbr is None:
        return None
    a = ESPN_TO_CANONICAL.get(abbr.upper(), abbr.upper())
    return a if a in CANONICAL_TEAMS else None


def _parse_ts(s: str) -> dt.datetime:
    s = s.strip().replace(" ", "T")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    t = dt.datetime.fromisoformat(s)
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def _iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _canon_json(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _round(x, n=6):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), n)


def _columns(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def read_db(db_path: Path, league: str = "nfl") -> dict:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        names = {tid: ab for tid, ab in conn.execute(
            "SELECT team_id, abbreviation FROM teams WHERE league = ?", (league,))}
        snap = conn.execute("SELECT MAX(snapshot_date) FROM rating_snapshots WHERE league = ?",
                            (league,)).fetchone()[0]
        ratings = []
        if snap:
            for tid, season, rating, sd, q05, q95, hadv in conn.execute(
                    "SELECT team_id, season, rating, rating_sd, rating_q05, rating_q95, home_adv "
                    "FROM rating_snapshots WHERE league = ? AND snapshot_date = ? "
                    "ORDER BY rating DESC", (league, snap)):
                ratings.append({"espn_abbr": names.get(tid), "season": season, "rating": rating,
                                "rating_sd": sd, "rating_q05": q05, "rating_q95": q95,
                                "home_adv": hadv})
        cols = ["espn_event_id", "snapshot_date", "home_team_id", "away_team_id", "home_prob",
                "home_spread", "total_pred", "home_total_pred", "away_total_pred"]
        extra = [c for c in ("model_version", "nfl_model_src", "nfl_team_prob", "nfl_ridge_prob")
                 if c in _columns(conn, "forecast_snapshots")]
        sel = ", ".join(cols + extra)
        rows = {}
        if snap:
            for r in conn.execute(f"SELECT {sel} FROM forecast_snapshots WHERE league = ? "
                                  "AND snapshot_date = ?", (league, snap)):
                rows[r[0]] = dict(zip(cols + extra, r), table="forecast_snapshots")
        up_extra = [c for c in extra if c in _columns(conn, "upcoming_forecasts")]
        for r in conn.execute(f"SELECT {', '.join(cols + up_extra)} FROM upcoming_forecasts "
                              "WHERE league = ?", (league,)):
            rows.setdefault(r[0], dict(zip(cols + up_extra, r), table="upcoming_forecasts"))
        starts = {}
        if rows:
            q = ",".join("?" * len(rows))
            for eid, start, neutral in conn.execute(
                    f"SELECT espn_event_id, start_time_utc, neutral_site FROM games "
                    f"WHERE espn_event_id IN ({q})", list(rows)):
                starts[eid] = (start, neutral)
        forecasts = []
        for eid, r in sorted(rows.items()):
            start, neutral = starts.get(eid, (None, 0))
            r.update(home_abbr=names.get(r.pop("home_team_id")),
                     away_abbr=names.get(r.pop("away_team_id")),
                     start_time_utc=start, neutral_site=bool(neutral))
            forecasts.append(r)
        return {"snapshot_date": snap, "ratings": ratings, "forecasts": forecasts}
    finally:
        conn.close()


def load_schedule(path: Path) -> dict:
    d = json.loads(path.read_text())
    return {"snapshot_id": d.get("integrity", {}).get("snapshot_id"),
            "games": d["data"]["games"]}


def match_game(sched_games, home, away, start_utc):
    """Same home/away pair, kickoff within 36 hours of ESPN's start time."""
    if not (home and away):
        return None
    pair = [g for g in sched_games if g["home_team"] == home and g["away_team"] == away]
    if start_utc is None:
        return pair[0] if len(pair) == 1 else None  # ambiguous without a time
    t = _parse_ts(start_utc)
    near = [(abs((_parse_ts(g["kickoff_at"]) - t).total_seconds()), g) for g in pair]
    near = [x for x in near if x[0] <= 36 * 3600]
    return min(near, key=lambda x: x[0])[1] if near else None


def build(db_path: Path, schedule_path: Path, captured_at: dt.datetime,
          upstream_commit: str, dd_commit: str | None = None,
          inputs: str = DEFAULT_INPUTS) -> dict:
    raw = read_db(db_path)
    sched = load_schedule(schedule_path)
    input_snapshot_id = "sha256:" + sha256_bytes(_canon_json(
        {"snapshot_date": raw["snapshot_date"], "ratings": raw["ratings"],
         "forecasts": raw["forecasts"], "upstream_commit": upstream_commit}))
    ratings = []
    for i, r in enumerate(raw["ratings"], 1):
        ratings.append({"rank": i, "team": canonical(r["espn_abbr"]), "espn_abbr": r["espn_abbr"],
                        "rating_logit": _round(r["rating"]), "rating_sd": _round(r["rating_sd"]),
                        "rating_q05": _round(r["rating_q05"]), "rating_q95": _round(r["rating_q95"])})
    home_adv = _round(raw["ratings"][0]["home_adv"]) if raw["ratings"] else None
    forecasts, receipts, unmatched = [], [], []
    short = upstream_commit[:12]
    for f in raw["forecasts"]:
        home, away = canonical(f["home_abbr"]), canonical(f["away_abbr"])
        g = match_game(sched["games"], home, away, f["start_time_utc"])
        if g is None:
            unmatched.append({"espn_event_id": f["espn_event_id"], "home": f["home_abbr"],
                              "away": f["away_abbr"], "start_time_utc": f["start_time_utc"]})
            continue
        p = f["home_prob"]
        spread = f["home_spread"]          # upstream convention: negative = home favored
        margin = None if spread is None else -spread
        version = f"{f.get('model_version') or 'bayesratings-models'}@{short}"
        row = {"game_id": g["game_id"], "season": g["season"], "week": g["week"],
               "kickoff_at": g["kickoff_at"], "home_team": home, "away_team": away,
               "espn_event_id": f["espn_event_id"],
               "home_win_probability": _round(p),
               "expected_margin_home": _round(margin, 2),
               "model_spread_home": _round(spread, 2),
               "total_points": _round(f["total_pred"], 2),
               "home_points": _round(f["home_total_pred"], 2),
               "away_points": _round(f["away_total_pred"], 2),
               "win_path": f.get("nfl_model_src") or "team",
               "team_path_probability": _round(f.get("nfl_team_prob")),
               "upstream_table": f["table"], "upstream_snapshot_date": f["snapshot_date"],
               "model_version": version}
        forecasts.append(row)
        if captured_at < _parse_ts(g["kickoff_at"]) and p is not None:
            receipts.append({
                "forecast_id": f"{MODEL_ID}-{short}-{g['season']}-{g['week']:02d}-"
                               f"{away.lower()}-{home.lower()}-{_iso(captured_at)}",
                "game_id": g["game_id"], "season": g["season"], "week": g["week"],
                "kickoff_at": g["kickoff_at"], "captured_at": _iso(captured_at),
                "model_id": MODEL_ID, "model_name": MODEL_NAME, "model_version": version,
                "source_repo": UPSTREAM_REPO, "source_commit": upstream_commit,
                "source_capture_at": _iso(captured_at),
                "home_team": home, "away_team": away,
                "home_win_probability": _round(p),
                "expected_margin_home": _round(margin, 2),
                "model_spread_home": _round(spread, 2),
                # The model publishes no cover or push distribution; the contract says null.
                "home_cover_probability": None, "push_probability": None,
                "input_snapshot_id": input_snapshot_id,
                "schedule_snapshot_id": sched["snapshot_id"],
                "forecast_status": "prospective",
                "methodology_url": METHODOLOGY_URL, "license_status": LICENSE_STATUS,
            })
    if any(r["win_path"] == "ridge_qb" for r in forecasts):
        inputs += " plus nflverse play-by-play (quarterback ridge)"
    return {
        "as_of": raw["snapshot_date"] or captured_at.date().isoformat(),
        "source": (f"{UPSTREAM_REPO} at {upstream_commit} (AGPL-3.0-only), vendored unmodified "
                   f"in /models/bayesratings, run on {inputs}."),
        "tier": "labs",
        "graded": False,
        "note": ("Model output, not a market. Ratings are zero-centered Bradley-Terry logits; "
                 "a +0.40 team beats a 0.00 team about 60% of the time on a neutral field before "
                 "home edge. win_path ridge_qb means the quarterback ridge set the win chance; "
                 "team means the team path did. Spread and total come from the team path; upstream nudges "
                 "the margin so it names the same favorite as the win chance. "
                 "receipt_candidates are not in /data/model-receipts.json until a reviewed append. "
                 "Ungraded."),
        "license": {"code": "AGPL-3.0-only", "source": "https://github.com/" + UPSTREAM_REPO,
                    "vendored_source": "https://github.com/JKapcar/data-dawgs/tree/main/models/bayesratings",
                    "data_terms": "Inputs remain under the terms of ESPN and nflverse."},
        "provenance": {"upstream_commit": upstream_commit, "data_dawgs_commit": dd_commit,
                       "captured_at": _iso(captured_at),
                       "upstream_snapshot_date": raw["snapshot_date"],
                       "schedule_snapshot_id": sched["snapshot_id"],
                       "input_snapshot_id": input_snapshot_id},
        "canonical_url": CANONICAL_URL,
        "data": {"model_id": MODEL_ID, "home_adv_logit": home_adv, "ratings": ratings,
                 "forecasts": forecasts, "receipt_candidates": receipts,
                 "unmatched": unmatched},
    }


def validate(doc: dict, contract_path: Path = ROOT / "data" / "model-contracts.json") -> list[str]:
    errs = []
    for k in ("as_of", "source"):
        if not doc.get(k):
            errs.append(f"missing {k}")
    required = json.loads(contract_path.read_text())["data"]["forecast_required"]
    teams = [r["team"] for r in doc["data"]["ratings"]]
    if any(t is None for t in teams):
        errs.append("a rated team has no canonical abbreviation")
    if len(teams) != len(set(teams)):
        errs.append("duplicate team in ratings")
    for r in doc["data"]["receipt_candidates"]:
        miss = [k for k in required if k not in r]
        if miss:
            errs.append(f"{r.get('forecast_id')}: missing {miss}")
        p = r.get("home_win_probability")
        if p is None or not (0 <= p <= 1):
            errs.append(f"{r.get('forecast_id')}: bad probability {p}")
        if _parse_ts(r["captured_at"]) >= _parse_ts(r["kickoff_at"]):
            errs.append(f"{r.get('forecast_id')}: captured at or after kickoff")
        if r["forecast_status"] != "prospective":
            errs.append(f"{r.get('forecast_id')}: not prospective")
    for f in doc["data"]["forecasts"]:
        p, m = f["home_win_probability"], f["expected_margin_home"]
        if p is not None and m not in (None, 0) and (p > 0.5) != (m > 0):
            errs.append(f"{f['game_id']}: margin and win chance name different favorites")
    return errs


def cmd_export(args) -> int:
    captured = _parse_ts(args.captured_at) if args.captured_at else dt.datetime.now(dt.timezone.utc)
    lock = json.loads(LOCK.read_text())
    doc = build(Path(args.db), Path(args.schedule), captured, lock["upstream_commit"],
                args.dd_commit, args.inputs)
    errs = validate(doc)
    if errs:
        print("\n".join(errs), file=sys.stderr)
        return 1
    if not doc["data"]["ratings"]:
        print("no NFL ratings in the database; run the pipeline first", file=sys.stderr)
        return 1
    Path(args.out).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    d = doc["data"]
    print(f"wrote {args.out}: {len(d['ratings'])} teams, {len(d['forecasts'])} forecasts, "
          f"{len(d['receipt_candidates'])} receipt candidates, {len(d['unmatched'])} unmatched")
    return 0


def cmd_validate(args) -> int:
    errs = validate(json.loads(Path(args.file).read_text()))
    print("\n".join(errs) or "ok")
    return 1 if errs else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("lock"); s.add_argument("--commit"); s.set_defaults(fn=cmd_lock)
    s = sub.add_parser("verify-vendor"); s.set_defaults(fn=cmd_verify_vendor)
    s = sub.add_parser("export")
    s.add_argument("--db", required=True)
    s.add_argument("--schedule", default=str(SCHEDULE))
    s.add_argument("--out", default=str(OUT))
    s.add_argument("--captured-at", default=None)
    s.add_argument("--dd-commit", default=None)
    s.add_argument("--inputs", default=DEFAULT_INPUTS,
                   help="what the pipeline was fed, for the envelope's source line")
    s.set_defaults(fn=cmd_export)
    s = sub.add_parser("validate"); s.add_argument("file", nargs="?", default=str(OUT))
    s.set_defaults(fn=cmd_validate)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
