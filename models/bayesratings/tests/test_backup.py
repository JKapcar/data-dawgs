"""Backup: snapshot is a valid gzip'd DB, pruning keeps newest N and ignores
other files. Run: PYTHONPATH=. python tests/test_backup.py"""
import gzip
import importlib.util
import sqlite3
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "backup_db", Path(__file__).resolve().parent.parent / "scripts" / "backup_db.py")
backup_db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_db)


def test_snapshot_and_prune():
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        src = td / "src.db"
        c = sqlite3.connect(src)
        c.execute("CREATE TABLE games (id INTEGER)")
        c.executemany("INSERT INTO games VALUES (?)", [(i,) for i in range(100)])
        c.commit()
        out_dir = td / "backups"
        out_dir.mkdir()
        for d in range(1, 9):
            (out_dir / f"bayesratings-2026-01-0{d}.db.gz").write_bytes(b"x")
        (out_dir / "keep-me.txt").write_text("not a backup")
        out = backup_db.snapshot(src, out_dir, day="2026-02-01")
        restored = td / "r.db"
        restored.write_bytes(gzip.decompress(out.read_bytes()))
        r = sqlite3.connect(restored)
        assert r.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert r.execute("SELECT COUNT(*) FROM games").fetchone()[0] == 100
        backup_db.prune(out_dir, 7)
        names = sorted(p.name for p in out_dir.iterdir())
        assert "keep-me.txt" in names and "bayesratings-2026-02-01.db.gz" in names
        assert len([n for n in names if n.startswith("bayesratings-")]) == 7
        assert "bayesratings-2026-01-01.db.gz" not in names
        assert not any(n.startswith(".snap-") or n.endswith(".tmp") for n in names)


if __name__ == "__main__":
    test_snapshot_and_prune()
    print("ok")
