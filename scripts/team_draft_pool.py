#!/usr/bin/env python3
"""
data/draft-2026.json — the pipe behind teamdraft.html.

The 2026 NFL team draft is eight people taking four NFL teams each. Every team is
owned, so league-wide wins are conserved at exactly 272 and par is 34.00 per drafter.
That conservation is the whole point of the page, and it is what this script checks.

WHAT IS SOURCE AND WHAT IS DERIVED
----------------------------------
Source, and never recomputed here:

    teams[].line          median posted win total
    teams[].ew            devigged expected wins, normalized to 272
    teams[].sd            season win standard deviation, from the upstream simulation
    teams[].dist          win-count probability mass, 0-17
    teams[].schedule      17 games with per-game win probability
    overlap               head-to-head game counts between team pairs
    picks                 the draft log
    draft_order           the eight drafters, in first-round order

Derived, and recomputed on every run so it cannot drift from the picks:

    drafters              roster, aggregate EW, internal games, par delta, picks left
    undrafted             the pool still on the board
    board                 the snake grid, with reach/value per pick
    diagnostics           what the numbers do and do not agree with

⚠️ EXPECTED WINS ARE NOT RECOMPUTED. The devig is upstream work; this script sums it.
If you find yourself adding a model here, you are in the wrong file.

RUNNING IT
----------
Append the picks as they land, then rebuild the manifest:

    python3 scripts/team_draft_pool.py --pick Jared:NYG --pick Alan:CLE
    node tools/data-manifest.js && node tools/validate-data.js

`--pick` takes `Drafter:TEAM` and assigns the next open slot in snake order. It
refuses a pick that is out of turn, a team already gone, or a name not in the draft
order — a silently misfiled pick is the one error the page cannot show you.

Other entry points:

    --import RAW.json     first load, from the upstream generator's payload
    --as-of YYYY-MM-DD    stamp a new as_of (defaults to keeping the current one)
    --check               recompute and diff, write nothing (exit 1 if it would change)
"""
import argparse
import datetime
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO / "data" / "draft-2026.json"

ROUNDS = 4
TOTAL_TEAMS = 32
TOTAL_WINS = 272          # 17 games x 32 teams / 2 — a league-wide identity, not an estimate
GAMES_PER_TEAM = 17

TIER_MEANING = (
    "Pup — live and useful, not yet validated. It may compute real answers and still "
    "have open questions about calibration, assumptions, data quality or edge. "
    "Everything starts here."
)

NOTE = (
    "A private eight-person pool: four NFL teams each, all 32 owned, total regular-season "
    "wins the only criterion. Expected wins are devigged from four books and normalized to "
    "272; they are NOT the posted lines, and `line` carries those separately. Nothing here "
    "is graded — the 2026 season has not started, every wins_tracker row reads zero, and no "
    "figure on this surface is a result. `drafters`, `undrafted`, `board` and `diagnostics` "
    "are derived from `picks` by scripts/team_draft_pool.py and are rewritten on every run."
)


# --------------------------------------------------------------------- helpers ----
def snake_slots(order):
    """Pick number -> drafter, serpentine. Pick 1 is order[0]; round 2 runs backwards."""
    slots = []
    for rnd in range(1, ROUNDS + 1):
        seq = order if rnd % 2 == 1 else list(reversed(order))
        for name in seq:
            slots.append((len(slots) + 1, rnd, name))
    return slots


def internal_games(roster, overlap):
    """Games this roster plays against ITSELF.

    Each one is a win the roster is guaranteed to bank and simultaneously guaranteed
    to lose, so it is dead weight in both tails: floor raised, ceiling capped."""
    return sum(
        overlap.get(a, {}).get(b, 0)
        for i, a in enumerate(roster)
        for b in roster[i + 1:]
    )


def model_sd(roster, teams):
    """Roster SD from the team SDs plus the head-to-head correction.

    Team-level SD in quadrature, then subtract 2*p*(1-p) for every game the roster
    plays against itself: in that game exactly one of the two indicators fires, so the
    pair is negatively related and the roster's variance falls.

    ⚠️ This is NOT the upstream simulated SD and it does not reproduce it — the
    simulation also draws correlated team strength, which quadrature cannot see. The
    two are reported side by side in diagnostics rather than reconciled. Used on the
    page only when a roster has changed and the simulation has not been re-run.
    """
    var = sum(teams[t]["sd"] ** 2 for t in roster)
    for i, a in enumerate(roster):
        for b in roster[i + 1:]:
            for g in teams[a]["schedule"]:
                if g["opp"] == b:
                    var -= 2 * g["wp"] * (1 - g["wp"])
    return round(max(var, 0.0) ** 0.5, 3)


