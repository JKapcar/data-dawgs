#!/usr/bin/env python3
"""DataDawg$ — one builder, every league in the War Room.   2026-09-02

⚠️ EVERY OUTPUT OF THIS SCRIPT IS PRIVATE. publication.public = false on all of them.
DataDawg$ is Kap's private, league-specific valuation, served by the Worker to members
of the league it prices. It never goes in /data/ and never in git. PMV is the public
fallback and is a different artefact entirely.

METHOD - the pepperoninipples contract (data/datadawg-dollars-method.md), generalised:

  prior            ETR column matching the room's format (superflex? x reception pts)
  baseline_premium max(prior - 1, 0)          ETR's own $1 floor is not "value"
  depth            VOR(room shape, ETR scoring) - VOR(ETR's implied shape, ETR scoring)
  scoring          VOR(room shape, room scoring) - VOR(room shape, ETR scoring)
  weight           max(0, baseline_premium + beta * (d_pass*depth + s_pass*scoring))
  beta             $/VOR-point implied by ETR itself: sum(premium)/sum(positive VOR)
  price            floor + (budget - floor*slots) * weight / sum(weight), over exactly the
                   room's PAID slots, Hamilton-rounded to an exact integer total
  bands            low/high = min/max over the documented pass-through scenarios
                   budget_only 0/0 . cautious .25/.25 . central .5/.5 . full 1/1
                   These are CONVERSION-ASSUMPTION bounds. Not bid ceilings, not outcomes.

VOR uses Sleeper's public season projections scored with each room's exact settings
(Sleeper rooms) or a hand-mapped table (ESPN/Yahoo). Replacement level is the War Room's
own algorithm: fill dedicated starters, then flex, best unselected player at each position.
K and DST are priced from ETR as-is (no VOR) and only where the room has a slot for them.

THINGS THIS DOES NOT DO, ON PURPOSE:
  * Dynasty horizon. ETR is a REDRAFT value. Three of these rooms are dynasty leagues and
    get a SEASON-horizon DataDawg$ only. Their dynasty-horizon value stays on the public
    dynasty PMV board until Kap supplies a dynasty source. Labelling this wrong would be
    the single most misleading thing the War Room could do.
  * Keeper inflation (PFL has keepers). A fact about prices, not value - see PFL notes.
  * Snake-draft "prices". Rooms without an auction get a NOMINAL $200/team budget so
    dollars are comparable across teams; the board says "nominal".
"""
import csv, json, hashlib, collections, datetime, re, unicodedata, os

TODAY = datetime.date.today().isoformat()
SRC = "etr.csv"
SHA = hashlib.sha256(open(SRC, "rb").read()).hexdigest()
ETR = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))
# ⚠️ Derived at runtime, never committed: which players ETR prices above zero is
# itself ETR's product. proj-rows.txt is keyed to THIS order, so it is rebuilt with it.
_PCOLS = ["ETR Full PPR", "ETR Half PPR", "ETR Std", "ETR Superflex Full", "ETR Superflex Half"]
NAMES = [x["Player"] for x in ETR
         if x["Position"] in ("QB", "RB", "WR", "TE") and any(int(x[c]) > 0 for c in _PCOLS)]
SCHEMES = ["std", "half", "ppr", "kayfabe", "bingbong", "guil", "jomo", "ppn"]
ROWS = [list(map(int, r.split(","))) for line in open("proj-rows.txt") for r in line.strip().split(";") if r]
assert len(ROWS) == len(NAMES)
PROJ = {n: dict(zip(SCHEMES, row)) for n, row in zip(NAMES, ROWS)}          # name -> {scheme: pts}
REPL = {}
for line in open("repl.txt"):
    room, sch, *v = line.split()
    REPL[(room, sch)] = dict(zip(["QB", "RB", "WR", "TE"], map(float, v)))

def mvkey(s):
    s = unicodedata.normalize("NFD", s); s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s); s = re.sub(r"[^a-z ]", "", s)
    return re.sub(r"\s+", " ", s).strip()

