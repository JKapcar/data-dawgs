"""Offline fixture: accepted final -> full model rebuild -> immutable receipt grade.

Pass a directory containing the pinned official.csv, initial.csv, history.csv.
Everything runs in a temporary clone. No API calls, remote pushes or live grades.
"""
import argparse
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import nfl_results_automation as a

parser = argparse.ArgumentParser()
parser.add_argument("--inputs", type=Path, required=True)
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="nfl-roundtrip-") as temp:
    temp = Path(temp)
    work = temp / "repo"
    a.run(ROOT, "git", "clone", "--shared", str(ROOT), str(work))
    # Include the code being reviewed, even before it is committed.
    changed = a.run(ROOT, "git", "diff", "HEAD", "--name-only").splitlines()
    changed += a.run(ROOT, "git", "ls-files", "--others", "--exclude-standard").splitlines()
    for rel in changed:
        dest = work / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / rel, dest)
    base = a.b.read_json(work / "data/nfl-schedule.json")
    original = a.b.read_json(work / "data/survivor-receipts.json")
    pending = next(r for r in original["data"] if r["forecast_status"] == "prospective")
    upstream = copy.deepcopy(base)
    pick = pending["recommended"][0]
    game = next(g for g in upstream["data"]["games"] if g["week"] == pending["week"]
                and pick in [g["home_team"], g["away_team"]])
    game.update(status="final", home_score=24 if game["home_team"] == pick else 17,
                away_score=24 if game["away_team"] == pick else 17)
    upstream["integrity"]["snapshot_id"] = a.b.sha256_id(upstream["data"]["games"])
    now = datetime(2026, 9, 15, 12, tzinfo=timezone.utc)
    candidate, ids, _ = a.result_candidate(base, upstream, now)
    assert ids == [game["game_id"]]
    old_model_rows = a.b.read_json(work / "data/model-receipts.json")["data"]
    a.b.write_json(work / "data/nfl-schedule.json", candidate)
    a.regenerate(work, now.isoformat(), args.inputs.resolve())
    a.verify_candidate(base, upstream, a.b.read_json(work / "data/nfl-schedule.json"), now)
    assert a.b.read_json(work / "data/model-receipts.json")["data"] == old_model_rows
    model = a.b.read_json(work / "data/538-classic.json")
    assert model["validation"]["official_probabilities_compared"] == 16810
    assert model["validation"]["max_absolute_probability_error"] < 2e-6
    print(a.run(work, "python3", "scripts/elo_538_classic.py", "validate"))
    result = subprocess.run(["node", "tools/validate-data.js"], cwd=work,
        env={**os.environ, "DD_TODAY": "2026-09-15"}, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    print(result.stdout.splitlines()[-1])
    clock = temp / "clock.mjs"
    clock.write_text("const NativeDate = Date; globalThis.Date = class extends NativeDate { "
                     "constructor(...a){ super(...(a.length?a:['2026-09-15T12:00:00Z'])); } "
                     "static now(){return NativeDate.parse('2026-09-15T12:00:00Z');} };\n")
    print(a.run(work, "node", "--import", str(clock), "work/survivor-receipt.mjs", "resolve"))
    after = a.b.read_json(work / "data/survivor-receipts.json")
    row = next(r for r in after["data"] if r["receipt_id"] == pending["receipt_id"])
    assert row["resolved"]["survived"] is True
    assert row["resolved"]["brier"] == round((1-pending["stated_win_probability"][0])**2, 6)
    assert {k:v for k,v in row.items() if k not in ["resolved","forecast_status"]} == {
        k:v for k,v in pending.items() if k not in ["resolved","forecast_status"]}
    frozen = (work / "data/survivor-receipts.json").read_bytes()
    print(a.run(work, "node", "--import", str(clock), "work/survivor-receipt.mjs", "resolve"))
    assert (work / "data/survivor-receipts.json").read_bytes() == frozen
    print("PASS: one synthetic final, 16810 historical comparisons, original 1088 model receipts preserved, one correct survivor grade, repeat resolution unchanged")
