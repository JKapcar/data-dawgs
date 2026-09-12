"""
Phase 0.5 T9 — toto · DK proxy health chip (already applied in this commit).

Ships:
  work/dfs-toto-health.js   — pure recordOk/recordErr + chipView
  work/test-dfs-toto-health.js
  dfs.html                  — chip near Slate lobby controls; dkFetch wraps /dk/*
  sw.js                     — VERSION restamp (H3)

Persistence: dd-dfs-v1.toto = { lastOk, lastErr }
T1 week sheet not on main → chip lives on Slate chrome (merge-clean with weekPipeChips later).
"""
print(__doc__)
