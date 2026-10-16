#!/usr/bin/env python3
"""Baseline experiment B1 (BASELINE-PLAN.md): stopwatch card vs cohort mean, untouched holdout.

    # 1. develop only (2023-2024 classes); the holdout is never read
    py research-lab\\data\\baseline.py archive.zip --features combine_results.csv --outcome <table.csv>:<column> --out OUT
    # 2. once, after the develop result is recorded and the plan is frozen
    py research-lab\\data\\baseline.py archive.zip ... --open-holdout --out OUT

Cohort: wide receivers (position WR) in draft classes 2023-2025 with every card measurement
present. Develop = 2023-2024 classes, holdout = 2025 class, so no athlete is in both. Features:
forty, ten_yd_split, combine_height, combine_weight (position is constant within the cohort).
Model: ordinary least squares fitted on develop only. Benchmark: develop-mean outcome.
Metric: MAE; develop uses leave-one-out; holdout uses the develop fit once. Uncertainty: paired
bootstrap by athlete of MAE(card) - MAE(mean), 2,000 resamples, fixed seed. Athletes without
an outcome are counted and excluded, never imputed.

The holdout opens once: --open-holdout refuses if OUT already holds a holdout receipt, and the
receipt records hashes of the inputs and code. Receipts are counts and metrics only.
Standard library only.
"""
from __future__ import annotations

import argparse, csv, hashlib, io, json, os, random, sys, zipfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
NULLS = {"", "NA", "N/A", "NaN", "nan", "NULL", "null", "None"}
FEATURES = ["forty", "ten_yd_split", "combine_height", "combine_weight"]
DEVELOP, HOLDOUT = {"2023", "2024"}, {"2025"}
BOOTSTRAP, SEED = 2000, 20261016
norm = lambda s: s.strip().lower().replace("_", "").replace(" ", "")


def open_table(source, name):
    if zipfile.is_zipfile(source):
        z = zipfile.ZipFile(source)
        match = [i for i in z.infolist() if os.path.basename(i.filename) == name]
        if len(match) != 1:
            raise SystemExit(f"{name}: expected one member in the archive, found {len(match)}")
        return io.TextIOWrapper(z.open(match[0]), encoding="utf-8-sig", newline="")
    return open(os.path.join(source, name), encoding="utf-8-sig", newline="")


def column(header, *names):
    lookup = {norm(h): h for h in header}
    for n in names:
        if norm(n) in lookup:
            return lookup[norm(n)]
    raise SystemExit("missing column: " + " / ".join(names))


def num(v):
    if v is None or v in NULLS:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load(source, features_table, outcome_spec, open_holdout=False):
    # Develop runs never read a holdout athlete's card or outcome: those rows are skipped on input.
    classes = DEVELOP | HOLDOUT if open_holdout else DEVELOP
    with open_table(source, features_table) as f:
        r = csv.DictReader(f)
        aid, year, pos = column(r.fieldnames, "nfl_id", "gsis_id"), column(r.fieldnames, "draft_year", "season", "year"), column(r.fieldnames, "position", "pos")
        counts_key = "wr_in_classes" if open_holdout else "wr_in_develop_classes"
        cols = [column(r.fieldnames, c) for c in FEATURES]
        athletes, counts = {}, {"rows": 0, counts_key: 0, "incomplete_card": 0, "duplicate_athlete": 0, "holdout_read": bool(open_holdout)}
        for row in r:
            counts["rows"] += 1
            if row[pos].strip().upper() != "WR" or row[year].strip() not in classes:
                continue
            counts[counts_key] += 1
            x = [num(row[c]) for c in cols]
            if None in x:
                counts["incomplete_card"] += 1
                continue
            if row[aid] in athletes:
                counts["duplicate_athlete"] += 1
                continue
            athletes[row[aid]] = {"year": row[year].strip(), "x": x}
    table, col = outcome_spec.rsplit(":", 1)
    with open_table(source, table) as f:
        r = csv.DictReader(f)
        aid2, ycol = column(r.fieldnames, "nfl_id", "gsis_id"), column(r.fieldnames, col)
        outcome = {}
        for row in r:
            v = num(row[ycol])
            if v is not None and row[aid2] in athletes:
                outcome.setdefault(row[aid2], []).append(v)
    counts["outcome_rows_multi"] = sum(1 for v in outcome.values() if len(v) > 1)
    data = {}
    for a, rec in athletes.items():
        if a in outcome:
            data[a] = {**rec, "y": sum(outcome[a]) / len(outcome[a])}
    counts["no_outcome_excluded"] = len(athletes) - len(data)
    return data, counts


def ols(xs, ys):
    """Least squares with an intercept via the normal equations (Gauss-Jordan, partial pivot)."""
    X = [[1.0] + x for x in xs]
    k = len(X[0])
    A = [[sum(r[i] * r[j] for r in X) for j in range(k)] + [sum(r[i] * y for r, y in zip(X, ys))] for i in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda i: abs(A[i][c]))
        if abs(A[p][c]) < 1e-12:
            raise SystemExit("card features are collinear or the cohort is too small to fit")
        A[c], A[p] = A[p], A[c]
        A[c] = [v / A[c][c] for v in A[c]]
        for i in range(k):
            if i != c:
                A[i] = [a - A[i][c] * b for a, b in zip(A[i], A[c])]
    return [A[i][k] for i in range(k)]


