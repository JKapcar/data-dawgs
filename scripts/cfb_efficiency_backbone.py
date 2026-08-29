#!/usr/bin/env python3
"""Build the compact Data Dawgs CFB efficiency surface from cfbfastR 3.0 data."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
import pathlib
import urllib.error
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "cfb-efficiency.json"
RELEASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_team_summaries"
ASSET = "cfb_team_summaries_{season}.csv"
TIER_MEANING = (
    "Pup — live and useful, not yet validated. It may compute real answers and still have open "
    "questions about calibration, assumptions, data quality or edge. Everything starts here."
)

FIELDS = {
    "team_id",
    "pos_team",
    "division",
    "conference",
    "season",
    "plays_off",
    "valid_games",
    "EPAplay_off",
    "EPAplay_def",
    "success_off",
    "success_def",
    "adj_off_epa",
    "adj_def_epa",
    "net_adj_epa",
    "adj_off_epa_rank",
    "adj_def_epa_rank",
    "net_adj_epa_rank",
}


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def number(value: str, *, integer: bool = False):
    if value is None or value.strip() == "":
        return None
    parsed = float(value)
    if not math.isfinite(parsed):
        return None
    return int(parsed) if integer else round(parsed, 6)


def fetch(season: int) -> tuple[bytes, str, str]:
    url = f"{RELEASE}/{ASSET.format(season=season)}"
    request = urllib.request.Request(url, headers={"User-Agent": "Data-Dawgs-CFB/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        modified = response.headers.get("Last-Modified")
    as_of = dt.datetime.strptime(modified, "%a, %d %b %Y %H:%M:%S %Z").date().isoformat() if modified else dt.date.today().isoformat()
    return raw, url, as_of


def latest_available(preferred: int) -> tuple[int, bytes, str, str]:
    for season in range(preferred, 2003, -1):
        try:
            raw, url, as_of = fetch(season)
            return season, raw, url, as_of
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise
    raise RuntimeError("No published cfbfastR team-summary season was found.")


def build(raw: bytes, url: str, as_of: str, season: int) -> dict:
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    missing = sorted(FIELDS - set(reader.fieldnames or []))
    if missing:
        raise ValueError("Upstream schema is missing: " + ", ".join(missing))

    rows = []
    for source in reader:
        if source["division"].strip().lower() != "fbs":
            continue
        row = {
            "team_id": source["team_id"].strip(),
            "team": source["pos_team"].strip(),
            "conference": source["conference"].strip() or "Independent",
            "season": number(source["season"], integer=True),
            "games": number(source["valid_games"], integer=True),
            "plays": number(source["plays_off"], integer=True),
            "adjusted": {
                "off_epa_play": number(source["adj_off_epa"]),
                "def_epa_play_allowed": number(source["adj_def_epa"]),
                "net_epa_play": number(source["net_adj_epa"]),
                "off_rank": number(source["adj_off_epa_rank"], integer=True),
                "def_rank": number(source["adj_def_epa_rank"], integer=True),
                "net_rank": number(source["net_adj_epa_rank"], integer=True),
            },
            "raw": {
                "off_epa_play": number(source["EPAplay_off"]),
                "def_epa_play_allowed": number(source["EPAplay_def"]),
                "off_success_rate": number(source["success_off"]),
                "def_success_rate_allowed": number(source["success_def"]),
            },
        }
        if row["team"] and row["season"] == season:
            rows.append(row)

    rows.sort(key=lambda row: (row["adjusted"]["net_rank"] or 9999, row["team"]))
    if len(rows) < 100:
        raise ValueError(f"Only {len(rows)} FBS team rows; refusing a partial or broken snapshot.")
    if len({row["team_id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate FBS team_id in upstream summary.")

    data = {
        "schema_version": 1,
        "season": season,
        "scope": "FBS season-to-date team efficiency",
        "metrics": {
            "adjusted.off_epa_play": "Opponent-adjusted offensive EPA per play; higher is better.",
            "adjusted.def_epa_play_allowed": "Opponent-adjusted EPA allowed per play; lower is better.",
            "adjusted.net_epa_play": "Adjusted offense minus adjusted defense; higher is better.",
            "raw.off_epa_play": "Unadjusted offensive EPA per play; higher is better.",
            "raw.def_epa_play_allowed": "Unadjusted EPA allowed per play; lower is better.",
            "raw.off_success_rate": "Share of offensive plays meeting the upstream success definition; higher is better.",
            "raw.def_success_rate_allowed": "Opponent success rate allowed; lower is better.",
        },
        "teams": rows,
    }
    source_hash = hashlib.sha256(raw).hexdigest()
    data_hash = hashlib.sha256(canonical(data)).hexdigest()
    built = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "as_of": as_of,
        "source": f"cfbfastR 3.0 / SportsDataverse espn_cfb_team_summaries release asset for {season}: {url} (sha256:{source_hash}).",
        "tier": "labs",
        "graded": False,
        "tier_meaning": TIER_MEANING,
        "note": (
            "MODELLED, DESCRIPTIVE SEASON SNAPSHOT. EPA/WPA play values and opponent adjustments are produced upstream by cfbfastR/SportsDataverse. "
            "Data Dawgs selects and labels fields but does not refit or independently validate those models here. This is not a forecast, betting line, poll or Data Dawgs power rating. "
            "Early-season samples can be very small; use games and plays with every comparison."
        ),
        "built": built,
        "canonical_url": "https://datadawgs216.com/data/cfb-efficiency.json",
        "provenance": {
            "generator": "scripts/cfb_efficiency_backbone.py",
            "source_url": url,
            "source_sha256": f"sha256:{source_hash}",
            "source_package": "cfbfastR 3.0",
            "upstream_model_ownership": "SportsDataverse/cfbfastR",
        },
        "integrity": {
            "snapshot_id": f"sha256:{data_hash}",
            "algorithm": "SHA-256 of canonical UTF-8 JSON for the data object (sorted object keys, no insignificant whitespace).",
            "rows": len(rows),
        },
        "data": data,
    }


def validate(payload: dict) -> None:
    if payload.get("tier") != "labs" or payload.get("graded") is not False:
        raise ValueError("Efficiency surface must remain an ungraded lab artifact.")
    data = payload.get("data") or {}
    rows = data.get("teams") or []
    if len(rows) < 100:
        raise ValueError("Efficiency surface has too few FBS rows.")
    if any(row.get("season") != data.get("season") for row in rows):
        raise ValueError("Mixed seasons in efficiency surface.")
    digest = "sha256:" + hashlib.sha256(canonical(data)).hexdigest()
    if payload.get("integrity", {}).get("snapshot_id") != digest:
        raise ValueError("Efficiency snapshot hash mismatch.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("refresh", "validate"))
    parser.add_argument("--season", type=int, default=dt.date.today().year)
    args = parser.parse_args()

    if args.command == "validate":
        validate(json.loads(OUTPUT.read_text()))
        print(f"validated {OUTPUT.relative_to(ROOT)}")
        return

    season, raw, url, as_of = latest_available(args.season)
    payload = build(raw, url, as_of, season)
    validate(payload)
    if OUTPUT.exists():
        previous = json.loads(OUTPUT.read_text())
        previous_without_build = {key: value for key, value in previous.items() if key != "built"}
        payload_without_build = {key: value for key, value in payload.items() if key != "built"}
        if previous_without_build == payload_without_build:
            print(f"unchanged {OUTPUT.relative_to(ROOT)}: season {season}")
            return
    OUTPUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {len(payload['data']['teams'])} FBS teams, season {season}")


if __name__ == "__main__":
    main()
