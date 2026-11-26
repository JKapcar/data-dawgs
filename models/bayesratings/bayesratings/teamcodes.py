"""Team-abbreviation aliases used when a feed's code differs from ESPN's."""

_CODE_ALIASES = {
    "nfl": {"JAC": "JAX", "WAS": "WSH", "LA": "LAR"},
    "nba": {"GSW": "GS", "NOP": "NO", "NYK": "NY", "PHO": "PHX", "SAS": "SA",
            "UTA": "UTAH", "WAS": "WSH"},
    "nhl": {"NJD": "NJ", "TBL": "TB", "LAK": "LA", "SJS": "SJ", "MON": "MTL",
            "NAS": "NSH", "VEG": "VGK", "WAS": "WSH", "UTA": "UTAH", "CLB": "CBJ"},
    "mlb": {"CWS": "CHW", "AZ": "ARI", "OAK": "ATH", "WAS": "WSH"},
}


def canon(league, code):
    """ESPN abbreviation for a feed's code (unchanged when it already matches)."""
    c = (code or "").upper().strip()
    return _CODE_ALIASES.get(league, {}).get(c, c)