COL = {(False, 1): "ETR Full PPR", (False, 0.5): "ETR Half PPR", (False, 0): "ETR Std",
       (True, 1): "ETR Superflex Full", (True, 0.5): "ETR Superflex Half"}
BASE = {1: "ppr", 0.5: "half", 0: "std"}

# ------------------------------------------------------------------ the rooms --
LEAGUES = {
  "pfl": dict(name="PFL: Parma Football League", provider="espn", league_id="110404",
      teams=12, rec=0.5, superflex=True, k=False, dst=True, paid_slots_per_team=17,
      budget_per_team=200, budget_kind="auction", floor=1, reserve=0.0,
      room_key="pfl", custom_scheme="half", dynasty=False,
      scoring_note="textbook half-PPR (read from ESPN): matches ETR's baseline, scoring delta is zero",
      notes=["2 keepers/team; keeper inflation deliberately not modelled (a fact about prices, not value)"]),
  "ppn": dict(name="JohnMaddenPepperoniNipplesXV", provider="yahoo", league_id="773763",
      teams=14, rec=0.5, superflex=False, k=False, dst=True, paid_slots_per_team=15,
      budget_per_team=200, budget_kind="auction", floor=0, reserve=0.75,
      room_key="ppn", custom_scheme="ppn", dynasty=False,
      scoring_note="heavy custom scoring per the published method contract (completions, INC, sacks, first downs, 40+ bonuses)",
      notes=["NO keepers (Kap, 2026-09-02) - supersedes the method contract's keeper-inflation caveat and the seed file's keepers:true",
             "Yahoo allows $0 bids: floor is $0 with the documented $0.75/slot behavioural reserve"]),
  "kayfabe": dict(name="The Kayfabe Dynasty", provider="sleeper", league_id="1315018026927554560",
      teams=12, rec=1, superflex=True, k=False, dst=False, paid_slots_per_team=25,
      budget_per_team=200, budget_kind="nominal", floor=1, reserve=0.0,
      room_key="kayfabe", custom_scheme="kayfabe", dynasty=True,
      scoring_note="full PPR + TE premium (+0.5/rec) via Sleeper scoring_settings; 4 FLEX + SUPER_FLEX",
      notes=["DYNASTY: this is the SEASON horizon only. Dynasty-horizon value is not derivable from a redraft prior."]),
  "bingbong": dict(name="Hey Bing Bong", provider="sleeper", league_id="1312265977353732096",
      teams=12, rec=0.5, superflex=True, k=False, dst=False, paid_slots_per_team=22,
      budget_per_team=200, budget_kind="nominal", floor=1, reserve=0.0,
      room_key="bingbong", custom_scheme="bingbong", dynasty=True,
      scoring_note="half PPR + TE premium (+0.5/rec); 3 WR, 2 FLEX + SUPER_FLEX",
      notes=["DYNASTY: SEASON horizon only."]),
  "guil": dict(name="Case's Guillotine League", provider="sleeper", league_id="1389344040964599808",
      teams=18, rec=0.5, superflex=False, k=False, dst=False, paid_slots_per_team=12,
      budget_per_team=200, budget_kind="nominal", floor=1, reserve=0.0,
      room_key="guil", custom_scheme="guil", dynasty=False,
      scoring_note="vanilla half PPR (verified: replacement level identical under room and baseline scoring)",
      notes=["18 teams, snake draft, guillotine format: the only conversion doing work here is DEPTH (18 vs 12 teams).",
             "Guillotine value is about survival, not roster $; treat this as a trade/roster comparator only."]),
  "jomo": dict(name="RIP Jomo Rucker", provider="sleeper", league_id="1315017937483997184",
      teams=12, rec=1, superflex=False, k=True, dst=True, paid_slots_per_team=25,
      budget_per_team=200, budget_kind="nominal", floor=1, reserve=0.0,
      room_key="jomo", custom_scheme="jomo", dynasty=True,
      scoring_note="full PPR, 6-pt passing TDs, K and DEF slots, 3 WR + 3 FLEX",
      notes=["DYNASTY: SEASON horizon only.", "6-pt pass TD lifts every QB; that is the scoring delta doing the work."]),
}
SCENARIOS = {"budget_only": (0, 0), "cautious": (.25, .25), "central": (.5, .5), "full": (1, 1)}

