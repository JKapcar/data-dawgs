#!/usr/bin/env python3
"""Canonical NFL player identity, provenance, and snapshot ledger for Data Dawgs."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAYERS = ROOT / "data" / "nfl-players.json"
DEFAULT_SNAPSHOTS = ROOT / "data" / "nfl-player-snapshots.json"

RELEASE_API = "https://api.github.com/repos/nflverse/nflverse-data/releases/tags/players"
ASSET_NAME = "players.csv"
SOURCE_REPOSITORY = "nflverse/nflverse-data"
SOURCE_LICENSE = "CC-BY-4.0"
SOURCE_RIGHTS_CLASS = "OPEN"
ID_VERSION = "dd-player-id-v1"
DD_ID_RE = re.compile(r"^DD-NFL-[0-9a-f]{16}$")
SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
CORE_COLUMNS = {
    "gsis_id", "display_name", "position", "position_group",
    "birth_date", "height", "weight", "latest_team",
}


class ContractError(ValueError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_id(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def dd_player_id(gsis_id: str) -> str:
    gsis = str(gsis_id or "").strip()
    if not gsis:
        raise ContractError("gsis_id is required for the NFL identity registry")
    digest = hashlib.sha256(f"{ID_VERSION}|gsis|{gsis}".encode("utf-8")).hexdigest()[:16]
    return f"DD-NFL-{digest}"


def clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return None if text == "" or text.lower() in {"na", "nan", "null", "none"} else text


def maybe_int(value: Any) -> int | None:
    text = clean(value)
    if text is None:
        return None
    try:
        return int(float(text))
    except ValueError as exc:
        raise ContractError(f"expected integer-like value, got {value!r}") from exc


def canonicalize_rows(rows: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    rows = list(rows)
    if not rows:
        raise ContractError("players source is empty")
    missing = CORE_COLUMNS - set(rows[0])
    if missing:
        raise ContractError(f"players source schema missing columns: {', '.join(sorted(missing))}")

    players: list[dict[str, Any]] = []
    skipped_without_gsis = 0
    seen_gsis: set[str] = set()
    seen_dd: set[str] = set()

    for raw in rows:
        gsis = clean(raw.get("gsis_id"))
        if not gsis:
            skipped_without_gsis += 1
            continue
        if gsis in seen_gsis:
            raise ContractError(f"duplicate gsis_id: {gsis}")
        seen_gsis.add(gsis)
        ddid = dd_player_id(gsis)
        if ddid in seen_dd:
            raise ContractError(f"Data Dawgs player-id collision: {ddid}")
        seen_dd.add(ddid)

        player = {
            "dd_player_id": ddid,
            "display_name": clean(raw.get("display_name")),
            "first_name": clean(raw.get("first_name")),
            "last_name": clean(raw.get("last_name")),
            "common_first_name": clean(raw.get("common_first_name")),
            "football_name": clean(raw.get("football_name")),
            "position": clean(raw.get("position")),
            "position_group": clean(raw.get("position_group")),
            "birth_date": clean(raw.get("birth_date")),
            "height": clean(raw.get("height")),
            "weight_lbs": maybe_int(raw.get("weight")),
            "college_name": clean(raw.get("college_name")),
            "college_conference": clean(raw.get("college_conference")),
            "rookie_season": maybe_int(raw.get("rookie_season")),
            "last_season": maybe_int(raw.get("last_season")),
            "latest_team": clean(raw.get("latest_team")),
            "status": clean(raw.get("status")),
            "draft": {
                "year": maybe_int(raw.get("draft_year")),
                "round": maybe_int(raw.get("draft_round")),
                "pick": maybe_int(raw.get("draft_pick")),
                "team": clean(raw.get("draft_team")),
            },
            "ids": {
                "gsis_id": gsis,
                "esb_id": clean(raw.get("esb_id")),
                "nfl_id": clean(raw.get("nfl_id")),
                "smart_id": clean(raw.get("smart_id")),
                "pfr_id": clean(raw.get("pfr_id")),
                "pff_id": clean(raw.get("pff_id")),
                "otc_id": clean(raw.get("otc_id")),
                "espn_id": clean(raw.get("espn_id")),
            },
        }
        if not player["display_name"]:
            raise ContractError(f"missing display_name for gsis_id {gsis}")
        players.append(player)

    players.sort(key=lambda p: (p["ids"]["gsis_id"], p["dd_player_id"]))
    validate_players(players)
    return players, {"source_rows": len(rows), "skipped_without_gsis": skipped_without_gsis}


def validate_players(players: list[dict[str, Any]]) -> None:
    if len(players) < 10000:
        raise ContractError(f"suspicious canonical player count: {len(players)}")
    ddids: set[str] = set()
    gsis_ids: set[str] = set()
    for player in players:
        ddid = player.get("dd_player_id")
        if not isinstance(ddid, str) or not DD_ID_RE.fullmatch(ddid):
            raise ContractError(f"invalid dd_player_id: {ddid!r}")
        gsis = player.get("ids", {}).get("gsis_id")
        if not gsis:
            raise ContractError(f"{ddid}: missing gsis_id")
        if ddid != dd_player_id(gsis):
            raise ContractError(f"{ddid}: does not match {ID_VERSION}")
        if ddid in ddids or gsis in gsis_ids:
            raise ContractError(f"duplicate identity detected: {ddid}/{gsis}")
        ddids.add(ddid)
        gsis_ids.add(gsis)


def fetch_release() -> tuple[dict[str, Any], bytes]:
    request = urllib.request.Request(
        RELEASE_API,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "data-dawgs-player-backbone/1"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        release = json.load(response)
    asset = next((a for a in release.get("assets", []) if a.get("name") == ASSET_NAME), None)
    if not asset:
        raise ContractError(f"{ASSET_NAME} missing from nflverse players release")
    digest = str(asset.get("digest") or "")
    if not SHA256_RE.fullmatch(digest):
        raise ContractError("players release asset is missing a SHA-256 digest")
    url = asset.get("browser_download_url")
    if not url:
        raise ContractError("players release asset is missing browser_download_url")
    req = urllib.request.Request(url, headers={"User-Agent": "data-dawgs-player-backbone/1"})
    with urllib.request.urlopen(req, timeout=120) as response:
        body = response.read()
    actual = "sha256:" + hashlib.sha256(body).hexdigest()
    if actual != digest:
        raise ContractError(f"players asset digest mismatch: expected {digest}, got {actual}")
    return {"release": release, "asset": asset}, body


def build_envelope(players: list[dict[str, Any]], stats: dict[str, int], meta: dict[str, Any], captured_at: str) -> dict[str, Any]:
    asset = meta["asset"]
    snapshot_id = sha256_id(players)
    return {
        "as_of": captured_at[:10],
        "source": "nflverse/nflverse-data players release (players.csv), normalized by Data Dawgs.",
        "note": (
            "Canonical NFL identity only. Inclusion requires a GSIS ID. Data Dawgs IDs are "
            "deterministically derived from GSIS IDs and are not player rankings or market values."
        ),
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/nfl-players.json",
        "provenance": {
            "source_repository": SOURCE_REPOSITORY,
            "release_tag": "players",
            "release_asset": ASSET_NAME,
            "source_asset_id": asset.get("id"),
            "source_asset_digest": asset.get("digest"),
            "source_asset_updated_at": asset.get("updated_at"),
            "captured_at": captured_at,
            "source_license": SOURCE_LICENSE,
            "redistribution_class": SOURCE_RIGHTS_CLASS,
            "attribution": "nflverse, nflverse-data players release",
            "transformation": "Selected, renamed and nested identity fields; rows without GSIS IDs excluded.",
        },
        "identity_contract": {
            "id_version": ID_VERSION,
            "anchor": "gsis_id",
            "format": "DD-NFL-<first 16 lowercase hex of SHA-256('dd-player-id-v1|gsis|<gsis_id>')>",
            "prospects_without_gsis": "excluded until a separate prospect identity bridge exists",
        },
        "field_provenance": {
            "dd_player_id": {"source": "Data Dawgs", "derivation": ID_VERSION},
            "identity_and_bio": {"source": "nflverse/nflverse-data players.csv"},
            "provider_ids": {"source": "nflverse/nflverse-data players.csv"},
            "draft": {"source": "nflverse/nflverse-data players.csv"},
        },
        "integrity": {
            "snapshot_id": snapshot_id,
            "algorithm": "SHA-256 of canonical UTF-8 JSON for ordered data.players.",
            "players": len(players),
            **stats,
        },
        "data": {"players": players},
    }


def empty_snapshot_ledger(as_of: str) -> dict[str, Any]:
    return {
        "as_of": as_of,
        "source": "Data Dawgs append-only NFL player snapshot ledger.",
        "note": "One row per published player-identity snapshot. Rows are immutable and ordered by first capture.",
        "built": as_of,
        "canonical_url": "https://datadawgs216.com/data/nfl-player-snapshots.json",
        "data": [],
    }


def append_snapshot(ledger: dict[str, Any], envelope: dict[str, Any]) -> dict[str, Any]:
    rows = list(ledger.get("data") or [])
    snapshot_id = envelope["integrity"]["snapshot_id"]
    new_row = {
        "snapshot_id": snapshot_id,
        "captured_at": envelope["provenance"]["captured_at"],
        "source_asset_digest": envelope["provenance"]["source_asset_digest"],
        "source_asset_updated_at": envelope["provenance"]["source_asset_updated_at"],
        "player_count": envelope["integrity"]["players"],
        "source_rows": envelope["integrity"]["source_rows"],
        "skipped_without_gsis": envelope["integrity"]["skipped_without_gsis"],
        "id_version": envelope["identity_contract"]["id_version"],
    }
    existing = next((r for r in rows if r.get("snapshot_id") == snapshot_id), None)
    if existing:
        # snapshot_id identifies canonical Data Dawgs rows, not every upstream byte revision.
        if existing.get("player_count") != new_row["player_count"] or existing.get("id_version") != new_row["id_version"]:
            raise ContractError(f"conflicting canonical snapshot metadata for {snapshot_id}")
        return ledger
    rows.append(new_row)
    out = dict(ledger)
    out["data"] = rows
    out["as_of"] = new_row["captured_at"][:10]
    out["built"] = new_row["captured_at"][:10]
    return out


def validate_envelope(envelope: dict[str, Any]) -> None:
    players = envelope.get("data", {}).get("players")
    if not isinstance(players, list):
        raise ContractError("data.players must be an array")
    validate_players(players)
    expected = sha256_id(players)
    actual = envelope.get("integrity", {}).get("snapshot_id")
    if expected != actual:
        raise ContractError(f"player snapshot hash mismatch: expected {expected}, found {actual}")
    prov = envelope.get("provenance", {})
    if not SHA256_RE.fullmatch(str(prov.get("source_asset_digest") or "")):
        raise ContractError("source_asset_digest must be an exact SHA-256 digest")
    if prov.get("redistribution_class") != "OPEN" or prov.get("source_license") != "CC-BY-4.0":
        raise ContractError("nflverse players rights metadata drifted")


def validate_ledger(ledger: dict[str, Any]) -> None:
    rows = ledger.get("data")
    if not isinstance(rows, list):
        raise ContractError("snapshot ledger data must be an array")
    seen: set[str] = set()
    for row in rows:
        sid = row.get("snapshot_id")
        if not SHA256_RE.fullmatch(str(sid or "")):
            raise ContractError(f"invalid snapshot_id in ledger: {sid!r}")
        if sid in seen:
            raise ContractError(f"duplicate snapshot_id in ledger: {sid}")
        seen.add(sid)


def assert_append_only(old_rows: list[dict[str, Any]], new_rows: list[dict[str, Any]]) -> None:
    if len(new_rows) < len(old_rows):
        raise ContractError("snapshot history removed rows")
    for index, old in enumerate(old_rows):
        if old != new_rows[index]:
            raise ContractError(f"snapshot history mutated row {index}")


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ContractError(f"{path} must contain an object")
    return value


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


def refresh(players_path: Path, snapshots_path: Path) -> None:
    meta, body = fetch_release()
    text = body.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    players, stats = canonicalize_rows(rows)
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    envelope = build_envelope(players, stats, meta, captured_at)
    ledger = read_json(snapshots_path) if snapshots_path.exists() else empty_snapshot_ledger(captured_at[:10])
    validate_ledger(ledger)
    ledger = append_snapshot(ledger, envelope)
    validate_envelope(envelope)
    validate_ledger(ledger)
    write_json(players_path, envelope)
    write_json(snapshots_path, ledger)


def verify_history(path: Path, base_ref: str) -> None:
    current = read_json(path)
    validate_ledger(current)
    result = subprocess.run(
        ["git", "show", f"{base_ref}:{path.relative_to(ROOT).as_posix()}"],
        cwd=ROOT, text=True, capture_output=True,
    )
    if result.returncode != 0:
        if "does not exist" in result.stderr or "exists on disk, but not in" in result.stderr:
            return
        raise ContractError(result.stderr.strip() or f"cannot read {path} from {base_ref}")
    old = json.loads(result.stdout)
    assert_append_only(old.get("data", []), current.get("data", []))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    refresh_p = sub.add_parser("refresh")
    refresh_p.add_argument("--players", type=Path, default=DEFAULT_PLAYERS)
    refresh_p.add_argument("--snapshots", type=Path, default=DEFAULT_SNAPSHOTS)
    val = sub.add_parser("validate")
    val.add_argument("--players", type=Path, default=DEFAULT_PLAYERS)
    val.add_argument("--snapshots", type=Path, default=DEFAULT_SNAPSHOTS)
    val.add_argument("--allow-missing", action="store_true")
    hist = sub.add_parser("verify-history")
    hist.add_argument("--snapshots", type=Path, default=DEFAULT_SNAPSHOTS)
    hist.add_argument("--base-ref", required=True)
    args = parser.parse_args()

    if args.command == "refresh":
        refresh(args.players, args.snapshots)
    elif args.command == "validate":
        if args.allow_missing and not args.players.exists() and not args.snapshots.exists():
            return
        validate_envelope(read_json(args.players))
        validate_ledger(read_json(args.snapshots))
    else:
        if not args.snapshots.exists():
            return
        verify_history(args.snapshots, args.base_ref)


if __name__ == "__main__":
    main()
