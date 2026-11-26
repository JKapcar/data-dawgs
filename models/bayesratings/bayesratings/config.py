"""Settings from the environment and an optional ``.env`` file.

No keys are required. Paths default to the checkout so a clone runs locally.

``BAYESRATINGS_LOCK`` is the full path of the writer-lock file. It is read
in ``bayesratings/db.py`` (``resolve_lock_path``) and overrides
``BAYESRATINGS_LOCK_DIR``. When it is unset, the lock file is
``write.lock`` inside the lock directory.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Load KEY=VALUE lines from ``.env`` in the working directory or the repo.

    Existing environment variables win. Blank lines and ``#`` comments are
    ignored. Values may be wrapped in single or double quotes.
    """
    for path in (Path.cwd() / ".env", ROOT / ".env"):
        if not path.is_file():
            continue
        try:
            text = path.read_text()
        except OSError:
            continue
        for raw in text.splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                val = val[1:-1]
            if key and key not in os.environ:
                os.environ[key] = val
        break


_load_dotenv()


def db_path() -> str:
    return os.environ.get("BAYESRATINGS_DB", "data/bayesratings.db")


def user_agent() -> str:
    """Identifying User-Agent. Must not contain a URL (some hosts stall those)."""
    return os.environ.get(
        "BAYESRATINGS_USER_AGENT",
        "bayesratings-models/0.1 (local; set BAYESRATINGS_USER_AGENT)",
    )


def status_dir() -> str:
    return os.environ.get("BAYESRATINGS_STATUS_DIR", str(ROOT / "data" / "status"))


def status_path(name: str) -> str:
    return str(Path(status_dir()) / name)


def lock_dir() -> str:
    return os.environ.get("BAYESRATINGS_LOCK_DIR", str(ROOT / "data"))
