#!/usr/bin/env python3
"""Copy a shipped NHL shots file into the main database.

    python scripts/load_nhl_shots.py --db data/bayesratings.db --from nhl_shots.db

ATTACHes the file and inserts games, shots, player rows, the xG model, and
the play-by-play digests. Running it again replaces the same keys. ESPN
event ids are filled from the main games table when the abbreviation and
date match one game.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from bayesratings.sources.nhl_pbp import main  # noqa: E402


def _argv(argv):
    out = []
    i = 0
    while i < len(argv):
        if argv[i] == "--from" and i + 1 < len(argv):
            out.extend(["--load", argv[i + 1]])
            i += 2
            continue
        out.append(argv[i])
        i += 1
    return out


if __name__ == "__main__":
    raise SystemExit(main(_argv(sys.argv[1:])))
