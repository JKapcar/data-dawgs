#!/usr/bin/env python3
"""Copy a shipped MLB box / batted-ball file into the main database.

    python scripts/load_mlb_extra.py --db data/bayesratings.db --from mlb_extra_2016.db

ATTACHes the file and inserts box scores, batted balls, and the per-player
aggregates. Running it again replaces the same keys. ESPN event ids and
athlete ids are filled from the main games and players when the date and
the teams match.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from bayesratings.sources.mlb_extra import main  # noqa: E402


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
