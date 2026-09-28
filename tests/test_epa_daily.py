import copy
import csv
import gzip
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('epa_daily',ROOT/'tools/stats-epa-daily.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DailyEPA(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'plays.csv.gz'
        self.schedule=[dict(game_id='2026_03_CAR_CLE',season='2026',game_type='REG',week='3',home_team='CLE',away_team='CAR',home_score='21',away_score='18',gameday='2026-09-27'),dict(game_id='2026_03_PHI_CHI',season='2026',game_type='REG',week='3',home_team='CHI',away_team='PHI',home_score='',away_score='',gameday='2026-09-28')]
        self.play=dict(game_id='2026_03_CAR_CLE',season='2026',season_type='REG',week='3',home_team='CLE',away_team='CAR',play_id='1',desc='Pass',posteam='CLE',defteam='CAR',epa='1.23',cpoe='4.5',wp='.6',down='1',qtr='1',success='1',passer='D.Watson',rusher='',**{'pass':'1','rush':'0'})
        self.end=dict(self.play,play_id='2',desc='END GAME',epa='',**{'pass':'0','rush':'0'})
        old=dict(season=0,week=1,pos=0,**{'def':1},down=1,qtr=1,wp=50,flags=1,epa=11,cpoe=0,name='Old QB')
        self.data=m.encoder.encode({'seasons':[2025],'teams':['CLE','CAR','CHI','PHI'],'cols':{k:'' for k in [*m.encoder.U8,'epa','cpoe','name']},'coverage':{'2025':{'weeks':'all','captured':'2026-07-29'}}},[old])
    def write(self,rows):
        with gzip.open(self.path,'wt',newline='') as f:
            w=csv.DictWriter(f,fieldnames=self.play);w.writeheader();w.writerows(rows)
    def build(self,data=None):
        return m.build_candidate(data or self.data,self.path,self.schedule,2026,'2026-09-28T12:00:00Z')
    def test_finished_sunday_game_included_before_monday_and_history_retained(self):
        self.write([self.play,self.end]);out=self.build()
        self.assertEqual(out['coverage']['2026']['games'],1)
        self.assertEqual(out['coverage']['2026']['game_ids'],['2026_03_CAR_CLE'])
        self.assertEqual(m.encoder.decode(out)[0],m.encoder.decode(self.data)[0])
    def test_no_end_game_cannot_be_published(self):
        self.write([self.play]);self.assertIsNone(self.build())
    def test_no_final_score_cannot_be_published(self):
        self.write([self.play,self.end]);self.schedule[0]['home_score']='';self.assertIsNone(self.build())
    def test_missing_epa_cannot_be_published(self):
        self.write([dict(self.play,epa=''),self.end]);self.assertIsNone(self.build())
    def test_duplicate_or_wrong_team_rejected(self):
        self.write([self.play,self.play,self.end])
        with self.assertRaisesRegex(ValueError,'Duplicate'):self.build()
        self.write([dict(self.play,home_team='BUF'),self.end])
        with self.assertRaisesRegex(ValueError,'identity'):self.build()
    def test_stat_correction_replaces_current_season_instead_of_appending(self):
        self.write([self.play,self.end]);old=self.build()
        self.write([dict(self.play,epa='2.34'),self.end]);new=self.build(old)
        self.assertEqual(new['n'],old['n']);self.assertEqual(m.encoder.decode(new)[-1]['epa'],234)
    def test_previous_game_disappearance_fails_without_mutating_data(self):
        self.write([self.play,self.end]);old=self.build();snapshot=copy.deepcopy(old)
        self.write([self.play])
        with self.assertRaisesRegex(ValueError,'preserving'):self.build(old)
        self.assertEqual(old,snapshot)
    def test_initial_migration_does_not_drop_previous_weeks(self):
        self.write([self.play,self.end]);old=self.build();old['coverage']['2026']['games_per_week']={'1':16,'2':16};old['coverage']['2026'].pop('game_ids')
        with self.assertRaisesRegex(ValueError,'week lost'):self.build(old)
    def test_source_hash_and_game_counts_are_published(self):
        self.write([self.play,self.end]);c=self.build()['coverage']['2026']
        self.assertEqual(len(c['source_sha256']),64);self.assertEqual(c['games_by_team'],{'CAR':1,'CLE':1});self.assertEqual(c['regular_games'],1)

if __name__=='__main__':unittest.main()
