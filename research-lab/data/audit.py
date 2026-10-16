#!/usr/bin/env python3
"""Reproducible audit of the real competition tables, with a receipt. Read-only.

    py research-lab\\data\\audit.py C:\\path\\to\\archive.zip --out C:\\path\\to\\audit-output

Reads every CSV inside the ZIP (or a directory of CSVs) in ONE streaming pass per table — no
extraction, nothing written next to or into the source — and records:

  identity   per-table byte count and SHA-256, archive verification (archive.py)
  shape      rows, columns, dtypes, null shares, numeric ranges, key uniqueness (manifest.py)
  joins      for each ID (game_id, play_id pair, nfl_id): distinct counts per table and how many
             of a table's IDs are absent from every other table that carries the same ID
  sampling   tracking time and frame spacing, dis vs coordinate deltas, dir convention, entity
             types, out-of-bounds, negative-a share (tracking-audit.py), for every tracking table
  leakage    post-play fields (post-play-fields.json, after aliases.json) by table, and columns
             that violate the registered feature cutoff (combine_results + combine_tracking only)
  readiness  which columns the recommended baseline needs are present, and where

Outputs, both in --out (default: ./audit-output beside where you run it, never in the repo):
  audit-receipt.json          full receipt; stays on your machine
  audit-receipt-summary.json  counts and shapes only, no identifiers or values; passes
                              tools/check-research-data.py and may be shared or committed
Each receipt carries the SHA-256 of the code and field lists that produced it and of its own body.
Standard library only. Python 3.9+.
"""
from __future__ import annotations

import argparse, csv, hashlib, importlib.util, io, json, os, re, sys, zipfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


manifest = _load("dd_manifest", "manifest.py")
tracking = _load("dd_tracking_audit", "tracking-audit.py")
archive = _load("dd_archive", "archive.py")
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

CODE_FILES = ["audit.py", "manifest.py", "tracking-audit.py", "archive.py", "aliases.json", "post-play-fields.json"]
# Columns the recommended baseline (BASELINE-PLAN.md) needs. Names compare case- and
# underscore-insensitively; any alias in a tuple counts.
READINESS = {
    "athlete_id": ("nfl_id", "nflId", "gsis_id"),
    "draft_year": ("draft_year", "draftYear", "season", "year"),
    "position": ("position", "pos", "official_position"),
    "forty": ("forty", "forty_yd", "forty_yard_dash", "40yd"),
    "ten_yd_split": ("ten_yd_split", "ten_yard_split", "10yd_split"),
    "combine_height": ("combine_height", "height", "ht"),
    "combine_weight": ("combine_weight", "weight", "wt"),
    "draft_overall_pick": ("draft_overall_pick", "overall_pick", "draft_pick"),
    "rookie_snap_share_or_snaps": ("snap_share", "offense_snap_share", "offense_pct", "snaps", "offense_snaps", "snap_count"),
    "route_type": ("route", "route_type", "route_ran", "routeRan"),
    "separation": ("separation", "target_separation", "nearest_defender_distance"),
}
CUTOFF_TABLE = re.compile(r"combine", re.I)
# draft_year is the class year, known before the draft; every other draft_* field is not.
POST_DRAFT = re.compile(r"^(draft_(?!year$)|overall_pick|pick$|round$|team$|club$)", re.I)


def norm(name):
    return manifest.norm(name)


class HashingReader(io.RawIOBase):
    """Wrap a binary stream and SHA-256 every byte that passes through it."""

    def __init__(self, raw):
        self.raw, self.sha, self.bytes = raw, hashlib.sha256(), 0

    def readable(self):
        return True

    def readinto(self, b):
        chunk = self.raw.read(len(b))
        n = len(chunk)
        b[:n] = chunk
        self.sha.update(chunk)
        self.bytes += n
        return n