def build_board(picks, teams, order):
    """The snake grid, with the reach/value signal per pick.

    `delta` is the chosen team's EW minus the best EW still available at that moment.
    It is zero or negative by construction: zero means best-available was taken,
    -1.8 means someone reached past 1.8 expected wins. It is a description of the
    board, not a grade of the pick — nobody drafts on expected wins alone.
    """
    by_pick = {p["pick"]: p for p in picks}
    gone, board = set(), []
    for num, rnd, who in snake_slots(order):
        p = by_pick.get(num)
        if not p:
            board.append({"pick": num, "round": rnd, "drafter": who, "team": None})
            continue
        avail = sorted(
            (t for t in teams if t not in gone),
            key=lambda t: -teams[t]["ew"],
        )
        best = avail[0]
        board.append({
            "pick": num,
            "round": rnd,
            "drafter": p["drafter"],
            "team": p["team"],
            "ew": teams[p["team"]]["ew"],
            "best_available": best,
            "best_available_ew": teams[best]["ew"],
            "delta": round(teams[p["team"]]["ew"] - teams[best]["ew"], 2),
            "rank_at_pick": avail.index(p["team"]) + 1,
            "available_at_pick": len(avail),
        })
        gone.add(p["team"])
    return board


def derive(d, sd_source):
    """Everything that follows from picks. Pure — no I/O, no upstream numbers touched."""
    teams, overlap, order = d["teams"], d["overlap"], d["draft_order"]
    picks = sorted(d["picks"], key=lambda p: p["pick"])

    rosters = {name: [] for name in order}
    for p in picks:
        rosters[p["drafter"]].append(p["team"])

    drafters = {}
    for slot, name in enumerate(order, start=1):
        roster = rosters[name]
        ew = round(sum(teams[t]["ew"] for t in roster), 2)
        drafters[name] = {
            # The color slot is the DRAFT SLOT, fixed for the season. Colour follows the
            # person, never their rank — a re-sorted standings table must not repaint.
            "slot": slot,
            "roster": roster,
            "ew": ew,
            "par_delta": round(ew - d["par"], 2),
            "internal_games": internal_games(roster, overlap),
            "sd_sim": sd_source.get(name),
            "sd_model": model_sd(roster, teams) if roster else None,
            "picks_remaining": ROUNDS - len(roster),
        }

    drafted = {p["team"] for p in picks}
    undrafted = sorted((t for t in teams if t not in drafted), key=lambda t: -teams[t]["ew"])

    return {
        "drafters": drafters,
        "undrafted": undrafted,
        "board": build_board(picks, teams, order),
        "picks_made": len(picks),
        "picks_total": len(order) * ROUNDS,
    }


