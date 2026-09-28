import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('feed',Path(__file__).resolve().parents[1]/'tools/fourth-down-refresh.py')
feed=importlib.util.module_from_spec(spec);spec.loader.exec_module(feed)
class FeedTests(unittest.TestCase):
    def test_preplay_score_timeouts_and_own_field_position(self):
        game=dict(home_team='CLE',away_team='CAR',game_id='2026_03_CAR_CLE',espn='1',gameday='2026-09-27',roof='outdoors',spread_line='-2.5',total_line='41.5')
        def play(i,kind,text,down,hs,aws,spot,period=4):return dict(id=str(i),sequenceNumber=str(i),type={'text':kind},text=text,period={'number':period},clock={'displayValue':'1:05'},homeScore=hs,awayScore=aws,start=dict(down=down,distance=1,possessionText=spot,team={'id':'5'}))
        plays=[play(1,'Rush','Prior score',1,21,18,'CLE 25'),play(2,'Timeout','Timeout #3 by CAR at 01:05.',4,21,18,'CLE 25'),play(3,'Rush','Touchdown',4,27,18,'CLE 25')]
        payload=dict(header={'competitions':[dict(competitors=[dict(team={'id':'5','abbreviation':'CLE'}),dict(team={'id':'29','abbreviation':'CAR'})],status={'type':{'description':'Final'}})]},drives={'previous':[{'team':{'abbreviation':'CLE'},'plays':plays}],'current':{'team':{'abbreviation':'CLE'},'plays':[plays[-1]]}})
        result=feed.parse_game(payload,game);self.assertEqual(len(result['decisions']),1)
        s=result['decisions'][0]['input'];self.assertEqual(s['diff'],3);self.assertEqual(s['defTO'],0);self.assertEqual(s['yardline'],75);self.assertEqual(s['homeKickoff'],1)
if __name__=='__main__':unittest.main()
