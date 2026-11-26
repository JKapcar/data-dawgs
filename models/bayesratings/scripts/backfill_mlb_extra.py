#!/usr/bin/env python3
"""Pull MLB box scores and Statcast batted balls into a standalone SQLite file.

Runs anywhere. It does not need the production database. One season per
process, one file per season, so seasons can run together:

    python scripts/backfill_mlb_extra.py --out mlb_extra_2016.db --from-season 2016 --to-season 2016

Box scores start in 2006 (doubles, triples, home runs, hit by pitch,
sacrifices, and the other batting and pitching counts ESPN does not keep).
Statcast batted balls start in 2015; a season before that has boxes only.
A game or date already in the file is not downloaded again. --rate is
seconds between requests (default 1). Statcast is requested in 3-day
windows. Exit 1 when any game or date failed. Re-run the same command to
retry. The file holds the narrow rows, not the raw box or the pitch CSV.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from bayesratings.sources.mlb_extra import main  # noqa: E402


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
