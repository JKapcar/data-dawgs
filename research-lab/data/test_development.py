import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from development import prepare

class DevelopmentTests(unittest.TestCase):
    def test_partition_missingness_determinism_and_no_holdout_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'input.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                for name in ('players', 'combine_results'):
                    z.writestr(name + '.csv', 'draft_year,nfl_id,value\n2025,heldout,NEVER_EXPORT\n2023,synthetic,NA\n2024,synthetic2,7\n')
                z.writestr('game_tracking_2025.csv', 'do not open this member')
            kwargs = dict(expected_sha=hashlib.sha256(archive.read_bytes()).hexdigest(), expected_size=archive.stat().st_size)
            digest, m = prepare(archive, root/'out', **kwargs)
            self.assertEqual(digest, prepare(archive, root/'again', **kwargs)[0])
            self.assertFalse(m['holdoutRead'])
            self.assertEqual(m['tables']['players']['rows'], 2)
            self.assertEqual(m['tables']['players']['columns'][2]['missing'], 1)
            for p in (root/'out').glob('*.json'):
                self.assertEqual(p.stem, hashlib.sha256(p.read_bytes()).hexdigest())
                self.assertNotIn('NEVER_EXPORT', p.read_text())
                self.assertNotIn('heldout', p.read_text())
            with self.assertRaisesRegex(ValueError, 'source identity'):
                prepare(archive, root/'bad')

    def test_refuses_git_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'.git').mkdir()
            with self.assertRaisesRegex(ValueError, 'outside Git'):
                prepare(root/'unused.zip', root/'out')

if __name__ == '__main__':
    unittest.main()
