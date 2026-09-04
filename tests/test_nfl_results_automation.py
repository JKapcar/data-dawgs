import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import nfl_results_automation as a


class ResultsRuleTests(unittest.TestCase):
    def setUp(self):
        self.base = json.loads((ROOT / "data/nfl-schedule.json").read_text())
        # A test fixture, independent of how much of the real season has completed.
        for g in self.base["data"]["games"]:
            g.update(status="scheduled", home_score=None, away_score=None)
        self.base["integrity"]["snapshot_id"] = a.b.sha256_id(self.base["data"]["games"])
        self.up = copy.deepcopy(self.base)
        self.now = datetime(2030, 1, 1, tzinfo=timezone.utc)
        self.final(0)

    def final(self, index, home=21, away=17):
        self.up["data"]["games"][index].update(status="final", home_score=home, away_score=away)

    def candidate(self):
        self.up["integrity"]["snapshot_id"] = a.b.sha256_id(self.up["data"]["games"])
        return a.result_candidate(self.base, self.up, self.now)

    def test_new_final_is_accepted_and_exactly_verified(self):
        out, ids, review = self.candidate()
        self.assertEqual(len(ids), 1)
        self.assertEqual(review, [])
        self.assertEqual(a.verify_candidate(self.base, self.up, out, self.now), ids)
        self.assertEqual(out["data"]["games"][1:], self.base["data"]["games"][1:])

    def test_zero_zero_tie_is_a_valid_result(self):
        self.final(0, 0, 0)
        self.assertEqual(len(self.candidate()[1]), 1)

    def test_future_final_is_refused(self):
        self.now = datetime(2020, 1, 1, tzinfo=timezone.utc)
        self.assertEqual(self.candidate()[1], [])

    def test_changed_kickoff_does_not_block_unrelated_safe_result(self):
        self.final(1)
        self.up["data"]["games"][1]["kickoff_at"] = "2029-01-01T00:00:00Z"
        out, ids, review = self.candidate()
        self.assertEqual(len(ids), 1)
        self.assertEqual(out["data"]["games"][1], self.base["data"]["games"][1])
        self.assertTrue(review)

    def test_every_nonresult_field_is_protected(self):
        original = copy.deepcopy(self.up)
        for key in self.up["data"]["games"][0]:
            if key in a.RESULT_FIELDS or key in {"game_id", "week", "season", "home_team", "away_team", "kickoff_at"}:
                continue  # Identity/schema failures are covered separately.
            with self.subTest(field=key):
                self.up = copy.deepcopy(original)
                value = self.up["data"]["games"][0][key]
                self.up["data"]["games"][0][key] = not value if isinstance(value, bool) else "changed"
                try:
                    self.assertEqual(self.candidate()[1], [])
                except a.b.ContractError:
                    pass

    def test_new_field_even_null_is_refused(self):
        self.up["data"]["games"][0]["extra"] = None
        self.assertEqual(self.candidate()[1], [])

    def test_removed_field_is_refused(self):
        del self.up["data"]["games"][0]["away_rest_days"]
        self.assertEqual(self.candidate()[1], [])

    def test_final_score_correction_and_reversal_are_refused(self):
        self.base["data"]["games"][0].update(status="final", home_score=24, away_score=17)
        self.base["integrity"]["snapshot_id"] = a.b.sha256_id(self.base["data"]["games"])
        self.assertEqual(self.candidate()[1], [])
        self.up["data"]["games"][0].update(status="scheduled", home_score=None, away_score=None)
        self.assertEqual(self.candidate()[1], [])

    def test_bad_score_types_refused(self):
        for score in [-1, 1.5, True, "21", None]:
            with self.subTest(score=score):
                self.final(0, score, 17)
                try:
                    self.assertEqual(self.candidate()[1], [])
                except a.b.ContractError:
                    pass

    def test_provenance_policy_change_fails_closed(self):
        self.up["provenance"]["source_url"] = "https://example.invalid"
        with self.assertRaises(a.b.ContractError):
            self.candidate()

    def test_noop_never_auto_merges(self):
        self.up = copy.deepcopy(self.base)
        out, ids, _ = self.candidate()
        self.assertEqual(ids, [])
        self.assertEqual(out, self.base)
        with self.assertRaises(a.b.ContractError):
            a.verify_candidate(self.base, self.up, out, self.now)

    def test_candidate_metadata_and_structure_cannot_be_smuggled(self):
        out, _, _ = self.candidate()
        for mutate in [lambda x: x.update(note="changed"),
                       lambda x: x["data"]["games"].reverse(),
                       lambda x: x["data"]["games"].pop(),
                       lambda x: x["provenance"].update(loader_license="changed")]:
            changed = copy.deepcopy(out)
            mutate(changed)
            with self.assertRaises(a.b.ContractError):
                a.verify_candidate(self.base, self.up, changed, self.now)

    def test_pr_identity_head_and_base_must_match(self):
        repo = "JKapcar/data-dawgs"
        pr = {"state": "open", "draft": False, "user": {"login": "github-actions[bot]"},
              "base": {"ref": "main", "repo": {"full_name": repo}},
              "head": {"ref": a.BRANCH, "sha": "a" * 40, "repo": {"full_name": repo}}}
        a.check_pr(pr, repo, "a" * 40)
        for section, key, value in [("head", "sha", "b" * 40), ("head", "ref", "evil"),
                                    ("base", "ref", "other"), ("user", "login", "someone")]:
            bad = copy.deepcopy(pr)
            bad[section][key] = value
            with self.assertRaises(a.b.ContractError):
                a.check_pr(bad, repo, "a" * 40)
        bad = copy.deepcopy(pr)
        bad["head"]["repo"]["full_name"] = "attacker/fork"
        with self.assertRaises(a.b.ContractError):
            a.check_pr(bad, repo, "a" * 40)


class GradingRebuildTests(unittest.TestCase):
    def test_new_schedule_hash_never_rebinds_legacy_receipts(self):
        schedule = json.loads((ROOT / "data/nfl-schedule.json").read_text())
        model = json.loads((ROOT / "data/538-classic.json").read_text())
        ledger = json.loads((ROOT / "data/model-receipts.json").read_text())
        legacy = json.loads((ROOT / "data/receipts.json").read_text())
        old = copy.deepcopy(ledger)
        game = schedule["data"]["games"][0]
        game.update(status="final", home_score=21, away_score=17)
        schedule["integrity"]["snapshot_id"] = a.b.sha256_id(schedule["data"]["games"])
        model["data"]["forecasts"] = [r for r in model["data"]["forecasts"] if r["game_id"] != game["game_id"]]
        model["provenance"]["schedule_snapshot_id"] = schedule["integrity"]["snapshot_id"]
        model["provenance"]["input_material"]["schedule_snapshot_id"] = schedule["integrity"]["snapshot_id"]
        model["integrity"].update(snapshot_id=a.b.sha256_id(model["data"]),
            input_snapshot_id=a.b.sha256_id(model["provenance"]["input_material"]),
            forecast_rows=len(model["data"]["forecasts"]))
        updated = a.elo.update_ledger(ledger, legacy, model, schedule)
        self.assertEqual(updated["data"], old["data"])
        a.elo.validate_public(model, updated, legacy, schedule)
        altered = copy.deepcopy(updated)
        target = next(r for r in altered["data"] if r["model_id"] == "nfelo")
        target["home_win_probability"] += 0.01
        altered["integrity"]["sha256"] = a.b.receipt_ledger_hash(altered["data"])
        with self.assertRaises(a.elo.ModelError):
            a.elo.validate_public(model, altered, legacy, schedule)


if __name__ == "__main__":
    unittest.main()