def build(L):
    col = COL[(L["superflex"], L["rec"])]
    base = BASE[L["rec"]]
    etr_room = "etr12sf" if L["superflex"] else "etr12"
    rows = [r for r in ETR if (r["Position"] != "K" or L["k"]) and (r["Position"] != "DST" or L["dst"])]
    prior = {r["id"]: float(r[col]) for r in rows}

    # VOR terms per skill player (K/DST carry none)
    def vor(name, pos, room, sch):
        p = PROJ.get(name)
        return None if p is None or pos not in ("QB", "RB", "WR", "TE") else p[sch] - REPL[(room, sch)][pos]
    depth, scoring, no_proj = {}, {}, 0
    for r in rows:
        pid, pos, name = r["id"], r["Position"], r["Player"]
        if pos in ("K", "DST"): continue
        v_etr = vor(name, pos, etr_room, base)
        v_room_base = vor(name, pos, L["room_key"], base)
        v_room_cust = vor(name, pos, L["room_key"], L["custom_scheme"])
        if v_etr is None:
            if prior[pid] > 0: no_proj += 1
            continue
        depth[pid] = v_room_base - v_etr
        scoring[pid] = v_room_cust - v_room_base

    premium = {k: max(v - 1, 0) for k, v in prior.items()}
    # beta: dollars per VOR point implied by ETR's own priced players
    pos_vor = [(premium[r["id"]], vor(r["Player"], r["Position"], etr_room, base)) for r in rows
               if premium[r["id"]] > 0 and r["Position"] in ("QB","RB","WR","TE")]
    pos_vor = [(p, v) for p, v in pos_vor if v is not None and v > 0]
    beta = sum(p for p, _ in pos_vor) / sum(v for _, v in pos_vor)

    slots = L["teams"] * L["paid_slots_per_team"]
    budget = L["teams"] * L["budget_per_team"]
    def price(dp, sp):
        w = {}
        for r in rows:
            pid = r["id"]
            adj = beta * (dp * depth.get(pid, 0.0) + sp * scoring.get(pid, 0.0))
            w[pid] = max(0.0, premium[pid] + adj)
        order = sorted(rows, key=lambda r: (-w[r["id"]], -prior[r["id"]], r["Player"]))
        paid = order[:slots]
        pool = budget - (L["floor"] + L["reserve"]) * slots
        ws = sum(w[r["id"]] for r in paid) or 1.0
        exact = {r["id"]: L["floor"] + L["reserve"] + pool * w[r["id"]] / ws for r in paid}
        fl = {k: int(v) for k, v in exact.items()}
        short = budget - sum(fl.values())
        for k in sorted(exact, key=lambda k: (-(exact[k] - fl[k]), -w[k], k))[:short]: fl[k] += 1
        return fl, exact

    central, exact = price(*SCENARIOS["central"])
    scen = {n: price(*ps)[0] for n, ps in SCENARIOS.items()}
    out = []
    for r in rows:
        pid = r["id"]
        t = central.get(pid, 0)
        lo = min(s.get(pid, 0) for s in scen.values()); hi = max(s.get(pid, 0) for s in scen.values())
        out.append({"id": pid, "player": r["Player"], "pos": r["Position"], "team": r["Team"],
                    "target": t, "low": lo, "high": hi,
                    "exact": round(exact.get(pid, 0.0), 4)})
    out.sort(key=lambda x: (-x["target"], -x["exact"], x["player"]))
    for i, x in enumerate(out, 1): x["rank"] = i

    priced = [x for x in out if x["target"] > 0]
    ident = sum(1 for x in priced if x["target"] == int(prior[x["id"]]))
    within1 = sum(1 for x in priced if abs(x["target"] - prior[x["id"]]) <= 1)
    v = {"source_rows": len(ETR), "rows": len(out), "priced_players": len(priced),
         "paid_slots": slots, "target_sum": sum(x["target"] for x in out), "budget": budget,
         "identical_to_prior": ident, "within_1_of_prior": within1,
         "share_identical": round(ident / len(priced), 3),
         "no_projection_but_priced": no_proj, "beta_dollars_per_vor_point": round(beta, 4),
         "priced_by_pos": dict(collections.Counter(x["pos"] for x in priced)),
         "negative_prices": sum(1 for x in out if x["target"] < 0),
         "kickers": sum(1 for x in out if x["pos"] == "K"),
         "duplicate_ids": [k for k, c in collections.Counter(x["id"] for x in out).items() if c > 1]}
    assert v["target_sum"] == budget and v["priced_players"] == slots, (L["name"], v)
    assert v["negative_prices"] == 0 and not v["duplicate_ids"]
    assert (v["kickers"] == 0) == (not L["k"])
    assert all("etr" not in k.lower() for x in out for k in x), "no raw ETR column may be carried"

    return {
      "as_of": TODAY, "built": TODAY, "tier": "labs", "graded": False,
      "source": (f"Establish The Run auction values ({col}; private subscriber snapshot, identified only by "
                 f"SHA-256 {SHA[:16]}), converted to {L['name']} ({L['provider']} {L['league_id']}; "
                 f"{L['teams']} teams, {L['paid_slots_per_team']}-man paid rosters, "
                 f"{'superflex, ' if L['superflex'] else ''}rec {L['rec']}) by the VOR-based conversion in "
                 f"data/datadawg-dollars-method.md, generalised. Not outcome-validated."),
      "note": ("PRIVATE. DataDawg$ is a league-specific valuation served to that league's members; it is never "
               "published to /data/. low/high are conversion-assumption bounds, not bid ceilings and not player "
               "outcome intervals." + (" SEASON HORIZON ONLY - this is a dynasty league and ETR is a redraft "
               "prior; dynasty-horizon value is NOT in this file." if L["dynasty"] else "")),
      "publication": {"public": False, "surface": f"worker:/{L['provider']}/warroom (values inlined per league)",
                      "public_aggregates_allowed": ["team totals", "ranks", "surplus vs price paid"],
                      "public_per_player_dollars_allowed": False},
      "data": {
        "schema_version": "1.1.0",
        "model_id": f"datadawgs-datadawg-dollars-{L['provider']}-{L['league_id']}-2026-v1",
        "as_of": TODAY, "league": L["name"], "provider": L["provider"], "league_id": L["league_id"],
        "horizon": "season", "dynasty_league": L["dynasty"],
        "tier": "labs", "graded": False,
        "epistemic_status": "reproducible VOR conversion of a dated third-party prior; not outcome-validated",
        "source_snapshot_sha256": SHA, "prior_column": col,
        "room": {"teams": L["teams"], "budget_per_team": L["budget_per_team"], "budget_kind": L["budget_kind"],
                 "total_budget": budget, "paid_slots_per_team": L["paid_slots_per_team"], "paid_slots": slots,
                 "floor": L["floor"], "behavioural_reserve": L["reserve"], "superflex": L["superflex"],
                 "reception": L["rec"], "kicker": L["k"], "dst": L["dst"]},
        "method": {"baseline_premium": "max(prior - 1, 0)",
                   "depth": f"VOR({L['room_key']}, {base}) - VOR({etr_room}, {base})",
                   "scoring": f"VOR({L['room_key']}, {L['custom_scheme']}) - VOR({L['room_key']}, {base})",
                   "central_weight": "max(0, premium + beta*(0.5*depth + 0.5*scoring))",
                   "beta": v["beta_dollars_per_vor_point"],
                   "projections": "Sleeper public season projections, scored with the room's settings",
                   "replacement": "War Room algorithm: dedicated starters, then flex, best unselected",
                   "scenarios": SCENARIOS, "scoring_note": L["scoring_note"]},
        "notes": L["notes"],
        "interpretation": ("A VALUATION board. Pick grade = price paid - target where an auction price exists. "
                           "Nominal-budget rooms have no prices; use it for roster and trade comparison only."),
        "validation": v, "players": out}}