class IdCollector:
    """Distinct identifier sets per table, for join coverage. Holds IDs in memory only."""

    def header(self, header):
        col = {norm(c): i for i, c in enumerate(header)}
        self.game = col.get("gameid")
        self.play = col.get("playid")
        self.athlete = next((col[k] for k in ("nflid", "gsisid") if k in col), None)
        self.games, self.plays, self.athletes = set(), set(), set()

    def row(self, row):
        get = lambda i: row[i] if i is not None and i < len(row) and row[i] not in manifest.NULLS else None
        g, p, a = get(self.game), get(self.play), get(self.athlete)
        if g is not None:
            self.games.add(g)
            if p is not None:
                self.plays.add((g, p))
        if a is not None:
            self.athletes.add(a)


def sources(path):
    """Yield (name, binary stream factory) for every CSV in a ZIP or a directory."""
    if zipfile.is_zipfile(path):
        z = zipfile.ZipFile(path)
        for info in sorted(z.infolist(), key=lambda i: i.filename):
            if info.filename.lower().endswith(".csv") and not info.is_dir():
                yield info.filename, (lambda info=info: z.open(info)), info.compress_size
    else:
        for name in sorted(os.listdir(path)):
            if name.lower().endswith(".csv"):
                full = os.path.join(path, name)
                yield name, (lambda full=full: open(full, "rb")), None


def load_fields():
    with open(os.path.join(HERE, "aliases.json"), encoding="utf-8") as f:
        aliases = {norm(k): v for k, v in json.load(f)["aliases"].items()}
    with open(os.path.join(HERE, "post-play-fields.json"), encoding="utf-8") as f:
        post = json.load(f)
    return aliases, {norm(x) for x in post["post_play_fields"]}, [re.compile(p) for p in post["patterns"]]


def canonical(name, aliases):
    return aliases.get(norm(name), name)


def audit(source, check_keys=True):
    aliases, post_fields, post_patterns = load_fields()
    tables, ids, tracking_results = [], {}, []
    for name, opener, compressed in sources(source):
        raw = opener()
        hashing = HashingReader(raw)
        text = io.TextIOWrapper(io.BufferedReader(hashing, 1 << 20), encoding="utf-8-sig", newline="")
        collector, maybe = IdCollector(), MaybeTracking()
        profile = manifest.profile_stream(text, check_keys, [collector, maybe])
        raw.close()
        auditor = maybe.auditor
        canon = [canonical(c["name"], aliases) for c in profile["columns"]]
        leak = sorted(c for c in canon if norm(c) in post_fields or any(p.search(c) for p in post_patterns))
        cutoff = sorted(c for c in canon if CUTOFF_TABLE.search(name) and POST_DRAFT.search(c)) if CUTOFF_TABLE.search(name) else []
        tables.append({"file": name, "bytes": hashing.bytes, "compressed_bytes": compressed, "sha256": hashing.sha.hexdigest(), **profile,
                       "post_play_fields": leak, "post_cutoff_columns": cutoff, "tracking": auditor is not None})
        ids[name] = collector
        if auditor:
            tracking_results.append(auditor.result(name))
    joins = {}
    for kind, attr in (("game_id", "games"), ("game_play", "plays"), ("athlete_ids", "athletes")):
        carriers = {n: getattr(c, attr) for n, c in ids.items() if getattr(c, attr)}
        rows = []
        for n, own in carriers.items():
            others = set().union(*[v for k, v in carriers.items() if k != n]) if len(carriers) > 1 else set()
            rows.append({"file": n, "distinct": len(own), "absent_from_all_other_tables": len(own - others) if others else None})
        joins[kind] = {"tables": len(carriers), "union_distinct": len(set().union(*carriers.values())) if carriers else 0, "by_table": rows}
    readiness = {}
    for need, names in READINESS.items():
        wanted = {norm(n) for n in names}
        readiness[need] = sorted({t["file"] + ":" + c["name"] for t in tables for c in t["columns"] if norm(canonical(c["name"], aliases)) in wanted})
    return tables, joins, tracking_results, readiness


