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

WITHOUT A TERMINAL
------------------
.github/workflows/draft-picks.yml runs exactly this from the Actions tab: open
"Record draft picks", press Run workflow, type `Jared:NYG Alan:CLE`, and GitHub runs
the pipe, validates, and commits to main. That path exists so draft night does not
require a laptop, and it is why this script's refusals have to stay strict and its
messages have to stay readable — they are the only thing standing between a typo and
a wrong board in front of eight people.

Other entry points:

    --import RAW.json     first load, from the upstream generator's payload
    --as-of YYYY-MM-DD    stamp a new as_of (defaults to keeping the current one)
    --check               recompute and diff, write nothing (exit 1 if it would change)
"""
import argparse
import datetime
import json
import math
import pathlib
import random
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO / "data" / "draft-2026.json"
CANON = REPO / "data" / "nfl-schedule.json"     # settled results, tier 1
LIVE = REPO / "data" / "survivor.json"          # market/model per game, tiers 2 and 3

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


# --------------------------------------------------------------- the basis ----
# WHERE A GAME'S NUMBER COMES FROM, resolved per game, in this order:
#
#   1. settled    the game was played. It is banked, not projected. Grows 0 -> 272.
#   2. market     unplayed, a real price exists. Market primacy does not lapse in
#                 September; nfelo backtests about a tenth of a point a game against
#                 closing lines, which is not enough to override a live price.
#   3. model      everything past the market's horizon, which is most of the season
#                 for most of the year.
#
# Tiers 2 and 3 are already resolved by /data/survivor.json — that file's `src` says
# which one each game is. So the in-season change is not "market to nfelo", it is
# "frozen preseason totals to survivor.json plus a results feed".
#
# ⚠️ THE JOIN KEY IS (week, home, away), NOT the game id. survivor.json writes the
# Rams as `LA` inside its `id` string while its own `h`/`a` fields say `LAR`. Joining
# on the id silently drops all 17 Rams games — they just quietly fall back to the
# preseason number and nothing looks wrong.
#
# ⚠️ PRESEASON IS THE DEFAULT AND IT IS DATA-DRIVEN. If nothing has been played, the
# page uses the frozen 2026-08-09 devigged totals. The moment one game is settled the
# whole payload flips to the composite. No date is hardcoded anywhere.
def load_basis():
    """Return {(week, home, away): {...}} for every canonical game, or {} if the
    feeds are missing. Never raises — a missing feed means preseason, not a crash."""
    out = {}
    try:
        canon = json.loads(CANON.read_text(encoding="utf-8"))
        live = json.loads(LIVE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out
    price = {(g["wk"], g["h"], g["a"]): g for g in live["data"]["games"]}
    for g in canon["data"]["games"]:
        key = (g["week"], g["home_team"], g["away_team"])
        p = price.get(key)
        hs, as_ = g.get("home_score"), g.get("away_score")
        settled = g.get("status") in ("final", "FINAL", "closed") and hs is not None and as_ is not None
        row = {"settled": settled, "tier": None, "p_home": None, "home_win": None}
        if settled:
            row["tier"] = "settled"
            # A tie is half a win to each side, which is also how the league scores it.
            row["home_win"] = 1.0 if hs > as_ else 0.0 if hs < as_ else 0.5
        elif p is not None:
            row["tier"] = "market" if p.get("src") == "market" else "model"
            row["p_home"] = p.get("p")
        out[key] = row
    return out


# ------------------------------------------------------- the schedule refit ----
# The payload arrives with two numbers that do not agree: each team's expected wins,
# and a schedule of per-game probabilities whose sum lands up to 2.67 wins away from it.
# Both are internally fine — every game's two sides sum to 1, and the league total is
# 272 either way — but a simulation has to pick one, and simulating the raw schedule
# would have Miami winning 6.6 games on a page whose ladder says 3.9.
#
# So the schedule is refit TO the expected wins, which are taken as given. For a game
# between i and j the fitted probability is
#
#     p'  =  sigmoid( logit(p) + a_i - a_j )
#
# with one offset per team, solved by Newton so that every team's fitted games sum to
# its expected wins. Complementarity survives by construction (the same expression
# gives 1 - p' from j's side), so the league still pays exactly 272.
#
# ⚠️ THIS DOES NOT RECOMPUTE EXPECTED WINS. It moves the schedule onto them. The devig
# is upstream work and stays untouched; this is the other number bending.
SIG = lambda x: 1.0 / (1.0 + math.exp(-x))


def refit_schedule(teams, max_iter=60, tol=1e-6):
    """Return (games, residual, iterations).

    `games` is the 272-game list as (home_side, away_side, fitted_p) with the fitted
    probability from the FIRST team's point of view. Each game appears once.
    """
    # ⚠️ THE WEEK IS PART OF THE IDENTITY OF A GAME. Division rivals meet twice, so a
    # (team, opponent) pair is not unique — keying on it collapses both meetings into
    # one and silently gives the second the first's probability. That bug put four
    # teams 0.3+ wins off their own target while the solver reported convergence.
    games = [(t, g["opp"], g["week"], g["wp"])
             for t, v in sorted(teams.items()) for g in v["schedule"] if t < g["opp"]]
    base = [math.log(p / (1 - p)) for _, _, _, p in games]
    off = {t: 0.0 for t in teams}

    residual, it = float("inf"), 0
    for it in range(1, max_iter + 1):
        exp = {t: 0.0 for t in teams}
        slope = {t: 0.0 for t in teams}
        for k, (x, y, _, _) in enumerate(games):
            q = SIG(base[k] + off[x] - off[y])
            exp[x] += q
            exp[y] += 1 - q
            v = q * (1 - q)                      # d(exp)/d(offset) for both sides
            slope[x] += v
            slope[y] += v
        residual = max(abs(exp[t] - teams[t]["ew"]) for t in teams)
        if residual < tol:
            break
        for t in teams:
            off[t] += (teams[t]["ew"] - exp[t]) / max(slope[t], 1e-9)

    fitted = [(x, y, w, SIG(base[k] + off[x] - off[y]))
              for k, (x, y, w, _) in enumerate(games)]
    return fitted, residual, it


# --------------------------------------------------------------- monte carlo ----
def simulate(fitted, rosters, order, trials, seed, banked=None):
    """Play `trials` whole seasons, game by game, and count where each roster lands.

    Simulating GAMES rather than team win totals is the only version that keeps the
    thing this pool is about. Every game hands its one win to exactly one side, so a
    season always pays 272 and a roster that owns both sides of a game cannot bank
    both — the self-cancellation falls out of the mechanic instead of being modelled
    on top of it. Sampling each team's win distribution independently would break
    both and quietly inflate the spread of a division-stacked roster.

    Known limits, reported alongside the output rather than buried:
      · no tie outcome. The league counts an NFL tie as half a win; this draws a
        winner every game, so a season here has no halves in it.
      · a tie for FIRST is broken at random. The real rules break it on playoff wins
        and then point differential, neither of which is in this payload — so the
        honest thing is to report how often it happens, which is often.
      · games are independent given the fitted probabilities. No injuries, no
        in-season correlation, no team having a different season than its price.
    """
    rnd = random.Random(seed)
    owner = {t: name for name, r in rosters.items() for t in r}
    names = list(order)
    idx = {n: i for i, n in enumerate(names)}
    # Wins already on the board. Preseason this is all zeros and the loop below is the
    # whole season; in-season it is the floor every simulated season starts from.
    base = [float((banked or {}).get(n, 0.0)) for n in names]
    # Flatten to (owner_index_or_-1, owner_index_or_-1, p) so the hot loop is arithmetic.
    flat = [(idx.get(owner.get(x), -1), idx.get(owner.get(y), -1), p) for x, y, _w, p in fitted]

    n = len(names)
    first = [0] * n
    second = [0] * n
    top2 = [0] * n
    total = [0] * n
    hist = [{} for _ in range(n)]
    tied_first = 0
    random_ = rnd.random

    for _ in range(trials):
        s = list(base)
        for oa, ob, p in flat:
            w = oa if random_() < p else ob
            if w >= 0:
                s[w] += 1
        order_ = sorted(range(n), key=lambda i: (-s[i], random_()))
        best = s[order_[0]]
        if sum(1 for v in s if v == best) > 1:
            tied_first += 1
        first[order_[0]] += 1
        second[order_[1]] += 1
        top2[order_[0]] += 1
        top2[order_[1]] += 1
        for i in range(n):
            total[i] += s[i]
            # A tied game banks half a win, so a season total can land on .5. Bucket on
            # the exact value rather than rounding it away — the tracker prints halves.
            hist[i][s[i]] = hist[i].get(s[i], 0) + 1

    out = {}
    for i, name in enumerate(names):
        counts = hist[i]
        mean = total[i] / trials
        var = sum(c * (w - mean) ** 2 for w, c in counts.items()) / trials
        ordered = sorted(counts)          # numeric sort; keys may carry a .5 from a tie
        cum, q = 0, {}
        for w in ordered:
            cum += counts[w]
            for tag, target in (("p10", 0.10), ("p50", 0.50), ("p90", 0.90)):
                if tag not in q and cum >= trials * target:
                    q[tag] = w
        out[name] = {
            "p_first": round(first[i] / trials, 5),
            "p_second": round(second[i] / trials, 5),
            "p_top2": round(top2[i] / trials, 5),
            "mean": round(mean, 3),
            "sd": round(var ** 0.5, 3),
            "p10": q.get("p10"), "p50": q.get("p50"), "p90": q.get("p90"),
            # The full mass, so the page can draw the curve without re-simulating.
            "dist": {(str(int(w)) if float(w).is_integer() else str(w)): round(counts[w] / trials, 6)
                     for w in ordered},
        }
    return {
        "trials": trials,
        "seed": seed,
        "method": "game-level Bernoulli over the refitted schedule; one win per game, "
                  "so every simulated season pays exactly 272",
        "tie_for_first_rate": round(tied_first / trials, 5),
        "no_tie_outcome": True,
        "first_place_ties_broken": "at random — the league's real tiebreakers (playoff "
                                   "wins, then point differential) are not in this payload",
        "drafters": out,
    }


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


def derive(d, sd_source, trials, seed):
    """Everything that follows from picks. No I/O, no upstream number rewritten.

    Also refits the schedule onto the expected wins and runs the Monte Carlo, and
    writes the fitted per-game probability back onto each schedule row as `wpf` so the
    page can replay seasons in the browser off the same numbers this ran on.
    """
    teams, overlap, order = d["teams"], d["overlap"], d["draft_order"]
    picks = sorted(d["picks"], key=lambda p: p["pick"])

    rosters = {name: [] for name in order}
    for p in picks:
        rosters[p["drafter"]].append(p["team"])

    fitted, fit_residual, fit_iters = refit_schedule(teams)
    by_game = {}
    for x, y, w, p in fitted:
        by_game[(x, y, w)] = p
        by_game[(y, x, w)] = 1 - p
    for t, v in teams.items():
        for g in v["schedule"]:
            g["wpf"] = round(by_game[(t, g["opp"], g["week"])], 5)

    # ---- resolve where each game's number comes from, right now ------------------
    basis = load_basis()
    settled_total = sum(1 for r in basis.values() if r["settled"]) // 1
    settled_games = len({k for k, r in basis.items() if r["settled"]})
    in_season = settled_games > 0
    tier_counts = {"settled": 0, "market": 0, "model": 0, "preseason": 0}

    for t, v in teams.items():
        banked = remaining = 0.0
        for g in v["schedule"]:
            home, away = (t, g["opp"]) if g["home"] else (g["opp"], t)
            row = basis.get((g["week"], home, away))
            if in_season and row and row["settled"]:
                share = row["home_win"] if g["home"] else 1 - row["home_win"]
                g["tier"], g["settled"], g["live"] = "settled", True, round(share, 4)
                banked += share
            elif in_season and row and row["p_home"] is not None:
                share = row["p_home"] if g["home"] else 1 - row["p_home"]
                g["tier"], g["settled"], g["live"] = row["tier"], False, round(share, 5)
                remaining += share
            else:
                # Preseason, or a game the live feeds do not carry: the frozen
                # 2026-08-09 devigged number, refit onto this team's expected wins.
                g["tier"], g["settled"], g["live"] = "preseason", False, g["wpf"]
                remaining += g["wpf"]
            tier_counts[g["tier"]] += 1
        # ⚠️ `ew` IS NEVER TOUCHED. It is what the market said on 2026-08-09 and it is
        # what the draft was made against; the board's reach/value column is a claim
        # about that day. `projected` is the live number and lives beside it.
        v["banked"] = round(banked, 3)
        v["remaining"] = round(remaining, 3)
        v["projected"] = round(banked + remaining, 3)

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
            # Preseason these are 0 / ew / ew. In-season the first grows and the second
            # shrinks, and their sum is what the tracker draws.
            "banked": round(sum(teams[t]["banked"] for t in roster), 3),
            "remaining": round(sum(teams[t]["remaining"] for t in roster), 3),
            "projected": round(sum(teams[t]["projected"] for t in roster), 3),
            "par_delta": round(ew - d["par"], 2),
            "internal_games": internal_games(roster, overlap),
            "sd_sim": sd_source.get(name),
            "sd_model": model_sd(roster, teams) if roster else None,
            "picks_remaining": ROUNDS - len(roster),
        }

    drafted = {p["team"] for p in picks}
    undrafted = sorted((t for t in teams if t not in drafted), key=lambda t: -teams[t]["ew"])

    # The 272 games as the simulation sees them: one entry per unplayed game at its live
    # probability, and a constant per drafter for everything already decided.
    sim_games, seen = [], set()
    for t, v in teams.items():
        for g in v["schedule"]:
            key = tuple(sorted((t, g["opp"]))) + (g["week"],)
            if key in seen or g["settled"]:
                continue
            seen.add(key)
            sim_games.append((t, g["opp"], g["week"], g["live"]))
    owner_of = {tm: name for name, r in rosters.items() for tm in r}
    banked_by_owner = {name: 0.0 for name in order}
    for t, v in teams.items():
        if owner_of.get(t):
            banked_by_owner[owner_of[t]] += v["banked"]

    return {
        "drafters": drafters,
        "undrafted": undrafted,
        "board": build_board(picks, teams, order),
        "picks_made": len(picks),
        "picks_total": len(order) * ROUNDS,
        "basis": {
            "mode": "in-season" if in_season else "preseason",
            "settled_games": settled_games,
            "total_games": TOTAL_WINS,
            "tiers": tier_counts,
            "resolution": [
                "settled — the game was played; banked, not projected",
                "market — unplayed with a real price; market primacy does not lapse in-season",
                "model — beyond the market's horizon",
                "preseason — the frozen 2026-08-09 devigged total, refit onto expected wins",
            ],
            "feeds": {"results": "/data/nfl-schedule.json", "prices": "/data/survivor.json"},
            "switch": "data-driven: one settled game anywhere flips the payload to the "
                      "composite. No date is hardcoded.",
            "field": "live",
        },
        "schedule_fit": {
            "method": "per-team logit offsets solved by Newton so each team's 17 fitted "
                      "game probabilities sum to its expected wins; complementarity and "
                      "the 272-win league total hold by construction",
            "residual": round(fit_residual, 8),
            "iterations": fit_iters,
            "field": "wpf",
        },
        # ⚠️ The simulation plays the UNPLAYED games and adds what is already banked.
        # Re-simulating a settled game would throw away a known result and quietly widen
        # everybody's range for the rest of the season.
        "simulation": simulate(sim_games, rosters, order, trials, seed, banked_by_owner),
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
    # ⚠️ EVALUATED, NOT ASSERTED. This read "known drift" for the first payload, whose
    # `wp` was the pre-refit model output and missed expected wins by up to 2.67 wins.
    # The upstream generator fixed it. The check stays as the regression guard — if a
    # future payload reintroduces the split, this is what catches it — but it reports
    # what it measures rather than a conclusion baked in when the bug was live.
    add("schedule_vs_ew", "The supplied game probabilities re-add to expected wins",
        abs(worst[1]) < 0.05,
        f"Summing a team's 17 supplied probabilities lands at most {abs(worst[1]):.4f} wins "
        f"from its expected-wins figure (worst: {worst[0]}). That is four-decimal rounding "
        f"across 17 games, not a disagreement — the ladder and the schedule strip are one "
        f"number."
        if abs(worst[1]) < 0.05 else
        f"Summing a team's 17 supplied probabilities lands up to {abs(worst[1]):.2f} wins away "
        f"from its expected-wins figure ({worst[0]}: "
        f"{sum(g['wp'] for g in teams[worst[0]]['schedule']):.2f} against "
        f"{teams[worst[0]]['ew']:.2f}). The league total is right and the split between teams "
        f"is not, so the refit below is doing real work and the two numbers are not "
        f"interchangeable.",
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

    # --- the refit that makes the simulation possible -----------------------------
    fit = derived["schedule_fit"]
    fitted_sums = {k: round(sum(g["wpf"] for g in t["schedule"]), 4) for k, t in teams.items()}
    fit_worst = max(abs(fitted_sums[k] - teams[k]["ew"]) for k in teams)
    add("schedule_fit", "The refitted schedule does re-add to expected wins",
        fit_worst < 0.01,
        f"Solved in {fit['iterations']} Newton steps; the worst team is now "
        f"{fit_worst:.4f} wins from its expected-wins figure, against {max(abs(sum(g['wp'] for g in t['schedule']) - t['ew']) for t in teams.values()):.2f} "
        f"before the refit. The residual cannot reach zero: the 32 expected-win values "
        f"sum to {ew_sum:.2f} rather than {TOTAL_WINS}, and a schedule of whole games "
        f"always pays exactly {TOTAL_WINS}, so that one hundredth has to live somewhere. "
        f"`wp` is untouched — `wpf` sits beside it and the simulation uses only `wpf`.",
        round(fit_worst, 6), "hard")

    sim = derived["simulation"]
    # ⚠️ Compare against PROJECTED, not `ew`. In-season `ew` is deliberately frozen at
    # the draft-day devig while the simulation plays the live board, so measuring the
    # sim against `ew` would fail this check every week for a correct payload. Preseason
    # the two are the same number, which is why the bug hid until results appeared.
    live_total = "projected" if derived["basis"]["mode"] == "in-season" else "ew"
    sim_worst = max(abs(sim["drafters"][n]["mean"] - derived["drafters"][n][live_total])
                    for n in d["draft_order"])
    add("sim_vs_ladder", f"Simulated roster totals land on each roster's {live_total} total",
        sim_worst < 0.15,
        f"Across {sim['trials']:,} simulated seasons the worst roster mean sits "
        f"{sim_worst:.3f} wins from its {live_total} total. That agreement is the refit and "
        f"the banked floor working together — simulating the raw preseason schedule instead "
        f"would have put a roster up to 2.7 wins away from the number printed on its own "
        f"card, and re-simulating settled games would widen every range for the rest of "
        f"the season.",
        round(sim_worst, 4), "hard")

    tie = sim["tie_for_first_rate"]
    add("tie_rate", "A tie for first is common, and this payload cannot break one",
        True,
        f"{tie * 100:.1f}% of simulated seasons end with two or more rosters level at the "
        f"top — roughly one in {round(1 / tie) if tie else 0}. The league breaks that on total "
        f"playoff wins and then point differential; neither is in this payload, so the "
        f"simulation breaks it at random and the page reports the rate instead of "
        f"pretending to a winner. The simulation also has no tie OUTCOME: every game is "
        f"decided, so no half-wins are produced.",
        tie, "info")

    incomplete = [n for n in d["draft_order"] if derived["drafters"][n]["picks_remaining"]]
    add("sim_rosters_complete", "The simulation is running on complete rosters",
        not incomplete,
        "Every roster has all four teams, so the finishing probabilities are about the "
        "league as drafted."
        if not incomplete else
        f"{len(incomplete)} of {len(d['draft_order'])} rosters are still short "
        f"({', '.join(incomplete)}), and {len(derived['undrafted'])} teams worth "
        f"{sum(teams[t]['ew'] for t in derived['undrafted']):.2f} expected wins are "
        f"unowned. Finishing probabilities on partial rosters are not a forecast of this "
        f"pool — a drafter holding two teams cannot win a four-team competition. They "
        f"describe the board as it stands right now and will move, hard, when the "
        f"remaining picks land.",
        len(incomplete), "known")

    # --- the live conservation check ----------------------------------------------
    # THE STRONGEST TEST THAT THE COMPOSITE IS WIRED RIGHT. Banked plus projected must
    # equal 272 at every point in the season. If the three tiers are being blended
    # wrongly — a game counted twice, a settled game also projected, the Rams silently
    # falling back to preseason — this is where it shows up first.
    b = derived["basis"]
    banked = sum(t["banked"] for t in teams.values())
    remaining = sum(t["remaining"] for t in teams.values())
    add("live_conservation", "Banked plus projected still totals the season",
        abs(banked + remaining - TOTAL_WINS) < 0.05,
        f"{banked:.2f} banked + {remaining:.2f} projected = {banked + remaining:.2f} "
        f"against {TOTAL_WINS}. {b['settled_games']} of {TOTAL_WINS} games are played. "
        f"Per-game basis: " + ", ".join(f"{k} {v}" for k, v in b["tiers"].items() if v) + ".",
        round(banked + remaining, 3), "hard")

    add("basis_mode", f"The payload is in {b['mode']} mode",
        True,
        ("Nothing has been played, so every game carries the frozen 2026-08-09 devigged "
         "total refit onto expected wins. The moment one game is settled this flips to "
         "the composite by itself — no date is hardcoded."
         if b["mode"] == "preseason" else
         f"{b['settled_games']} games are settled and banked. Unplayed games take a real "
         f"price where one exists ({b['tiers']['market']} of them) and the model beyond "
         f"that ({b['tiers']['model']}). Expected wins on the ladder stay frozen at the "
         f"draft-day devig — the board's reach and value are claims about that day and "
         f"recomputing them against live ratings would make them retroactively wrong."),
        b["settled_games"], "info")

    if b["tiers"].get("preseason") and b["mode"] == "in-season":
        add("basis_gaps", "Some games fell back to the preseason number",
            False,
            f"{b['tiers']['preseason']} games are in-season but matched neither the "
            f"results feed nor the price feed, so they are still carrying the frozen "
            f"preseason figure. That is the failure mode the (week, home, away) join "
            f"exists to prevent; check the feeds rather than trusting these games.",
            b["tiers"]["preseason"], "hard")

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
def tracker(d, derived):
    """Per drafter: banked wins by DRAFT ROUND, the total, and the projected finish."""
    teams = d["teams"]
    by_round = {}
    for b in derived["board"]:
        if b.get("team"):
            by_round.setdefault(b["drafter"], {})[b["round"]] = b["team"]
    out = {}
    for name in d["draft_order"]:
        slots = by_round.get(name, {})
        rounds, teams_by_round = [], []
        for r in range(1, ROUNDS + 1):
            t = slots.get(r)
            rounds.append(round(teams[t]["banked"], 1) if t else None)
            teams_by_round.append(t)
        v = derived["drafters"][name]
        out[name] = {
            "rounds": rounds,
            "teams": teams_by_round,
            "total": round(sum(x for x in rounds if x), 1),
            "projected": v["projected"],
            "remaining": v["remaining"],
        }
    return out


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
            "schedule[].wp": "The payload's original per-game probability. Coherent game by game; does not re-add to `ew`.",
            "schedule[].wpf": "The same game after the schedule was refit onto `ew`. This is what the simulation uses.",
            "simulation": "Monte Carlo over `live`, game by game, on top of whatever is banked. Finishing probabilities, not a forecast; nothing graded.",
            "schedule[].live": "What this game is worth right now: a settled result, a market price, a model price, or the frozen preseason number. `tier` says which.",
            "schedule[].tier": "settled | market | model | preseason. Every game carries its own provenance.",
            "teams[].banked": "Wins actually recorded. A tie counts half.",
            "teams[].remaining": "Sum of the live probabilities for games not yet played.",
            "teams[].projected": "banked + remaining. The in-season number. `ew` stays frozen at the draft-day devig beside it.",
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
            # DERIVED, not typed. Round N is the team taken in round N, so each cell is
            # that team's banked wins and the row sums to the roster's. Preseason every
            # cell is zero because zero is the true number; the shape does not change in
            # week 1, it just starts filling in. `projected` rides alongside so the
            # tracker can draw the remaining season as a ghost without a second lookup.
            "wins_tracker": tracker(d, derived),
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
    ap.add_argument("--trials", type=int, default=100_000, metavar="N",
                    help="Monte Carlo seasons for the stored reference (default 100000)")
    ap.add_argument("--seed", type=int, default=20260812, metavar="N",
                    help="Monte Carlo seed. Fixed by default so the payload is reproducible.")
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
    derived = derive(d, sd_source, args.trials, args.seed)
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

    sim = derived["simulation"]["drafters"]
    print(f"\n  {derived['simulation']['trials']:,} simulated seasons "
          f"(seed {derived['simulation']['seed']}) · "
          f"{derived['simulation']['tie_for_first_rate'] * 100:.1f}% end tied for first")
    for name in sorted(d["draft_order"], key=lambda n: -sim[n]["p_first"]):
        v = sim[name]
        print(f"  {name:<7} wins {v['mean']:6.2f}  1st {v['p_first'] * 100:5.1f}%  "
              f"2nd {v['p_second'] * 100:5.1f}%  paid {v['p_top2'] * 100:5.1f}%")

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
