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
