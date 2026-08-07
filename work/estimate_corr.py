"""
Estimate the within-game correlation structure of DraftKings NFL scoring from real
play-by-play-derived weekly stats, so the contest simulator uses measured covariance
instead of invented factor loadings.

Source: nflverse-data `stats_player_week` + `stats_team_week`, regular season 2019-2025.

Method
------
1. DK points per player-week from the raw stat lines (full PPR + the three 100/300-yard
   bonuses, fumbles lost, 2pt conversions). DST from team defensive stats plus points
   allowed off the schedule.
2. Roles assigned per team-season by *usage*, not by outcome: pass catchers ranked by
   season targets, backs by carries+targets. Ranking by fantasy points would let the
   outcome pick the role and inflate every correlation it then measures.
3. Each player-season's weekly scores are converted to z-scores. This is the step that
   matters: correlating raw points across weeks measures how much better one player is
   than another, not how their outcomes move together inside a game. Standardising
   inside player-season removes the level and leaves the co-movement.
4. Pairwise correlations of those z-scores across every game where both roles appear.
5. The pairwise matrix is not guaranteed positive semi-definite, so it gets an
   eigenvalue-clipped nearest-PSD projection before it can be Cholesky-factored.

Emits a JSON blob for inlining into dfs.html, with sample sizes attached to every cell.
"""
import json, math, sys
import numpy as np
import pandas as pd

SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025]
MIN_GAMES = 6          # a player-season needs this many weeks before its sd means anything
MIN_PAIR_N = 400       # a role pair needs this many observations to be reported

ROLES = ["QB", "RB1", "RB2", "RBx", "WR1", "WR2", "WR3", "WRx", "TE1", "TEx", "DST"]


def col(df, *names):
    for n in names:
        if n in df.columns:
            return df[n].fillna(0)
    return pd.Series(0.0, index=df.index)


def dk_points_skill(d):
    py = col(d, "passing_yards")
    ry = col(d, "rushing_yards")
    cy = col(d, "receiving_yards")
    pts = (
        py * 0.04
        + col(d, "passing_tds") * 4
        - col(d, "passing_interceptions", "interceptions") * 1
        + (py >= 300) * 3
        + ry * 0.1
        + col(d, "rushing_tds") * 6
        + (ry >= 100) * 3
        + col(d, "receptions") * 1
        + cy * 0.1
        + col(d, "receiving_tds") * 6
        + (cy >= 100) * 3
        + col(d, "special_teams_tds") * 6
        - (col(d, "sack_fumbles_lost") + col(d, "rushing_fumbles_lost") + col(d, "receiving_fumbles_lost")) * 1
        + (col(d, "passing_2pt_conversions") + col(d, "rushing_2pt_conversions") + col(d, "receiving_2pt_conversions")) * 2
    )
    return pts


def pa_points(pa):
    if pa == 0: return 10
    if pa <= 6: return 7
    if pa <= 13: return 4
    if pa <= 20: return 1
    if pa <= 27: return 0
    if pa <= 34: return -1
    return -4


def load():
    sp, st = [], []
    for y in SEASONS:
        a = pd.read_csv(f"/tmp/sp_{y}.csv", low_memory=False)
        a["season"] = y
        sp.append(a)
        b = pd.read_csv(f"/tmp/st_{y}.csv", low_memory=False)
        b["season"] = y
        st.append(b)
    return pd.concat(sp, ignore_index=True), pd.concat(st, ignore_index=True)