os.makedirs("boards", exist_ok=True)
print(f"{'league':<30}{'col':<20}{'slots':>6}{'budget':>8}{'beta':>7}{'=ETR':>7}{'±$1':>6}{'noProj':>7}")
for key, L in LEAGUES.items():
    env = build(L); v = env["data"]["validation"]
    json.dump(env, open(f"boards/datadawg-dollars-{key}.json", "w"), indent=1)
    print(f"{L['name'][:29]:<30}{env['data']['prior_column'][4:]:<20}{v['paid_slots']:>6}{v['budget']:>8}"
          f"{v['beta_dollars_per_vor_point']:>7}{v['share_identical']:>7.0%}"
          f"{v['within_1_of_prior']/v['priced_players']:>6.0%}{v['no_projection_but_priced']:>7}")


# =============================== DYNASTY =====================================
"""Dynasty boards.  ⚠️ A DIFFERENT METHOD, ON PURPOSE.

The season boards above convert ETR with a VOR term computed from Sleeper's 2026
season projections. That machinery MUST NOT be reused here. Dynasty value is
multi-year and age-weighted; a season-projection VOR delta would drag every price
toward this-year production, which is precisely what a dynasty board is not.
Applying it would look more sophisticated and be more wrong.

So the dynasty conversion is deliberately thin, and only does what the data supports:

  1. COLUMN SELECTION, which does most of the work and is exact.
     ETR ships "1QB Auction" and "2QB Auction". The 2QB column is labelled
     SF/TE Prem and was verified to carry BOTH effects: top QBs rise by roughly
     3x between the columns, and TEs rise too rather than falling as they would
     under a QB-only superflex adjustment. Kayfabe and Hey Bing Bong are
     superflex WITH a +0.5 TE premium, so that column is a genuine format match,
     not an approximation. Jomo is 1QB with no TE premium -> the 1QB column.
     (Deliberately no player prices quoted here: this file is committed to a
     PUBLIC repo and the prior is paid third-party content.)
  2. ROSTER DEPTH. Each room rosters more players than ETR prices (Kayfabe 300
     slots vs ~275 priced), so the tail is floored rather than left at $0.
  3. RENORMALISATION to the room's nominal budget.

⚠️ WHAT IS NOT MODELLED, AND MUST BE SAID ON THE PAGE:
  * Hey Bing Bong is HALF PPR. ETR's dynasty export does not state its reception
    assumption; dynasty boards conventionally assume full PPR. If so, pass-catchers
    on that board are somewhat overvalued. There is no dynasty-horizon projection
    here to derive the correction from, so it is FLAGGED, NOT FUDGED.
  * Draft picks are priced by ETR and carried through scaled, but they are not
    roster slots, so they are excluded from the paid-slot normalisation.
"""
DYN_SRC = "etr-dynasty.csv"
DYN_SHA = hashlib.sha256(open(DYN_SRC, "rb").read()).hexdigest()
DYN = list(csv.DictReader(open(DYN_SRC, encoding="utf-8-sig")))

