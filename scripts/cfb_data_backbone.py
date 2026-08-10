#!/usr/bin/env python3
"""Build and validate Data Dawgs' canonical College Football schedule surface.

Step 1 of the CFB roadmap (cfb-sportsdataverse, cfb-games): a pinned
SportsDataverse (cfbfastR-data) schedule load, canonicalized into a small
dependency-free public contract at /data/cfb-schedule.json.

Scope is deliberately narrow: schedule and result FACTS for FBS-involved games
only. Upstream modelled columns (win probabilities, ESPN Elo, excitement index)
are excluded from the canonical rows for the same reason the NFL backbone
excludes market columns — they are not facts and they carry no methodology or
observation metadata. The raw snapshot hash is recorded so downstream lab work
(for example the Elo baseline) can reference the exact bytes it consumed.

Validation intentionally uses only the Python standard library so it also runs
without network access.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCHEDULE = ROOT / "data" / "cfb-schedule.json"
SOURCE_REPOSITORY = "sportsdataverse/cfbfastR-data"
SOURCE_BRANCH = "main"
SOURCE_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/"
    "main/schedules/csv/cfb_schedules_{season}.csv"
)
TIER_MEANING = (
    "Pup — live and useful, not yet validated. It may compute real answers and still "
    "have open questions about calibration, assumptions, data quality or edge. "
    "Everything starts here."
)
REQUIRED_SOURCE_COLUMNS = {
    "game_id", "season", "week", "season_type", "start_date", "completed",
    "neutral_site", "conference_game", "home_id", "home_team", "home_division",
    "home_conference", "home_points", "away_id", "away_team", "away_division",
    "away_conference", "away_points",
}
KNOWN_DIVISIONS = {"fbs", "fcs", "ii", "iii", None}
KNOWN_SEASON_TYPES = {"regular", "postseason"}
# FBS-involved game counts per season have ranged from ~500 (2020) to ~950.
FBS_GAME_RANGE = (400, 1100)
# FBS membership has ranged 125-136 in the modern era; leave headroom for expansion.
FBS_TEAM_RANGE = (120, 145)
SHA_RE = re.compile(r"^[0-9a-f]{40,64}$")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class ContractError(ValueError):
    """Raised when source or public data violates the declared contract."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_id(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def team_slug(name: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")
    if not SLUG_RE.fullmatch(slug):
        raise ContractError(f"cannot slug team name: {name!r}")
    return slug


def na(value: Any) -> Any:
    text = str(value or "").strip()
    return None if text in ("", "NA") else text


def nullable_int(value: Any) -> int | None:
    text = na(value)
    if text is None:
        return None
    try:
        number = float(text)
    except ValueError as exc:
        raise ContractError(f"not a number: {value!r}") from exc
    if math.isnan(number):
        return None
    return int(number)


def flag(value: Any, field: str) -> bool:
    text = str(value or "").strip().upper()
    if text not in {"TRUE", "FALSE"}:
        raise ContractError(f"{field} must be TRUE/FALSE, found {value!r}")
    return text == "TRUE"


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


def division(value: Any) -> str | None:
    text = na(value)
    if text is not None:
        text = text.lower()
    if text not in KNOWN_DIVISIONS:
        raise ContractError(f"unknown division: {value!r}")
    return text