# ----------------------------------------------------------------- diagnostics ----
def diagnose(d, derived):
    """What the payload agrees with, and — more usefully — what it does not.

    Every number here is measured off the file on this run. Three of these checks are
    expected to report a non-zero drift; that is the point. A diagnostics block that
    only ever prints OK is decoration.
    """
    teams, overlap = d["teams"], d["overlap"]
    checks = []

    def add(id_, label, ok, detail, value=None, severity="info"):
        checks.append({"id": id_, "label": label, "ok": bool(ok), "detail": detail,
                       "value": value, "severity": severity})

    # --- conservation: the identity the whole page rests on ---------------------
    ew_sum = round(sum(t["ew"] for t in teams.values()), 4)
    add("ew_sum", "Expected wins sum to 272",
        abs(ew_sum - TOTAL_WINS) < 0.05,
        f"{ew_sum:.2f} against a league total of {TOTAL_WINS}. The teams carry two "
        f"decimals each, so a drift of a hundredth or two is the rounding and nothing "
        f"else; anything larger means the devig was not renormalized.",
        ew_sum, "hard")

    add("team_count", "32 teams, 4 per division",
        len(teams) == TOTAL_TEAMS and all(
            sum(1 for t in teams.values() if t["division"] == div) == 4
            for div in {t["division"] for t in teams.values()}),
        f"{len(teams)} teams across {len({t['division'] for t in teams.values()})} divisions.",
        len(teams), "hard")

    # --- the overlap matrix ------------------------------------------------------
    asym = sum(1 for a, row in overlap.items() for b, v in row.items()
               if overlap.get(b, {}).get(a) != v)
    total_games = sum(sum(r.values()) for r in overlap.values()) // 2
    per_team_bad = sorted(k for k in teams if sum(overlap.get(k, {}).values()) != GAMES_PER_TEAM)
    add("overlap", "Head-to-head matrix is symmetric and complete",
        asym == 0 and total_games == TOTAL_WINS and not per_team_bad,
        f"{asym} asymmetric entries, {total_games} games total (expect {TOTAL_WINS}), "
        f"{len(per_team_bad)} teams not playing exactly {GAMES_PER_TEAM}."
        + (f" Off: {', '.join(per_team_bad)}." if per_team_bad else ""),
        total_games, "hard")

    # --- the schedule ------------------------------------------------------------
    mismatch = 0
    for k, t in teams.items():
        for g in t["schedule"]:
            other = [x for x in teams[g["opp"]]["schedule"]
                     if x["week"] == g["week"] and x["opp"] == k]
            if not other or abs(other[0]["wp"] + g["wp"] - 1) > 1e-4:
                mismatch += 1
    add("schedule_pairs", "Every game's two win probabilities sum to 1",
        mismatch == 0,
        f"{mismatch} games where the two sides do not complement. The schedule is one "
        f"coherent set of games, not 32 independent lists.",
        mismatch, "hard")

    # --- the drift worth knowing about, #1 ---------------------------------------
    sched_drift = sorted(
        ((k, round(sum(g["wp"] for g in t["schedule"]) - t["ew"], 3)) for k, t in teams.items()),
        key=lambda kv: -abs(kv[1]))
    worst = sched_drift[0]
    add("schedule_vs_ew", "Game probabilities do not re-add to expected wins",
        False,
        f"Summing a team's 17 game probabilities lands up to {abs(worst[1]):.2f} wins away "
        f"from its expected-wins figure ({worst[0]}: {sum(g['wp'] for g in teams[worst[0]]['schedule']):.2f} "
        f"against {teams[worst[0]]['ew']:.2f}). Across all 32 the game probabilities sum to "
        f"{sum(g['wp'] for t in teams.values() for g in t['schedule']):.0f} — the league total is "
        f"right and the split between teams is not. The refit to market totals did not converge "
        f"per team, so the ladder and the schedule strip are two different numbers and the page "
        f"labels them as such rather than quietly picking one.",
        abs(worst[1]), "known")

    # --- the drift worth knowing about, #2 ---------------------------------------
    dist_drift = sorted(
        ((k, round(sum(int(w) * p for w, p in t["dist"].items())
                   / sum(t["dist"].values()) - t["ew"], 3)) for k, t in teams.items()),
        key=lambda kv: -abs(kv[1]))
    dw = dist_drift[0]
    add("dist_vs_ew", "Win distributions run above expected wins at the bottom of the board",
        False,
        f"The mean of the 0-17 distribution sits up to {abs(dw[1]):.2f} wins from expected wins "
        f"({dw[0]}). The gap is positive for the worst teams and negative for the best, which is "
        f"what truncation at 0 and 17 does to a distribution built around a mean near the edge. "
        f"The curves are the shape of a season, not a second estimate of its total.",
        abs(dw[1]), "known")

    dist_sum = max(abs(sum(t["dist"].values()) - 1) for t in teams.values())
    add("dist_mass", "Each win distribution sums to 1",
        dist_sum < 5e-4,
        f"Worst total mass is off by {dist_sum:.5f} — four-decimal rounding across 18 buckets.",
        round(dist_sum, 6), "hard")

    # --- the draft ---------------------------------------------------------------
    picks = sorted(d["picks"], key=lambda p: p["pick"])
    slots = {n: who for n, _, who in snake_slots(d["draft_order"])}
    out_of_turn = [p for p in picks if slots.get(p["pick"]) != p["drafter"]]
    dupes = sorted({p["team"] for p in picks if
                    sum(1 for q in picks if q["team"] == p["team"]) > 1})
    unknown = sorted({p["team"] for p in picks if p["team"] not in teams})
    add("picks", "The draft log is a valid snake",
        not out_of_turn and not dupes and not unknown,
        f"{len(picks)} of {derived['picks_total']} picks recorded. "
        f"{len(out_of_turn)} out of turn, {len(dupes)} teams taken twice, "
        f"{len(unknown)} unknown abbreviations."
        + (f" Duplicates: {', '.join(dupes)}." if dupes else "")
        + (f" Unknown: {', '.join(unknown)}." if unknown else ""),
        len(picks), "hard")

    owned = round(sum(v["ew"] for v in derived["drafters"].values()), 2)
    pool = round(sum(teams[t]["ew"] for t in derived["undrafted"]), 2)
    add("conservation", "Rostered wins plus the pool still add to the league total",
        abs(owned + pool - ew_sum) < 0.05,
        f"{owned:.2f} on rosters, {pool:.2f} still on the board, {owned + pool:.2f} together. "
        f"With every pick made, the eight roster totals must sum to {TOTAL_WINS} and one "
        f"drafter's gain is another's loss — that is the whole game.",
        owned, "hard")

    # --- the two standard deviations ---------------------------------------------
    gaps = [(n, round(v["sd_model"] - v["sd_sim"], 3))
            for n, v in derived["drafters"].items()
            if v.get("sd_sim") is not None and v.get("sd_model") is not None]
    if gaps:
        g = max(gaps, key=lambda kv: abs(kv[1]))
        add("sd_models", "Two roster standard deviations, and they disagree",
            True,
            f"The upstream simulation and the quadrature-plus-head-to-head calculation sit "
            f"within {abs(g[1]):.2f} wins of each other (worst: {g[0]}). They diverge most for "
            f"rosters with internal games, and the simulation is the smaller of the two — it "
            f"also draws correlated team strength, which quadrature cannot see. The page shows "
            f"the simulated figure wherever it exists and says when it is falling back.",
            abs(g[1]), "info")
    else:
        add("sd_models", "Roster standard deviation is derived, not simulated",
            True,
            "No simulated roster SD ships with this payload, so the page shows the "
            "quadrature-plus-head-to-head figure and labels it as derived.",
            None, "info")

    return {
        "checked_at_as_of": d["as_of"],
        "hard_failures": [c["id"] for c in checks if c["severity"] == "hard" and not c["ok"]],
        "checks": checks,
    }


