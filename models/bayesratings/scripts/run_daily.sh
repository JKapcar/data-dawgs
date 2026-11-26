#!/usr/bin/env bash
# Daily ESPN update and model fit. Runs only at 04:xx America/Chicago
# unless FORCE=1. Loads .env from the repo when that file exists.
# Requires flock (on macOS: brew install flock).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${FORCE:-0}" != 1 ] && [ "$(TZ=America/Chicago date +%H)" != 04 ]; then
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
exec 9>"$LOCK_DIR/daily.job"
flock -w 1800 9 || { echo "lock busy; skipping"; exit 1; }
PY="$REPO/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
DB="${BAYESRATINGS_DB:-$REPO/data/bayesratings.db}"
STATUS_DIR="${BAYESRATINGS_STATUS_DIR:-$REPO/data/status}"
mkdir -p "$STATUS_DIR"
# The 04:15 goalie pass feeds today's NHL starters. Wait if it is still running.
if ! flock -n "$LOCK_DIR/prelog-goalies.lock" true 2>/dev/null; then
  echo "waiting for the goalie pass"
  flock -w 600 "$LOCK_DIR/prelog-goalies.lock" true || echo "goalie pass still running; going on"
fi
if ! flock -n "$LOCK_DIR/prelog-nhl-slate.lock" true 2>/dev/null; then
  echo "waiting for the lines pass"
  flock -w 600 "$LOCK_DIR/prelog-nhl-slate.lock" true || echo "lines pass still running; going on"
fi
if ! flock -n "$LOCK_DIR/prelog-nfl-pbp.lock" true 2>/dev/null; then
  echo "waiting for the play-by-play pass"
  flock -w 600 "$LOCK_DIR/prelog-nfl-pbp.lock" true || echo "play-by-play pass still running; going on"
fi
"$PY" -m bayesratings.daily --db "$DB" --status-file "$STATUS_DIR/daily.log"
rc=$?
if [ "$rc" -eq 0 ]; then
  mkdir -p "$REPO/backups"
  nice -n 19 "$PY" "$REPO/scripts/backup_db.py" \
    --db "$DB" --dir "$REPO/backups" --keep 1 \
    >>"$REPO/backups/backup.log" 2>&1 || echo "backup failed (see backups/backup.log)"
else
  echo "daily update failed (exit $rc); skipping backup"
fi
exit "$rc"
