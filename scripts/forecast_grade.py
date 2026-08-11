#!/usr/bin/env python3
"""Grade the forecasting challenge (Stage FC-F).

Joins four things that are deliberately kept apart until this moment:

    outcomes   data/nfl-schedule.json          — status "final" plus the two scores
    entries    GET /forecast/week (admin)      — every entry for a fully-locked week
    models     data/model-receipts.json        — the dated, prospective model lines
    crowd      the sealed crowd rows           — one per game, frozen at kickoff

and emits one graded row per (entrant, game_id).

⚠️ WHY THE GRADER LIVES HERE AND NOT IN THE WORKER. Outcomes and grades are evidence
ABOUT forecasts, and they are produced by a different process, from a different source,
at a different time. Keeping them in one place would let a bug in scoring rewrite a
forecast, which is the one thing the storage layer is built to make impossible.

⚠️ NOTHING SIMULATED MAY EVER BE WRITTEN TO THE REAL LEDGER. The output is append-only
with an integrity hash over the rows in append order, exactly like model-receipts.json.
That makes "write test rows, delete them later" the one operation the format forbids: a
ledger you can retract is not a ledger. Use --out to write a scratch file when
rehearsing, and let the first row in data/forecast-grades.json be a real one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent

# The scoring rule, and the reason it is this one. points = 25 - 100 * (p - r)^2 is a
# linear transform of the Brier score, so one number ranks people and models identically
# and nobody needs a second leaderboard to argue about. A correct certainty is +25, a
# confident miss is -75, and a slider left alone in the middle is exactly 0.
POINTS_CEILING = 25.0
POINTS_SLOPE = 100.0


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def points_for(p: float, r: int) -> float:
    """25 - 100(p - r)^2, with p the probability on the HOME team and r the home result.

    ⚠️ SIDE-SYMMETRIC BY CONSTRUCTION. Substituting p -> 1-p and r -> 1-r leaves the
    square unchanged, so it cannot matter which side a person expressed their forecast
    on. That is why storage keeps only the canonical home probability and the raw slider
    beside it, and why no part of this file needs to know about sides at all.
    """
    return POINTS_CEILING - POINTS_SLOPE * (p - r) ** 2


def brier_for(p: float, r: int) -> float:
    return (p - r) ** 2


def log_loss_for(p: float, r: int) -> float:
    """Log loss, clamped. An unclamped log loss is infinite on a confident miss, and one
    such row would swallow every average it appears in — the metric would describe a
    single game rather than a season."""
    q = min(1 - 1e-15, max(1e-15, p))
    return -(math.log(q) if r == 1 else math.log(1 - q))


def outcome_of(game: dict[str, Any]) -> tuple[int | None, str]:
    """Return (home_result, why). home_result is 1, 0, or None for VOID.

    ⚠️ TIES ARE VOID FOR EVERYONE, MODELS INCLUDED — a deliberate deviation from 538,
    which resolved them at r = 0.5. Scoring a tie at 0.5 hands an untouched 50 slider a
    free +25 for having no opinion, which would make refusing to forecast the single
    best strategy on the board. Void rows are dropped from every denominator; they are
    not scored as zero, because "did not count" and "scored nothing" are different facts.
    """
    if game.get("status") != "final":
        return None, "not final"
    home, away = game.get("home_score"), game.get("away_score")
    if not isinstance(home, int) or not isinstance(away, int):
        return None, "final without a score"
    if home == away:
        return None, "tie — void for everyone"
    return (1 if home > away else 0), "final"


def load_envelope(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or "data" not in payload:
        raise SystemExit(f"{path}: not a data envelope")
    if not payload.get("as_of") or not payload.get("source"):
        raise SystemExit(f"{path}: an envelope must carry as_of and source")
    return payload


def schedule_index(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    games = payload["data"].get("games") if isinstance(payload["data"], dict) else None
    if not isinstance(games, list) or not games:
        raise SystemExit("the schedule payload carries no games")
    return {g["game_id"]: g for g in games if isinstance(g.get("game_id"), str)}


def grade_rows(
    entries: Iterable[dict[str, Any]],
    games: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Grade what can be graded. Returns (graded, skipped) and never raises on one bad row.

    A row that cannot be graded is REPORTED, not dropped silently — a grader that quietly
    ignores what it does not understand is indistinguishable from one that works.
    """
    graded: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for e in entries:
        gid = e.get("game_id")
        entrant = e.get("entrant")
        game = games.get(gid) if isinstance(gid, str) else None
        if game is None:
            skipped.append({"entrant": entrant, "game_id": gid, "why": "not in the canonical schedule"})
            continue

        p = e.get("home_win_probability")
        if not isinstance(p, (int, float)) or not (0.0 <= float(p) <= 1.0):
            skipped.append({"entrant": entrant, "game_id": gid, "why": "no usable home_win_probability"})
            continue
        p = float(p)

        r, why = outcome_of(game)
        if r is None:
            skipped.append({"entrant": entrant, "game_id": gid, "why": why})
            continue

        graded.append({
            "entrant": entrant,
            "entrant_kind": e.get("entrant_kind", "human"),
            "owner": e.get("owner", entrant),
            "sport": e.get("sport"),
            "season": game.get("season"),
            "week": game.get("week"),
            "game_id": gid,
            "home_win_probability": round(p, 6),
            "touched": e.get("touched"),
            "home_result": r,
            "points": round(points_for(p, r), 6),
            "brier": round(brier_for(p, r), 6),
            "log_loss": round(log_loss_for(p, r), 6),
            # The outcome travels WITH its source. A grade whose provenance is implicit is
            # a number somebody has to take on trust.
            "outcome_source": "data/nfl-schedule.json",
            "home_score": game.get("home_score"),
            "away_score": game.get("away_score"),
        })

    graded.sort(key=lambda row: (str(row["game_id"]), str(row["entrant"])))
    return graded, skipped


