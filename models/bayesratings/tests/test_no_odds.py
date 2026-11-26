"""Fail if the tree names a prediction-market exchange, a server path, an
unexpected host, a non-loopback address, or a key.

Odds from free sources (ESPN, nflverse) are allowed. A local database and
its logs are not scanned. The license file is the
verbatim AGPL-3.0 text and is not scanned. Public data-source hosts the
fetchers call are allowed. A building name that contains a dotted token is
not a host unless it is written as a URL.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _w(*parts):
    return "".join(parts)


# Exchange names, built from pieces so this file does not contain them.
_EXCHANGES = (
    _w("kal", "shi"),
    _w("poly", "mar", "ket"),
    _w("no", "vig"),
    _w("prophet", "x"),
)
_WORD = re.compile(r"(" + "|".join(_EXCHANGES) + r")", re.I)

_SERVER = re.compile("|".join([
    _w("/op", "t/"), _w("/et", "c/"), _w("/ru", "n/"),
    _w("/var/li", "b/"), _w("/var/lo", "g/"), _w("tail", "scale"),
]), re.I)

_IP = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b")
_LOOPBACK = {"127.0.0.1", "0.0.0.0"}

_URL = re.compile(r"https?://([a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,})", re.I)
_HOST_OK = (
    "espn.com", "mlb.com", "nba.com", "nhl.com", "nfl.com", "nhle.com",
    "github.com", "dailyfaceoff.com",
)

_KEY = re.compile("|".join([
    _w("ghp_", "[A-Za-z0-9]{10,}"),
    _w("BEGIN ", "[A-Z ]*PRIVATE KEY"),
    r"(?:api|secret|private)[_-]?key\s*=\s*\S+",
]), re.I)


def _files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in {".git", ".venv", "__pycache__", "dist", "build", ".pytest_cache"}
               or part.endswith(".egg-info") for part in path.parts):
            continue
        if path.name == "LICENSE" or path.suffix in {
                ".png", ".webp", ".avif", ".jpg", ".pdf", ".gz",
                ".db", ".db-wal", ".db-shm", ".log"}:
            continue
        yield path


def test_tree_has_no_exchange_names_paths_hosts_or_keys():
    bad = []
    for path in _files():
        try:
            text = path.read_text(errors="replace")
        except OSError:
            continue
        rel = path.relative_to(ROOT)
        for i, line in enumerate(text.splitlines(), 1):
            if _WORD.search(line):
                bad.append(f"{rel}:{i}: exchange")
            if _SERVER.search(line):
                bad.append(f"{rel}:{i}: path")
            for ip in _IP.findall(line):
                if ip not in _LOOPBACK:
                    bad.append(f"{rel}:{i}: address {ip}")
            if _KEY.search(line):
                bad.append(f"{rel}:{i}: key")
            for host in _URL.findall(line):
                host = host.split(":")[0].lower()
                if any(name in host for name in _EXCHANGES):
                    bad.append(f"{rel}:{i}: exchange host {host}")
                elif not any(host == ok or host.endswith("." + ok) for ok in _HOST_OK):
                    bad.append(f"{rel}:{i}: host {host}")
    assert not bad, "\n".join(bad[:40])
