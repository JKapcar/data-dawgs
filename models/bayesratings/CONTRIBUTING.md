# Contributing

This repository is the models and the data pipeline. Changes should keep
`bayesratings init`, `backfill`, `extract`, `update`, `daily`, `check`, and
`show` working, and the docs in step with the code.

## Setup

Python 3.12, a C++ compiler, and CmdStan. The install and the NBA quickstart
are in `README.md`. Set `BAYESRATINGS_USER_AGENT` in `.env` before you fetch
anything. Do not commit `.env`, a database, or a raw payload.

## Tests

```bash
.venv/bin/pip install pytest
.venv/bin/python -m pytest
```

The rating-fit tests compile and sample the Stan models, so CmdStan has to
be installed. `tests/test_no_odds.py` fails if a prediction-market exchange
name, a server path, an unexpected host, a non-loopback address, or a key
appears in the tree. Odds that come from ESPN or nflverse are allowed.

## Changes

- Match the flags in `bayesratings/cli.py`. A command in the README has to
  be one the code accepts.
- A new table goes in `bayesratings/schema.sql` and in `docs/database.md`.
- A change to how a forecast is made goes in `docs/model.md`.
- Do not add a second database, a hosted app, or a fetcher that needs a key.
- Contributions are licensed under the AGPL-3.0, the same license as
  `LICENSE`.
