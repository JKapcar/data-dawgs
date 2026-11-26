#!/usr/bin/env python3
"""Thin wrapper: `python3 scripts/backfill.py --leagues mlb --seasons 5`.
Same flags as `python -m bayesratings.backfill`."""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from bayesratings.backfill import main  # noqa: E402

if __name__ == "__main__":
    main()
