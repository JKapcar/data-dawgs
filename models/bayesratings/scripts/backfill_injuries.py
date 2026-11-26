#!/usr/bin/env python3
"""Pull historical NBA and NFL injury reports into a standalone SQLite file.

Runs anywhere. It does not need the production database. One season per
process, one file per season, so seasons can run together:

    python scripts/backfill_injuries.py --out injuries_2024.db --from-season 2024 --to-season 2024 --rate 1

Season labels differ. NFL is the start year (2024 is the 2024 season).
NBA is the end year (2025 is 2024-25). NFL files start in 2009. NBA PDFs
start in 2019 (2018-19), one report per calendar day, noon Eastern when
that file exists. A day or a past NFL season already stored is not
downloaded again. --rate is seconds between requests (default 1).
--league is nba, nfl, or both. Exit 1 when any day or file failed.
Re-run the same command to retry.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from bayesratings.sources.injhist import main  # noqa: E402


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
