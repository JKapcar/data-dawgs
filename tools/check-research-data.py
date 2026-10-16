#!/usr/bin/env python3
"""CI guard: research-lab/data/ holds tools and redacted summaries, never people or raw data.

Fails if any file under research-lab/data/ (or a directory given as an argument):
  * is a raw data format (.csv .tsv .parquet .feather .zip .xlsx .xls .xlsm .gz .jsonl)
  * in JSON, has a person or identifier key (nfl_id, display_name, player_name, first_name,
    last_name, name, ...) carrying a value, or an array of 3+ nfl_id-like numbers
  * in any text file, has a run of 3+ nfl_id-like numbers (5-8 digits) in one list, or a
    `nfl_id`-style key followed by a value or a list
Code may NAME such columns (manifest.py looks for nfl_id); it may not carry their values.
"""
import json, os, re, sys

RAW = (".csv", ".tsv", ".parquet", ".feather", ".zip", ".xlsx", ".xls", ".xlsm", ".gz", ".jsonl")
PERSON_KEYS = {"nflid", "gsisid", "displayname", "playername", "firstname", "lastname", "fullname", "name", "player", "athlete", "athletename"}
ID_RUN = re.compile(r"(?:\b\d{5,8}\b[\s,;\]\)\"']+){2,}\b\d{5,8}\b")
ID_ASSIGN = re.compile(r"""["']?\b(nfl_?id|nflId|gsis_?id)\b["']?\s*[:=]\s*(\[|\d)""")
norm = lambda k: re.sub(r"[^a-z]", "", str(k).lower())

def walk_json(value, where, bad):
    if isinstance(value, dict):
        for k, v in value.items():
            if norm(k) in PERSON_KEYS and v not in (None, "", [], {}):
                bad.append(f"{where}: key {k!r} carries a value")
            walk_json(v, where, bad)
    elif isinstance(value, list):
        ids = [x for x in value if (isinstance(x, int) and 10000 <= x <= 99999999) or (isinstance(x, str) and re.fullmatch(r"\d{5,8}", x))]
        if len(ids) >= 3:
            bad.append(f"{where}: list of {len(ids)} id-like numbers")
        for v in value:
            walk_json(v, where, bad)

def check(root):
    bad = []
    for base, _, files in os.walk(root):
        if "__pycache__" in base:
            continue
        for name in files:
            path = os.path.join(base, name)
            if name.lower().endswith(RAW):
                bad.append(f"{path}: raw data file type is not allowed here")
                continue
            try:
                with open(path, encoding="utf-8") as f:
                    text = f.read()
            except (UnicodeDecodeError, OSError):
                bad.append(f"{path}: unreadable or binary")
                continue
            if name.endswith(".json"):
                try:
                    walk_json(json.loads(text), path, bad)
                except json.JSONDecodeError:
                    bad.append(f"{path}: invalid JSON")
            if ID_RUN.search(text):
                bad.append(f"{path}: a run of nfl_id-like numbers")
            if ID_ASSIGN.search(text):
                bad.append(f"{path}: an nfl_id key with a value")
    return bad

if __name__ == "__main__":
    roots = sys.argv[1:] or [os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "research-lab", "data")]
    problems = [p for r in roots for p in check(r)]
    for p in problems:
        print("FAIL", p)
    print(("FAILED: %d problem(s)" % len(problems)) if problems else "research-lab/data: no names, no id lists, no raw data")
    sys.exit(1 if problems else 0)
