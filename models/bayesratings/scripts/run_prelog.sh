#!/usr/bin/env bash
# Update passes (bayesratings.prelog).
#   run_prelog.sh KIND [GATE_HOUR] [extra args]
# KIND: morning | rosters | depth | transactions | pregame | sources | goalies |
# nhl-lines | nhl-slate | mlb-probables | nbainj | nflverse | nfl-pbp | mlb-extra |
# nhl-pbp | inj-hist | check.
# GATE_HOUR is 00-23 America/Chicago, a range like 08-22, or "-" for none.
# Cron can fire at two UTC hours so the pass lands on the same Chicago hour
# in both CDT and CST. Requires flock (on macOS: brew install flock).
set -u
KIND="${1:?kind}"; GATE="${2:--}"; shift $(( $# >= 2 ? 2 : 1 ))
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${FORCE:-0}" != 1 ] && [ "$GATE" != "-" ]; then
  H=$((10#$(TZ=America/Chicago date +%H)))
  case "$GATE" in
    *-*) [ "$H" -ge $((10#${GATE%-*})) ] && [ "$H" -le $((10#${GATE#*-})) ] || exit 0 ;;
    *) [ "$H" -eq $((10#$GATE)) ] || exit 0 ;;
  esac
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
exec 9>"$LOCK_DIR/prelog-$KIND.lock"
flock -n 9 || { echo "prelog $KIND already running; skipping"; exit 0; }
PY="$REPO/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
DB="${BAYESRATINGS_DB:-$REPO/data/bayesratings.db}"
STATUS_DIR="${BAYESRATINGS_STATUS_DIR:-$REPO/data/status}"
mkdir -p "$STATUS_DIR"
exec nice -n 19 "$PY" -m bayesratings.prelog "$KIND" "$@" \
  --db "$DB" --status-file "$STATUS_DIR/prelog.log"
