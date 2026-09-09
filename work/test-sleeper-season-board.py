"""Invented fixtures only: guard the source universe and starting-slot coverage."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build-sleeper-season-board.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class BoardTests(unittest.TestCase):
    def test_source_universe_excludes_unvalued_fringe_players(self):
        columns = ['ETR Full PPR', 'ETR Half PPR', 'ETR Std',
                   'ETR Superflex Full', 'ETR Superflex Half']
        def row(name, pos, priced=None):
            return dict(Player=name, Position=pos, **{c: '1' if c == priced else '0' for c in columns})
        rows = [row('Fringe receiver', 'WR'), row('Other format quarterback', 'QB', columns[3]),
                row('Starting runner', 'RB', columns[0]), row('Kicker', 'K', columns[0])]
        self.assertEqual(builder.projection_names(rows), {'Other format quarterback', 'Starting runner'})

    def test_budget_total_cannot_hide_missing_quarterbacks(self):
        rows = [dict(pos='QB', target=1) for _ in range(5)]
        rows += [dict(pos='WR', target=17995)]
        self.assertEqual(sum(r['target'] for r in rows), 18000)
        with self.assertRaisesRegex(AssertionError, '5 priced for 18'):
            builder.validate_starter_coverage(rows, ['QB'], 18)

    def test_all_dedicated_slots_have_paid_players(self):
        rows = [dict(pos=p, target=1) for p, n in [('QB', 18), ('RB', 36), ('WR', 36), ('TE', 18)] for _ in range(n)]
        counts = builder.validate_starter_coverage(rows, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'], 18)
        self.assertEqual(counts['TE'], 18)

if __name__ == '__main__':
    unittest.main()
