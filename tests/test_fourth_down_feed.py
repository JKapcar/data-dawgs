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
    def test_rollover_freezes_the_outgoing_week_only(self):
        game=dict(id='2026_05_TB_DAL',home='DAL',away='TB',status='Final',decisions=[dict(id='1')])
        old=dict(source='ESPN',data=dict(season=2026,week=5,refreshed_at='2026-10-13T04:00:00+00:00',games=[game]))
        frozen=feed.archive(old,2026,6,'2026-10-15T12:00:00+00:00')
        self.assertEqual((frozen['data']['season'],frozen['data']['week']),(2026,5))
        self.assertEqual(frozen['data']['games'],[game]);self.assertEqual(frozen['as_of'],'2026-10-13')
        self.assertEqual(frozen['data']['archived_at'],'2026-10-15T12:00:00+00:00')
        for key in ('as_of','source','tier','tier_meaning','canonical_url','note'):self.assertTrue(frozen[key])
        self.assertIs(frozen['graded'],False)
        self.assertIsNone(feed.archive(old,2026,5,'x'))                      # same week: nothing to freeze
        self.assertIsNone(feed.archive(old,2026,4,'x'))                      # a hand-run earlier week never overwrites
        self.assertEqual(feed.archive(old,2027,1,'x')['data']['week'],5)     # season rollover
        empty=dict(data=dict(season=2026,week=5,games=[dict(id='g',decisions=[])]))
        self.assertIsNone(feed.archive(empty,2026,6,'x'))                    # never replace an archive with nothing
        self.assertIsNone(feed.archive(None,2026,6,'x'));self.assertIsNone(feed.archive({},2026,6,'x'))
if __name__=='__main__':unittest.main()
