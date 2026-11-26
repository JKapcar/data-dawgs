#!/usr/bin/env python3
"""Probe NFL/NBA/NHL scoreboards to confirm season conventions before backfill.

Fetches one regular-season date and one postseason/All-Star date per league,
saves raw payloads to data/samples/ (gitignored), and reports: season.year (vs
the documented convention), season.type values present, a sample event's
competitors, OT/tie flags, and that parse_scoreboard handles the payload.
Read-only. Polite 1s spacing between requests.
"""

import json
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from bayesratings import espn  # noqa: E402

SAMPLES = ROOT / "data" / "samples"
SAMPLES.mkdir(parents=True, exist_ok=True)

PROBES = {
    "nfl": ("start year",  [("reg", "20251005"), ("playoff", "20260111")]),
    "nba": ("end year",    [("reg", "20250115"), ("allstar", "20250216")]),
    "nhl": ("end year",    [("reg", "20250115"), ("playoff", "20250510")]),
}


def main():
    for league, (convention, dates) in PROBES.items():
        print(f"\n===== {league.upper()} (documented: season.year = {convention}) =====")
        for label, date in dates:
            try:
                data = espn.fetch_scoreboard(league, dates=date)
            except Exception as e:
                print(f"  [{label} {date}] FETCH ERROR: {e}")
                continue
            (SAMPLES / f"espn-{league}-scoreboard-{date}.json").write_text(
                json.dumps(data))
            evs = data.get("events", [])
            lseason = (data.get("leagues") or [{}])[0].get("season", {})
            ltype = lseason.get("type", {})
            types = sorted({(e.get("season") or {}).get("type") for e in evs})
            print(f"  [{label} {date}] events={len(evs)} | league.season.year="
                  f"{lseason.get('year')} type={ltype.get('name')!r} "
                  f"| event season.type values={types}")
            if evs:
                e = evs[0]
                comp = (e.get("competitions") or [{}])[0]
                st = (comp.get("status") or {}).get("type", {})
                sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
                def g(c):
                    return (c.get("homeAway"), c["team"]["id"],
                            c["team"].get("abbreviation"), c.get("score"),
                            c.get("winner"))
                print(f"       ev.season year={(e.get('season') or {}).get('year')} "
                      f"type={(e.get('season') or {}).get('type')} | "
                      f"status completed={st.get('completed')} detail={st.get('detail')!r}")
                print(f"       {[g(c) for c in sides.values()]}")
                # ties among completed games today
                ties = [ev.get("shortName") for ev in evs
                        if (ev.get("competitions") or [{}])[0].get("status", {})
                           .get("type", {}).get("completed")
                        and len({c.get("score") for c in
                                 (ev.get("competitions") or [{}])[0].get("competitors", [])}) == 1]
                print(f"       completed ties today: {ties or 'none'}")
                parsed = espn.parse_scoreboard(data, league)
                print(f"       parse_scoreboard → {len(parsed['games'])} games, "
                      f"{len(parsed['teams'])} teams")
            time.sleep(1)


if __name__ == "__main__":
    main()
