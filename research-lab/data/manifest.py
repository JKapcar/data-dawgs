#!/usr/bin/env python3
"""Read-only manifest of the owner's Big Data Bowl CSVs.

Runs on the owner's own machine against the private source directory, e.g.

    py research-lab\\data\\manifest.py C:\\Users\\jkapc\\Documents\\Codex\\2026-10-15\\task-4\\private-source

It never modifies, uploads or copies source data. It writes two files BESIDE THE SOURCE:

  manifest.json          full per-file profile (column names, dtypes, null shares, numeric
                         ranges, key checks). Stays on the owner's machine.
  manifest-summary.json  redacted: counts and shapes only. No column values, no ranges for
                         identifier columns, no names. This is the only file that may be
                         copied to research-lab/data/manifest-summary.json for the Real data tab.

Standard library only. Python 3.9+. Streams each CSV once; key uniqueness keeps one 8-byte
digest per row, so pass --no-keys on a machine short of memory.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

NULLS = {"", "NA", "N/A", "NaN", "nan", "NULL", "null", "None"}
# Candidate natural keys, most specific first. Names compare case- and underscore-insensitively.
KEY_CANDIDATES = [
    ["game_id", "play_id", "nfl_id", "frame_id"],
    ["game_id", "play_id", "frame_id", "entity_type"],
    ["game_id", "play_id", "nfl_id"],
    ["game_id", "play_id"],
    ["nfl_id", "season", "week"],
    ["nfl_id", "drill", "attempt"],
    ["nfl_id", "drill"],
    ["nfl_id", "draft_year"],
    ["nfl_id"],
    ["game_id"],
]
YEAR_COLUMNS = ["draft_year", "season", "year", "combine_year"]
# Identifier-like columns never get value ranges in the summary (ranges of ids leak ids).
ID_HINTS = ("id", "name", "college", "team", "uuid")
POSITION_COLUMNS = ["position", "pos", "official_position"]


def norm(name: str) -> str:
    return name.strip().lower().replace("_", "").replace(" ", "")


def is_id_like(name: str) -> bool:
    n = norm(name)
    return any(n.endswith(h) or n == h for h in ID_HINTS)


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def classify(value: str) -> str:
    """Narrowest type a non-null cell fits: int < float < bool < string."""
    try:
        int(value)
        return "int"
    except ValueError:
        pass
    try:
        f = float(value)
        return "float" if math.isfinite(f) else "string"
    except ValueError:
        pass
    if value in ("TRUE", "FALSE", "True", "False", "true", "false"):
        return "bool"
    return "string"


RANK = {"int": 0, "float": 1, "bool": 2, "string": 3}


def find_key(columns: list[str]):
    lookup = {norm(c): c for c in columns}
    for cand in KEY_CANDIDATES:
        if all(norm(k) in lookup for k in cand):
            return [lookup[norm(k)] for k in cand]
    return None


def profile_csv(path: str, check_keys: bool = True) -> dict:
    stats = {}
    rows = 0
    seen = set()
    duplicates = 0
    years: dict[str, int] = {}
    positions: dict[str, int] = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None) or []
        key = find_key(header) if check_keys else None
        key_idx = [header.index(k) for k in key] if key else None
        lookup = {norm(c): i for i, c in enumerate(header)}
        year_idx = next((lookup[norm(c)] for c in YEAR_COLUMNS if norm(c) in lookup), None)
        pos_idx = next((lookup[norm(c)] for c in POSITION_COLUMNS if norm(c) in lookup), None)
        for c in header:
            stats[c] = {"nulls": 0, "type": None, "min": None, "max": None}
        cols = list(stats.values())
        width = len(header)
        ragged = 0
        for row in reader:
            rows += 1
            if len(row) != width:
                ragged += 1
            for i in range(width):
                v = row[i] if i < len(row) else ""
                s = cols[i]
                if v in NULLS:
                    s["nulls"] += 1
                    continue
                t = classify(v)
                if s["type"] is None or RANK[t] > RANK[s["type"]]:
                    s["type"] = t
                if t in ("int", "float") and s["type"] in ("int", "float"):
                    x = float(v)
                    s["min"] = x if s["min"] is None or x < s["min"] else s["min"]
                    s["max"] = x if s["max"] is None or x > s["max"] else s["max"]
            if key_idx is not None:
                digest = hashlib.blake2b("\x1f".join(row[i] if i < len(row) else "" for i in key_idx).encode(), digest_size=8).digest()
                if digest in seen:
                    duplicates += 1
                else:
                    seen.add(digest)
            if year_idx is not None and year_idx < len(row) and row[year_idx] not in NULLS:
                years[row[year_idx]] = years.get(row[year_idx], 0) + 1
            if pos_idx is not None and pos_idx < len(row) and row[pos_idx] not in NULLS:
                positions[row[pos_idx]] = positions.get(row[pos_idx], 0) + 1
    columns = []
    for name, s in stats.items():
        numeric = s["type"] in ("int", "float")
        columns.append({
            "name": name,
            "dtype": s["type"] or "empty",
            "null_share": round(s["nulls"] / rows, 6) if rows else None,
            "min": s["min"] if numeric else None,
            "max": s["max"] if numeric else None,
            "id_like": is_id_like(name),
        })
    return {
        "rows": rows,
        "ragged_rows": ragged,
        "columns": columns,
        "key": key,
        "key_unique": (duplicates == 0) if key else None,
        "duplicated_keys": duplicates if key else None,
        "draft_year_coverage": dict(sorted(years.items())) or None,
        "position_counts": dict(sorted(positions.items())) or None,
    }


def build(source: str, check_keys: bool = True) -> tuple[dict, dict]:
    files = sorted(f for f in os.listdir(source) if f.lower().endswith(".csv"))
    if not files:
        raise SystemExit("No .csv files in " + source)
    full, summary_files = [], []
    for name in files:
        path = os.path.join(source, name)
        entry = {"file": name, "bytes": os.path.getsize(path), "sha256": sha256_of(path)}
        entry.update(profile_csv(path, check_keys))
        full.append(entry)
        nulls = [c["null_share"] for c in entry["columns"] if c["null_share"] is not None]
        summary_files.append({
            "file": name,
            "bytes": entry["bytes"],
            "sha256": entry["sha256"],
            "rows": entry["rows"],
            "columns": len(entry["columns"]),
            "dtypes": {t: sum(1 for c in entry["columns"] if c["dtype"] == t) for t in sorted({c["dtype"] for c in entry["columns"]})},
            "key_unique": entry["key_unique"],
            "duplicated_keys": entry["duplicated_keys"],
            "max_null_share": max(nulls) if nulls else None,
            "draft_year_coverage": entry["draft_year_coverage"],
            # Ranges only for measurement columns: identifier ranges would leak identifiers.
            "numeric_ranges": {c["name"]: [c["min"], c["max"]] for c in entry["columns"] if c["min"] is not None and not c["id_like"]},
        })
    total = sum(f["bytes"] for f in full)
    combined = hashlib.sha256("".join(f["file"] + ":" + f["sha256"] + "\n" for f in full).encode()).hexdigest()
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest = {
        "kind": "bdb-manifest", "version": 1, "generated_at": generated, "source_dir": os.path.abspath(source),
        "files": full, "total_bytes": total, "files_sha256": combined,
        "note": "Read-only profile. Stays beside the source; never commit it.",
    }
    summary = {
        "kind": "bdb-manifest-summary", "version": 1, "generated_at": generated,
        "archive": {"total_bytes": total, "files": len(full), "sha256": combined},
        "files": summary_files,
        "note": "Counts and shapes only; no rows, names or identifier values. Not a finding.",
    }
    return manifest, summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("source", help="directory holding the competition CSVs (read-only)")
    ap.add_argument("--no-keys", action="store_true", help="skip key-uniqueness checks to save memory")
    args = ap.parse_args(argv)
    manifest, summary = build(args.source, not args.no_keys)
    for name, body in (("manifest.json", manifest), ("manifest-summary.json", summary)):
        out = os.path.join(args.source, name)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(body, f, indent=1)
            f.write("\n")
        print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
