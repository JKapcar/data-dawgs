#!/usr/bin/env python3
"""Build and validate Data Dawgs' canonical NFL schedule and receipt ledger.

The scheduled path uses nfelodcm as a typed loader, then immediately converts its
DataFrame into a small, dependency-free public contract.  Validation and receipt
operations intentionally use only the Python standard library so they also run in
pull requests without network access.
"""

from __future__ import annotations

import argparse
import csv
import io
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCHEDULE = ROOT / "data" / "nfl-schedule.json"
DEFAULT_RECEIPTS = ROOT / "data" / "model-receipts.json"
NFELODCM_VERSION = "0.2.21"
SOURCE_REPOSITORY = "nflverse/nfldata"
SOURCE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
SOURCE_COMMIT_API = (
    "https://api.github.com/repos/nflverse/nfldata/commits?path=data/games.csv&per_page=1"
)
TIER_MEANING = (
    "Pup — live and useful, not yet validated. It may compute real answers and still "
    "have open questions about calibration, assumptions, data quality or edge. "
    "Everything starts here."
)
TEAM_ALIASES = {
    "ARZ": "ARI",
    "BLT": "BAL",
    "CLV": "CLE",
    "HST": "HOU",
    "JAC": "JAX",
    "LA": "LAR",
    "OAK": "LV",
    "SD": "LAC",
    "SL": "STL",
    "STL": "LAR",
    "WSH": "WAS",
}
CURRENT_TEAMS = {
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
    "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA",
    "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB",
    "TEN", "WAS",
}
REQUIRED_SOURCE_COLUMNS = {
    "game_id", "season", "game_type", "week", "gameday", "gametime",
    "away_team", "home_team", "location", "away_score", "home_score",
    "away_rest", "home_rest", "div_game",
}
REQUIRED_FORECAST_FIELDS = {
    "forecast_id", "game_id", "season", "week", "kickoff_at", "captured_at",
    "model_id", "model_name", "model_version", "source_repo", "source_commit",
    "source_capture_at", "home_team", "away_team", "home_win_probability",
    "expected_margin_home", "model_spread_home", "home_cover_probability",
    "push_probability", "input_snapshot_id", "schedule_snapshot_id", "forecast_status",
    "methodology_url", "license_status",
}
SHA_RE = re.compile(r"^[0-9a-f]{40,64}$")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class ContractError(ValueError):
    """Raised when source or public data violates the declared contract."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_id(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def canonical_team(value: Any) -> str:
    team = str(value or "").strip().upper()
    team = TEAM_ALIASES.get(team, team)
    if team not in CURRENT_TEAMS:
        raise ContractError(f"unknown current team abbreviation: {value!r}")
    return team


def canonical_game_id(season: int, week: int, away_team: str, home_team: str) -> str:
    if not 1 <= int(week) <= 30:
        raise ContractError(f"week out of range: {week}")
    return f"{int(season)}_{int(week):02d}_{canonical_team(away_team)}_{canonical_team(home_team)}"


def kickoff_utc(gameday: Any, gametime: Any) -> str:
    day = str(gameday or "").strip()
    clock = str(gametime or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise ContractError(f"invalid gameday: {gameday!r}")
    if not re.fullmatch(r"\d{1,2}:\d{2}", clock):
        raise ContractError(f"missing or invalid gametime for {day}: {gametime!r}")
    local = datetime.strptime(f"{day} {clock}", "%Y-%m-%d %H:%M").replace(
        tzinfo=ZoneInfo("America/New_York")
    )
    return local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def nullable_int(value: Any) -> int | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ContractError(f"invalid integer: {value!r}") from exc
    if math.isnan(number):
        return None
    if isinstance(value, bool) or not math.isfinite(number) or not number.is_integer():
        raise ContractError(f"invalid integer: {value!r}")
    return int(number)


def canonicalize_source_rows(rows: Iterable[dict[str, Any]], season: int) -> list[dict[str, Any]]:
    games: list[dict[str, Any]] = []
    for raw in rows:
        missing = REQUIRED_SOURCE_COLUMNS - set(raw)
        if missing:
            raise ContractError(f"source schema missing columns: {', '.join(sorted(missing))}")
        if int(raw["season"]) != season:
            continue
        away = canonical_team(raw["away_team"])
        home = canonical_team(raw["home_team"])
        week = int(raw["week"])
        canonical_id = canonical_game_id(season, week, away, home)
        upstream_id = str(raw["game_id"])
        if canonical_id != upstream_id:
            # A known historical team alias is acceptable, but the published identifier is ours.
            upstream_parts = upstream_id.split("_")
            if len(upstream_parts) != 4 or canonical_game_id(
                int(upstream_parts[0]), int(upstream_parts[1]), upstream_parts[2], upstream_parts[3]
            ) != canonical_id:
                raise ContractError(f"upstream game_id disagrees with row: {upstream_id}")
        away_score = nullable_int(raw["away_score"])
        home_score = nullable_int(raw["home_score"])
        if (away_score is None) != (home_score is None):
            raise ContractError(f"partial score for {canonical_id}")
        games.append({
            "game_id": canonical_id,
            "upstream_game_id": upstream_id,
            "season": season,
            "week": week,
            "season_type": str(raw["game_type"]).strip().upper(),
            "kickoff_at": kickoff_utc(raw["gameday"], raw["gametime"]),
            "away_team": away,
            "home_team": home,
            "neutral_site": str(raw["location"]).strip().lower() == "neutral",
            "divisional": nullable_int(raw["div_game"]) == 1,
            "away_rest_days": nullable_int(raw["away_rest"]),
            "home_rest_days": nullable_int(raw["home_rest"]),
            "status": "final" if home_score is not None else "scheduled",
            "away_score": away_score,
            "home_score": home_score,
        })
    games.sort(key=lambda game: (game["kickoff_at"], game["game_id"]))
    validate_games(games, season)
    return games


def validate_games(games: list[dict[str, Any]], season: int) -> None:
    if not 250 <= len(games) <= 350:
        raise ContractError(f"suspicious season row count: {len(games)} (expected 250-350)")
    ids = [game.get("game_id") for game in games]
    if len(ids) != len(set(ids)):
        raise ContractError("duplicate canonical game_id")
    for game in games:
        if game.get("season") != season:
            raise ContractError(f"mixed season in schedule: {game.get('season')}")
        expected = canonical_game_id(season, game["week"], game["away_team"], game["home_team"])
        if game.get("game_id") != expected:
            raise ContractError(f"non-canonical game_id: {game.get('game_id')}")
        parse_timestamp(game.get("kickoff_at"), "kickoff_at")
        if game.get("status") not in {"scheduled", "final"}:
            raise ContractError(f"invalid game status: {game.get('status')}")
    regular = [game for game in games if game.get("season_type") == "REG"]
    if len(regular) != 272:
        raise ContractError(f"suspicious regular-season row count: {len(regular)} (expected 272)")
    if {game["week"] for game in regular} != set(range(1, 19)):
        raise ContractError("regular-season weeks must be exactly 1-18")
    teams = {game[side] for game in regular for side in ("home_team", "away_team")}
    if teams != CURRENT_TEAMS:
        missing = sorted(CURRENT_TEAMS - teams)
        extra = sorted(teams - CURRENT_TEAMS)
        raise ContractError(f"team coverage drift; missing={missing}, extra={extra}")


def parse_timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise ContractError(f"{field} must be a non-empty ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(f"invalid {field}: {value!r}") from exc
    if parsed.tzinfo is None:
        raise ContractError(f"{field} must include a timezone: {value!r}")
    return parsed.astimezone(timezone.utc)


def fetch_source_commit(max_age_days: int) -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "data-dawgs-nfl-backbone/1"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(SOURCE_COMMIT_API, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - fixed HTTPS URL
        payload = json.load(response)
    if not isinstance(payload, list) or not payload:
        raise ContractError("GitHub returned no commit for nflverse/nfldata data/games.csv")
    commit = payload[0]
    sha = str(commit.get("sha", ""))
    committed_at = commit.get("commit", {}).get("committer", {}).get("date")
    if not SHA_RE.fullmatch(sha) or not committed_at:
        raise ContractError("upstream commit response is missing sha or timestamp")
    age = datetime.now(timezone.utc) - parse_timestamp(committed_at, "source committed_at")
    if age.days > max_age_days:
        raise ContractError(
            f"upstream games source is stale: {age.days} days old (limit {max_age_days})"
        )
    if age.total_seconds() < -300:
        raise ContractError("upstream games commit timestamp is in the future")
    return {"sha": sha, "committed_at": committed_at}


def make_schedule_envelope(
    games: list[dict[str, Any]], season: int, source_commit: dict[str, str], captured_at: str
) -> dict[str, Any]:
    snapshot_id = sha256_id(games)
    return {
        "as_of": captured_at[:10],
        "source": (
            f"nfelodcm {NFELODCM_VERSION} typed load of nflverse/nfldata data/games.csv "
            f"at commit {source_commit['sha']}."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "Canonical schedule facts only. Market prices are deliberately excluded because the "
            "upstream table does not identify their book and observation timestamp. Git history "
            "retains every changed snapshot; models must record integrity.snapshot_id in receipts."
        ),
        "provenance": {
            "loader": "nfelodcm",
            "loader_version": NFELODCM_VERSION,
            "loader_license": "MIT",
            "source_repository": SOURCE_REPOSITORY,
            "source_url": SOURCE_URL,
            "source_commit": source_commit["sha"],
            "source_committed_at": source_commit["committed_at"],
            "source_data_license": "not-verified-for-nfldata-repository",
            "captured_at": captured_at,
        },
        "integrity": {
            "snapshot_id": snapshot_id,
            "algorithm": "SHA-256 of canonical UTF-8 JSON for data.games (sorted object keys, no insignificant whitespace).",
            "rows": len(games),
            "regular_season_rows": sum(game["season_type"] == "REG" for game in games),
        },
        "data": {"season": season, "games": games},
        "tier_meaning": TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/nfl-schedule.json",
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ContractError(f"{path} must contain a JSON object")
    return value


def validate_schedule_envelope(envelope: dict[str, Any]) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("games"), list):
        raise ContractError("schedule data.games must be an array")
    season = data.get("season")
    if not isinstance(season, int):
        raise ContractError("schedule data.season must be an integer")
    validate_games(data["games"], season)
    expected = sha256_id(data["games"])
    actual = envelope.get("integrity", {}).get("snapshot_id")
    if expected != actual:
        raise ContractError(f"schedule snapshot hash mismatch: expected {expected}, found {actual}")
    provenance = envelope.get("provenance", {})
    if provenance.get("loader_version") != NFELODCM_VERSION:
        raise ContractError("schedule loader version is not the pinned nfelodcm version")
    if not SHA_RE.fullmatch(str(provenance.get("source_commit", ""))):
        raise ContractError("schedule provenance is missing an exact source commit")
    parse_timestamp(provenance.get("captured_at"), "provenance.captured_at")


def validate_probability(value: Any, field: str, nullable: bool = True) -> None:
    if value is None and nullable:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ContractError(f"{field} must be a finite number in [0,1] or null")
    if not 0 <= value <= 1:
        raise ContractError(f"{field} is outside [0,1]: {value}")


def validate_receipt(receipt: dict[str, Any]) -> None:
    missing = REQUIRED_FORECAST_FIELDS - set(receipt)
    if missing:
        raise ContractError(f"receipt missing fields: {', '.join(sorted(missing))}")
    if not isinstance(receipt["forecast_id"], str) or not receipt["forecast_id"]:
        raise ContractError("forecast_id must be a non-empty string")
    if not SLUG_RE.fullmatch(str(receipt["model_id"])):
        raise ContractError(f"invalid model_id: {receipt['model_id']!r}")
    home = canonical_team(receipt["home_team"])
    away = canonical_team(receipt["away_team"])
    expected_game = canonical_game_id(receipt["season"], receipt["week"], away, home)
    if receipt["game_id"] != expected_game:
        raise ContractError(f"receipt game_id must be {expected_game}")
    kickoff = parse_timestamp(receipt["kickoff_at"], "kickoff_at")
    captured = parse_timestamp(receipt["captured_at"], "captured_at")
    parse_timestamp(receipt["source_capture_at"], "source_capture_at")
    if receipt["forecast_status"] not in {"backtest", "prospective"}:
        raise ContractError(f"invalid forecast_status: {receipt['forecast_status']}")
    if receipt["forecast_status"] == "prospective" and captured >= kickoff:
        raise ContractError("prospective receipt must be captured before kickoff")
    validate_probability(receipt["home_win_probability"], "home_win_probability", nullable=False)
    validate_probability(receipt["home_cover_probability"], "home_cover_probability")
    validate_probability(receipt["push_probability"], "push_probability")
    for field in ("expected_margin_home", "model_spread_home"):
        value = receipt[field]
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
        ):
            raise ContractError(f"{field} must be finite or null")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", str(receipt["input_snapshot_id"])):
        raise ContractError("input_snapshot_id must be a sha256 identifier")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", str(receipt["schedule_snapshot_id"])):
        raise ContractError("schedule_snapshot_id must be a sha256 identifier")
    if not SHA_RE.fullmatch(str(receipt["source_commit"])):
        raise ContractError("source_commit must be an exact commit SHA")
    if not isinstance(receipt["source_repo"], str) or "/" not in receipt["source_repo"]:
        raise ContractError("source_repo must be an owner/repository name")


def receipt_ledger_hash(receipts: list[dict[str, Any]]) -> str:
    canonical = "\n".join(canonical_json(receipt) for receipt in receipts)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_receipt_ledger(envelope: dict[str, Any]) -> None:
    receipts = envelope.get("data")
    if not isinstance(receipts, list):
        raise ContractError("receipt ledger data must be an array")
    ids: set[str] = set()
    model_games: set[tuple[str, str]] = set()
    for receipt in receipts:
        if not isinstance(receipt, dict):
            raise ContractError("every receipt must be an object")
        validate_receipt(receipt)
        if receipt["forecast_id"] in ids:
            raise ContractError(f"duplicate forecast_id: {receipt['forecast_id']}")
        ids.add(receipt["forecast_id"])
        model_game = (receipt["model_id"], receipt["game_id"])
        if model_game in model_games:
            raise ContractError(
                f"duplicate forecast for {receipt['model_id']} on {receipt['game_id']}"
            )
        model_games.add(model_game)
    integrity = envelope.get("integrity", {})
    expected = receipt_ledger_hash(receipts)
    if integrity.get("sha256") != expected:
        raise ContractError("receipt ledger SHA-256 does not match canonical rows")
    if integrity.get("rows") != len(receipts):
        raise ContractError("receipt ledger row count does not match integrity.rows")


def assert_append_only(base: list[dict[str, Any]], current: list[dict[str, Any]]) -> None:
    if len(current) < len(base):
        raise ContractError("receipt history removed existing rows")
    for index, old in enumerate(base):
        if current[index] != old:
            receipt_id = old.get("forecast_id", f"row-{index}")
            raise ContractError(f"receipt history mutated existing row: {receipt_id}")


def append_receipts(
    ledger: dict[str, Any], additions: list[dict[str, Any]], schedule: dict[str, Any]
) -> dict[str, Any]:
    validate_receipt_ledger(ledger)
    validate_schedule_envelope(schedule)
    snapshot_id = schedule["integrity"]["snapshot_id"]
    schedule_games = {game["game_id"]: game for game in schedule["data"]["games"]}
    existing = {receipt["forecast_id"]: receipt for receipt in ledger["data"]}
    covered = {(receipt["model_id"], receipt["game_id"]) for receipt in ledger["data"]}
    appended = list(ledger["data"])
    for receipt in additions:
        validate_receipt(receipt)
        if receipt["schedule_snapshot_id"] != snapshot_id:
            raise ContractError("receipt schedule_snapshot_id does not match the supplied schedule")
        game = schedule_games.get(receipt["game_id"])
        if not game or game["kickoff_at"] != receipt["kickoff_at"]:
            raise ContractError(f"receipt game is absent from or disagrees with schedule: {receipt['game_id']}")
        prior = existing.get(receipt["forecast_id"])
        if prior is not None:
            if prior != receipt:
                raise ContractError(f"conflicting duplicate forecast_id: {receipt['forecast_id']}")
            continue
        model_game = (receipt["model_id"], receipt["game_id"])
        if model_game in covered:
            # forecast_id carries the input snapshot, so an upstream refresh mints a new
            # id for a game this model already forecast. The first prospective row stands;
            # a later re-forecast of the same game is not a second receipt.
            continue
        appended.append(receipt)
        existing[receipt["forecast_id"]] = receipt
        covered.add(model_game)
    result = dict(ledger)
    result["data"] = appended
    result["integrity"] = {
        "sha256": receipt_ledger_hash(appended),
        "algorithm": "SHA-256 of canonical receipt JSON rows joined by LF in append order.",
        "rows": len(appended),
    }
    result["as_of"] = datetime.now(timezone.utc).date().isoformat()
    result["built"] = result["as_of"]
    validate_receipt_ledger(result)
    return result


def same_source_games(left, right):
    # nfelodcm normalizes aliases inside game_id (including LA/LAR and LV/OAK).
    # Both lists have already validated that upstream_game_id resolves to game_id.
    # Compare every canonical fact; keep the published loader ID unchanged.
    return [{k: v for k, v in row.items() if k != "upstream_game_id"} for row in left] == [
        {k: v for k, v in row.items() if k != "upstream_game_id"} for row in right]


def cmd_refresh(args: argparse.Namespace) -> None:
    try:
        import nfelodcm  # type: ignore
    except ImportError as exc:
        raise ContractError(
            f"nfelodcm {NFELODCM_VERSION} is required; install requirements-data.txt"
        ) from exc
    package_version = getattr(nfelodcm, "__version__", None)
    if package_version not in {None, NFELODCM_VERSION}:
        raise ContractError(f"unexpected nfelodcm version: {package_version}")
    frame = nfelodcm.load(["games"])["games"]
    rows = frame.to_dict(orient="records")
    games = canonicalize_source_rows(rows, args.season)
    source_commit = fetch_source_commit(args.max_source_age_days)
    # Bind the typed loader output to the exact cited commit. A moving branch
    # between the load and provenance lookup must fail, never acquire a false SHA.
    pinned_url = f"https://raw.githubusercontent.com/{SOURCE_REPOSITORY}/{source_commit['sha']}/data/games.csv"
    with urllib.request.urlopen(pinned_url, timeout=60) as response:
        pinned_rows = list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig"))))
    if not same_source_games(canonicalize_source_rows(pinned_rows, args.season), games):
        raise ContractError("typed schedule differs from pinned source commit; retry the refresh")
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    envelope = make_schedule_envelope(games, args.season, source_commit, captured_at)
    validate_schedule_envelope(envelope)
    if args.output.exists():
        existing = read_json(args.output)
        validate_schedule_envelope(existing)
        if (
            existing["integrity"]["snapshot_id"] == envelope["integrity"]["snapshot_id"]
            and existing["provenance"]["source_commit"] == source_commit["sha"]
        ):
            print(
                f"unchanged {args.output}: {len(games)} games, "
                f"{envelope['integrity']['snapshot_id']}, source {source_commit['sha'][:12]}"
            )
            return
    write_json(args.output, envelope)
    print(
        f"wrote {args.output}: {len(games)} games, {envelope['integrity']['snapshot_id']}, "
        f"source {source_commit['sha'][:12]}"
    )


def cmd_validate(args: argparse.Namespace) -> None:
    schedule = read_json(args.schedule)
    receipts = read_json(args.receipts)
    validate_schedule_envelope(schedule)
    validate_receipt_ledger(receipts)
    print(
        f"validated {len(schedule['data']['games'])} games and {len(receipts['data'])} model receipts"
    )


def cmd_append(args: argparse.Namespace) -> None:
    ledger = read_json(args.ledger)
    schedule = read_json(args.schedule)
    additions_value = json.loads(args.input.read_text(encoding="utf-8"))
    additions = additions_value.get("data") if isinstance(additions_value, dict) else additions_value
    if not isinstance(additions, list):
        raise ContractError("receipt input must be an array or an object with data[]")
    updated = append_receipts(ledger, additions, schedule)
    write_json(args.ledger, updated)
    print(f"receipt ledger now contains {len(updated['data'])} rows")


def cmd_verify_history(args: argparse.Namespace) -> None:
    current = read_json(args.ledger)
    validate_receipt_ledger(current)
    relative = args.ledger.resolve().relative_to(ROOT).as_posix()
    proc = subprocess.run(
        ["git", "show", f"{args.base_ref}:{relative}"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        if current["data"]:
            raise ContractError("base ledger is absent; first introduction must be empty")
        print("base ledger absent and current ledger empty; initial append-only baseline is valid")
        return
    try:
        base = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ContractError("base ledger is not valid JSON") from exc
    validate_receipt_ledger(base)
    assert_append_only(base["data"], current["data"])
    print(f"append-only history preserved for {len(base['data'])} existing receipts")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    refresh = sub.add_parser("refresh", help="load nfelodcm and write a canonical schedule")
    refresh.add_argument("--season", type=int, default=2026)
    refresh.add_argument("--max-source-age-days", type=int, default=30)
    refresh.add_argument("--output", type=Path, default=DEFAULT_SCHEDULE)
    refresh.set_defaults(func=cmd_refresh)

    validate = sub.add_parser("validate", help="validate public schedule and receipt files")
    validate.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    validate.add_argument("--receipts", type=Path, default=DEFAULT_RECEIPTS)
    validate.set_defaults(func=cmd_validate)

    append = sub.add_parser("append-receipts", help="append normalized forecasts without mutation")
    append.add_argument("--input", type=Path, required=True)
    append.add_argument("--ledger", type=Path, default=DEFAULT_RECEIPTS)
    append.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    append.set_defaults(func=cmd_append)

    history = sub.add_parser("verify-history", help="prove existing receipt rows were not changed")
    history.add_argument("--base-ref", default="origin/main")
    history.add_argument("--ledger", type=Path, default=DEFAULT_RECEIPTS)
    history.set_defaults(func=cmd_verify_history)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        args.func(args)
    except (ContractError, OSError, urllib.error.URLError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