def canonicalize_source_rows(rows: Iterable[dict[str, Any]], season: int) -> list[dict[str, Any]]:
    games: list[dict[str, Any]] = []
    for raw in rows:
        missing = REQUIRED_SOURCE_COLUMNS - set(raw)
        if missing:
            raise ContractError(f"source schema missing columns: {', '.join(sorted(missing))}")
        if int(raw["season"]) != season:
            raise ContractError(f"mixed season in source: {raw['season']!r}")
        home_division = division(raw["home_division"])
        away_division = division(raw["away_division"])
        if home_division != "fbs" and away_division != "fbs":
            continue
        season_type = str(raw["season_type"]).strip().lower()
        if season_type not in KNOWN_SEASON_TYPES:
            raise ContractError(f"unknown season_type: {raw['season_type']!r}")
        week = int(raw["week"])
        if not 0 <= week <= 20:
            raise ContractError(f"week out of range: {week}")
        completed = flag(raw["completed"], "completed")
        home_points = nullable_int(raw["home_points"])
        away_points = nullable_int(raw["away_points"])
        if completed and (home_points is None) != (away_points is None):
            raise ContractError(f"partial score for completed game {raw['game_id']}")
        if not completed:
            home_points = away_points = None
        kickoff = parse_timestamp(str(raw["start_date"]), "start_date")
        home_slug = team_slug(raw["home_team"])
        away_slug = team_slug(raw["away_team"])
        games.append({
            "game_id": f"{season}_{season_type[:4]}_{week:02d}_{away_slug}_{home_slug}",
            "upstream_game_id": str(raw["game_id"]).strip(),
            "season": season,
            "week": week,
            "season_type": season_type,
            "kickoff_at": kickoff.isoformat().replace("+00:00", "Z"),
            "neutral_site": flag(raw["neutral_site"], "neutral_site"),
            "conference_game": flag(raw["conference_game"], "conference_game"),
            "home_team": str(raw["home_team"]).strip(),
            "home_team_slug": home_slug,
            "home_espn_id": nullable_int(raw["home_id"]),
            "home_division": home_division,
            "home_conference": na(raw["home_conference"]),
            "away_team": str(raw["away_team"]).strip(),
            "away_team_slug": away_slug,
            "away_espn_id": nullable_int(raw["away_id"]),
            "away_division": away_division,
            "away_conference": na(raw["away_conference"]),
            "status": "final" if completed and home_points is not None else
                      ("completed_no_score" if completed else "scheduled"),
            "home_points": home_points,
            "away_points": away_points,
        })
    games.sort(key=lambda game: (game["kickoff_at"], game["game_id"]))
    validate_games(games, season)
    return games


def validate_games(games: list[dict[str, Any]], season: int) -> None:
    low, high = FBS_GAME_RANGE
    if not low <= len(games) <= high:
        raise ContractError(f"suspicious FBS-involved row count: {len(games)} (expected {low}-{high})")
    for field in ("game_id", "upstream_game_id"):
        ids = [game.get(field) for game in games]
        if len(ids) != len(set(ids)):
            raise ContractError(f"duplicate {field}")
    fbs_teams: set[str] = set()
    for game in games:
        if game.get("season") != season:
            raise ContractError(f"mixed season in schedule: {game.get('season')}")
        parse_timestamp(game.get("kickoff_at"), "kickoff_at")
        if game.get("season_type") not in KNOWN_SEASON_TYPES:
            raise ContractError(f"invalid season_type: {game.get('season_type')}")
        if game.get("status") not in {"scheduled", "final", "completed_no_score"}:
            raise ContractError(f"invalid game status: {game.get('status')}")
        if game.get("status") == "final" and (
            game.get("home_points") is None or game.get("away_points") is None
        ):
            raise ContractError(f"final game without both scores: {game.get('game_id')}")
        if game.get("home_division") != "fbs" and game.get("away_division") != "fbs":
            raise ContractError(f"non-FBS game in canonical set: {game.get('game_id')}")
        for side in ("home", "away"):
            if game.get(f"{side}_division") == "fbs":
                fbs_teams.add(game[f"{side}_team_slug"])
                if not game.get(f"{side}_conference"):
                    raise ContractError(f"FBS team without conference: {game.get('game_id')}")
    low, high = FBS_TEAM_RANGE
    if not low <= len(fbs_teams) <= high:
        raise ContractError(f"suspicious FBS team count: {len(fbs_teams)} (expected {low}-{high})")


def fetch_source(season: int) -> tuple[str, str]:
    url = SOURCE_URL_TEMPLATE.format(season=season)
    request = urllib.request.Request(url, headers={"User-Agent": "data-dawgs-cfb-backbone/1"})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - fixed HTTPS URL
        raw = response.read()
    if not raw:
        raise ContractError(f"empty source download: {url}")
    return raw.decode("utf-8"), hashlib.sha256(raw).hexdigest()


