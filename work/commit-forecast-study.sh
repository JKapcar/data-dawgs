#!/usr/bin/env bash
# Commit the forecast study's cohort files to main. Each stage reads the files the previous
# stage wrote (pool -> draw -> collect -> resolve -> grade), so an uncommitted stage is a lost
# stage. Only data/cohorts/ is staged; nothing else writes there, so the rebase cannot conflict.
# No Pages build is requested: no page reads these files yet.
set -euo pipefail
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
[ -d data/cohorts ] || { echo 'No cohorts yet.'; exit 0; }
git add data/cohorts
if git diff --cached --quiet; then echo 'No cohort changes.'; exit 0; fi
git commit -m "$1"
for attempt in 1 2 3; do
  if git push origin HEAD:main; then exit 0; fi
  echo "Push raced another writer; retry $attempt/3"
  git pull --rebase origin main
done
echo 'Push failed after three attempts' >&2
exit 1
