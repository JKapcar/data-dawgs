#!/usr/bin/env python3
"""Pull NHL shot locations into a standalone SQLite file.

Runs anywhere. It does not need the production database. The file holds
games, shots, per-player xG and GSAx, and the logistic coefficients. Raw
play-by-play is not stored, so the file stays small.

    python scripts/backfill_nhl_shots.py --out nhl_shots.db --from-season 2009 --to-season 2025

Seasons are NHL start years (2025 is 2025-26). A game already in the file is
not downloaded again. --rate is seconds between requests (default 1; each
game is a play-by-play request and a box-score request). The fit runs once
at the end unless --no-fit. Exit 1 when any game failed. Re-run the same
command to retry those games. Coordinates are reliable from the 2009 season.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from bayesratings.sources.nhl_pbp import main  # noqa: E402


def _argv(argv):
    out = ["--backfill"]
    i = 0
    while i < len(argv):
        if argv[i] == "--out" and i + 1 < len(argv):
            out.extend(["--db", argv[i + 1]])
            i += 2
            continue
        out.append(argv[i])
        i += 1
    return out


if __name__ == "__main__":
    raise SystemExit(main(_argv(sys.argv[1:])))