def fetch_source_repo_head() -> str:
    """Pin the source repository HEAD via git ls-remote (no GitHub API required).

    This is repository-level pinning, coarser than the NFL backbone's
    path-level commit lookup; the raw snapshot SHA-256 recorded alongside it is
    what makes the exact bytes reproducible and drift detectable.
    """
    out = subprocess.run(
        ["git", "ls-remote", f"https://github.com/{SOURCE_REPOSITORY}.git", f"refs/heads/{SOURCE_BRANCH}"],
        capture_output=True, text=True, timeout=60, check=True,
    ).stdout.strip()
    sha = out.split("\t")[0] if out else ""
    if not SHA_RE.fullmatch(sha):
        raise ContractError(f"could not pin source repository HEAD: {out!r}")
    return sha


def make_schedule_envelope(
    games: list[dict[str, Any]], season: int, repo_head: str,
    source_sha256: str, captured_at: str,
) -> dict[str, Any]:
    return {
        "as_of": captured_at[:10],
        "source": (
            f"{SOURCE_REPOSITORY} schedules/csv/cfb_schedules_{season}.csv on branch "
            f"{SOURCE_BRANCH} (repository HEAD {repo_head} at capture; raw snapshot "
            f"sha256 {source_sha256})."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "Canonical CFB schedule and result facts for FBS-involved games only. Upstream "
            "modelled columns (win probabilities, ESPN Elo, excitement index) are deliberately "
            "excluded: they are model outputs, not facts, and carry no methodology metadata. "
            "Git history retains every changed snapshot; downstream work must record "
            "integrity.snapshot_id."
        ),
        "provenance": {
            "source_repository": SOURCE_REPOSITORY,
            "source_branch": SOURCE_BRANCH,
            "source_path": f"schedules/csv/cfb_schedules_{season}.csv",
            "source_url": SOURCE_URL_TEMPLATE.format(season=season),
            "source_repo_head_at_capture": repo_head,
            "source_raw_sha256": source_sha256,
            "source_data_license": "not-verified-for-cfbfastR-data-repository",
            "captured_at": captured_at,
        },
        "integrity": {
            "snapshot_id": sha256_id(games),
            "algorithm": (
                "SHA-256 of canonical UTF-8 JSON for data.games "
                "(sorted object keys, no insignificant whitespace)."
            ),
            "rows": len(games),
            "final_rows": sum(game["status"] == "final" for game in games),
        },
        "data": {"season": season, "games": games},
        "tier_meaning": TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/cfb-schedule.json",
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
    if provenance.get("source_repository") != SOURCE_REPOSITORY:
        raise ContractError("schedule provenance names the wrong source repository")
    if not SHA_RE.fullmatch(str(provenance.get("source_repo_head_at_capture", ""))):
        raise ContractError("schedule provenance is missing the pinned repository HEAD")
    if not re.fullmatch(r"[0-9a-f]{64}", str(provenance.get("source_raw_sha256", ""))):
        raise ContractError("schedule provenance is missing the raw snapshot sha256")
    parse_timestamp(provenance.get("captured_at"), "provenance.captured_at")


def cmd_refresh(args: argparse.Namespace) -> int:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    text, source_sha256 = fetch_source(args.season)
    repo_head = fetch_source_repo_head()
    rows = list(csv.DictReader(io.StringIO(text)))
    games = canonicalize_source_rows(rows, args.season)
    envelope = make_schedule_envelope(games, args.season, repo_head, source_sha256, captured_at)
    write_json(Path(args.schedule), envelope)
    print(f"wrote {args.schedule}: {len(games)} FBS-involved games, "
          f"snapshot {envelope['integrity']['snapshot_id'][:23]}…")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    validate_schedule_envelope(read_json(Path(args.schedule)))
    print(f"{args.schedule} satisfies the CFB schedule contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    refresh = sub.add_parser("refresh", help="download the pinned source and write the canonical schedule")
    refresh.add_argument("--season", type=int, required=True)
    refresh.add_argument("--schedule", default=str(DEFAULT_SCHEDULE))
    refresh.set_defaults(func=cmd_refresh)
    validate = sub.add_parser("validate", help="validate the public schedule file (offline)")
    validate.add_argument("--schedule", default=str(DEFAULT_SCHEDULE))
    validate.set_defaults(func=cmd_validate)
    args = parser.parse_args()
    try:
        return args.func(args)
    except ContractError as exc:
        print(f"contract violation: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
