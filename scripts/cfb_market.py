#!/usr/bin/env python3
"""Data Dawgs canonical CFB market surface (roadmap step 1, idea cfb-market).

Ingests SportsDataverse's `betting/csv/cfb_line_odds.csv.gz` and publishes
book-identified spread, total and moneyline prices joined to the canonical CFB
schedule, at /data/cfb-market.json.

THE TIMING CAVEAT, stated once here and again in the envelope, because it
governs every legitimate use of this file:

    The upstream table carries a `date_time` column, but it is the KICKOFF
    time, not an observation time. Every row for a given game, book and market
    shares it. There is therefore NO observation timestamp: we know which book
    quoted a number, and not when.

Consequences, all enforced by naming rather than left to the reader:
  - These are NOT closing lines. Nothing here may be called a closing line, and
    no closing-line value (CLV) may be computed from it.
  - A model-vs-market comparison built on this file is directionally useful and
    formally unfair to the model: if these prices are late, they contain
    information a pregame model did not have. Reported as a reference point,
    never as a verdict.
  - No forecast receipt may cite this file as a prospective market input,
    because "prospective" cannot be established without a capture time.

The NFL backbone excludes its upstream market columns entirely because they
identify neither book nor observation time. This file clears the first bar and
not the second, so it ships labelled rather than suppressed.

Devigging matches the house method in work/pound-core.js exactly: proportional
normalization of the two raw implied probabilities.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import importlib.util
import io
import json
import math
import statistics
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "cfb-market.json"
DEFAULT_SCHEDULE = ROOT / "data" / "cfb-schedule.json"
SOURCE_PATH = "betting/csv/cfb_line_odds.csv.gz"
SOURCE_URL = f"https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/{SOURCE_PATH}"

_SPEC = importlib.util.spec_from_file_location("cfb_data_backbone", ROOT / "scripts" / "cfb_data_backbone.py")
backbone = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault(_SPEC.name, backbone)
_SPEC.loader.exec_module(backbone)

ContractError = backbone.ContractError

BOOK_ALIASES = {"draft kings": "DraftKings", "draftkings": "DraftKings",
                "espn bet": "ESPN Bet", "bovada": "Bovada"}
KNOWN_MARKETS = {"spread", "total", "money_line"}
REQUIRED_SOURCE_COLUMNS = {
    "game_id", "season", "date_time", "market_type", "abbr", "lines", "odds",
    "opening_lines", "opening_odds", "book", "season_type", "week",
}


def normalize_book(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ContractError("market row has no book; the market contract requires one")
    return BOOK_ALIASES.get(text.lower(), text)


def american_to_decimal(value: Any) -> float:
    number = float(str(value).strip())
    if number == 0 or -100 < number < 100:
        raise ContractError(f"implausible American odds: {value!r}")
    return 1.0 + (number / 100.0 if number > 0 else 100.0 / -number)


class QuoteRejected(ValueError):
    """One book's quote is unusable. The build continues; the rejection is published."""


# A two-way market cannot really hold more than a few percent. Anything past this
# is a corrupt upstream row, not a wide market.
MAX_PLAUSIBLE_OVERROUND = 1.12
MAX_REJECTED_QUOTE_SHARE = 0.01


def devig_pair(home_odds: Any, away_odds: Any) -> tuple[float, float]:
    """Proportional devig, identical to holdVig() in work/pound-core.js."""
    raw = [1.0 / american_to_decimal(home_odds), 1.0 / american_to_decimal(away_odds)]
    total = raw[0] + raw[1]
    if not 1.0 <= total <= MAX_PLAUSIBLE_OVERROUND:
        raise QuoteRejected(f"implausible two-way overround {total:.4f}")
    return raw[0] / total, total - 1.0


def nullable_float(value: Any) -> float | None:
    text = str(value or "").strip()
    if text in ("", "NA"):
        return None
    number = float(text)
    if not math.isfinite(number):
        return None
    return number


def fetch_source() -> tuple[str, str]:
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "data-dawgs-cfb-market/1"})
    with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310 - fixed HTTPS URL
        raw = response.read()
    if not raw:
        raise ContractError("empty market download")
    import hashlib
    return gzip.decompress(raw).decode("utf-8"), hashlib.sha256(raw).hexdigest()