def main():
    sp, st = load()
    for d in (sp, st):
        if "season_type" in d.columns:
            d.drop(d.index[d["season_type"] != "REG"], inplace=True)

    sp = sp.reset_index(drop=True)
    st = st.reset_index(drop=True)

    team_c = "team" if "team" in sp.columns else "recent_team"
    pos_c = "position"
    sp = sp[sp[pos_c].isin(["QB", "RB", "WR", "TE", "FB"])].copy()
    sp.loc[sp[pos_c] == "FB", pos_c] = "RB"
    sp["dk"] = dk_points_skill(sp)

    # ---- roles by season usage, per player-season-team ----
    sp["tg"] = col(sp, "targets")
    sp["ca"] = col(sp, "carries")
    key = ["season", team_c, "player_id"]
    usage = sp.groupby(key, as_index=False).agg(tg=("tg", "sum"), ca=("ca", "sum"),
                                                pos=(pos_c, "first"), g=("week", "nunique"))
    usage["use"] = np.where(usage["pos"] == "RB", usage["ca"] + usage["tg"], usage["tg"])
    usage["rk"] = usage.groupby(["season", team_c, "pos"])["use"].rank(ascending=False, method="first")

    def role_of(pos, rk):
        if pos == "QB": return "QB"
        if pos == "RB": return "RB1" if rk == 1 else ("RB2" if rk == 2 else "RBx")
        if pos == "WR": return {1: "WR1", 2: "WR2", 3: "WR3"}.get(int(rk), "WRx")
        if pos == "TE": return "TE1" if rk == 1 else "TEx"
        return None

    usage["role"] = [role_of(p, r) for p, r in zip(usage["pos"], usage["rk"])]
    sp = sp.merge(usage[key + ["role", "g"]], on=key, how="left")

    # ---- DST ----
    stt = st.copy()
    stt["team"] = stt["team"] if "team" in stt.columns else stt["recent_team"]
    # points scored per team-week, from the team's own offensive line -> opponent's PA
    sched = stt[["season", "week", "game_id", "team", "opponent_team"]].copy()
    # points allowed comes from the schedule file; derive from team stats is unreliable,
    # so use nfldata games.csv
    games = pd.read_csv("/tmp/games.csv", low_memory=False)
    games = games[games["game_type"] == "REG"]
    sc = pd.concat([
        games[["season", "week", "home_team", "away_team", "home_score", "away_score"]]
            .rename(columns={"home_team": "team", "away_team": "opponent_team",
                             "home_score": "pf", "away_score": "pa"}),
        games[["season", "week", "away_team", "home_team", "away_score", "home_score"]]
            .rename(columns={"away_team": "team", "home_team": "opponent_team",
                             "away_score": "pf", "home_score": "pa"}),
    ], ignore_index=True)

    dstats = stt.groupby(["season", "week", "game_id", "team", "opponent_team"], as_index=False).agg(
        sacks=("def_sacks", "sum"),
        ints=("def_interceptions", "sum"),
        fr=("def_fumbles", "sum"),
        dtd=("def_tds", "sum"),
        saf=("def_safeties", "sum"),
        sttd=("special_teams_tds", "sum"),
    )
    # ⚠️ the team file's def_* columns describe what that team's DEFENCE did, so they are
    # already on the right side. Points allowed still has to come from the schedule.
    dstats = dstats.merge(sc[["season", "week", "team", "pa"]], on=["season", "week", "team"], how="left")
    dstats["dk"] = (dstats["sacks"] * 1 + dstats["ints"] * 2 + dstats["fr"] * 2
                    + dstats["dtd"] * 6 + dstats["saf"] * 2 + dstats["sttd"] * 6
                    + dstats["pa"].fillna(21).map(pa_points))
    dstats["role"] = "DST"
    dstats["player_id"] = "DST_" + dstats["team"]
    dstats = dstats.rename(columns={"team": team_c})
    dstats["g"] = dstats.groupby(["season", team_c])["week"].transform("nunique")

    cols = ["season", "week", "game_id", team_c, "opponent_team", "player_id", "role", "dk", "g"]
    allp = pd.concat([sp[cols], dstats[cols]], ignore_index=True)
    allp = allp[allp["role"].notna() & (allp["g"] >= MIN_GAMES)]

    # ---- z-score inside player-season-team ----
    grp = allp.groupby(["season", team_c, "player_id"])["dk"]
    allp["mu"] = grp.transform("mean")
    allp["sd"] = grp.transform("std")
    allp = allp[allp["sd"] > 1e-6]
    allp["z"] = (allp["dk"] - allp["mu"]) / allp["sd"]
    # a role can have several players in one team-week (WRx); average their z
    allp = allp.groupby(["season", "week", "game_id", team_c, "opponent_team", "role"],
                        as_index=False).agg(z=("z", "mean"))

    # ---- pairwise correlations, same team and opposing team ----
    R = len(ROLES)
    idx = {r: i for i, r in enumerate(ROLES)}
    same = np.zeros((R, R)); sameN = np.zeros((R, R))
    opp = np.zeros((R, R)); oppN = np.zeros((R, R))
    sx = np.zeros((R, R)); sy = np.zeros((R, R)); sxx = np.zeros((R, R)); syy = np.zeros((R, R)); sxy = np.zeros((R, R))
    ox = np.zeros((R, R)); oy = np.zeros((R, R)); oxx = np.zeros((R, R)); oyy = np.zeros((R, R)); oxy = np.zeros((R, R))

    for (gid,), g in allp.groupby(["game_id"]):
        teams = g[team_c].unique()
        byteam = {t: dict(zip(g[g[team_c] == t]["role"], g[g[team_c] == t]["z"])) for t in teams}
        for t in teams:
            a = byteam[t]
            for r1, v1 in a.items():
                i = idx[r1]
                for r2, v2 in a.items():
                    j = idx[r2]
                    sx[i, j] += v1; sy[i, j] += v2; sxx[i, j] += v1 * v1
                    syy[i, j] += v2 * v2; sxy[i, j] += v1 * v2; sameN[i, j] += 1
            for t2 in teams:
                if t2 == t: continue
                b = byteam[t2]
                for r1, v1 in a.items():
                    i = idx[r1]
                    for r2, v2 in b.items():
                        j = idx[r2]
                        ox[i, j] += v1; oy[i, j] += v2; oxx[i, j] += v1 * v1
                        oyy[i, j] += v2 * v2; oxy[i, j] += v1 * v2; oppN[i, j] += 1

    def corr(n, x, y, xx, yy, xy):
        out = np.zeros_like(x)
        with np.errstate(invalid="ignore", divide="ignore"):
            cov = xy / n - (x / n) * (y / n)
            vx = xx / n - (x / n) ** 2
            vy = yy / n - (y / n) ** 2
            out = cov / np.sqrt(vx * vy)
        out[~np.isfinite(out)] = 0.0
        out[n < MIN_PAIR_N] = 0.0
        return out

    Csame = corr(sameN, sx, sy, sxx, syy, sxy)
    Copp = corr(oppN, ox, oy, oxx, oyy, oxy)
    np.fill_diagonal(Csame, 1.0)
    Copp = (Copp + Copp.T) / 2      # opposing-team correlation is symmetric by construction

    # ---- full 2R x 2R game matrix, then nearest PSD ----
    M = np.block([[Csame, Copp], [Copp.T, Csame]])
    np.fill_diagonal(M, 1.0)
    w, V = np.linalg.eigh(M)
    clipped = int((w < 1e-6).sum())
    w = np.clip(w, 1e-6, None)
    M2 = V @ np.diag(w) @ V.T
    d = np.sqrt(np.diag(M2))
    M2 = M2 / np.outer(d, d)
    maxdrift = float(np.abs(M2 - M).max())

    # ---- coefficient of variation by position and scoring level ----
    cv = {}
    lvl = allp.copy()
    src = pd.concat([sp[["season", team_c, "player_id", "role", "dk"]],
                     dstats[["season", team_c, "player_id", "role", "dk"]]], ignore_index=True)
    src = src[src["role"].notna()]
    st2 = src.groupby(["season", team_c, "player_id", "role"], as_index=False).agg(
        mu=("dk", "mean"), sd=("dk", "std"), n=("dk", "size"))
    st2 = st2[(st2["n"] >= MIN_GAMES) & (st2["mu"] > 0.5)]
    st2["pos"] = st2["role"].str.replace(r"\d|x", "", regex=True)
    for pos, g in st2.groupby("pos"):
        bins = [0, 6, 10, 14, 18, 24, 999]
        g = g.copy(); g["b"] = pd.cut(g["mu"], bins)
        rows = []
        for b, gg in g.groupby("b", observed=True):
            if len(gg) < 25: continue
            rows.append({"lo": float(b.left), "hi": float(b.right),
                         "cv": round(float((gg["sd"] / gg["mu"]).median()), 4), "n": int(len(gg))})
        cv[pos] = rows

    out = {
        "meta": {
            "source": "nflverse-data stats_player_week + stats_team_week + nfldata games.csv",
            "seasons": [SEASONS[0], SEASONS[-1]],
            "regularSeasonOnly": True,
            "games": int(allp["game_id"].nunique()),
            "playerWeeks": int(len(allp)),
            "minGamesPerPlayerSeason": MIN_GAMES,
            "minPairObservations": MIN_PAIR_N,
            "psdEigenvaluesClipped": clipped,
            "psdMaxCellDrift": round(maxdrift, 4),
            "scoring": "DraftKings full-PPR incl. 100/300-yard bonuses; DST incl. points-allowed tiers",
        },
        "roles": ROLES,
        "same": [[round(float(v), 4) for v in r] for r in Csame],
        "opp": [[round(float(v), 4) for v in r] for r in Copp],
        "game": [[round(float(v), 5) for v in r] for r in M2],
        "sameN": [[int(v) for v in r] for r in sameN],
        "oppN": [[int(v) for v in r] for r in oppN],
        "cv": cv,
    }
    json.dump(out, open("/home/claude/work/corr.json", "w"), indent=1)

    print("games", out["meta"]["games"], "player-weeks", out["meta"]["playerWeeks"])
    print("eigenvalues clipped:", clipped, " max cell drift from PSD projection:", round(maxdrift, 4))
    print("\nSAME TEAM")
    print(pd.DataFrame(Csame, index=ROLES, columns=ROLES).round(3).to_string())
    print("\nOPPOSING TEAM")
    print(pd.DataFrame(Copp, index=ROLES, columns=ROLES).round(3).to_string())
    print("\nsample sizes (same team, lower triangle)")
    print(pd.DataFrame(sameN.astype(int), index=ROLES, columns=ROLES).to_string())
    print("\nCV by position and scoring level")
    print(json.dumps(cv, indent=1))


main()
