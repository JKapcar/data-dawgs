#!/usr/bin/env python3
"""Read-only audit of a tracking CSV's measurement conventions.

    py research-lab\\data\\tracking-audit.py <private-source>\\<tracking file>.csv

Checks, per (game, play, entity) track, and reports — never clips, drops or rewrites:
  * timestamp monotonicity and spacing (time column if present, else frame_id steps)
  * `dis` versus the straight-line coordinate delta between consecutive frames
  * `dir` convention: share of moving steps whose heading agrees with each candidate
    convention (0 = +y clockwise, the NFL tracking convention; 0 = +x counterclockwise)
  * PLAYER versus BALL counts by entity_type
  * out-of-bounds coordinates (x outside 0-120, y outside 0-53.3), counted not clipped
  * the share of negative `a` (acceleration is often published as a magnitude)
  * a small numeric sample of one track including `o`, written beside the source

Writes <file>.audit.json BESIDE THE SOURCE. Standard library only. Holds one previous row
per track in memory, so it streams files of any length.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
NULLS = {"", "NA", "N/A", "NaN", "nan", "NULL", "null", "None"}
FIELD_X, FIELD_Y = 120.0, 160.0 / 3.0
SAMPLE_ROWS = 25


def norm(name):
    return name.strip().lower().replace("_", "").replace(" ", "")


def num(row, idx):
    if idx is None or idx >= len(row) or row[idx] in NULLS:
        return None
    try:
        v = float(row[idx])
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def angle_diff(a, b):
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


class Running:
    """Count, mean, min, max and a few quantile-ish buckets without storing values."""

    def __init__(self, edges):
        self.n = 0
        self.total = 0.0
        self.lo = None
        self.hi = None
        self.edges = edges
        self.buckets = [0] * (len(edges) + 1)

    def add(self, v):
        self.n += 1
        self.total += v
        self.lo = v if self.lo is None or v < self.lo else self.lo
        self.hi = v if self.hi is None or v > self.hi else self.hi
        for i, e in enumerate(self.edges):
            if v <= e:
                self.buckets[i] += 1
                return
        self.buckets[-1] += 1

    def out(self):
        labels = ["<=" + str(e) for e in self.edges] + [">" + str(self.edges[-1])]
        return {"n": self.n, "mean": round(self.total / self.n, 6) if self.n else None,
                "min": self.lo, "max": self.hi, "buckets": dict(zip(labels, self.buckets))}


def audit(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None) or []
        col = {norm(c): i for i, c in enumerate(header)}
        pick = lambda *names: next((col[norm(n)] for n in names if norm(n) in col), None)
        g, p, e, fr = pick("game_id", "gameId"), pick("play_id", "playId"), pick("nfl_id", "nflId", "entity_id", "id"), pick("frame_id", "frameId")
        t, x, y, s, a, dis, d, o, kind = (pick("time", "timestamp"), pick("x"), pick("y"), pick("s", "speed"), pick("a", "acc", "acceleration"),
                                          pick("dis", "distance"), pick("dir", "direction"), pick("o", "orientation"), pick("entity_type", "entityType", "club_type"))
        missing = [n for n, i in (("game_id", g), ("play_id", p), ("frame_id", fr), ("x", x), ("y", y)) if i is None]
        if missing:
            raise SystemExit("Not a tracking file; missing columns: " + ", ".join(missing))
        rows = 0
        prev = {}
        frame_steps = Running([0, 1, 2, 5])
        time_steps = Running([0.0, 0.05, 0.1, 0.11, 0.2, 1.0])
        non_monotonic = 0
        dis_gap = Running([0.01, 0.05, 0.1, 0.25, 1.0])
        dir_votes = {"zero_plus_y_clockwise": 0, "zero_plus_x_counterclockwise": 0, "neither": 0}
        entity = {}
        oob = {"x_below_0": 0, "x_above_120": 0, "y_below_0": 0, "y_above_53_3": 0}
        a_n = a_neg = 0
        sample, sample_key = [], None
        for row in reader:
            rows += 1
            key = tuple(row[i] if i < len(row) else "" for i in (g, p, e if e is not None else g))
            label = row[kind] if kind is not None and kind < len(row) else "unlabelled"
            entity[label] = entity.get(label, 0) + 1
            fx, fy = num(row, x), num(row, y)
            if fx is not None:
                oob["x_below_0"] += fx < 0
                oob["x_above_120"] += fx > FIELD_X
            if fy is not None:
                oob["y_below_0"] += fy < 0
                oob["y_above_53_3"] += fy > FIELD_Y
            av = num(row, a)
            if av is not None:
                a_n += 1
                a_neg += av < 0
            cur = {"frame": num(row, fr), "time": row[t] if t is not None and t < len(row) else None, "x": fx, "y": fy}
            before = prev.get(key)
            if before is not None and cur["frame"] is not None and before["frame"] is not None:
                step = cur["frame"] - before["frame"]
                frame_steps.add(step)
                if step <= 0:
                    non_monotonic += 1
                tt = _seconds(cur["time"]), _seconds(before["time"])
                if None not in tt:
                    time_steps.add(round(tt[0] - tt[1], 4))
                if None not in (fx, fy, before["x"], before["y"]):
                    dx, dy = fx - before["x"], fy - before["y"]
                    moved = math.hypot(dx, dy)
                    dv = num(row, dis)
                    if dv is not None:
                        dis_gap.add(round(abs(dv - moved), 4))
                    dv_dir = num(row, d)
                    if dv_dir is not None and moved > 0.05:
                        heading_y_cw = math.degrees(math.atan2(dx, dy)) % 360.0
                        heading_x_ccw = math.degrees(math.atan2(dy, dx)) % 360.0
                        if angle_diff(dv_dir, heading_y_cw) <= 30:
                            dir_votes["zero_plus_y_clockwise"] += 1
                        elif angle_diff(dv_dir, heading_x_ccw) <= 30:
                            dir_votes["zero_plus_x_counterclockwise"] += 1
                        else:
                            dir_votes["neither"] += 1
            prev[key] = cur
            if sample_key is None:
                sample_key = key
            if key == sample_key and len(sample) < SAMPLE_ROWS:
                sample.append({n: num(row, i) for n, i in (("frame_id", fr), ("x", x), ("y", y), ("s", s), ("a", a), ("dis", dis), ("dir", d), ("o", o))})
    voted = sum(dir_votes.values())
    return {
        "kind": "bdb-tracking-audit", "version": 1, "file": os.path.basename(path), "rows": rows, "tracks": len(prev),
        "frame_steps": frame_steps.out(), "non_monotonic_steps": non_monotonic,
        "time_steps_seconds": time_steps.out() if time_steps.n else None,
        "dis_minus_coordinate_delta": dis_gap.out() if dis_gap.n else None,
        "dir_convention_votes": dir_votes,
        "dir_convention_share": {k: round(v / voted, 4) for k, v in dir_votes.items()} if voted else None,
        "entity_type_counts": entity,
        "out_of_bounds": oob, "out_of_bounds_policy": "reported, not clipped",
        "a_negative_share": round(a_neg / a_n, 6) if a_n else None,
        "orientation_column_present": o is not None,
        "sample_track": {"note": "Numeric columns of the first track only; identifiers omitted. Stays beside the source.", "rows": sample},
    }


def _seconds(value):
    if value is None or value in NULLS:
        return None
    try:
        return float(value)
    except ValueError:
        pass
    from datetime import datetime
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value.rstrip("Z"), fmt).timestamp()
        except ValueError:
            continue
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("csv", help="one tracking CSV (read-only)")
    args = ap.parse_args(argv)
    result = audit(args.csv)
    out = args.csv[:-4] + ".audit.json" if args.csv.lower().endswith(".csv") else args.csv + ".audit.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)
        f.write("\n")
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