def build_rows(text: str, schedule: dict[str, Any], season: int) -> list[dict[str, Any]]:
    by_upstream = {g["upstream_game_id"]: g for g in schedule["data"]["games"]}
    # (game, book) -> market accumulator
    quotes: dict[tuple[str, str], dict[str, Any]] = {}
    seen_kickoffs: dict[str, set[str]] = {}

    for raw in csv.DictReader(io.StringIO(text)):
        missing = REQUIRED_SOURCE_COLUMNS - set(raw)
        if missing:
            raise ContractError(f"market source missing columns: {', '.join(sorted(missing))}")
        if nullable_float(raw["season"]) != season:
            continue
        upstream = str(raw["game_id"]).strip()
        game = by_upstream.get(upstream)
        if game is None:
            continue  # odds cover games outside the FBS-involved canonical set
        market = str(raw["market_type"]).strip().lower()
        if market not in KNOWN_MARKETS:
            raise ContractError(f"unknown market_type: {raw['market_type']!r}")
        book = normalize_book(raw["book"])
        seen_kickoffs.setdefault(upstream, set()).add(str(raw["date_time"]).strip())
        key = (upstream, book)
        quote = quotes.setdefault(key, {
            "spread_home": None, "spread_open_home": None,
            "total": None, "total_open": None,
            "moneyline_home": None, "moneyline_away": None,
        })
        side = str(raw["abbr"]).strip()
        line = nullable_float(raw["lines"])
        opening = nullable_float(raw["opening_lines"])
        if market == "spread":
            if side == game["home_team"]:
                quote["spread_home"], quote["spread_open_home"] = line, opening
            elif side != game["away_team"]:
                raise ContractError(f"spread side {side!r} matches neither team in {upstream}")
        elif market == "total":
            if side.lower() == "over":
                quote["total"], quote["total_open"] = line, opening
            elif side.lower() != "under":
                raise ContractError(f"total side must be over/under, found {side!r}")
        else:
            odds = nullable_float(raw["odds"])
            if side == game["home_team"]:
                quote["moneyline_home"] = odds
            elif side == game["away_team"]:
                quote["moneyline_away"] = odds
            else:
                raise ContractError(f"moneyline side {side!r} matches neither team in {upstream}")

    for upstream, kickoffs in seen_kickoffs.items():
        if len(kickoffs) > 1:
            raise ContractError(
                f"{upstream} has multiple date_time values; the assumption that date_time is "
                "kickoff rather than an observation time no longer holds and this script's "
                "timing caveat must be revisited"
            )

    games: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for game in schedule["data"]["games"]:
        upstream = game["upstream_game_id"]
        books = []
        for (gid, book), quote in sorted(quotes.items()):
            if gid != upstream:
                continue
            entry = {"book": book, **quote, "devig_home_win_probability": None, "hold": None}
            if quote["moneyline_home"] is not None and quote["moneyline_away"] is not None:
                try:
                    probability, hold = devig_pair(quote["moneyline_home"], quote["moneyline_away"])
                except (QuoteRejected, ValueError) as exc:
                    rejected.append({
                        "game_id": game["game_id"], "book": book, "market": "money_line",
                        "moneyline_home": quote["moneyline_home"],
                        "moneyline_away": quote["moneyline_away"],
                        "reason": str(exc),
                    })
                    entry["moneyline_home"] = entry["moneyline_away"] = None
                else:
                    entry["devig_home_win_probability"] = round(probability, 6)
                    entry["hold"] = round(hold, 6)
            books.append(entry)
        if not books:
            continue
        spreads = [b["spread_home"] for b in books if b["spread_home"] is not None]
        totals = [b["total"] for b in books if b["total"] is not None]
        probabilities = [b["devig_home_win_probability"] for b in books
                         if b["devig_home_win_probability"] is not None]
        games.append({
            "game_id": game["game_id"],
            "upstream_game_id": upstream,
            "season": game["season"],
            "week": game["week"],
            "kickoff_at": game["kickoff_at"],
            "home_team": game["home_team"],
            "away_team": game["away_team"],
            "books": books,
            "median_spread_home": round(statistics.median(spreads), 2) if spreads else None,
            "median_total": round(statistics.median(totals), 2) if totals else None,
            "median_devig_home_win_probability": (
                round(statistics.median(probabilities), 6) if probabilities else None
            ),
            "books_quoting": len(books),
        })
    quoted_pairs = sum(len(g["books"]) for g in games) + len(rejected)
    if quoted_pairs and len(rejected) / quoted_pairs > MAX_REJECTED_QUOTE_SHARE:
        raise ContractError(
            f"{len(rejected)} of {quoted_pairs} quotes rejected as corrupt "
            f"(limit {MAX_REJECTED_QUOTE_SHARE:.0%}); the upstream feed has degraded"
        )
    validate_market_games(games)
    return games, rejected


def validate_market_games(games: list[dict[str, Any]]) -> None:
    if not 200 <= len(games) <= 1100:
        raise ContractError(f"suspicious market game count: {len(games)}")
    ids = [g["game_id"] for g in games]
    if len(ids) != len(set(ids)):
        raise ContractError("duplicate market game_id")
    for game in games:
        if not game["books"]:
            raise ContractError(f"market row with no books: {game['game_id']}")
        seen = set()
        for book in game["books"]:
            if book["book"] in seen:
                raise ContractError(f"duplicate book {book['book']} for {game['game_id']}")
            seen.add(book["book"])
            probability = book["devig_home_win_probability"]
            if probability is not None and not 0.0 < probability < 1.0:
                raise ContractError(f"devig probability out of range for {game['game_id']}")
            if book["hold"] is not None and not -0.01 <= book["hold"] <= 0.5:
                raise ContractError(f"implausible hold for {game['game_id']}: {book['hold']}")
            if book["spread_home"] is not None and abs(book["spread_home"]) > 80:
                raise ContractError(f"implausible spread for {game['game_id']}")
            if book["total"] is not None and not 15 <= book["total"] <= 130:
                raise ContractError(f"implausible total for {game['game_id']}")


