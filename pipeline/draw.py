"""Deterministic drand selection. The selection function is intentionally tiny."""
from __future__ import annotations
import argparse, hashlib
from .common import read_json, stamped, write_json
from .config import load

def ordered(pool, randomness_hex):
    return sorted(pool, key=lambda m: hashlib.sha256(f"{randomness_hex}:{m['id']}".encode()).hexdigest())

def select(pool, randomness_hex, n): return ordered(pool, randomness_hex)[:n]

def main():
    p=argparse.ArgumentParser(); p.add_argument("cohort"); p.add_argument("--randomness", required=True); p.add_argument("--dry-run",action="store_true"); a=p.parse_args()
    cfg,_=load(); pool=read_json(f"data/cohorts/{a.cohort}/pool.json")
    if pool.get("sha256") != __import__("pipeline.common",fromlist=["sha256"]).sha256({k:v for k,v in pool.items() if k!="sha256"}): raise RuntimeError("pool hash mismatch")
    rows=ordered(pool["markets"],a.randomness)
    selection = [{"market_id": m["id"], "key": hashlib.sha256((a.randomness + ":" + m["id"]).encode()).hexdigest()} for m in rows]
    body = {"cohort_id": a.cohort, "randomness": a.randomness, "selection": selection,
            "markets": rows[:cfg["n_per_cohort"]]}
    write_json(f"data/cohorts/{a.cohort}/cohort.json", stamped(body, dry_run=a.dry_run))
if __name__ == "__main__": main()