# ------------------------------------------------------------------------ io ----
def envelope(d, derived, diagnostics, as_of, built):
    """The /data/ contract: as_of and source on the outside, payload under `data`."""
    return {
        "source_page": "/teamdraft.html",
        "tier": "labs",
        "graded": False,
        "as_of": as_of,
        "source": d["source"],
        "note": NOTE,
        "field_notes": {
            "line": "Median posted regular-season win total. Half-point lines are the book's.",
            "ew": "Devigged expected wins, normalized so all 32 sum to 272. Not the posted line.",
            "sd": "Season win standard deviation from the upstream simulation.",
            "dist": "Probability mass by final win count, 0 through 17. Sums to 1 within rounding.",
            "schedule": "17 games: week, opponent, home flag, and this team's win probability.",
            "overlap": "Sparse symmetric head-to-head game counts. 2 = division rival, 1 = other, absent = 0.",
            "wins_tracker": "Actual wins, by round, per drafter. Every value is zero — no game has been played.",
            "board[].delta": "Chosen team's expected wins minus the best still available. Descriptive, not a grade.",
        },
        "tier_meaning": TIER_MEANING,
        "built": built,
        "canonical_url": "https://datadawgs216.com/data/draft-2026.json",
        "data": {
            "season": 2026,
            "format": {
                "drafters": len(d["draft_order"]),
                "teams_per_drafter": ROUNDS,
                "rounds": ROUNDS,
                "order": "snake",
                "criterion": "total regular-season wins",
                "tie_value": 0.5,
                "prizes": {"first": 120, "second": 40, "currency": "USD"},
                "tiebreakers": [
                    "total playoff wins among the four teams",
                    "total regular-season point differential among the four teams",
                ],
            },
            "par": d["par"],
            "total_wins": d["total_wins"],
            "draft_order": d["draft_order"],
            "teams": d["teams"],
            "overlap": d["overlap"],
            "picks": sorted(d["picks"], key=lambda p: p["pick"]),
            # Zeroes, deliberately. The tracker ships with the shape the season will
            # fill in so nothing has to be rebuilt in week 1, and it reads zero because
            # zero is the true number today.
            "wins_tracker": {
                name: {"rounds": [0, 0, 0, 0], "total": 0}
                for name in d["draft_order"]
            },
            **derived,
            "diagnostics": diagnostics,
        },
    }


def load_existing():
    if not OUT.exists():
        sys.exit(f"{OUT} does not exist — bootstrap it with --import RAW.json")
    env = json.loads(OUT.read_text(encoding="utf-8"))
    # ⚠️ A COPY. `derive` and the envelope builder read `d` freely, and mutating the
    # dict that `env` still points at makes --check diff the file against itself.
    d = json.loads(json.dumps(env["data"]))
    d["as_of"], d["source"] = env["as_of"], env["source"]
    sd_source = {n: v.get("sd_sim") for n, v in d.get("drafters", {}).items()}
    return env, d, sd_source


