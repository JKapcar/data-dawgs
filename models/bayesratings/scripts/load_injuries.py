#!/usr/bin/env python3
"""Copy a shipped injury-report file into the main database.

    python scripts/load_injuries.py --db data/bayesratings.db --from injuries_2024.db

ATTACHes the file and inserts NBA reports, NBA player statuses, and NFL
player-week statuses. A report slot or player-week already stored is left
as it is, so running it again inserts nothing. ESPN team, player and game
ids are filled from the main database.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from bayesratings.sources.injhist import main  # noqa: E402


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
