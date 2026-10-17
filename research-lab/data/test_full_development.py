import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from full_development import prepare

class FullDevelopmentTests(unittest.TestCase):
    def test_complete_tree_and_holdout_exclusion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.zip'
            with zipfile.ZipFile(source, 'w') as z:
                for t in ('players', 'combine_results'):
                    z.writestr(t+'.csv', 'draft_year,nfl_id,value\n2023,p,NA\n2025,h,HOLDOUT\n')
                z.writestr('games.csv', 'game_id,season\ng,2023\nh,2025\n')
                z.writestr('combine_tracking.csv', 'draft_year,nfl_id,time\n2023,p,1\n2025,h,HOLDOUT\n')
                z.writestr('player_play.csv', 'game_id,play_id,nfl_id\ng,1,p\nh,1,p\ng,1,context\n')
                z.writestr('game_tracking_2023.csv', 'game_id,play_id,nfl_id,time\n'+''.join(f'g,1,p,{i}\n' for i in range(17000))+'g,1,context,0\n')
                z.writestr('game_tracking_2024.csv', 'game_id,play_id,nfl_id,time\n')
                z.writestr('game_tracking_2025.csv', 'NEVER OPEN')
                z.writestr('player_career_successes.csv', 'NEVER OPEN')
            kwargs=dict(expected_sha=hashlib.sha256(source.read_bytes()).hexdigest(), expected_size=source.stat().st_size)
            original = zipfile.ZipFile.open
            def guarded(z, name, *args, **kw):
                self.assertNotIn('2025', str(name))
                self.assertNotIn('career', str(name))
                return original(z, name, *args, **kw)
            with patch.object(zipfile.ZipFile, 'open', guarded):
                digest, m = prepare(source, root/'out', **kwargs)
            self.assertEqual(m['tables']['game_tracking']['rows'], 17000)
            self.assertEqual(m['tables']['game_tracking']['depth'], 1)
            value_column=next(c for c in m['tables']['players']['columns'] if c['name']=='value')
            self.assertEqual(value_column['missing'],1)
            self.assertEqual(value_column['unit'],'unverified')
            seen=[]
            def walk(h):
                raw=(root/'out'/(h+'.json')).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),h)
                n=json.loads(raw)
                for child in n.get('children',[]): walk(child)
                for a in n.get('artifacts',[]):
                    raw=(root/'out'/(a['sha256']+'.json')).read_bytes()
                    self.assertEqual(hashlib.sha256(raw).hexdigest(),a['sha256'])
                    self.assertLessEqual(len(raw),131072)
                    seen.extend(json.loads(raw)['rows'])
            walk(m['tables']['game_tracking']['root'])
            self.assertEqual([r['time'] for r in seen],list(map(str,range(17000))))
            for p in (root/'out').glob('*.json'):
                self.assertNotIn('HOLDOUT',p.read_text())
                self.assertNotIn('"context"',p.read_text())
            self.assertEqual(digest,prepare(source,root/'again',**kwargs)[0])
            (root/'gitout').mkdir();(root/'gitout'/'.git').mkdir()
            with self.assertRaisesRegex(ValueError,'outside Git'):prepare(source,root/'gitout'/'out',**kwargs)
            with self.assertRaisesRegex(ValueError,'identity mismatch'):prepare(source,root/'bad')

    def test_identity_and_season_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for defect in ('duplicate_player','duplicate_game','cohort','season'):
                source=root/(defect+'.zip')
                with zipfile.ZipFile(source,'w') as z:
                    z.writestr('players.csv','draft_year,nfl_id\n2023,p\n'+('2023,p\n' if defect=='duplicate_player' else ''))
                    z.writestr('games.csv','game_id,season\ng,2023\n'+('g,2023\n' if defect=='duplicate_game' else ''))
                    z.writestr('combine_results.csv','draft_year,nfl_id\n2023,'+('missing' if defect=='cohort' else 'p')+'\n')
                    z.writestr('combine_tracking.csv','draft_year,nfl_id,time\n2023,p,1\n')
                    z.writestr('player_play.csv','game_id,play_id,nfl_id\ng,1,p\n')
                    z.writestr('game_tracking_2023.csv','game_id,play_id,nfl_id,time\n')
                    z.writestr('game_tracking_2024.csv','game_id,play_id,nfl_id,time\ng,1,p,1\n')
                with self.assertRaises(ValueError):
                    prepare(source,root/(defect+'out'),expected_sha=hashlib.sha256(source.read_bytes()).hexdigest(),expected_size=source.stat().st_size)

if __name__ == '__main__': unittest.main()
