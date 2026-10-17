import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from wr_audit import audit

class WRAuditTests(unittest.TestCase):
    def test_population_missingness_hashes_and_no_holdout_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'fixture.zip'
            with zipfile.ZipFile(source,'w') as z:
                z.writestr('players.csv','nfl_id,draft_year,nfl_position\n1,2023,WR\n2,2024,WR\n3,2023,DB\n4,2025,WR\n')
                z.writestr('games.csv','game_id,season,season_type\n10,2023,REG\n11,2023,PRE\n20,2024,REG\n30,2025,REG\n')
                z.writestr('player_play.csv','game_id,play_id,nfl_id,separation_at_pass_forward\n10,1,1,2\n10,2,1,NA\n10,3,1,bad\n10,4,1,inf\n20,1,2,4\n20,2,1,999\n11,1,1,999\n10,1,3,999\n30,1,4,HOLDOUT\n')
                z.writestr('combine_results.csv','nfl_id,draft_year\n1,2023\n4,2025\n')
                z.writestr('combine_tracking.csv','nfl_id,draft_year,event_id,drill_type,drill_name,attempt,time,x,y,s,a,dis,dir\n1,2023,e,CUT,left,1,t,NA,2,3,4,5,6\n4,2025,e,CUT,left,1,t,HOLDOUT,2,3,4,5,6\n')
                z.writestr('game_tracking_2023.csv','game_id,play_id,nfl_id\n10,1,1\n10,9,1\n')
                z.writestr('game_tracking_2024.csv','game_id,play_id,nfl_id\n20,1,2\n20,2,1\n')
                z.writestr('game_tracking_2025.csv','NEVER OPEN')
                z.writestr('player_career_successes.csv','NEVER OPEN')
            kwargs=dict(expected_sha=hashlib.sha256(source.read_bytes()).hexdigest(),expected_size=source.stat().st_size)
            original=zipfile.ZipFile.open
            def guard(z,name,*args,**kw):
                self.assertNotIn('2025',str(name));self.assertNotIn('career',str(name))
                return original(z,name,*args,**kw)
            with patch.object(zipfile.ZipFile,'open',guard):
                report,receipt=audit(source,root/'out',**kwargs)
            y=report['years']['2023']
            self.assertEqual((y['player_play_rows'],y['separation_missing'],y['separation_invalid']),(4,1,2))
            self.assertEqual(y['separation_raw_distribution']['mean'],2)
            self.assertEqual((y['tracking_unmatched_rows'],y['tracking_unmatched_trajectories']),(1,1))
            self.assertEqual(report['years']['2024']['player_play_rows'],1)
            self.assertEqual(report['combineDrills'][0]['missing'],{'x':1})
            self.assertEqual(report['athletes']['1']['combine_drill_missingness'][0]['missing'],{'x':1})
            raw=(root/'out'/(receipt['outputSha256']+'.json')).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),receipt['outputSha256'])
            self.assertNotIn('HOLDOUT',raw.decode())
            self.assertEqual(receipt,audit(source,root/'again',**kwargs)[1])
            (root/'git'/'.git').mkdir(parents=True)
            with self.assertRaisesRegex(ValueError,'outside Git'):audit(source,root/'git'/'out',**kwargs)
            with self.assertRaisesRegex(ValueError,'identity mismatch'):audit(source,root/'bad')

    def test_bad_schema_and_row_width_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for i, data in enumerate(('nfl_id,draft_year\n1,2023\n', 'nfl_id,draft_year,nfl_position\n1,2023\n', 'nfl_id,draft_year,nfl_position\n1,2023,WR,extra\n', 'nfl_id,draft_year,nfl_position,nfl_id\n1,2023,WR,1\n')):
                source=root/(str(i)+'.zip')
                with zipfile.ZipFile(source,'w') as z:z.writestr('players.csv',data)
                kwargs=dict(expected_sha=hashlib.sha256(source.read_bytes()).hexdigest(),expected_size=source.stat().st_size)
                with self.assertRaisesRegex(ValueError,'schema|row width'):
                    audit(source,root/('out'+str(i)),**kwargs)

if __name__=='__main__':unittest.main()