def make_envelope(games: list[dict[str, Any]], rejected: list[dict[str, Any]], season: int,
                  schedule: dict[str, Any], repo_head: str, source_sha256: str,
                  captured_at: str) -> dict[str, Any]:
    with_probability = sum(g["median_devig_home_win_probability"] is not None for g in games)
    payload = {"season": season, "games": games, "rejected_quotes": rejected}
    return {
        "as_of": captured_at[:10],
        "source": (
            f"{backbone.SOURCE_REPOSITORY} {SOURCE_PATH} on branch {backbone.SOURCE_BRANCH} "
            f"(repository HEAD {repo_head} at capture; raw snapshot sha256 {source_sha256})."
        ),
        "tier": "labs",
        "graded": False,
        "note": (
            "Book-identified CFB prices joined to the canonical schedule. TIMING IS UNKNOWN: "
            "the upstream date_time column is the kickoff time, not an observation time, so "
            "there is no capture timestamp for any price. These are NOT closing lines, no CLV "
            "may be computed from them, and no forecast receipt may cite them as a prospective "
            "market input. A model-vs-market comparison drawn from this file is a reference "
            "point only, and one that flatters the market: if these prices are late, they carry "
            "information a pregame model did not have. Devig is proportional, matching "
            "work/pound-core.js."
        ),
        "provenance": {
            "source_repository": backbone.SOURCE_REPOSITORY,
            "source_path": SOURCE_PATH,
            "source_url": SOURCE_URL,
            "source_repo_head_at_capture": repo_head,
            "source_raw_sha256": source_sha256,
            "source_data_license": "not-verified-for-cfbfastR-data-repository",
            "joined_to_schedule_snapshot": schedule["integrity"]["snapshot_id"],
            "observation_timestamp_available": False,
            "price_timing": "unknown",
            "devig_method": "proportional normalization of two-way raw implied probabilities",
            "captured_at": captured_at,
        },
        "integrity": {
            "snapshot_id": backbone.sha256_id(payload),
            "algorithm": (
                "SHA-256 of canonical UTF-8 JSON for the data object "
                "(sorted object keys, no insignificant whitespace)."
            ),
            "games": len(games),
            "games_with_devig_probability": with_probability,
            "rejected_quotes": len(rejected),
        },
        "data": payload,
        "tier_meaning": backbone.TIER_MEANING,
        "built": captured_at[:10],
        "canonical_url": "https://datadawgs216.com/data/cfb-market.json",
    }


def validate_envelope(envelope: dict[str, Any]) -> None:
    data = envelope.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("games"), list):
        raise ContractError("market data.games must be an array")
    if not isinstance(data.get("rejected_quotes"), list):
        raise ContractError("market data.rejected_quotes must be an array, even when empty")
    if len(data["rejected_quotes"]) != envelope.get("integrity", {}).get("rejected_quotes"):
        raise ContractError("integrity.rejected_quotes disagrees with the published rejections")
    validate_market_games(data["games"])
    if envelope.get("integrity", {}).get("snapshot_id") != backbone.sha256_id(data):
        raise ContractError("market snapshot hash mismatch")
    provenance = envelope.get("provenance", {})
    if provenance.get("observation_timestamp_available") is not False:
        raise ContractError("market provenance must declare that no observation timestamp exists")
    if provenance.get("price_timing") != "unknown":
        raise ContractError("market provenance must declare price timing unknown")
    if "closing" in json.dumps(data).lower():
        raise ContractError("market data must not describe any price as closing")
    backbone.parse_timestamp(provenance.get("captured_at"), "provenance.captured_at")


def cmd_refresh(args: argparse.Namespace) -> int:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    schedule = backbone.read_json(Path(args.schedule))
    backbone.validate_schedule_envelope(schedule)
    season = schedule["data"]["season"]
    text, source_sha256 = fetch_source()
    repo_head = backbone.fetch_source_repo_head()
    games, rejected = build_rows(text, schedule, season)
    envelope = make_envelope(games, rejected, season, schedule, repo_head, source_sha256, captured_at)
    validate_envelope(envelope)
    backbone.write_json(Path(args.output), envelope)
    print(f"wrote {args.output}: {len(games)} games priced, "
          f"{envelope['integrity']['games_with_devig_probability']} with a devigged probability, "
          f"{len(rejected)} corrupt quotes rejected and published")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    validate_envelope(backbone.read_json(Path(args.output)))
    print(f"{args.output} satisfies the CFB market contract")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    refresh = sub.add_parser("refresh", help="download prices and write the canonical market file")
    refresh.add_argument("--output", default=str(DEFAULT_OUTPUT))
    refresh.add_argument("--schedule", default=str(DEFAULT_SCHEDULE))
    refresh.set_defaults(func=cmd_refresh)
    validate = sub.add_parser("validate", help="validate the published market file (offline)")
    validate.add_argument("--output", default=str(DEFAULT_OUTPUT))
    validate.set_defaults(func=cmd_validate)
    args = parser.parse_args()
    try:
        return args.func(args)
    except ContractError as exc:
        print(f"contract violation: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
