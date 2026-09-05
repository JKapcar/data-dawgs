#!/usr/bin/env python3
"""Re-inline work/dfs-slate-ingest.js (+ standings + screener) into dfs.html.

Anchored replace between Phase 0 markers. Run from repo root:
    python3 work/patch-dfs-slate-ingest.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "dfs.html"
page = PAGE.read_text()
start = page.find("/* ---- CSV / slate ingest (Phase 0")
if start < 0:
    start = page.find("/* ---- CSV ---- */")
end = page.find("/* ---------------------------------------------------------------- demo slate */")
assert start >= 0 and end > start, "ingest anchors missing"

ingest = (ROOT / "work/dfs-slate-ingest.js").read_text()
stand = (ROOT / "work/dfs-standings-ingest.js").read_text()
screen = (ROOT / "work/dfs-contest-screener.js").read_text()
replacement = (
    "/* ---- CSV / slate ingest (Phase 0 — source: work/dfs-slate-ingest.js) ---- */\n"
    + ingest + "\n" + stand + "\n" + screen + "\n"
    + "function parseCSV(text) { return DDFSIngest.parseCSV(text); }\n"
    + "function nameKeys(name, tm) { return DDFSIngest.nameKeys(name, tm); }\n"
    + "function team(raw) { return DDFSIngest.team(raw); }\n"
    + "function readSalaries(text) { return DDFSIngest.readSalaries(text); }\n"
    + "function applyProjections(text, map) {\n"
    + "  return DDFSIngest.applyProjections(text, S.players, map, { ownTier: (window.DD_OWN_TIER || \"auto\") });\n"
    + "}\n\n"
)
PAGE.write_text(page[:start] + replacement + page[end:])
print("dfs.html ingest block refreshed")
