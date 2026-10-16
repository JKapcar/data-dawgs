#!/usr/bin/env python3
"""Tests for manifest.py, tracking-audit.py and the research-data CI guard.

Every input is generated here, in a temp directory: the lab's synthetic tracking fixture
(converted to CSV through node) and tiny fake CSVs. No competition data is read or fetched.
Run: python3 research-lab/data/test_data_tools.py
"""
import importlib.util, json, math, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


manifest = load("manifest", os.path.join(HERE, "manifest.py"))
audit = load("tracking_audit", os.path.join(HERE, "tracking-audit.py"))
guard = load("check_research_data", os.path.join(ROOT, "tools", "check-research-data.py"))


def write(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        f.write(",".join(header) + "\n")
        for r in rows:
            f.write(",".join("" if v is None else str(v) for v in r) + "\n")


def fake_id(i):
    return str(40000 + i)  # generated, never a committed list


class SyntheticFixture(unittest.TestCase):
    """The lab's own synthetic tracking fixture, flattened to the competition's CSV shape."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="dd-data-synth-")
        js = "import {syntheticTracking} from './research-lab/tracking.mjs';process.stdout.write(JSON.stringify(syntheticTracking()))"
        data = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", js], cwd=ROOT))
        rows = []
        for i, frame in enumerate(data["frames"]):
            for e in frame["entities"]:
                rows.append([1, 1, e["id"], i + 1, frame["timeMs"] / 1000, e["x"], e["y"], e["speed"], None, None, e["dir"], e["o"], "BALL" if e["kind"] == "ball" else "PLAYER"])
        cls.csv = os.path.join(cls.dir, "synthetic_tracking.csv")
        write(cls.csv, ["game_id", "play_id", "nfl_id", "frame_id", "time", "x", "y", "s", "a", "dis", "dir", "o", "entity_type"], rows)
        cls.rows = len(rows)

    def test_manifest_profiles_the_fixture(self):
        full, summary = manifest.build(self.dir)
        f = full["files"][0]
        self.assertEqual(f["rows"], self.rows)
        self.assertEqual(f["key"], ["game_id", "play_id", "nfl_id", "frame_id"])
        self.assertTrue(f["key_unique"])
        s = {c["name"]: c for c in f["columns"]}
        self.assertEqual(s["a"]["dtype"], "empty")
        self.assertGreater(s["s"]["null_share"], 0)
        self.assertEqual(summary["files"][0]["rows"], self.rows)
        self.assertNotIn("nfl_id", summary["files"][0]["numeric_ranges"])

    def test_audit_reads_the_fixture_without_altering_it(self):
        with open(self.csv, "rb") as f:
            before = f.read()
        r = audit.audit(self.csv)
        self.assertEqual(r["rows"], self.rows)
        self.assertEqual(r["non_monotonic_steps"], 0)
        self.assertIn("PLAYER", r["entity_type_counts"])
        self.assertIn("BALL", r["entity_type_counts"])
        self.assertTrue(r["orientation_column_present"])
        self.assertTrue(any(row["o"] is not None for row in r["sample_track"]["rows"]))
        with open(self.csv, "rb") as f:
            self.assertEqual(f.read(), before)


class TinyFakeCsv(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="dd-data-fake-")
        # A combine-shaped file: duplicate key, a null, two draft years, positions.
        write(os.path.join(self.dir, "combine_results.csv"), ["nfl_id", "draft_year", "position", "forty", "ten_yd_split", "combine_height", "combine_weight"],
              [[fake_id(1), 2023, "WR", 4.41, 1.52, 72, 190], [fake_id(2), 2024, "WR", None, 1.55, 70, 185], [fake_id(2), 2024, "WR", 4.50, 1.55, 70, 185], [fake_id(3), 2025, "CB", 4.38, 1.49, 71, 188]])
        # A tracking-shaped file: moves due +x with dir 90 (NFL: 0 = +y, clockwise), one
        # step out of bounds, a negative a, a ball row and a repeated frame.
        rows, x = [], 110.0
        for frame in range(1, 7):
            rows.append([7, 3, fake_id(9), frame, round(frame * 0.1, 1), x, 20.0, 5.0, -0.5 if frame == 3 else 1.0, 1.0 if frame > 1 else None, 90, 85, "PLAYER"])
            x += 2.0
        rows.append([7, 3, fake_id(9), 6, 0.7, x, 20.0, 5.0, 1.0, 2.0, 90, 85, "PLAYER"])
        rows.append([7, 3, "", 1, 0.1, 60.0, 26.6, 0, 0, None, None, None, "BALL"])
        self.tracking = os.path.join(self.dir, "tracking_week_1.csv")
        write(self.tracking, ["game_id", "play_id", "nfl_id", "frame_id", "time", "x", "y", "s", "a", "dis", "dir", "o", "entity_type"], rows)

    def test_manifest_counts_keys_years_nulls_and_ranges(self):
        full, summary = manifest.build(self.dir)
        by = {f["file"]: f for f in full["files"]}
        c = by["combine_results.csv"]
        self.assertEqual(c["rows"], 4)
        self.assertEqual(c["key"], ["nfl_id", "draft_year"])
        self.assertFalse(c["key_unique"])
        self.assertEqual(c["duplicated_keys"], 1)
        self.assertEqual(c["draft_year_coverage"], {"2023": 1, "2024": 2, "2025": 1})
        cols = {x["name"]: x for x in c["columns"]}
        self.assertEqual(cols["forty"]["null_share"], 0.25)
        self.assertEqual((cols["forty"]["min"], cols["forty"]["max"]), (4.38, 4.5))
        self.assertEqual(cols["position"]["dtype"], "string")
        self.assertEqual(cols["nfl_id"]["dtype"], "int")
        sm = {f["file"]: f for f in summary["files"]}["combine_results.csv"]
        self.assertNotIn("nfl_id", sm["numeric_ranges"])
        self.assertIn("forty", sm["numeric_ranges"])
        self.assertEqual(summary["archive"]["files"], 2)
        self.assertEqual(len(summary["archive"]["sha256"]), 64)

    def test_summary_carries_no_values_that_identify_anyone(self):
        _, summary = manifest.build(self.dir)
        text = json.dumps(summary)
        for i in (1, 2, 3, 9):
            self.assertNotIn(fake_id(i), text)
        self.assertNotIn("WR", text)

    def test_main_writes_both_files_beside_the_source_and_nowhere_else(self):
        before = set(os.listdir(self.dir))
        manifest.main([self.dir])
        self.assertEqual(set(os.listdir(self.dir)) - before, {"manifest.json", "manifest-summary.json"})
        # The redacted summary is the one file allowed into research-lab/data/; it must pass the guard.
        clean = tempfile.mkdtemp(prefix="dd-data-summary-")
        with open(os.path.join(self.dir, "manifest-summary.json"), encoding="utf-8") as src, open(os.path.join(clean, "manifest-summary.json"), "w", encoding="utf-8") as dst:
            dst.write(src.read())
        self.assertEqual(guard.check(clean), [])

    def test_audit_reports_conventions_without_clipping(self):
        r = audit.audit(self.tracking)
        self.assertEqual(r["non_monotonic_steps"], 1)
        self.assertEqual(r["out_of_bounds"]["x_above_120"], 1)
        self.assertEqual(r["out_of_bounds_policy"], "reported, not clipped")
        self.assertEqual(r["entity_type_counts"], {"PLAYER": 7, "BALL": 1})
        self.assertAlmostEqual(r["a_negative_share"], 1 / 8)
        self.assertGreater(r["dir_convention_votes"]["zero_plus_y_clockwise"], 0)
        self.assertEqual(r["dir_convention_votes"]["zero_plus_x_counterclockwise"], 0)
        self.assertEqual(r["dis_minus_coordinate_delta"]["n"], 6)  # five forward steps plus the repeated frame
        self.assertGreater(r["dis_minus_coordinate_delta"]["max"], 0.5)  # the reported dis disagrees with a 2-yard step
        self.assertEqual(r["sample_track"]["rows"][0]["o"], 85)
        self.assertNotIn("nfl_id", r["sample_track"]["rows"][0])


archive_mod = load("archive", os.path.join(HERE, "archive.py"))
audit_mod = load("audit", os.path.join(HERE, "audit.py"))


class ArchiveAndAudit(unittest.TestCase):
    """A fake competition ZIP, generated here: verify, audit, receipt, redaction."""

    def setUp(self):
        import zipfile, hashlib
        self.dir = tempfile.mkdtemp(prefix="dd-data-zip-")
        members = {
            "combine_results.csv": "nfl_id,draft_year,position,forty,ten_yd_split,combine_height,combine_weight,draft_overall_pick\n"
            + "".join(f"{fake_id(i)},{2023 + i % 3},WR,4.{40 + i},1.5{i},7{i % 3},19{i},{10 + i}\n" for i in range(6)),
            "players.csv": "nfl_id,position\n" + "".join(f"{fake_id(i)},WR\n" for i in range(5)),
            "plays.csv": "game_id,play_id,yards_gained,pass_result,visitor_team_win_probility_added\n7,3,12,C,0.01\n7,4,0,I,-0.02\n",
            "tracking_week_1.csv": "game_id,play_id,nfl_id,frame_id,time,x,y,s,a,dis,dir,o,entity_type\n"
            + "".join(f"7,3,{fake_id(1)},{k},{k / 10},{100 + k},20,5,1,1,90,85,PLAYER\n" for k in range(1, 5))
            + f"7,9,{fake_id(77)},1,0.1,50,20,0,0,,,,PLAYER\n",
        }
        self.zip = os.path.join(self.dir, "competition.zip")
        with zipfile.ZipFile(self.zip, "w", zipfile.ZIP_DEFLATED) as z:
            for name, text in members.items():
                z.writestr(name, text)
        self.member_sha = {n: hashlib.sha256(t.encode()).hexdigest() for n, t in members.items()}
        with open(self.zip, "rb") as f:
            data = f.read()
        self.size, self.sha = len(data), hashlib.sha256(data).hexdigest()

    def test_verify_matches_only_the_same_bytes(self):
        fp = archive_mod.fingerprint(self.zip)
        self.assertEqual((fp["bytes"], fp["sha256"], fp["parts"]), (self.size, self.sha, 1))
        good = archive_mod.verify(self.zip, self.size, self.sha, fp["partHashesSha256"])
        self.assertTrue(good["ok"])
        self.assertEqual(set(good["checks"]), {"size_matches_verified_archive", "sha256_matches_verified_archive", "matches_uploaded_copy"})
        default = archive_mod.verify(self.zip)  # the real archive's expectations
        self.assertFalse(default["ok"])
        self.assertFalse(archive_mod.verify(self.zip, self.size, self.sha, "0" * 64)["ok"])
        self.assertEqual(archive_mod.main(["verify", self.zip, "--expect-size", str(self.size), "--expect-sha256", self.sha]), 0)

    def test_part_digest_matches_the_upload_gateway_definition(self):
        import hashlib
        big = os.path.join(self.dir, "big.bin")
        with open(big, "wb") as f:
            f.write(os.urandom(archive_mod.PART_BYTES + 5))
        with open(big, "rb") as f:
            a, b = f.read(archive_mod.PART_BYTES), f.read()
        expected = hashlib.sha256((hashlib.sha256(a).hexdigest() + "\n" + hashlib.sha256(b).hexdigest()).encode()).hexdigest()
        self.assertEqual(archive_mod.fingerprint(big)["partHashesSha256"], expected)

    def test_audit_reads_the_zip_in_place_and_writes_a_sealed_receipt(self):
        import hashlib, json as _json
        before = os.listdir(self.dir)
        full, summary = audit_mod.build(self.zip)
        self.assertEqual(os.listdir(self.dir), before)  # nothing written beside the source
        by = {t["file"]: t for t in full["tables"]}
        self.assertEqual({n: t["sha256"] for n, t in by.items()}, self.member_sha)
        self.assertEqual(by["combine_results.csv"]["post_cutoff_columns"], ["draft_overall_pick"])
        self.assertEqual(by["plays.csv"]["post_play_fields"], ["pass_result", "visitor_team_win_probability_added", "yards_gained"])
        self.assertTrue(by["tracking_week_1.csv"]["tracking"])
        self.assertEqual(full["tracking"][0]["tracks"], 2)
        athletes = {r["file"]: r for r in full["joins"]["athlete_ids"]["by_table"]}
        self.assertEqual(athletes["combine_results.csv"]["absent_from_all_other_tables"], 1)  # fake_id(5) has no players row
        self.assertEqual(athletes["tracking_week_1.csv"]["absent_from_all_other_tables"], 1)  # fake_id(77)
        plays = {r["file"]: r for r in full["joins"]["game_play"]["by_table"]}
        self.assertEqual(plays["tracking_week_1.csv"]["absent_from_all_other_tables"], 1)  # play 9 is not in plays.csv
        self.assertTrue(summary["readiness"]["forty"] and summary["readiness"]["draft_overall_pick"])
        self.assertFalse(summary["readiness"]["rookie_snap_share_or_snaps"])
        self.assertFalse(summary["archive"]["ok"])
        for receipt in (full, summary):
            body = {k: v for k, v in receipt.items() if k != "receipt_sha256"}
            self.assertEqual(receipt["receipt_sha256"], hashlib.sha256(_json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest())
        self.assertEqual(summary["full_receipt_sha256"], full["receipt_sha256"])
        self.assertEqual(set(summary["code_sha256"]), set(audit_mod.CODE_FILES))
        text = _json.dumps(summary)
        for i in (1, 5, 77):
            self.assertNotIn(fake_id(i), text)
        out = tempfile.mkdtemp(prefix="dd-audit-out-")
        audit_mod.main([self.zip, "--out", out])
        clean = tempfile.mkdtemp(prefix="dd-audit-clean-")
        os.replace(os.path.join(out, "audit-receipt-summary.json"), os.path.join(clean, "audit-receipt-summary.json"))
        self.assertEqual(guard.check(clean), [])

    def test_audit_is_reproducible_apart_from_its_timestamp(self):
        a, _ = audit_mod.build(self.zip)
        b, _ = audit_mod.build(self.zip)
        strip = lambda r: {k: v for k, v in r.items() if k not in ("generated_at", "as_of", "receipt_sha256")}
        self.assertEqual(strip(a), strip(b))


baseline_mod = load("baseline", os.path.join(HERE, "baseline.py"))


class Baseline(unittest.TestCase):
    """Synthetic cohort with a known linear signal: the card must beat the mean, the holdout opens once."""

    def setUp(self):
        import random
        rng = random.Random(7)
        self.dir = tempfile.mkdtemp(prefix="dd-baseline-")
        rows, outs = [], []
        for i in range(90):
            year = (2023, 2024, 2025)[i % 3]
            forty, split, h, w = 4.3 + rng.random() * 0.4, 1.45 + rng.random() * 0.15, 69 + rng.randrange(8), 175 + rng.randrange(50)
            rows.append([fake_id(i), year, "WR" if i % 10 else "CB", round(forty, 3), round(split, 3), h, w])
            if i % 9:  # some athletes have no outcome: excluded and counted, never imputed
                outs.append([fake_id(i), round(0.9 - 1.5 * (forty - 4.3) + rng.gauss(0, 0.05), 4)])
        rows.append([fake_id(200), 2024, "WR", "", 1.5, 70, 190])  # incomplete card
        write(os.path.join(self.dir, "combine_results.csv"), ["nfl_id", "draft_year", "position", "forty", "ten_yd_split", "combine_height", "combine_weight"], rows)
        write(os.path.join(self.dir, "rookie_usage.csv"), ["nfl_id", "snap_share"], outs)
        self.out = tempfile.mkdtemp(prefix="dd-baseline-out-")

    def test_develop_run_never_reads_the_holdout_and_card_beats_mean(self):
        baseline_mod.main([self.dir, "--outcome", "rookie_usage.csv:snap_share", "--out", self.out])
        with open(os.path.join(self.out, "baseline-develop-receipt.json"), encoding="utf-8") as f:
            r = json.load(f)
        self.assertEqual(r["result"]["holdout_n"], "sealed")
        self.assertFalse(r["counts"]["holdout_read"])
        self.assertEqual(r["counts"]["wr_in_develop_classes"], sum(1 for i in range(90) if i % 10 and (2023, 2024, 2025)[i % 3] != 2025) + 1)
        self.assertNotIn("holdout", r["result"])
        self.assertEqual(r["counts"]["incomplete_card"], 1)
        self.assertGreater(r["counts"]["no_outcome_excluded"], 0)
        loo = r["result"]["develop_loo"]
        self.assertLess(loo["mae_card"], loo["mae_mean"])
        self.assertLess(loo["mae_difference_card_minus_mean_95ci"][1], 0)
        self.assertLess(r["result"]["develop_fit"]["forty"], 0)

    def test_holdout_opens_once(self):
        args = [self.dir, "--outcome", "rookie_usage.csv:snap_share", "--out", self.out, "--open-holdout"]
        baseline_mod.main(args)
        with open(os.path.join(self.out, "baseline-holdout-receipt.json"), encoding="utf-8") as f:
            r = json.load(f)
        self.assertGreater(r["result"]["holdout_n"], 0)
        self.assertLess(r["result"]["holdout"]["mae_card"], r["result"]["holdout"]["mae_mean"])
        with self.assertRaises(SystemExit):
            baseline_mod.main(args)

    def test_receipt_holds_no_identifiers(self):
        baseline_mod.main([self.dir, "--outcome", "rookie_usage.csv:snap_share", "--out", self.out])
        with open(os.path.join(self.out, "baseline-develop-receipt.json"), encoding="utf-8") as f:
            text = f.read()
        for i in range(0, 90, 7):
            self.assertNotIn(fake_id(i), text)
        self.assertEqual(guard.check(self.out), [])


class Guard(unittest.TestCase):
    def test_committed_directory_is_clean(self):
        self.assertEqual(guard.check(HERE), [])

    def test_guard_rejects_raw_files_names_and_id_lists(self):
        d = tempfile.mkdtemp(prefix="dd-data-guard-")
        cases = {
            "raw.csv": "a,b\n1,2\n",
            "people.json": json.dumps({"rows": [{"display" + "_name": "Somebody Person"}]}),
            "ids.json": json.dumps({"ids": [int(fake_id(i)) for i in range(4)]}),
            "notes.md": "ids " + ", ".join(fake_id(i) for i in range(3)),
            "key.py": "x = {'nfl" + "_id': " + fake_id(1) + "}",
        }
        for name, text in cases.items():
            with open(os.path.join(d, name), "w", encoding="utf-8") as f:
                f.write(text)
        flagged = {os.path.basename(p.split(":")[0]) for p in guard.check(d)}
        self.assertEqual(flagged, set(cases))

    def test_post_play_and_alias_files_are_well_formed(self):
        with open(os.path.join(HERE, "aliases.json"), encoding="utf-8") as f:
            aliases = json.load(f)
        self.assertEqual(aliases["aliases"]["visitor_team_win_probility_added"], "visitor_team_win_probability_added")
        with open(os.path.join(HERE, "post-play-fields.json"), encoding="utf-8") as f:
            post = json.load(f)
        for f in ["expected_points_added", "pass_result", "yards_after_catch", "expected_yards_after_catch", "yards_gained", "pre_penalty_yards_gained", "target", "pass_length", "visitor_team_win_probability_added"]:
            self.assertIn(f, post["post_play_fields"])
        for doc in (aliases, post):
            self.assertTrue(doc["as_of"] and doc["source"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