def load_raw(path):
    d = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    sd_source = {n: v.get("sd") for n, v in d.get("drafters", {}).items()}
    return d, sd_source


def apply_picks(d, specs):
    """Append `Drafter:TEAM` picks into the next open snake slots.

    Refuses anything it cannot place unambiguously. A pick recorded against the wrong
    slot is invisible on the page — every roster still shows four teams — so this is
    the one place that has to be strict."""
    order = d["draft_order"]
    taken_nums = {p["pick"] for p in d["picks"]}
    taken_teams = {p["team"] for p in d["picks"]}
    for spec in specs:
        if ":" not in spec:
            sys.exit(f"--pick {spec!r}: expected Drafter:TEAM")
        who, team = (s.strip() for s in spec.split(":", 1))
        team = team.upper()
        if who not in order:
            sys.exit(f"--pick {spec!r}: {who!r} is not in the draft order {order}")
        if team not in d["teams"]:
            sys.exit(f"--pick {spec!r}: {team!r} is not one of the 32 team abbreviations")
        if team in taken_teams:
            prev = next(p for p in d["picks"] if p["team"] == team)
            sys.exit(f"--pick {spec!r}: {team} already went at pick {prev['pick']} to {prev['drafter']}")
        slot = next(((n, r) for n, r, name in snake_slots(order)
                     if name == who and n not in taken_nums), None)
        if slot is None:
            sys.exit(f"--pick {spec!r}: {who} already has all {ROUNDS} picks")
        num, rnd = slot
        d["picks"].append({"pick": num, "round": rnd, "drafter": who, "team": team})
        taken_nums.add(num)
        taken_teams.add(team)
        print(f"  pick {num:>2} (round {rnd}) {who} -> {team}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--import", dest="raw", metavar="RAW.json",
                    help="bootstrap from the upstream generator's payload")
    ap.add_argument("--pick", action="append", default=[], metavar="Drafter:TEAM",
                    help="append a pick into the next open snake slot (repeatable)")
    ap.add_argument("--as-of", metavar="YYYY-MM-DD", help="stamp a new as_of")
    ap.add_argument("--check", action="store_true",
                    help="recompute and report; write nothing; exit 1 if the file would change")
    args = ap.parse_args()

    if args.raw:
        d, sd_source = load_raw(args.raw)
        before = None
    else:
        before, d, sd_source = load_existing()

    if args.pick:
        apply_picks(d, args.pick)

    as_of = args.as_of or d["as_of"]
    built = datetime.date.today().isoformat()
    derived = derive(d, sd_source)
    diagnostics = diagnose(d, derived)
    env = envelope(d, derived, diagnostics, as_of, built)

    # `built` moves every run; ignore it when deciding whether anything really changed.
    def comparable(e):
        return json.dumps({k: v for k, v in e.items() if k != "built"}, sort_keys=True)

    changed = before is None or comparable(before) != comparable(env)

    made, total = derived["picks_made"], derived["picks_total"]
    print(f"\n  {made}/{total} picks · {len(derived['undrafted'])} teams still on the board")
    for name in d["draft_order"]:
        v = derived["drafters"][name]
        sd = v["sd_sim"] if v["sd_sim"] is not None else v["sd_model"]
        flag = "" if v["sd_sim"] is not None else "  (SD derived — simulation not re-run)"
        print(f"  {name:<7} {v['ew']:6.2f} EW  {v['par_delta']:+6.2f} vs par  "
              f"{v['internal_games']} internal  SD {sd}  "
              f"{', '.join(v['roster']) or '—'}{flag}")

    for c in diagnostics["checks"]:
        mark = {"hard": "FAIL", "known": "note", "info": "ok  "}[c["severity"]] if not c["ok"] else "ok  "
        if c["severity"] == "known" and not c["ok"]:
            mark = "note"
        print(f"  {mark}  {c['label']}")

    if diagnostics["hard_failures"]:
        print(f"\n  HARD FAILURES: {', '.join(diagnostics['hard_failures'])}")

    if args.check:
        print(f"\n  --check: {'file would change' if changed else 'file is current'}")
        sys.exit(1 if changed else 0)

    OUT.write_text(json.dumps(env, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n  wrote {OUT.relative_to(REPO)} ({OUT.stat().st_size} bytes)")
    print("  next: node tools/data-manifest.js && node tools/validate-data.js")
    sys.exit(1 if diagnostics["hard_failures"] else 0)


if __name__ == "__main__":
    main()
