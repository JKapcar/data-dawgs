import importlib.util
import json
import math
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cfb_elo", ROOT / "scripts" / "cfb_elo.py")
elo = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = elo
SPEC.loader.exec_module(elo)


def final_game(home="Home College", away="Away College", home_points=28, away_points=14,
               neutral=False, home_division="fbs", away_division="fbs"):
    slug = elo.backbone.team_slug
    return {
        "status": "final",
        "neutral_site": neutral,
        "home_team": home, "home_team_slug": slug(home), "home_division": home_division,
        "home_conference": "Test", "home_points": home_points,
        "away_team": away, "away_team_slug": slug(away), "away_division": away_division,
        "away_conference": "Test", "away_points": away_points,
    }


class EloMathTests(unittest.TestCase):
    def test_equal_ratings_neutral_site_is_a_coin_flip(self):
        self.assertAlmostEqual(elo.expected_home_prob(1500, 1500, neutral=True), 0.5)

    def test_home_field_shifts_probability_home(self):
        self.assertGreater(elo.expected_home_prob(1500, 1500, neutral=False), 0.5)

    def test_updates_are_zero_sum_between_fbs_teams(self):
        model = elo.EloModel()
        model.start_season(2025)
        model.process_game(final_game())
        total = sum(model.ratings.values())
        self.assertAlmostEqual(total, 2 * elo.PARAMS["base_rating"], places=9)

    def test_winner_gains_and_bigger_margins_gain_more(self):
        small, large = elo.EloModel(), elo.EloModel()
        small.start_season(2025); large.start_season(2025)
        small.process_game(final_game(home_points=17, away_points=14))
        large.process_game(final_game(home_points=49, away_points=0))
        slug = elo.backbone.team_slug("Home College")
        self.assertGreater(small.ratings[slug], elo.PARAMS["base_rating"])
        self.assertGreater(large.ratings[slug], small.ratings[slug])

    def test_mov_multiplier_dampens_runaway_favorites(self):
        even = elo.mov_multiplier(21, 0)
        favorite = elo.mov_multiplier(21, 400)
        self.assertGreater(even, favorite)
        self.assertGreater(favorite, 0)

    def test_non_fbs_opponent_pool_never_updates(self):
        model = elo.EloModel()
        model.start_season(2025)
        model.process_game(final_game(away_division="fcs", home_points=10, away_points=45))
        slug = elo.backbone.team_slug("Home College")
        self.assertLess(model.ratings[slug], elo.PARAMS["base_rating"])
        self.assertNotIn(elo.backbone.team_slug("Away College"), model.ratings)

    def test_season_rollover_reverts_toward_mean(self):
        model = elo.EloModel()
        model.start_season(2024)
        slug = elo.backbone.team_slug("Home College")
        model.ratings[slug] = 1800.0
        model.start_season(2025)
        expected = 1800.0 + elo.PARAMS["season_reversion_to_mean"] * (1500.0 - 1800.0)
        self.assertAlmostEqual(model.ratings[slug], expected)

    def test_same_season_start_does_not_revert(self):
        model = elo.EloModel()
        model.start_season(2025)
        slug = elo.backbone.team_slug("Home College")
        model.ratings[slug] = 1800.0
        model.start_season(2025)
        self.assertEqual(model.ratings[slug], 1800.0)

    def test_scheduled_games_do_not_move_ratings(self):
        model = elo.EloModel()
        model.start_season(2025)
        game = final_game()
        game["status"] = "scheduled"
        self.assertIsNone(model.process_game(game))
        self.assertEqual(model.ratings, {})

    def test_team_diagnostics_aggregate_two_perspectives_without_ranking(self):
        model = elo.EloModel()
        model.team_names = {"alpha": "Alpha", "beta": "Beta"}
        model.team_conferences = {"alpha": "Test", "beta": "Test"}
        rows = [
            {"home_team_slug": "alpha", "away_team_slug": "beta", "p_home": 0.75, "home_won": 1},
            {"home_team_slug": "beta", "away_team_slug": "alpha", "p_home": 0.40, "home_won": 0},
        ]
        diagnostics = elo.build_team_diagnostics(rows, model)
        by_slug = {row["team_slug"]: row for row in diagnostics["teams"]}
        self.assertEqual(by_slug["alpha"]["games"], 2)
        self.assertEqual(by_slug["alpha"]["observed_wins"], 2)
        self.assertEqual(by_slug["alpha"]["expected_wins"], 1.35)
        self.assertEqual(by_slug["alpha"]["actual_minus_expected_wins"], 0.65)
        self.assertFalse(diagnostics["prospective"])
        self.assertFalse(diagnostics["graded"])
        self.assertFalse(diagnostics["team_rankings_published"])
        self.assertNotIn("rank", by_slug["alpha"])


class PublishedFileTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT / "data" / "cfb-elo.json"
        if not self.path.exists():
            self.skipTest("data/cfb-elo.json not built yet")
        self.envelope = elo.backbone.read_json(self.path)

    def test_published_file_validates(self):
        elo.validate_envelope(self.envelope)

    def test_backtest_beats_its_reference_points(self):
        """Locks in the Baseline Requirement evidence: if a refresh ever makes the
        baseline worse than picking home teams, that is a contract-worthy event."""
        bt = self.envelope["data"]["backtest"]
        self.assertGreater(bt["elo_baseline"]["favorite_accuracy"],
                           bt["reference_points"]["always_pick_home_accuracy"])
        self.assertLess(bt["elo_baseline"]["brier_home_win"],
                        bt["reference_points"]["climatological_brier"])

    def test_market_comparison_is_scored_on_the_same_games(self):
        versus = self.envelope["data"]["backtest"].get("versus_market")
        if versus is None:
            self.skipTest("market file was absent when the Elo file was built")
        self.assertIn("market_median_devig", versus)
        self.assertIn("elo_baseline_same_games", versus)
        self.assertGreater(versus["coverage_of_evaluation_set"], 0.5)
        self.assertIn("timing", versus["timing_caveat"].lower())

    def test_market_comparison_does_not_claim_closing_lines(self):
        versus = self.envelope["data"]["backtest"].get("versus_market")
        if versus is None:
            self.skipTest("market file was absent when the Elo file was built")
        self.assertIn("not closing lines", versus["timing_caveat"].lower())

    def test_output_declares_itself_modelled_and_ungraded(self):
        self.assertFalse(self.envelope["graded"])
        self.assertIn("MODELLED", self.envelope["note"])
        self.assertIn("retrodictive", self.envelope["note"].lower() + self.envelope["data"]["backtest"]["kind"])

    def test_private_evaluation_rows_are_never_published(self):
        serialized = json.dumps(self.envelope, sort_keys=True)
        self.assertNotIn("_eval_rows", serialized)
        self.assertNotIn("home_team_slug", serialized)
        self.assertNotIn("away_team_slug", serialized)

    def test_team_diagnostics_reconcile_without_publishing_labels(self):
        diagnostics = self.envelope["data"]["team_diagnostics"]
        rows = diagnostics["teams"]
        backtest = self.envelope["data"]["backtest"]
        ratings = self.envelope["data"]["ratings_as_of_end_of_2025"]
        self.assertEqual(diagnostics["kind"], "retrodictive-team-aggregate")
        self.assertFalse(diagnostics["prospective"])
        self.assertFalse(diagnostics["graded"])
        self.assertFalse(diagnostics["team_rankings_published"])
        self.assertEqual({row["team_slug"] for row in rows}, {row["team_slug"] for row in ratings})
        self.assertEqual(sum(row["games"] for row in rows), 2 * backtest["n_games"])
        self.assertAlmostEqual(sum(row["expected_wins"] for row in rows), backtest["n_games"], delta=0.05)
        weighted_brier = sum(row["games"] * row["brier_win_probability"] for row in rows) / sum(
            row["games"] for row in rows
        )
        self.assertAlmostEqual(weighted_brier, backtest["elo_baseline"]["brier_home_win"], places=4)
        serialized = json.dumps(diagnostics, sort_keys=True).lower()
        for forbidden in ('"rank"', '"luck"', 'overrated', 'underrated'):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
