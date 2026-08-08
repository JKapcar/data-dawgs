import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cfb_team_results", ROOT / "scripts" / "cfb_team_results.py"
)
results = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = results
SPEC.loader.exec_module(results)


class TeamResultsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schedule = results.backbone.read_json(ROOT / "data" / "cfb-schedule.json")
        cls.team_game = results.backbone.read_json(ROOT / "data" / "cfb-team-game.json")
        cls.team_week = results.backbone.read_json(ROOT / "data" / "cfb-team-week.json")
        cls.team_week_latest = results.backbone.read_json(ROOT / "data" / "cfb-team-week-latest.json")
        cls.games_latest = results.backbone.read_json(ROOT / "data" / "cfb-games-latest.json")

    def test_published_surfaces_validate_against_the_current_schedule(self):
        results.validate_team_game(self.team_game, self.schedule)
        results.validate_team_week(self.team_week, self.team_game, self.schedule)
        results.validate_team_week_latest(
            self.team_week_latest, self.team_week, self.team_game, self.schedule
        )
        results.validate_games_latest(self.games_latest, self.team_game, self.schedule)

    def test_every_game_has_two_mirrored_rows(self):
        by_game = {}
        for row in self.team_game["data"]["rows"]:
            by_game.setdefault(row["game_id"], []).append(row)
        self.assertEqual(len(by_game), len(self.schedule["data"]["games"]))
        for game_id, pair in by_game.items():
            self.assertEqual(len(pair), 2, game_id)
            first, second = pair
            self.assertEqual(first["team_slug"], second["opponent_slug"])
            self.assertEqual(first["opponent_slug"], second["team_slug"])
            self.assertEqual(first["points_for"], second["points_against"])
            self.assertEqual(first["point_differential"], -second["point_differential"])

    def test_nonfinal_game_does_not_manufacture_a_result(self):
        changed = copy.deepcopy(self.schedule)
        game = changed["data"]["games"][0]
        game["status"] = "scheduled"
        game["home_points"] = None
        game["away_points"] = None
        changed["integrity"]["snapshot_id"] = results.backbone.sha256_id(changed["data"]["games"])
        payload = results.build_team_game(changed)
        pair = [row for row in payload["rows"] if row["game_id"] == game["game_id"]]
        self.assertEqual(len(pair), 2)
        self.assertTrue(all(row["result"] is None and row["point_differential"] is None for row in pair))

    def test_team_identity_drift_fails_closed(self):
        changed = copy.deepcopy(self.schedule)
        slug = changed["data"]["games"][0]["home_team_slug"]
        later = next(game for game in changed["data"]["games"][1:]
                     if game["home_team_slug"] == slug or game["away_team_slug"] == slug)
        side = "home" if later["home_team_slug"] == slug else "away"
        later[f"{side}_conference"] = "Wrong Conference"
        changed["integrity"]["snapshot_id"] = results.backbone.sha256_id(changed["data"]["games"])
        with self.assertRaisesRegex(results.ContractError, "identity drift"):
            results.build_team_game(changed)

    def test_week_keys_keep_postseason_week_one_separate(self):
        rows = self.team_week["data"]["rows"]
        keys = {(row["team_slug"], row["period_key"]) for row in rows}
        postseason_teams = {row["team_slug"] for row in rows if row["season_type"] == "postseason"}
        self.assertTrue(postseason_teams)
        team = next(slug for slug in postseason_teams if (slug, "regular-01") in keys)
        self.assertIn((team, "postseason-01"), keys)
        self.assertIn((team, "regular-01"), keys)

    def test_period_contract_allows_multiple_games_under_one_upstream_week(self):
        row = next(row for row in self.team_week["data"]["rows"]
                   if row["team_slug"] == "unlv" and row["period_key"] == "regular-01")
        self.assertEqual(row["scheduled_games_this_period"], 2)
        self.assertEqual(row["period"]["games"], 2)
        self.assertEqual(len(row["opponent_slugs"]), 2)

    def test_season_to_date_totals_reconcile_with_team_games(self):
        team = "ohio-state"
        team_rows = [row for row in self.team_game["data"]["rows"]
                     if row["team_slug"] == team and row["result"] is not None]
        final_period = [row for row in self.team_week["data"]["rows"] if row["team_slug"] == team][-1]
        totals = final_period["season_to_date"]
        self.assertEqual(totals["games"], len(team_rows))
        self.assertEqual(totals["points_for"], sum(row["points_for"] for row in team_rows))
        self.assertEqual(totals["points_against"], sum(row["points_against"] for row in team_rows))
        self.assertEqual(totals["wins"] + totals["losses"] + totals["ties"], totals["games"])

    def test_conference_record_is_regular_season_only_and_reconciles(self):
        team = "ohio-state"
        source = [row for row in self.team_game["data"]["rows"]
                  if row["team_slug"] == team and row["result"] is not None and
                  row["season_type"] == "regular" and row["conference_game"]]
        final_period = [row for row in self.team_week["data"]["rows"] if row["team_slug"] == team][-1]
        totals = final_period["conference_regular_season_to_date"]
        self.assertEqual(totals["games"], len(source))
        self.assertEqual(totals["wins"], sum(row["result"] == "win" for row in source))
        self.assertEqual(totals["losses"], sum(row["result"] == "loss" for row in source))
        self.assertEqual(totals["points_for"], sum(row["points_for"] for row in source))
        self.assertEqual(totals["points_against"], sum(row["points_against"] for row in source))
        self.assertIn("not an official standing", self.team_week["data"]["conference_record_definition"])

    def test_advanced_metrics_are_explicitly_unavailable(self):
        for envelope in (self.team_game, self.team_week, self.team_week_latest, self.games_latest):
            self.assertIn("results-only", envelope["data"]["scope"])
            self.assertIn("epa_per_play", envelope["data"]["unavailable_metrics"])
            self.assertIn("opponent_adjusted_metrics", envelope["data"]["unavailable_metrics"])
            self.assertIn("OBSERVED RESULTS ONLY", envelope["note"])

    def test_latest_surface_has_one_exact_latest_period_per_team(self):
        rows = self.team_week_latest["data"]["rows"]
        teams = self.team_week["data"]["teams"]
        self.assertEqual(len(rows), len(teams))
        self.assertEqual(len({row["team_slug"] for row in rows}), len(teams))
        by_team = {}
        for row in self.team_week["data"]["rows"]:
            prior = by_team.get(row["team_slug"])
            if prior is None or (row["through_at"], row["team_period_id"]) > (
                prior["through_at"], prior["team_period_id"]
            ):
                by_team[row["team_slug"]] = row
        for compact in rows:
            source = by_team[compact["team_slug"]]
            self.assertEqual(compact["through_at"], source["through_at"])
            self.assertEqual(compact["latest_period"]["team_period_id"], source["team_period_id"])
            self.assertEqual(compact["season_to_date"], source["season_to_date"])
            self.assertEqual(
                compact["conference_regular_season_to_date"],
                source["conference_regular_season_to_date"],
            )

    def test_latest_surface_locks_the_exact_team_week_snapshot(self):
        self.assertEqual(
            self.team_week_latest["data"]["input_team_week_snapshot_id"],
            self.team_week["integrity"]["snapshot_id"],
        )

    def test_latest_surface_declares_partial_fcs_coverage(self):
        coverage = self.team_week_latest["data"]["coverage"]
        self.assertIn("at least one FBS team", coverage["schedule_scope"])
        self.assertIn("not complete FCS season records", coverage["fcs_team_records"])
        self.assertTrue(any(row["division"] == "fcs" for row in self.team_week_latest["data"]["rows"]))
        self.assertEqual(
            self.team_week_latest["provenance"]["input_snapshot_id"],
            self.team_week["integrity"]["snapshot_id"],
        )

    def test_latest_surface_rehashed_tamper_still_fails_source_reconciliation(self):
        broken = copy.deepcopy(self.team_week_latest)
        broken["data"]["rows"][0]["season_to_date"]["wins"] += 1
        broken["integrity"]["snapshot_id"] = results.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(results.ContractError, "drift"):
            results.validate_team_week_latest(
                broken, self.team_week, self.team_game, self.schedule
            )

    def test_latest_games_select_exact_latest_completed_row_per_fbs_team(self):
        rows = self.games_latest["data"]["rows"]
        fbs = {slug for slug, facts in self.team_game["data"]["teams"].items()
               if facts["division"] == "fbs"}
        self.assertEqual({row["team_slug"] for row in rows}, fbs)
        by_team = {}
        for row in self.team_game["data"]["rows"]:
            if row["team_slug"] not in fbs or row["result"] is None:
                continue
            prior = by_team.get(row["team_slug"])
            if prior is None or (row["kickoff_at"], row["team_game_id"]) > (
                prior["kickoff_at"], prior["team_game_id"]
            ):
                by_team[row["team_slug"]] = row
        for compact in rows:
            source = by_team[compact["team_slug"]]
            game = compact["latest_completed_game"]
            self.assertEqual(game["team_game_id"], source["team_game_id"])
            self.assertEqual(game["points_for"], source["points_for"])
            self.assertEqual(game["points_against"], source["points_against"])
            self.assertEqual(game["result"], source["result"])

    def test_latest_games_are_fbs_final_only_and_snapshot_locked(self):
        data = self.games_latest["data"]
        self.assertTrue(data["coverage"]["final_games_only"])
        self.assertEqual(data["coverage"]["teams_without_a_completed_game"], [])
        self.assertEqual(data["input_team_game_snapshot_id"], self.team_game["integrity"]["snapshot_id"])
        self.assertEqual(
            self.games_latest["provenance"]["input_snapshot_id"],
            self.team_game["integrity"]["snapshot_id"],
        )

    def test_latest_games_rehashed_tamper_still_fails_source_reconciliation(self):
        broken = copy.deepcopy(self.games_latest)
        broken["data"]["rows"][0]["latest_completed_game"]["points_for"] += 1
        broken["integrity"]["snapshot_id"] = results.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(results.ContractError, "drift"):
            results.validate_games_latest(broken, self.team_game, self.schedule)

    def test_rehashed_row_tamper_still_fails_source_reconciliation(self):
        broken = copy.deepcopy(self.team_game)
        broken["data"]["rows"][0]["points_for"] += 1
        broken["integrity"]["snapshot_id"] = results.backbone.sha256_id(broken["data"])
        with self.assertRaisesRegex(results.ContractError, "drift"):
            results.validate_team_game(broken, self.schedule)

    def test_build_is_deterministic_for_the_same_snapshot(self):
        first_game = results.build_team_game(self.schedule)
        second_game = results.build_team_game(self.schedule)
        self.assertEqual(first_game, second_game)
        first_week = results.build_team_week(first_game)
        second_week = results.build_team_week(second_game)
        self.assertEqual(first_week, second_week)
        first_envelope = results.make_envelope(first_week, self.schedule, "team-week")
        second_envelope = results.make_envelope(second_week, self.schedule, "team-week")
        self.assertEqual(
            results.build_team_week_latest(first_envelope),
            results.build_team_week_latest(second_envelope),
        )


if __name__ == "__main__":
    unittest.main()
