#!/usr/bin/env bash
# Rebuild past ratings and forecasts, one league at a time, at low priority.
# Safe to stop and start again: finished days are skipped.
# The Python replay takes the writer lock. This wrapper does not call flock.
#
#   LEAGUES="nba" scripts/run_replay.sh --seasons 1
# Weekly refits: add --refit weekly. Start date: --since YYYY-MM-DD.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
DB="${BAYESRATINGS_DB:-data/bayesratings.db}"
LEAGUES="${LEAGUES:-nfl nba nhl mlb}"
PY=".venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
for lg in $LEAGUES; do
  nice -n 15 "$PY" -m bayesratings.replay --db "$DB" --leagues "$lg" "$@" \
    || echo "replay $lg finished with errors (see above)"
done
echo "replay all done"