def _usd(x):
    x = (x or "").replace("$", "").strip()
    try: return float(x)
    except ValueError: return None

DYN_LEAGUES = {
  "kayfabe":  dict(col="2QB Auction", ppr_gap=None,
                   note="superflex + TE premium: the SF/TE Prem column is a genuine format match"),
  "bingbong": dict(col="2QB Auction", ppr_gap="half",
                   note="superflex + TE premium matches; the room is HALF PPR and ETR's dynasty reception assumption is unstated"),
  "jomo":     dict(col="1QB Auction", ppr_gap=None,
                   note="1QB, no TE premium: the 1QB column is the match"),
}

def build_dynasty(key, L, cfg):
    col = cfg["col"]
    rows = [r for r in DYN if r["Pos"] != "Pick"]
    picks = [r for r in DYN if r["Pos"] == "Pick"]
    prior = {r["Player"]: (_usd(r[col]) or 0.0) for r in rows}

    slots = L["teams"] * L["paid_slots_per_team"]
    budget = L["teams"] * L["budget_per_team"]
    FLOOR = 1
    order = sorted(rows, key=lambda r: (-prior[r["Player"]], r["Player"]))
    paid = order[:slots]
    premium = {r["Player"]: max(prior[r["Player"]] - FLOOR, 0.0) for r in paid}
    pool = budget - FLOOR * slots
    ws = sum(premium.values()) or 1.0
    exact = {r["Player"]: FLOOR + pool * premium[r["Player"]] / ws for r in paid}
    fl = {k: int(v) for k, v in exact.items()}
    short = budget - sum(fl.values())
    for k in sorted(exact, key=lambda k: (-(exact[k] - fl[k]), -prior[k], k))[:short]: fl[k] += 1
    scale = (budget / sum(prior[r["Player"]] for r in paid)) if paid else 1.0

    out = []
    for r in rows:
        n = r["Player"]
        out.append({"id": "name:" + n, "player": n, "pos": r["Pos"], "team": r["Team"],
                    "target": fl.get(n, 0), "exact": round(exact.get(n, 0.0), 4)})
    # ⚠️ PICKS GO IN THEIR OWN ARRAY, NOT IN `players`. The Worker reads data.picks; a pick
    # parked in players is keyed by ddPlayerKey() as though it were a person - it matches no
    # roster, pollutes the key space, and leaves draft capital invisible, which is exactly
    # what v1 did. They are also never folded into roster value: a team can be mid-table on
    # roster and first on capital, and merging the two hides precisely that.
    pick_rows = []
    for r in picks:
        m = re.match(r"(\d{4})\s+(\d+)(?:st|nd|rd|th)\s+Round", r["Player"] or "")
        if not m: continue
        pick_rows.append({"pick": r["Player"], "season": int(m.group(1)),
                          "round": int(m.group(2)),
                          "target": int(round((_usd(r[col]) or 0) * scale))})
    out.sort(key=lambda x: (-x["target"], -x["exact"], x["player"]))
    for i, x in enumerate(out, 1): x["rank"] = i

    priced = [x for x in out if x["target"] > 0]
    ident = sum(1 for x in priced if x["target"] == int(prior.get(x["player"], -1)))
    v = {"source_rows": len(DYN), "rows": len(out), "priced_players": len(priced),
         "paid_slots": slots, "target_sum": sum(x["target"] for x in out),
         "budget": budget, "picks_priced": len(pick_rows),
         "identical_to_prior": ident, "share_identical": round(ident / max(len(priced), 1), 3),
         "priced_by_pos": dict(collections.Counter(x["pos"] for x in priced)),
         "negative_prices": sum(1 for x in out if x["target"] < 0),
         "duplicate_ids": [k for k, c in collections.Counter(x["id"] for x in out).items() if c > 1]}
    assert v["target_sum"] == budget and v["priced_players"] == slots, (L["name"], v)
    assert v["negative_prices"] == 0 and not v["duplicate_ids"]
    assert all("notes" not in k.lower() and "etr" not in k.lower() for x in out for k in x)

    unmodelled = []
    if cfg["ppr_gap"] == "half":
        unmodelled.append("Room is HALF PPR; ETR's dynasty export does not state its reception "
                          "assumption and dynasty boards conventionally assume full PPR. If so, "
                          "pass-catchers here are somewhat overvalued. FLAGGED, NOT MODELLED - there "
                          "is no dynasty-horizon projection to derive a correction from. Confirm the "
                          "assumption with ETR before treating receiver prices as precise.")
    return {
      "as_of": TODAY, "built": TODAY, "tier": "labs", "graded": False,
      "source": (f"Establish The Run DYNASTY auction values ({col}; private subscriber snapshot, "
                 f"identified only by SHA-256 {DYN_SHA[:16]}), renormalised to {L['name']} "
                 f"({L['provider']} {L['league_id']}; {L['teams']} teams, "
                 f"{L['paid_slots_per_team']}-man rosters). {cfg['note']}."),
      "note": ("PRIVATE. Dynasty horizon. The season-projection VOR conversion used on the redraft "
               "boards is deliberately NOT applied here - dynasty value is multi-year and "
               "age-weighted, and a season VOR term would drag every price toward 2026 production."),
      "publication": {"public": False, "surface": f"worker:/{L['provider']}/warroom",
                      "public_aggregates_allowed": ["team totals", "ranks", "surplus vs price paid"],
                      "public_per_player_dollars_allowed": False},
      "data": {
        "schema_version": "1.1.0",
        "model_id": f"datadawgs-dd-dynasty-{L['provider']}-{L['league_id']}-2026-v1",
        "as_of": TODAY, "league": L["name"], "provider": L["provider"], "league_id": L["league_id"],
        "horizon": "dynasty", "dynasty_league": True, "tier": "labs", "graded": False,
        "epistemic_status": "column-matched renormalisation of a dated third-party dynasty prior; not outcome-validated",
        "source_snapshot_sha256": DYN_SHA, "prior_column": col,
        "room": {"teams": L["teams"], "budget_per_team": L["budget_per_team"], "budget_kind": "nominal",
                 "total_budget": budget, "paid_slots": slots, "floor": FLOOR,
                 "superflex": L["superflex"], "reception": L["rec"], "te_premium": L.get("te_prem", False)},
        "method": {"format_delta": "column selection (1QB vs SF/TE-premium) + roster depth",
                   "normalisation": f"target = 1 + ({budget}-{slots}) * max(prior-1,0) / sum(...) over the {slots} paid slots",
                   "rounding": "Hamilton/largest remainder to an exact integer total",
                   "vor": "NOT APPLIED - see the module docstring",
                   "picks": "carried at ETR value x the board's scale factor; excluded from slot normalisation"},
        "unmodelled": unmodelled,
        "interpretation": ("A dynasty VALUATION board for trade and roster comparison. Nominal budget: "
                           "these rooms have no auction, so dollars are comparable across teams but are "
                           "not prices."),
        "picks": pick_rows,
        "pick_coverage": {
          "seasons": sorted({x["season"] for x in pick_rows}),
          "rounds": sorted({x["round"] for x in pick_rows}),
          "note": ("ETR prices future picks by ROUND, not by slot, and only for the seasons "
                   "and rounds listed here. A pick outside that range - a later season, or a "
                   "round the source does not price - is UNPRICED and must be reported as "
                   "such, never valued at zero: zero reads as 'worthless', not 'not covered'."),
        },
        "validation": v, "players": out}}

for key, cfg in DYN_LEAGUES.items():
    L = dict(LEAGUES[key]); L["te_prem"] = key in ("kayfabe", "bingbong")
    env = build_dynasty(key, L, cfg); v = env["data"]["validation"]
    json.dump(env, open(f"boards/datadawg-dollars-{key}-dynasty.json", "w"), indent=1)
    print(f"{L['name'][:29]:<30}{env['data']['prior_column']:<14}{v['paid_slots']:>6}{v['budget']:>8}"
          f"{v['share_identical']:>8.0%}{v['picks_priced']:>7} picks"
          f"{'  ⚠ ' + str(len(env['data']['unmodelled'])) + ' unmodelled' if env['data']['unmodelled'] else ''}")
