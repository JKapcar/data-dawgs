"""Refresh data/datadawg-default.json from ETR rest-of-season (ROS) rank exports.

WHY THIS EXISTS. import-default-etr.py wants ETR's *auction* export (five dollar
columns, ~450 players). In-season ETR publishes ROS *ranks* with a 0-1000 Trade Value,
not dollars, and only the top 150 per format. Trade Value is a flatter curve than
auction dollars (rank 100 is ~9% of #1 on TV, ~2% on ETR's own auction curve), so
treating it as a price would silently re-shape every conversion downstream.

METHOD - re-order, don't re-shape. The dollar CURVE stays the last imported ETR auction
curve (per format, the sorted values already in data/datadawg-default.json). The ORDER
of players on that curve comes from the new ROS ranks. Values are a permutation of the
existing column, so every format still sums to exactly $2,400 and the $1 floor / zero
tail are unchanged. This is the same "vendor rank mapped onto ETR's own curve" rule the
PPN four-source board used; it is documented in the payload's method block.

  half    <- 1-QB ROS file, OVERALL rank onto the half curve          (exact format)
  sfHalf  <- 2-QB ROS file, OVERALL rank onto the sfHalf curve        (exact format)
  full    <- 1-QB ROS file, POSITIONAL rank onto the full curve       (approximation)
  std     <- 1-QB ROS file, POSITIONAL rank onto the std curve        (approximation)
  sfFull  <- 2-QB ROS file, POSITIONAL rank onto the sfFull curve     (approximation)

  Exact-format columns take the whole overall order (cross-position drift included).
  Formats ETR did not supply take only the within-position order, keeping each format's
  own positional pricing; cross-position drift is NOT applied there. Say so on the page.

  Skill players outside the ROS top 150 keep their previous relative order and take the
  curve tail behind the listed 150 (i.e. $1 or $0). K and DST are untouched: the ROS
  files carry none and the default conversion still needs them for the 12-team reference.

Raw ETR files stay outside git. Usage, from the repo root:

    python work/refresh-default-ros.py --one-qb /private/ROS-1QB.csv \
        --two-qb /private/ROS-2QB.csv --received YYYY-MM-DD
"""
import argparse, csv, datetime, hashlib, json, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "datadawg-default.json"
SKILL = ("QB", "RB", "WR", "TE")
COLUMNS = {"full": ("one", "positional"), "half": ("one", "overall"), "std": ("one", "positional"),
           "sfFull": ("two", "positional"), "sfHalf": ("two", "overall")}


