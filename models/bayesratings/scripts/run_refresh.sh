#!/usr/bin/env bash
# Hourly schedule refresh, and every 10 minutes with --live.
# Skips the 04:xx America/Chicago hour (the daily job owns it) unless FORCE=1.
# Requires flock (on macOS: brew install flock).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${FORCE:-0}" != 1 ] && [ "$(TZ=America/Chicago date +%H)" = 04 ]; then
  exit 0
fi
cd "$REPO" || exit 1
if [ -f "$REPO/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO/.env"
  set +a
fi
LOCK_DIR="${BAYESRATINGS_LOCK_DIR:-$REPO/data}"
mkdir -p "$LOCK_DIR"
exec 9>"$LOCK_DIR/refresh.job"
flock -n 9 || { echo "refresh already running; skipping"; exit 0; }
PY="$REPO/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
DB="${BAYESRATINGS_DB:-$REPO/data/bayesratings.db}"
STATUS_DIR="${BAYESRATINGS_STATUS_DIR:-$REPO/data/status}"
mkdir -p "$STATUS_DIR"
STATUS="$STATUS_DIR/refresh.log"
[ "${1:-}" = --live ] && STATUS="$STATUS_DIR/refresh-live.log"
exec "$PY" -m bayesratings.refresh --db "$DB" --status-file "$STATUS" "$@"
