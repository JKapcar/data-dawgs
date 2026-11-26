"""Pregame availability for player-model training.

A published status (out, doubtful, questionable, probable, available) is what
was known before the game. Out and doubtful are unavailable. Questionable,
probable and available stay available, including when the player did not
play. Where no status was published, training keeps the who-played proxy.
"""


UNAVAILABLE = frozenset({"out", "doubtful"})
AVAILABLE = frozenset({"questionable", "probable", "available"})
_BLANK = frozenset({"", "nan", "none", "n/a", "na", "not yet submitted"})


def norm_report_status(value):
    """Lowercase published status, or None when the cell is blank or not a status."""
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in _BLANK:
        return None
    if text in UNAVAILABLE or text in AVAILABLE:
        return text
    return None


def training_available(status, played):
    """Whether a player is in the training pool.

    `status` is a normalized report status or the raw cell. `played` is the
    who-played proxy (he recorded a minute, a snap, or the start).
    """
    st = status if status in UNAVAILABLE or status in AVAILABLE else norm_report_status(status)
    if st is None:
        return bool(played)
    if st in UNAVAILABLE:
        return False
    if st in AVAILABLE:
        return True
    return bool(played)


def _qb_text(qb):
    if qb is None:
        return None
    if isinstance(qb, float) and qb != qb:
        return None
    text = str(qb).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def pregame_qb(actual, previous, status_of):
    """Training quarterback for one team.

    `status_of(gsis)` is the published status, or None when that player is
    not on the report. No status for the quarterback who played keeps him.
    Out or doubtful uses the previous game's starter when that quarterback
    was not out or doubtful. When the previous starter is also ruled out,
    or there is no previous starter, the quarterback who played stays.
    """
    actual_id = _qb_text(actual)
    if actual_id is None or status_of is None:
        return actual
    if status_of(actual_id) not in UNAVAILABLE:
        return actual
    prev = _qb_text(previous)
    if prev and status_of(prev) not in UNAVAILABLE:
        return prev
    return actual