def leaderboards(graded: list[dict[str, Any]]) -> dict[str, Any]:
    """Both boards. Never one.

    ⚠️ TOTAL POINTS REWARDS SHOWING UP. A game you did not forecast is zero points, so a
    model that forecast all 272 and a person who forecast 40 cannot be compared on it —
    publishing only that board would be making exactly the claim this site tells everyone
    else not to make. Beside it goes a COMMON-SAMPLE board restricted to the games every
    entrant in the comparison forecast, with n and coverage on every row so the reader can
    see how much the restriction cost.
    """
    by_entrant: dict[str, list[dict[str, Any]]] = {}
    for row in graded:
        by_entrant.setdefault(str(row["entrant"]), []).append(row)

    totals = []
    for entrant, rows in by_entrant.items():
        n = len(rows)
        totals.append({
            "entrant": entrant,
            "entrant_kind": rows[0].get("entrant_kind", "human"),
            "n": n,
            "points": round(sum(r["points"] for r in rows), 6),
            "brier": round(sum(r["brier"] for r in rows) / n, 6),
            "log_loss": round(sum(r["log_loss"] for r in rows) / n, 6),
        })
    totals.sort(key=lambda t: -t["points"])

    # The common sample: games EVERY entrant forecast. With one entrant this is their own
    # set; with none it is empty, and an empty common sample is reported rather than
    # papered over with the totals board.
    sets = [set(r["game_id"] for r in rows) for rows in by_entrant.values()]
    common = set.intersection(*sets) if sets else set()

    common_rows = []
    for entrant, rows in by_entrant.items():
        sub = [r for r in rows if r["game_id"] in common]
        if not sub:
            continue
        n = len(sub)
        common_rows.append({
            "entrant": entrant,
            "entrant_kind": sub[0].get("entrant_kind", "human"),
            "n": n,
            "coverage": round(n / len(common), 6) if common else 0.0,
            "points": round(sum(r["points"] for r in sub), 6),
            "brier": round(sum(r["brier"] for r in sub) / n, 6),
            "log_loss": round(sum(r["log_loss"] for r in sub) / n, 6),
        })
    common_rows.sort(key=lambda t: t["brier"])

    return {
        "totals": {
            "note": "Total points rewards showing up: a game you did not forecast scores nothing, so entrants with different coverage are NOT comparable here.",
            "rows": totals,
        },
        "common_sample": {
            "note": "Restricted to the games every entrant forecast, which is the only set on which these numbers may be compared. n and coverage are on every row.",
            "n_games": len(common),
            "rows": common_rows,
        },
    }


def build_payload(graded: list[dict[str, Any]], skipped: list[dict[str, Any]], as_of: str) -> dict[str, Any]:
    digest = hashlib.sha256("\n".join(canonical_json(r) for r in graded).encode("utf-8")).hexdigest()
    return {
        "as_of": as_of,
        "source": "Data Dawgs forecasting-challenge grades. Outcomes joined from the canonical NFL schedule; forecasts read from the Worker's own store. Scored with points = 25 - 100(p - r)^2.",
        "tier": "labs",
        "graded": True,
        "note": (
            "One row per entrant per graded game. Ties are VOID for everyone including models and are "
            "dropped from every denominator rather than scored at 0.5, because scoring a tie at 0.5 would "
            "hand an untouched slider a free +25. No running total is stored: the boards below are queries "
            "over these rows, recomputed from them, and nothing else is authoritative."
        ),
        "integrity": {
            "sha256": digest,
            "algorithm": "SHA-256 of canonical graded JSON rows joined by LF in append order.",
            "rows": len(graded),
        },
        "canonical_url": "https://datadawgs216.com/data/forecast-grades.json",
        "data": {
            "rows": graded,
            "skipped": skipped,
            "boards": leaderboards(graded),
        },
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entries", required=True, type=Path,
                    help="JSON file of entries: a list, or {entries:[...]} as the Worker returns them")
    ap.add_argument("--schedule", type=Path, default=ROOT / "data" / "nfl-schedule.json")
    ap.add_argument("--as-of", required=True, help="the date this grading run reflects, YYYY-MM-DD")
    ap.add_argument("--out", type=Path, default=None,
                    help="where to write. ⚠️ Point this at a scratch path when rehearsing — "
                         "the real ledger is append-only and rows may never be retracted.")
    args = ap.parse_args(argv)

    raw = json.loads(args.entries.read_text(encoding="utf-8"))
    entries = raw.get("entries") if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        raise SystemExit("--entries must hold a list, or an object with an 'entries' list")

    games = schedule_index(load_envelope(args.schedule))
    graded, skipped = grade_rows(entries, games)
    payload = build_payload(graded, skipped, args.as_of)

    if args.out is None:
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=1)
        sys.stdout.write("\n")
    else:
        # newline="\n": Python otherwise translates every \n to \r\n on Windows, which
        # would change the file's bytes and break every hash taken over it.
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
        print(f"wrote {args.out}: {len(graded)} graded, {len(skipped)} skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
