import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
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
            opened = []
            original_open = zipfile.ZipFile.open
            def guarded_open(z, name, *args, **kw):
                member = name.filename if isinstance(name, zipfile.ZipInfo) else name
                opened.append(member)
                self.assertNotIn('2025', member)
                return original_open(z, name, *args, **kw)
            with patch.object(zipfile.ZipFile, 'open', guarded_open):
                digest, m = prepare(archive, root/'out', **kwargs)
            self.assertEqual(set(opened), {'players.csv', 'combine_results.csv'})
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

    def test_complete_export_across_chunk_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root/'input.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                body = 'draft_year,nfl_id,value\n' + ''.join(f"2023,id{i:04d},{i}\n" for i in range(600))
                for table in ('players', 'combine_results'):
                    z.writestr(table+'.csv', body)
            _, m = prepare(archive, root/'out', expected_sha=hashlib.sha256(archive.read_bytes()).hexdigest(), expected_size=archive.stat().st_size)
            for table in ('players', 'combine_results'):
                chunks = [a for a in m['artifacts'] if a['table'] == table]
                self.assertEqual([a['rows'] for a in chunks], [256, 256, 88])
                rows = [r for a in chunks for r in json.loads((root/'out'/(a['sha256']+'.json')).read_text())['rows']]
                self.assertEqual([r['nfl_id'] for r in rows], [f'id{i:04d}' for i in range(600)])
                self.assertEqual(m['tables'][table]['rows'], 600)

    def test_rejects_schema_duplicate_identity_and_malformed_rows(self):
        cases = [('draft_year,nfl_id,nfl_id\n', 'invalid schema'),
                 ('nfl_id,value\n', 'invalid schema'),
                 ('draft_year,nfl_id\n2023,same\n2024,same\n', 'duplicate'),
                 ('draft_year,nfl_id\n2023,\n', 'missing'),
                 ('draft_year,nfl_id\n2023,id,extra\n', 'malformed')]
        for body, message in cases:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                archive = root/'input.zip'
                with zipfile.ZipFile(archive, 'w') as z:
                    for table in ('players', 'combine_results'):
                        z.writestr(table+'.csv', body)
                with self.assertRaisesRegex(ValueError, message):
                    prepare(archive, root/'out', expected_sha=hashlib.sha256(archive.read_bytes()).hexdigest(), expected_size=archive.stat().st_size)

    def test_refuses_git_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'.git').mkdir()
            with self.assertRaisesRegex(ValueError, 'outside Git'):
                prepare(root/'unused.zip', root/'out')

if __name__ == '__main__':
    unittest.main()
