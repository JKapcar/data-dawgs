"""Snapshot the SQLite DB after a successful daily update.

Uses the sqlite3 online backup API, so the copy is consistent while another
job keeps the database. Writes backups/bayesratings-YYYY-MM-DD.db.gz
(America/Chicago date) and keeps only the newest KEEP snapshots in that folder.

Run: python scripts/backup_db.py [--db PATH] [--dir PATH] [--keep 7]
"""
import argparse
import gzip
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parent.parent
NAME_RE = re.compile(r"^bayesratings-\d{4}-\d{2}-\d{2}\.db\.gz$")


def log(msg):
    ts = datetime.now(ZoneInfo("America/Chicago")).strftime("%F %T CT")
    print(f"{ts} backup: {msg}", flush=True)


def snapshot(db_path, out_dir, day=None):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    day = day or datetime.now(ZoneInfo("America/Chicago")).date().isoformat()
    final = out_dir / f"bayesratings-{day}.db.gz"
    fd, raw = tempfile.mkstemp(prefix=".snap-", suffix=".db", dir=out_dir)
    os.close(fd)
    gz_tmp = final.with_name(final.name + ".tmp")
    try:
        src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        dst = sqlite3.connect(raw)
        with dst:
            src.backup(dst, pages=4096)
        src.close()
        ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
        dst.close()
        if ok != "ok":
            raise RuntimeError(f"integrity_check failed: {ok}")
        with open(raw, "rb") as f, gzip.open(gz_tmp, "wb", compresslevel=6) as g:
            shutil.copyfileobj(f, g, 1 << 20)
        os.replace(gz_tmp, final)
    finally:
        for p in (raw, gz_tmp):
            try:
                os.remove(p)
            except FileNotFoundError:
                pass
    return final


def prune(out_dir, keep):
    files = sorted(p for p in Path(out_dir).iterdir() if NAME_RE.match(p.name))
    removed = files[:-keep] if keep > 0 else []
    for p in removed:
        p.unlink()
    return removed


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(REPO / "data" / "bayesratings.db"))
    ap.add_argument("--dir", default=str(REPO / "backups"))
    ap.add_argument("--keep", type=int, default=7)
    a = ap.parse_args(argv)
    if not Path(a.db).exists():
        log(f"database not found: {a.db}")
        return 1
    try:
        out = snapshot(a.db, a.dir)
    except Exception as e:  # keep older backups if this one fails
        log(f"FAILED: {e}")
        return 1
    log(f"wrote {out.name} ({out.stat().st_size / 1e6:.1f} MB)")
    for p in prune(a.dir, a.keep):
        log(f"removed old {p.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
