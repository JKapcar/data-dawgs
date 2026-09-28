import csv,gzip,importlib.util,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('rates',Path(__file__).resolve().parents[1]/'tools/fourth-down-rates.py')
rates=importlib.util.module_from_spec(spec);spec.loader.exec_module(rates)
class RatesTest(unittest.TestCase):
 def test_only_finished_games_real_attempts_and_matching_context(self):
  base={'game_id':'2026_01_CLE_CAR','play_id':'1','game_date':'2026-09-13','season_type':'REG','qtr':'4','no_play':'0','posteam':'CLE','down':'4','yardline_100':'15','ydstogo':'1','fourth_down_converted':'1','fourth_down_failed':'0','qb_kneel':'0','qb_spike':'0','field_goal_attempt':'0','field_goal_result':'','kick_distance':'','roof':'outdoors','desc':'first down'}
  rows=[base,dict(base,play_id='2',no_play='1'),dict(base,play_id='3',qb_kneel='1'),dict(base,play_id='4',qtr='5'),dict(base,play_id='5',fourth_down_converted='0',fourth_down_failed='0',desc='END GAME'),dict(base,play_id='6',field_goal_attempt='1',field_goal_result='made',kick_distance='33',fourth_down_converted='0'),dict(base,game_id='unfinished')]
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'pbp.gz'
   with gzip.open(p,'wt') as f:
    w=csv.DictWriter(f,fieldnames=list(base));w.writeheader();w.writerows(rows)
   out=rates.summarize(p,2026)
  self.assertEqual(out['go']['1|red']['CLE'],[1,1]);self.assertEqual(out['fg']['30|out']['CLE'],[1,1]);self.assertEqual(out['games'],1)
if __name__=='__main__':unittest.main()
