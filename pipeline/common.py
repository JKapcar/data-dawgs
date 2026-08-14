"""Invariant helpers for the forecasting pipeline. Stdlib only."""
from __future__ import annotations
import hashlib, json, os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PENDING = "PENDING_RATIFICATION"

def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha256(value):
    if not isinstance(value, bytes): value = canonical_json(value).encode("utf-8")
    return hashlib.sha256(value).hexdigest()

def utcnow(): return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def write_json(path, payload, *, api_key=None):
    """The only artifact writer; refuses accidental secret serialization."""
    encoded = canonical_json(payload)
    key = api_key or os.environ.get("OPENROUTER_API_KEY")
    if key and key in encoded: raise ValueError("refusing to serialize OPENROUTER_API_KEY")
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(encoded + "\n", encoding="utf-8")

def read_json(path): return json.loads(Path(path).read_text(encoding="utf-8"))

def stamped(payload, *, dry_run=False):
    body = dict(payload); body["generated_at"] = utcnow(); body["dry_run"] = dry_run
    body["sha256"] = sha256({k:v for k,v in body.items() if k != "sha256"})
    return body
