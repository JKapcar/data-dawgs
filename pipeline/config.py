"""Ratification gate. No defaults: every experimental choice belongs in preregistration."""
from __future__ import annotations
import hashlib, re
from pathlib import Path
from .common import ROOT, PENDING

REQUIRED = ("models", "arms", "divisions", "n_per_cohort", "volume_floor_usd", "price_band",
            "end_date_window_days", "draw_time_utc", "min_n_for_claims", "bootstrap_iterations",
            "bootstrap_seed", "update_cadence")

def _scalar(s):
    s=s.strip()
    if s.startswith("[") and s.endswith("]"): return [_scalar(x) for x in s[1:-1].split(",")]
    if s in ("true","false"): return s == "true"
    try: return int(s)
    except ValueError:
        try: return float(s)
        except ValueError: return s.strip("\"'")

def load(path=None):
    path = Path(path or ROOT / "data/preregistration.md")
    if not path.exists(): raise RuntimeError("preregistration.md is required before any pipeline job can run")
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---\n"): raise RuntimeError("preregistration.md needs YAML front matter")
    front = raw.split("---", 2)[1]
    cfg = {}
    current = None
    for line in front.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"): continue
        if stripped.startswith("-") and current:
            cfg.setdefault(current, []).append(_scalar(stripped[1:].split("#",1)[0])); continue
        if ":" not in line: continue
        k,v=line.split(":",1); current=k.strip(); value=v.split("#",1)[0].strip()
        cfg[current] = [] if not value else _scalar(value)
    missing=[k for k in REQUIRED if k not in cfg]
    if missing: raise RuntimeError("preregistration missing: " + ", ".join(missing))
    pending=[k for k in REQUIRED if cfg[k] == PENDING or (isinstance(cfg[k],list) and PENDING in cfg[k])]
    if pending: raise RuntimeError("PENDING_RATIFICATION: " + ", ".join(pending))
    if cfg["update_cadence"] != "once": raise RuntimeError("Phase 1 requires update_cadence: once")
    digest=hashlib.sha256(raw.encode()).hexdigest()
    sidecar=path.with_suffix(".sha256")
    if not sidecar.exists() or sidecar.read_text().strip() != digest: raise RuntimeError("preregistration.sha256 missing or mismatched")
    return cfg, digest
