import importlib.util
import datetime as dt
import json
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bayesratings_export",
                                              ROOT / "scripts" / "bayesratings_export.py")
bx = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(bx)

SCHEMA = ROOT / "models" / "bayesratings" / "bayesratings" / "schema.sql"
CAPTURED = dt.datetime(2026, 11, 27, 12, 0, tzinfo=dt.timezone.utc)


def make_db(path: Path):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA.read_text())
    teams = {1: "CLE", 2: "CIN", 3: "WSH", 4: "DAL", 5: "KC", 6: "XXX"}
    for tid, ab in teams.items():
        conn.execute("INSERT INTO teams (team_id, league, espn_id, abbreviation) VALUES (?,?,?,?)",
                     (tid, "nfl", 100 + tid, ab))
    ratings = {1: 0.10, 2: -0.05, 3: -0.20, 4: 0.30, 5: 0.45}
    for tid, r in ratings.items():
        conn.execute(
            "INSERT INTO rating_snapshots (snapshot_date, league, season, team_id, rating, rating_sd,"
            " rating_q05, rating_q95, home_adv) VALUES (?,?,?,?,?,?,?,?,?)",
            ("2026-11-27", "nfl", 2026, tid, r, 0.2, r - 0.33, r + 0.33, 0.11))
    # an older snapshot that must be ignored
    conn.execute("INSERT INTO rating_snapshots (snapshot_date, league, season, team_id, rating)"
                 " VALUES ('2026-11-20','nfl',2026,1,9.9)")
    games = [  # espn_event_id, start, home, away
        (9001, "2026-12-06T18:00", 1, 2),   # 2026_13_CIN_CLE
        (9002, "2026-11-26T21:30", 4, 5),   # already kicked off at capture time -> no receipt
        (9003, "2026-12-06T18:00", 6, 1),   # unknown team -> unmatched
    ]
    for gid, (eid, start, h, a) in enumerate(games, 1):
        conn.execute("INSERT INTO games (game_id, espn_event_id, league, season, start_time_utc,"
                     " game_date, home_team_id, away_team_id) VALUES (?,?,?,?,?,?,?,?)",
                     (gid, eid, "nfl", 2026, start, start[:10], h, a))
    conn.execute("INSERT INTO forecast_snapshots (snapshot_date, league, espn_event_id, game_date,"
                 " home_team_id, away_team_id, home_prob, away_prob, home_spread, total_pred,"
                 " home_total_pred, away_total_pred, nfl_model_src, nfl_team_prob)"
                 " VALUES ('2026-11-27','nfl',9002,'2026-11-26',4,5,0.42,0.58,1.5,48.5,23.5,25.0,"
                 "'team',0.42)")
    for eid, h, a, p, sp in ((9001, 1, 2, 0.61, -3.2), (9003, 6, 1, 0.5, 0.0)):
        conn.execute("INSERT INTO upcoming_forecasts (snapshot_date, league, espn_event_id,"
                     " game_date, home_team_id, away_team_id, home_prob, away_prob, home_spread,"
                     " total_pred, home_total_pred, away_total_pred, nfl_model_src, nfl_team_prob)"
                     " VALUES ('2026-11-27','nfl',?,?,?,?,?,?,?,44.0,23.6,20.4,'ridge_qb',0.58)",
                     (eid, "2026-12-06", h, a, p, 1 - p, sp))
    conn.commit()
    conn.close()


