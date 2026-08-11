"""Grade the grader (Stage FC-F).

⚠️ EVERY EXPECTED VALUE HERE IS HAND-COMPUTED FROM THE PUBLISHED FORMULA, not copied out
of a run. A test whose expectations came from the code under test only proves the code
still does what it did — which is exactly what you do not want from the component that
decides who won.

points = 25 - 100(p - r)^2, so by inspection:
    p = 1.0 on a winner   ->  25 - 100(0)^2   = +25   the ceiling
    p = 0.0 on a winner   ->  25 - 100(1)^2   = -75   the floor
    p = 0.5 either way    ->  25 - 100(0.25)  =   0   an untouched slider scores nothing
    p = 0.8 on a winner   ->  25 - 100(0.04)  = +21
    p = 0.8 on a loser    ->  25 - 100(0.64)  = -39
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import forecast_grade as fg  # noqa: E402


def game(gid, home, away, status="final", home_score=None, away_score=None, week=1):
    return {"game_id": gid, "season": 2026, "week": week, "home_team": home, "away_team": away,
            "status": status, "home_score": home_score, "away_score": away_score,
            "kickoff_at": "2026-09-10T00:20:00Z"}


def entry(entrant, gid, p, touched=True, kind="human"):
    return {"entrant": entrant, "entrant_kind": kind, "owner": entrant, "sport": "nfl",
            "game_id": gid, "home_win_probability": p, "touched": touched}


class TestPoints(unittest.TestCase):
    """The formula, checked against numbers computed by hand."""

    def test_a_correct_certainty_is_the_ceiling(self):
        self.assertAlmostEqual(fg.points_for(1.0, 1), 25.0)

    def test_a_confident_miss_is_the_floor(self):
        self.assertAlmostEqual(fg.points_for(0.0, 1), -75.0)
        self.assertAlmostEqual(fg.points_for(1.0, 0), -75.0)

    def test_an_untouched_slider_scores_exactly_nothing(self):
        # ⚠️ This is why a tie may not resolve at r = 0.5: it would turn this exact 0
        # into a +25 for having no opinion, and refusing to forecast would dominate.
        self.assertAlmostEqual(fg.points_for(0.5, 1), 0.0)
        self.assertAlmostEqual(fg.points_for(0.5, 0), 0.0)

    def test_ordinary_values(self):
        self.assertAlmostEqual(fg.points_for(0.8, 1), 21.0)
        self.assertAlmostEqual(fg.points_for(0.8, 0), -39.0)

    def test_the_formula_is_side_symmetric(self):
        """p -> 1-p together with r -> 1-r must not change the score. This is what lets
        storage keep only the canonical home probability without losing information."""
        for p, r in [(0.62, 1), (0.13, 0), (0.5, 1), (0.99, 0)]:
            self.assertAlmostEqual(fg.points_for(p, r), fg.points_for(1 - p, 1 - r))

    def test_points_are_a_linear_transform_of_brier(self):
        for p, r in [(0.62, 1), (0.13, 0), (0.5, 1)]:
            self.assertAlmostEqual(fg.points_for(p, r), 25 - 100 * fg.brier_for(p, r))


class TestOutcome(unittest.TestCase):
    def test_a_home_win_is_one_and_an_away_win_is_zero(self):
        self.assertEqual(fg.outcome_of(game("g", "SEA", "NE", home_score=24, away_score=10))[0], 1)
        self.assertEqual(fg.outcome_of(game("g", "SEA", "NE", home_score=10, away_score=24))[0], 0)

    def test_a_tie_is_void_not_a_half(self):
        r, why = fg.outcome_of(game("g", "SEA", "NE", home_score=17, away_score=17))
        self.assertIsNone(r)
        self.assertIn("void", why)

    def test_an_unplayed_game_is_not_graded(self):
        self.assertIsNone(fg.outcome_of(game("g", "SEA", "NE", status="scheduled"))[0])

    def test_a_final_without_a_score_is_refused(self):
        """Fails closed. A final whose score did not arrive must not be silently graded
        as an away win because None sorted below zero somewhere."""
        self.assertIsNone(fg.outcome_of(game("g", "SEA", "NE", status="final"))[0])


class TestGrading(unittest.TestCase):
    def setUp(self):
        self.games = {
            "g1": game("g1", "SEA", "NE", home_score=24, away_score=10),   # home won
            "g2": game("g2", "LAR", "SF", home_score=10, away_score=24),   # away won
            "tie": game("tie", "GB", "CHI", home_score=17, away_score=17),  # void
            "open": game("open", "BUF", "MIA", status="scheduled"),
        }

    def test_a_tie_is_dropped_from_every_denominator(self):
        graded, skipped = fg.grade_rows(
            [entry("Kap", "g1", 1.0), entry("Kap", "tie", 1.0)], self.games)
        self.assertEqual(len(graded), 1)
        self.assertEqual(graded[0]["game_id"], "g1")
        # ⚠️ Dropped, not scored zero: "did not count" and "scored nothing" are different
        # facts, and averaging a void in as a zero would quietly punish everyone equally.
        self.assertTrue(any(s["game_id"] == "tie" and "void" in s["why"] for s in skipped))

    def test_an_unplayed_game_is_skipped_with_a_reason(self):
        graded, skipped = fg.grade_rows([entry("Kap", "open", 0.7)], self.games)
        self.assertEqual(graded, [])
        self.assertEqual(skipped[0]["why"], "not final")

    def test_a_game_off_the_canonical_schedule_is_reported_not_dropped(self):
        graded, skipped = fg.grade_rows([entry("Kap", "nope", 0.7)], self.games)
        self.assertEqual(graded, [])
        self.assertIn("canonical schedule", skipped[0]["why"])

    def test_a_missing_probability_is_reported_not_assumed(self):
        bad = entry("Kap", "g1", None)
        graded, skipped = fg.grade_rows([bad], self.games)
        self.assertEqual(graded, [])
        self.assertIn("home_win_probability", skipped[0]["why"])

    def test_the_scores_and_their_source_travel_with_the_grade(self):
        graded, _ = fg.grade_rows([entry("Kap", "g1", 0.8)], self.games)
        row = graded[0]
        self.assertEqual(row["points"], 21.0)
        self.assertEqual(row["home_result"], 1)
        self.assertEqual(row["home_score"], 24)
        self.assertEqual(row["outcome_source"], "data/nfl-schedule.json")

    def test_an_agent_keeps_its_kind_and_its_owner(self):
        graded, _ = fg.grade_rows([entry("EloBot", "g1", 0.9, kind="agent")], self.games)
        self.assertEqual(graded[0]["entrant_kind"], "agent")


class TestBoards(unittest.TestCase):
    """⚠️ Both boards, always. Totals reward volume; the common sample is the only set on
    which two entrants with different coverage may be compared."""

    def setUp(self):
        self.games = {
            "g1": game("g1", "SEA", "NE", home_score=24, away_score=10),
            "g2": game("g2", "LAR", "SF", home_score=24, away_score=10),
            "g3": game("g3", "GB", "CHI", home_score=24, away_score=10),
        }
        # Volume forecasts all three, badly. Sniper forecasts one, perfectly.
        self.entries = [
            entry("Volume", "g1", 0.6), entry("Volume", "g2", 0.6), entry("Volume", "g3", 0.6),
            entry("Sniper", "g1", 1.0),
        ]

    def test_totals_reward_showing_up(self):
        graded, _ = fg.grade_rows(self.entries, self.games)
        boards = fg.leaderboards(graded)
        totals = {r["entrant"]: r for r in boards["totals"]["rows"]}
        # Volume: three games at 25 - 100(0.4^2) = 9 each  = 27.
        self.assertAlmostEqual(totals["Volume"]["points"], 27.0)
        # Sniper: one perfect game = 25.
        self.assertAlmostEqual(totals["Sniper"]["points"], 25.0)
        # So the worse forecaster leads the totals board purely on volume. That is the
        # board behaving correctly, and exactly why it may never be published alone.
        self.assertEqual(boards["totals"]["rows"][0]["entrant"], "Volume")

    def test_the_common_sample_restricts_to_the_shared_games(self):
        graded, _ = fg.grade_rows(self.entries, self.games)
        boards = fg.leaderboards(graded)
        self.assertEqual(boards["common_sample"]["n_games"], 1)
        rows = {r["entrant"]: r for r in boards["common_sample"]["rows"]}
        self.assertEqual(rows["Volume"]["n"], 1)
        self.assertEqual(rows["Sniper"]["n"], 1)
        # On the one game they both forecast, the sniper is better and the board says so.
        self.assertLess(rows["Sniper"]["brier"], rows["Volume"]["brier"])
        self.assertEqual(boards["common_sample"]["rows"][0]["entrant"], "Sniper")

    def test_every_common_sample_row_carries_n_and_coverage(self):
        graded, _ = fg.grade_rows(self.entries, self.games)
        for row in fg.leaderboards(graded)["common_sample"]["rows"]:
            self.assertIn("n", row)
            self.assertIn("coverage", row)

    def test_no_running_total_is_stored_anywhere(self):
        """The boards are a query. Recomputing them from the rows must reproduce them
        exactly, which is what makes the rows the only authoritative thing in the file."""
        graded, _ = fg.grade_rows(self.entries, self.games)
        self.assertEqual(fg.leaderboards(graded), fg.leaderboards(graded))


class TestPayload(unittest.TestCase):
    def test_the_integrity_hash_covers_the_rows_in_append_order(self):
        games = {"g1": game("g1", "SEA", "NE", home_score=24, away_score=10)}
        graded, skipped = fg.grade_rows([entry("Kap", "g1", 0.8)], games)
        payload = fg.build_payload(graded, skipped, "2026-09-11")
        import hashlib
        want = hashlib.sha256(
            "\n".join(fg.canonical_json(r) for r in graded).encode("utf-8")).hexdigest()
        self.assertEqual(payload["integrity"]["sha256"], want)
        self.assertEqual(payload["integrity"]["rows"], len(graded))

    def test_the_envelope_carries_what_the_data_contract_demands(self):
        payload = fg.build_payload([], [], "2026-09-11")
        self.assertTrue(payload["as_of"])
        self.assertTrue(payload["source"])
        self.assertIn("Ties are VOID", payload["note"])

    def test_the_ledger_is_never_written_by_a_test(self):
        """⚠️ The guard on the whole idea of rehearsing before the season. Nothing here
        may create or touch data/forecast-grades.json — the real ledger is append-only,
        so a row written now could not be retracted later without breaking the one
        property the file exists to have."""
        self.assertFalse((ROOT / "data" / "forecast-grades.json").exists(),
                         "a test or a rehearsal wrote the real ledger")


class TestCli(unittest.TestCase):
    def test_the_cli_writes_only_where_it_is_told(self):
        games = {"games": [game("2026_01_NE_SEA", "SEA", "NE", home_score=24, away_score=10)]}
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            sched = tmp / "sched.json"
            sched.write_text(json.dumps(
                {"as_of": "2026-09-11", "source": "test fixture", "data": games}), encoding="utf-8")
            ent = tmp / "entries.json"
            ent.write_text(json.dumps({"entries": [entry("Kap", "2026_01_NE_SEA", 1.0)]}), encoding="utf-8")
            out = tmp / "grades.json"
            rc = fg.main(["--entries", str(ent), "--schedule", str(sched),
                          "--as-of", "2026-09-11", "--out", str(out)])
            self.assertEqual(rc, 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["integrity"]["rows"], 1)
            self.assertAlmostEqual(payload["data"]["rows"][0]["points"], 25.0)
            # LF only — the hash is taken over bytes, so a CRLF write would change it.
            self.assertNotIn(b"\r\n", out.read_bytes())


if __name__ == "__main__":
    unittest.main()