class MaybeTracking:
    """Becomes a TrackingAuditor when the table's header is a tracking header; otherwise inert."""

    auditor = None

    def header(self, header):
        if tracking.is_tracking(header):
            self.auditor = tracking.TrackingAuditor()
            self.auditor.header(header)

    def row(self, row):
        if self.auditor:
            self.auditor.row(row)


def sha_file(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def seal(body):
    text = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return {**body, "receipt_sha256": hashlib.sha256(text.encode()).hexdigest()}


def build(source, check_keys=True):
    started = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    archive_check = archive.verify(source) if zipfile.is_zipfile(source) else None
    tables, joins, tracking_results, readiness = audit(source, check_keys)
    code = {f: sha_file(os.path.join(HERE, f)) for f in CODE_FILES}
    full = seal({"kind": "bdb-audit-receipt", "version": 1, "as_of": started[:10], "generated_at": started,
                 "source": os.path.basename(source), "archive": archive_check, "code_sha256": code,
                 "tables": tables, "joins": joins, "tracking": tracking_results, "readiness": readiness,
                 "note": "Full receipt. Stays on the owner's machine; column ranges and per-table detail are not for publication."})
    summary = seal({"kind": "bdb-audit-receipt-summary", "version": 1, "as_of": started[:10], "generated_at": started,
                    "source": "owner-local archive", "full_receipt_sha256": full["receipt_sha256"], "code_sha256": code,
                    "archive": {k: archive_check[k] for k in ("bytes", "sha256", "partHashesSha256", "checks", "ok")} if archive_check else None,
                    "tables": [{"file": t["file"], "bytes": t["bytes"], "sha256": t["sha256"], "rows": t["rows"], "columns": len(t["columns"]),
                                "key_unique": t["key_unique"], "duplicated_keys": t["duplicated_keys"],
                                "max_null_share": max([c["null_share"] for c in t["columns"] if c["null_share"] is not None], default=None),
                                "draft_year_coverage": t["draft_year_coverage"], "tracking": t["tracking"],
                                "post_play_fields": t["post_play_fields"], "post_cutoff_columns": t["post_cutoff_columns"]} for t in tables],
                    "joins": {k: {"tables": v["tables"], "union_distinct": v["union_distinct"], "by_table": v["by_table"]} for k, v in joins.items()},
                    # Data values never become JSON keys in the summary: entity types are listed as rows.
                    "tracking": [{**{k: r[k] for k in ("file", "rows", "tracks", "frame_steps", "non_monotonic_steps", "time_steps_seconds", "dis_minus_coordinate_delta",
                                                       "dir_convention_share", "out_of_bounds", "a_negative_share", "orientation_column_present")},
                                  "entity_types": [{"entity_type": e, "rows": n} for e, n in sorted(r["entity_type_counts"].items())]} for r in tracking_results],
                    "readiness": {k: bool(v) for k, v in readiness.items()}, "readiness_columns": readiness,
                    "note": "Counts, shapes, hashes and column names only. No identifiers, names or values."})
    return full, summary


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("source", help="the competition ZIP, or a directory of its CSVs (read-only)")
    ap.add_argument("--out", default="audit-output", help="directory for the receipts (created if missing)")
    ap.add_argument("--no-keys", action="store_true", help="skip key-uniqueness checks to save memory")
    args = ap.parse_args(argv)
    full, summary = build(args.source, not args.no_keys)
    os.makedirs(args.out, exist_ok=True)
    for name, body in (("audit-receipt.json", full), ("audit-receipt-summary.json", summary)):
        with open(os.path.join(args.out, name), "w", encoding="utf-8") as f:
            json.dump(body, f, indent=1)
            f.write("\n")
        print("wrote", os.path.join(args.out, name))
    print("archive ok" if (summary["archive"] or {}).get("ok") else "archive check: see receipt")
    print("readiness:", ", ".join(k for k, v in summary["readiness"].items() if not v) or "all baseline columns found", "missing" if any(not v for v in summary["readiness"].values()) else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