def schedule_fixture(path: Path):
    games = [
        {"game_id": "2026_13_CIN_CLE", "season": 2026, "week": 13,
         "kickoff_at": "2026-12-06T18:00:00Z", "home_team": "CLE", "away_team": "CIN"},
        {"game_id": "2026_12_KC_DAL", "season": 2026, "week": 12,
         "kickoff_at": "2026-11-26T21:30:00Z", "home_team": "DAL", "away_team": "KC"},
        {"game_id": "2026_05_KC_DAL", "season": 2026, "week": 5,
         "kickoff_at": "2026-10-04T17:00:00Z", "home_team": "DAL", "away_team": "KC"},
    ]
    path.write_text(json.dumps({"as_of": "2026-11-26", "source": "fixture",
                                "integrity": {"snapshot_id": "sha256:fixture"},
                                "data": {"season": 2026, "games": games}}))


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "br.db"
        self.sched = self.tmp / "sched.json"
        make_db(self.db)
        schedule_fixture(self.sched)
        self.doc = bx.build(self.db, self.sched, CAPTURED, "d" * 40, "e" * 40)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_envelope_and_contract(self):
        self.assertEqual(self.doc["as_of"], "2026-11-27")
        self.assertIn("AGPL-3.0-only", self.doc["source"])
        self.assertEqual(bx.validate(self.doc), [])

    def test_ratings_use_latest_snapshot_and_canonical_codes(self):
        teams = [r["team"] for r in self.doc["data"]["ratings"]]
        self.assertEqual(teams, ["KC", "DAL", "CLE", "CIN", "WAS"])
        self.assertEqual(self.doc["data"]["ratings"][0]["rank"], 1)
        self.assertEqual(self.doc["data"]["home_adv_logit"], 0.11)

    def test_forecast_mapping_and_sign_convention(self):
        f = {r["game_id"]: r for r in self.doc["data"]["forecasts"]}
        self.assertEqual(set(f), {"2026_13_CIN_CLE", "2026_12_KC_DAL"})
        cle = f["2026_13_CIN_CLE"]
        self.assertEqual(cle["model_spread_home"], -3.2)
        self.assertEqual(cle["expected_margin_home"], 3.2)
        self.assertEqual(cle["win_path"], "ridge_qb")
        # nearest kickoff wins when the same pair meets twice
        self.assertEqual(f["2026_12_KC_DAL"]["week"], 12)
        self.assertEqual(len(self.doc["data"]["unmatched"]), 1)

    def test_receipts_only_before_kickoff(self):
        rc = self.doc["data"]["receipt_candidates"]
        self.assertEqual([r["game_id"] for r in rc], ["2026_13_CIN_CLE"])
        r = rc[0]
        self.assertEqual(r["model_id"], "bayesratings-nfl")
        self.assertIsNone(r["home_cover_probability"])
        self.assertIsNone(r["push_probability"])
        self.assertEqual(r["source_commit"], "d" * 40)
        self.assertEqual(r["schedule_snapshot_id"], "sha256:fixture")

    def test_source_names_inputs(self):
        self.assertIn("run on ESPN scoreboards plus nflverse play-by-play", self.doc["source"])
        other = bx.build(self.db, self.sched, CAPTURED, "d" * 40, "e" * 40, "nflverse games.csv")
        self.assertIn("run on nflverse games.csv plus", other["source"])

    def test_input_snapshot_is_deterministic(self):
        again = bx.build(self.db, self.sched, CAPTURED, "d" * 40, "e" * 40)
        self.assertEqual(again["provenance"]["input_snapshot_id"],
                         self.doc["provenance"]["input_snapshot_id"])

    def test_validate_catches_disagreeing_favorite(self):
        bad = json.loads(json.dumps(self.doc))
        bad["data"]["forecasts"][0]["expected_margin_home"] *= -1
        self.assertTrue(any("different favorites" in e for e in bx.validate(bad)))

    def test_real_schedule_matches(self):
        sched = bx.load_schedule(ROOT / "data" / "nfl-schedule.json")
        g = bx.match_game(sched["games"], "CLE", "CIN", "2026-12-06T18:00")
        self.assertEqual(g["game_id"], "2026_13_CIN_CLE")


class VendorTests(unittest.TestCase):
    def test_vendored_tree_matches_lock(self):
        self.assertEqual(bx.verify_vendor(), [])

    def test_license_and_lock_metadata(self):
        lock = json.loads(bx.LOCK.read_text())
        self.assertEqual(lock["license"], "AGPL-3.0-only")
        self.assertFalse(lock["modified"])
        self.assertIn("GNU AFFERO GENERAL PUBLIC LICENSE",
                      (bx.VENDOR / "LICENSE").read_text()[:200])

    def test_a_local_edit_is_caught(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            copy = tmp / "vendor"
            shutil.copytree(bx.VENDOR, copy)
            (copy / "bayesratings" / "forecast.py").write_text("# edited\n")
            problems = bx.verify_vendor(copy)
            self.assertIn("changed: bayesratings/forecast.py", problems)
            self.assertTrue(any("section 5" in p for p in problems))
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