def mvkey(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    s = re.sub(r"[^a-z ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def read_ros(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    out = []
    for r in rows:
        pos = r["Pos"].strip().upper()
        assert pos in SKILL, f"{r['Player']}: unexpected position {pos}"
        out.append({"name": r["Player"].strip(), "pos": pos, "team": r["Team"].strip(),
                    "rank": int(r["Rank"]), "pos_rank": int(re.sub(r"\D", "", r["Pos Rank"])),
                    "tv": int(r["Trade Value"]), "change": int(r["Rank Change"] or 0),
                    "note": (r.get("Notes") or "").strip()})
    out.sort(key=lambda x: x["rank"])
    assert [x["rank"] for x in out] == list(range(1, len(out) + 1)), "ROS ranks must be 1..N"
    assert len({mvkey(x["name"]) for x in out}) == len(out), "duplicate name in ROS file"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--one-qb", required=True)
    ap.add_argument("--two-qb", required=True)
    ap.add_argument("--received", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    datetime.date.fromisoformat(args.received)
    for p in (args.one_qb, args.two_qb):
        assert not Path(p).resolve().is_relative_to(ROOT), "raw ETR files must stay outside the repo"

    base = json.loads(OUT.read_text())
    players = base["data"]["players"]
    prev = {"as_of": base["as_of"], "sha256": base["data"]["sha256"]}
    by_key = {}
    for p in players:
        k = mvkey(p["name"])
        assert k not in by_key or p["pos"] == "DST", f"name collision {p['name']}"
        by_key.setdefault(k, p)
    ros = {"one": read_ros(args.one_qb), "two": read_ros(args.two_qb)}
    unmatched = {f: [x["name"] for x in rows if mvkey(x["name"]) not in by_key] for f, rows in ros.items()}
    assert not any(unmatched.values()), f"ROS players missing from the default pool: {unmatched}"
    # ROS lists have no ids; map name -> pool id once, then work in ids.
    ros_ids = {f: [by_key[mvkey(x["name"])]["id"] for x in rows] for f, rows in ros.items()}
    ros_by_id = {f: {by_key[mvkey(x["name"])]["id"]: x for x in rows} for f, rows in ros.items()}
    for f, rows in ros.items():                       # a listed player's position must agree with the pool
        for x in rows:
            p = by_key[mvkey(x["name"])]
            assert p["pos"] == x["pos"], f"{x['name']}: pool says {p['pos']}, ROS says {x['pos']}"

    old_values = {p["id"]: dict(p["values"]) for p in players}
    for col, (feed, mode) in COLUMNS.items():
        listed = ros_ids[feed]
        listed_set = set(listed)
        skill = [p for p in players if p["pos"] in SKILL]
        # previous order among unlisted players: by old value desc, then old overall position
        unlisted = sorted([p for p in skill if p["id"] not in listed_set],
                          key=lambda p: (-old_values[p["id"]][col], p["id"]))
        if mode == "overall":
            order = listed + [p["id"] for p in unlisted]
            curve = sorted((old_values[p["id"]][col] for p in skill), reverse=True)
            assert len(order) == len(curve)
            new = dict(zip(order, curve))
        else:
            new = {}
            for pos in SKILL:
                order = [i for i in listed if by_id(players, i)["pos"] == pos] + \
                        [p["id"] for p in unlisted if p["pos"] == pos]
                curve = sorted((old_values[p["id"]][col] for p in skill if p["pos"] == pos), reverse=True)
                assert len(order) == len(curve), (col, pos, len(order), len(curve))
                new.update(zip(order, curve))
        for p in players:
            if p["pos"] in SKILL:
                p["values"][col] = new[p["id"]]
        total = sum(p["values"][col] for p in players)
        assert abs(total - 2400) < 1e-6, (col, total)

    sha = {"one_qb_ros": hashlib.sha256(Path(args.one_qb).read_bytes()).hexdigest(),
           "two_qb_ros": hashlib.sha256(Path(args.two_qb).read_bytes()).hexdigest()}
    movers = []
    for p in players:
        if p["pos"] not in SKILL:
            continue
        d = p["values"]["half"] - old_values[p["id"]]["half"]
        if abs(d) >= 3:
            movers.append((round(d, 1), p["name"], p["pos"], old_values[p["id"]]["half"], p["values"]["half"]))
    movers.sort(key=lambda m: -abs(m[0]))

    base["as_of"] = args.received
    base["source"] = ("Owner-supplied ETR rest-of-season rank exports (Half-PPR 1-QB and 2-QB, top 150), "
                      "re-ordering the previously imported ETR auction curves; each format still sums to a "
                      "$2400 comparison pool.")
    base["note"] = ("Default season input, not weekly projections. ROS ranks re-order players on the last "
                    "imported ETR auction dollar curve per format (values are a permutation of that curve); "
                    "full/std/superflex-full take within-position order only, half and superflex-half take "
                    "the whole overall order. K and DST unchanged from the auction import. Source publication "
                    "date absent; as_of is receipt date.")
    base["data"]["received_at"] = args.received
    base["data"]["published_at"] = None
    base["data"]["sha256"] = sha["one_qb_ros"]
    base["data"]["inputs"] = {"one_qb_ros_sha256": sha["one_qb_ros"], "two_qb_ros_sha256": sha["two_qb_ros"],
                              "curve_basis": {"as_of": prev["as_of"], "sha256": prev["sha256"],
                                              "note": "ETR auction import whose per-format dollar curves are re-used"}}
    base["data"]["method"] = {
        "model_id": "datadawg-default-ros-reorder-v1",
        "rule": "ROS rank -> position on the last ETR auction curve (permutation; no re-shaping)",
        "columns": {c: {"feed": ("Half-PPR 1-QB ROS" if f == "one" else "Half-PPR 2-QB ROS"),
                        "mapping": m, "exact_format": m == "overall"} for c, (f, m) in COLUMNS.items()},
        "unlisted_skill_players": "keep prior relative order behind the listed 150; take the curve tail",
        "k_dst": "unchanged from the auction import"}
    base["data"]["ros_notes"] = [{"name": x["name"], "pos": x["pos"], "team": x["team"], "note": x["note"],
                                  "feed": "1-QB" if f == "one" else "2-QB"}
                                 for f, rows in ros.items() for x in rows if x["note"]]
    OUT.write_text(json.dumps(base, separators=(",", ":")) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(players)} players; five columns re-ordered; as_of {args.received}")
    print("largest half-PPR movers (>=$3):")
    for d, n, pos, o, v in movers[:25]:
        print(f"  {d:+5.1f}  {n:<24}{pos:<4}{o:>5.0f} -> {v:>4.0f}")
    return players, old_values, ros_by_id


def by_id(players, i):
    if not hasattr(by_id, "_m"):
        by_id._m = {p["id"]: p for p in players}
    return by_id._m[i]


if __name__ == "__main__":
    main()
