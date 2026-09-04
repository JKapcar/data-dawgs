#!/usr/bin/env bash
# Rebase one validated automation commit. Resolve ONLY generated-file conflicts.
# Every other conflict fails closed; never force push or recompute a captured claim.
set -euo pipefail
for attempt in 1 2 3; do
  git fetch origin main
  if ! git rebase origin/main; then
    mapfile -t conflicts < <(git diff --name-only --diff-filter=U)
    if [ "${#conflicts[@]}" -eq 0 ]; then exit 1; fi
    for file in "${conflicts[@]}"; do
      case "$file" in sw.js|data/index.json) ;; *) git rebase --abort; exit 1 ;; esac
    done
    git restore --source=origin/main --staged --worktree -- sw.js data/index.json
    python3 work/stamp-sw-version.py
    node tools/data-manifest.js
    git add sw.js data/index.json
    GIT_EDITOR=true git rebase --continue
  fi
  python3 work/stamp-sw-version.py
  node tools/data-manifest.js
  git add sw.js data/index.json
  node work/verify-sw.mjs
  node tools/validate-data.js
  if ! git diff --cached --quiet; then git commit --amend --no-edit; fi
  # A newly captured claim must reach Git before its deadline as well.
  node --input-type=module -e '
    import {execFileSync} from "node:child_process";
    import fs from "node:fs";
    const old=JSON.parse(execFileSync("git",["show","origin/main:data/survivor-receipts.json"])).data;
    const ids=new Set(old.map(r=>r.receipt_id));
    for(const r of JSON.parse(fs.readFileSync("data/survivor-receipts.json")).data)
      if(!ids.has(r.receipt_id) && Date.now()>=Date.parse(r.kickoff_at))
        throw new Error("Capture missed publication deadline: "+r.receipt_id);
  '
  if git push origin HEAD:main; then
    echo "Published commit $(git rev-parse HEAD)"
    sha256sum data/survivor.json data/survivor-receipts.json
    exit 0
  fi
  echo "Push raced another writer; retry $attempt/3"
done
echo 'Push failed after three attempts' >&2
exit 1