predict = lambda beta, x: beta[0] + sum(b * v for b, v in zip(beta[1:], x))
mae = lambda errs: sum(abs(e) for e in errs) / len(errs)


def r2(ys, preds):
    m = sum(ys) / len(ys)
    tot = sum((y - m) ** 2 for y in ys)
    return 1 - sum((y - p) ** 2 for y, p in zip(ys, preds)) / tot if tot else None


def bootstrap(card_err, mean_err):
    rng, n, diffs = random.Random(SEED), len(card_err), []
    for _ in range(BOOTSTRAP):
        idx = [rng.randrange(n) for _ in range(n)]
        diffs.append(mae([card_err[i] for i in idx]) - mae([mean_err[i] for i in idx]))
    diffs.sort()
    return {"resamples": BOOTSTRAP, "seed": SEED, "mae_difference_card_minus_mean_95ci": [round(diffs[int(0.025 * BOOTSTRAP)], 6), round(diffs[int(0.975 * BOOTSTRAP) - 1], 6)]}


def run(data, open_holdout):
    dev = [(a, d) for a, d in sorted(data.items()) if d["year"] in DEVELOP]
    hold = [(a, d) for a, d in sorted(data.items()) if d["year"] in HOLDOUT]
    if len(dev) < len(FEATURES) + 3:
        raise SystemExit(f"develop cohort too small: {len(dev)} athletes with card and outcome")
    out = {"develop_n": len(dev), "holdout_n": len(hold) if open_holdout else "sealed"}
    # Develop: leave-one-out, so every develop athlete is scored by a fit that never saw them.
    card_err, mean_err, ys, preds = [], [], [], []
    for i, (_, d) in enumerate(dev):
        rest = [r for j, (_, r) in enumerate(dev) if j != i]
        beta, m = ols([r["x"] for r in rest], [r["y"] for r in rest]), sum(r["y"] for r in rest) / len(rest)
        p = predict(beta, d["x"])
        card_err.append(p - d["y"]); mean_err.append(m - d["y"]); ys.append(d["y"]); preds.append(p)
    out["develop_loo"] = {"mae_card": round(mae(card_err), 6), "mae_mean": round(mae(mean_err), 6), "r2_card": r2(ys, preds), **bootstrap(card_err, mean_err)}
    beta = ols([d["x"] for _, d in dev], [d["y"] for _, d in dev])
    out["develop_fit"] = {"intercept": beta[0], **{f: b for f, b in zip(FEATURES, beta[1:])}, "mean_outcome": sum(d["y"] for _, d in dev) / len(dev)}
    if open_holdout:
        if not hold:
            raise SystemExit("holdout cohort is empty")
        m = out["develop_fit"]["mean_outcome"]
        ce = [predict(beta, d["x"]) - d["y"] for _, d in hold]
        me = [m - d["y"] for _, d in hold]
        out["holdout"] = {"mae_card": round(mae(ce), 6), "mae_mean": round(mae(me), 6), "r2_card": r2([d["y"] for _, d in hold], [predict(beta, d["x"]) for _, d in hold]), **bootstrap(ce, me)}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("source", help="the competition ZIP or a directory of its CSVs (read-only)")
    ap.add_argument("--features", default="combine_results.csv", help="table holding the card measurements")
    ap.add_argument("--outcome", required=True, help="TABLE.csv:COLUMN holding the per-athlete outcome (registered before running)")
    ap.add_argument("--out", required=True, help="directory for receipts, outside the repository")
    ap.add_argument("--open-holdout", action="store_true", help="score the 2025 holdout ONCE")
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    lock = os.path.join(args.out, "baseline-holdout-receipt.json")
    if args.open_holdout and os.path.exists(lock):
        raise SystemExit("holdout already opened: " + lock + " exists. It opens once.")
    data, counts = load(args.source, args.features, args.outcome, args.open_holdout)
    result = run(data, args.open_holdout)
    with open(__file__, "rb") as f:
        code = hashlib.sha256(f.read()).hexdigest()
    body = {"kind": "bdb-baseline-B1", "version": 1, "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "design": {"cohort": "WR, draft classes 2023-2025, complete card", "develop": sorted(DEVELOP), "holdout": sorted(HOLDOUT), "features": FEATURES,
                       "model": "OLS on develop", "benchmark": "develop mean", "metric": "MAE", "outcome": args.outcome},
            "code_sha256": code, "counts": counts, "result": result,
            "note": "Counts and metrics only. A develop result is not a finding; the holdout result is the test."}
    body["receipt_sha256"] = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    name = "baseline-holdout-receipt.json" if args.open_holdout else "baseline-develop-receipt.json"
    with open(os.path.join(args.out, name), "x" if args.open_holdout else "w", encoding="utf-8") as f:
        json.dump(body, f, indent=1)
        f.write("\n")
    print(json.dumps(result, indent=1))
    print("wrote", os.path.join(args.out, name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
