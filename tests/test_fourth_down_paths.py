import csv,gzip,importlib.util,tempfile,unittest
from pathlib import Path
try:
 import numpy as np,pandas,scipy  # the builder is a research tool; CI does not install these
 spec=importlib.util.spec_from_file_location('paths',Path(__file__).resolve().parents[1]/'tools/fourth-down-paths.py')
 paths=importlib.util.module_from_spec(spec);spec.loader.exec_module(paths)
except ImportError:
 paths=None
@unittest.skipUnless(paths,'numpy, pandas and scipy are needed for the path builder')
class PathsTest(unittest.TestCase):
 def game(self):
  # Home WP .6 for the first half, .3 for the third quarter, .9 for the fourth.
  rows=[]
  for i in range(60):
   t=3600-60*i
   rows.append({'game_id':'g','play_id':i,'qtr':1+i//15,'down':4 if i==30 else 1,'posteam':'H' if i%2==0 else 'A','home_team':'H','game_seconds_remaining':t,'vegas_home_wp':.6 if t>1800 else .3 if t>900 else .9})
  rows.append({'game_id':'g','play_id':99,'qtr':5,'down':1,'posteam':'H','home_team':'H','game_seconds_remaining':0,'vegas_home_wp':.5})
  return rows
 def measure(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'pbp.gz'
   with gzip.open(p,'wt') as f:
    w=csv.DictWriter(f,fieldnames=list(self.game()[0]));w.writeheader();w.writerows(self.game())
   return paths.game_paths(p,2025)
 def test_realized_clock_shares_are_exact_for_a_known_path(self):
  a,games=self.measure();x=list(paths.THRESHOLDS)
  self.assertEqual(games,1);self.assertEqual(len(a),120)  # 60 plays, both sides, overtime dropped
  home=a[0];self.assertEqual(home[1],3600);self.assertAlmostEqual(home[2],.6)
  self.assertAlmostEqual(home[3],.6*.5+.3*.25+.9*.25)                # time-average WP from kickoff
  first=6
  self.assertAlmostEqual(home[first+x.index(.5)],.75)                 # above 50%: first half + fourth quarter
  self.assertAlmostEqual(home[first+x.index(.8)],.25);self.assertAlmostEqual(home[first+x.index(.2)],1)
  away=a[60];self.assertAlmostEqual(away[2],.4);self.assertAlmostEqual(away[first+x.index(.5)],.25)
  self.assertAlmostEqual(home[first+x.index(.5)]+away[first+x.index(.5)],1)
 def test_horizon_shares_and_fourth_down_flags(self):
  a,_=self.measure();x=list(paths.THRESHOLDS);n=len(x)
  at_half=a[30]                                                       # 1800 left: 900s at .3 then 900s at .9
  self.assertEqual(at_half[1],1800);self.assertEqual(at_half[4],1);self.assertEqual(at_half[5],1)
  self.assertAlmostEqual(at_half[6+n+x.index(.5)],0)                  # next 300s all at .3
  self.assertAlmostEqual(at_half[6+2*n+x.index(.2)],1)                # next 900s above 20%
  late=a[58]                                                          # 120s left: horizons run past 0:00
  self.assertTrue(np.isnan(late[6+n]));self.assertAlmostEqual(late[6+x.index(.8)],1)
  early=a[26]                                                         # 2040 left: 240s at .6 then 60s at .3
  self.assertAlmostEqual(early[6+n+x.index(.5)],240/300)
 def test_path_model_is_a_martingale_and_reduces_to_a_coin_flip_at_even_odds(self):
  v=paths.information(np.log(np.diff(paths.KNOTS/3600)))               # a plain linear clock
  self.assertAlmostEqual(float(v[-1]),1);self.assertTrue((np.diff(v)>0).all())
  o=paths.occupancy(np.array([.5]),np.array([3600.]),v)[0]
  self.assertAlmostEqual(float(o[list(paths.THRESHOLDS).index(.5)]),.5,places=6)
  self.assertAlmostEqual(paths.occupancy_exact(.5,.5,3600,3600,v),.5,places=6)
  mids=(np.arange(200)+.5)/200                                         # integral over every line = starting WP
  self.assertAlmostEqual(float(np.mean([paths.occupancy_exact(.3,g,1800,1800,v) for g in mids])),.3,places=3)
if __name__=='__main__':unittest.main()
