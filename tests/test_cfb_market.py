import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cfb_market", ROOT / "scripts" / "cfb_market.py")
market = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = market
SPEC.loader.exec_module(market)


SCHEDULE = {
    "integrity": {"snapshot_id": "sha256:" + "0" * 64},
    "data": {
        "season": 2025,
        "games": [{
            "game_id": "2025_regu_01_away-college_home-college",
            "upstream_game_id": "401000001",
            "season": 2025, "week": 1, "kickoff_at": "2025-09-06T16:00:00Z",
            "home_team": "Home College", "away_team": "Away College",
            "home_division": "fbs", "away_division": "fbs",
            "status": "final", "home_points": 28, "away_points": 14,
        }],
    },
}

HEADER = ("id,game_id,season,game_desc,date_time,market_type,abbr,lines,odds,"
          "opening_lines,opening_odds,book,season_type,week,home_team_id,away_team_id")


def source_csv(rows):
    return "\n".join([HEADER] + rows) + "\n"


def row(market_type, abbr, lines="", odds="", opening="", book="DraftKings", game="401000001"):
    return (f"1,{game},2025.0,Away College@Home College,2025-09-06T16:00:00.000Z,"
            f"{market_type},{abbr},{lines},{odds},{opening},,{book},regular,1,1,2")


class OddsMathTests(unittest.TestCase):
    def test_american_to_decimal_both_signs(self):
        self.assertAlmostEqual(market.american_to_decimal(100), 2.0)
        self.assertAlmostEqual(market.american_to_decimal(-200), 1.5)
        self.assertAlmostEqual(market.american_to_decimal(150), 2.5)

    def test_implausible_american_odds_rejected(self):
        for value in (0, 50, -50):
            with self.assertRaises(market.ContractError):
                market.american_to_decimal(value)

    def test_devig_is_proportional_and_symmetric(self):
        probability, hold = market.devig_pair(-110, -110)
        self.assertAlmostEqual(probability, 0.5)
        self.assertGreater(hold, 0)

    def test_devig_matches_hand_computed_house_method(self):
        probability, hold = market.devig_pair(-165, 140)
        raw_home = 165 / 265
        raw_away = 100 / 240
        self.assertAlmostEqual(probability, raw_home / (raw_home + raw_away), places=9)
        self.assertAlmostEqual(hold, raw_home + raw_away - 1, places=9)

    def test_corrupt_two_way_price_is_rejected_not_devigged(self):
        with self.assertRaises(market.QuoteRejected):
            market.devig_pair(-400, -400)

    def test_book_aliases_normalize(self):
        self.assertEqual(market.normalize_book("Draft Kings"), "DraftKings")
        self.assertEqual(market.normalize_book("DraftKings"), "DraftKings")

    def test_missing_book_fails_closed(self):
        with self.assertRaises(market.ContractError):
            market.normalize_book("")


class BuildTests(unittest.TestCase):
    def test_full_quote_builds_with_devig(self):
        text = source_csv([
            row("spread", "Home College", lines="-7.0", opening="-6.5"),
            row("spread", "Away College", lines="7.0", opening="6.5"),
            row("total", "over", lines="52.5"),
            row("total", "under", lines="52.5"),
            row("money_line", "Home College", odds="-280"),
            row("money_line", "Away College", odds="230"),
        ])
        with unittest.mock.patch.object(market, "validate_market_games", lambda games: None):
            games, rejected = market.build_rows(text, SCHEDULE, 2025)
        self.assertEqual(rejected, [])
        book = games[0]["books"][0]
        self.assertEqual(book["spread_home"], -7.0)
        self.assertEqual(book["spread_open_home"], -6.5)
        self.assertEqual(book["total"], 52.5)
        self.assertGreater(book["devig_home_win_probability"], 0.7)

    def test_corrupt_quote_is_published_not_silently_dropped(self):
        text = source_csv([
            row("money_line", "Home College", odds="-400"),
            row("money_line", "Away College", odds="-400"),
        ])
        with unittest.mock.patch.object(market, "validate_market_games", lambda games: None), \
                unittest.mock.patch.object(market, "MAX_REJECTED_QUOTE_SHARE", 1.0):
            games, rejected = market.build_rows(text, SCHEDULE, 2025)
        self.assertEqual(len(rejected), 1)
        self.assertIn("overround", rejected[0]["reason"])
        self.assertIsNone(games[0]["books"][0]["devig_home_win_probability"])
        self.assertIsNone(games[0]["books"][0]["moneyline_home"])

    def test_rejection_share_gate_fails_closed_on_a_degraded_feed(self):
        text = source_csv([
            row("money_line", "Home College", odds="-400"),
            row("money_line", "Away College", odds="-400"),
        ])
        with unittest.mock.patch.object(market, "validate_market_games", lambda games: None), \
                self.assertRaises(market.ContractError):
            market.build_rows(text, SCHEDULE, 2025)

    def test_unknown_team_on_a_price_fails_closed(self):
        text = source_csv([row("spread", "Somewhere Else", lines="-7.0")])
        with self.assertRaises(market.ContractError):
            market.build_rows(text, SCHEDULE, 2025)

    def test_multiple_date_times_per_game_fails_closed(self):
        """The whole timing caveat rests on date_time being kickoff. If that ever
        stops being true, the build must stop rather than quietly mislabel."""
        odd = row("total", "over", lines="52.5").replace(
            "2025-09-06T16:00:00.000Z", "2025-09-05T10:00:00.000Z")
        text = source_csv([row("total", "under", lines="52.5"), odd])
        with self.assertRaises(market.ContractError):
            market.build_rows(text, SCHEDULE, 2025)

    def test_games_outside_the_canonical_set_are_ignored(self):
        text = source_csv([row("total", "over", lines="52.5", game="999999999")])
        with unittest.mock.patch.object(market, "validate_market_games", lambda games: None):
            games, _ = market.build_rows(text, SCHEDULE, 2025)
        self.assertEqual(games, [])


class PublishedFileTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT / "data" / "cfb-market.json"
        if not self.path.exists():
            self.skipTest("data/cfb-market.json not built yet")
        self.envelope = market.backbone.read_json(self.path)

    def test_published_file_validates(self):
        market.validate_envelope(self.envelope)

    def test_timing_caveat_is_machine_readable_not_only_prose(self):
        provenance = self.envelope["provenance"]
        self.assertIs(provenance["observation_timestamp_available"], False)
        self.assertEqual(provenance["price_timing"], "unknown")

    def test_no_price_is_described_as_closing(self):
        self.assertNotIn("closing line", json.dumps(self.envelope["data"]).lower())

    def test_rejected_quotes_are_published(self):
        self.assertIsInstance(self.envelope["data"]["rejected_quotes"], list)
        self.assertEqual(len(self.envelope["data"]["rejected_quotes"]),
                         self.envelope["integrity"]["rejected_quotes"])


import unittest.mock  # noqa: E402

if __name__ == "__main__":
    unittest.main()
