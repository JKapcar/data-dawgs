import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from indexed_development import prepare as export, WR_POLICY

def prepare(*args, **kwargs):
    return export(*args, policy=WR_POLICY, **kwargs)

class IndexedDevelopmentTests(unittest.TestCase):
    def test_compact_leaf_uses_128_entry_and_independent_byte_bounds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'compact.zip'
            with zipfile.ZipFile(source,'w') as z:
                z.writestr('players.csv','nfl_id,draft_year,nfl_position\n'+''.join(f'p{i},2023,QB\n' for i in range(70)))
                z.writestr('games.csv','game_id,season,season_type\n')
                z.writestr('combine_results.csv','nfl_id,draft_year\n')
                z.writestr('combine_tracking.csv','nfl_id,draft_year,time\n')
                z.writestr('player_play.csv','game_id,play_id,nfl_id\n')
                for year in (2023,2024):z.writestr(f'game_tracking_{year}.csv','game_id,play_id,nfl_id,time\n')
            _,m=export(source,root/'out',expected_sha=hashlib.sha256(source.read_bytes()).hexdigest(),expected_size=source.stat().st_size)
            node=json.loads((root/'out'/(m['tables']['players']['root']+'.json')).read_text())
            self.assertGreater(len(node['entries']),32)
            self.assertLessEqual(len(node['entries']),128)
            for p in (root/'out').glob('*.json'):self.assertLessEqual(p.stat().st_size,65536)

    def test_all_population_rejects_orphan_combine_join(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,_=self.make(root)
            for table in ('combine_results','combine_tracking'):
                bad=root/(table+'.zip')
                with zipfile.ZipFile(source) as src,zipfile.ZipFile(bad,'w') as dst:
                    for name in src.namelist():
                        raw=src.read(name)
                        dst.writestr(name,raw+b'orphan,2023,1\n' if name==table+'.csv' else raw)
                kwargs=dict(expected_sha=hashlib.sha256(bad.read_bytes()).hexdigest(),expected_size=bad.stat().st_size)
                with self.assertRaisesRegex(ValueError,'cohort join failed'):export(bad,root/('all-'+table),**kwargs)
                # An explicit study may exclude other development athletes.
                prepare(bad,root/('wr-'+table),**kwargs)

    def make(self, root, drift=False):
        source=root/'source.zip'
        with zipfile.ZipFile(source,'w') as z:
            z.writestr('players.csv','nfl_id,draft_year,nfl_position\na,2023,WR\nb,2024,WR\nqb,2023,QB\nh,2025,WR\n')
            z.writestr('combine_results.csv','nfl_id,draft_year,forty\na,2023,NA\nb,2024,4.4\nqb,2023,4.5\nh,2025,SEALED\n')
            z.writestr('combine_tracking.csv','nfl_id,draft_year,time\na,2023,t\nb,2024,t\nh,2025,SEALED\n')
            z.writestr('games.csv','game_id,season,season_type\ng,2023,REG\nr,2024,REG\npre,2023,PRE\npost,2023,POST\nh,2025,REG\n')
            z.writestr('player_play.csv','game_id,play_id,nfl_id\ng,1,a\nr,1,b\nr,2,a\ng,1,qb\npre,1,a\npost,1,a\nh,1,a\n')
            z.writestr('game_tracking_2023.csv','game_id,play_id,nfl_id,time\n'+''.join(f'g,1,a,{i}\n' for i in range(5000))+'g,unmatched,a,u\ng,1,qb,EXCLUDE\npre,1,a,EXCLUDE\npost,1,a,EXCLUDE\n')
            z.writestr('game_tracking_2024.csv','game_id,play_id,nfl_id,'+('changed_time\n' if drift else 'time\nr,1,b,t\nr,2,a,EXCLUDE\n'))
            z.writestr('game_tracking_2025.csv','NEVER OPEN')
            z.writestr('player_career_successes.csv','NEVER OPEN')
        return source,dict(expected_sha=hashlib.sha256(source.read_bytes()).hexdigest(),expected_size=source.stat().st_size)

    def test_default_all_positions_preserves_full_development_population(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source,kwargs=self.make(root)
            original=zipfile.ZipFile.open
            def guarded(z,name,*a,**kw):
                self.assertNotIn('2025',str(name)); self.assertNotIn('career',str(name)); return original(z,name,*a,**kw)
            with patch.object(zipfile.ZipFile,'open',guarded):
                pin,m=export(source,root/'all',**kwargs)
            self.assertEqual(m['policy'],'all-position-development-v1')
            self.assertEqual({t:m['tables'][t]['rows'] for t in m['tables']},dict(players=3,combine_results=3,combine_tracking=2,games=4,player_play=6,game_tracking=5006))
            rows=[]
            for p in (root/'all').glob('*.gz'):
                a=json.loads(gzip.decompress(p.read_bytes()))
                if a['table']=='game_tracking': rows.extend(a['rows'])
            self.assertEqual(len(rows),5006)
            self.assertEqual({r['dd_season_type'] for r in rows},{'PRE','REG','POST'})
            self.assertIn('QB',{r['dd_nfl_position'] for r in rows})
            self.assertTrue(any(r['dd_season']=='2024' and r['dd_draft_year']=='2023' for r in rows))
            self.assertEqual(sum(r['play_id']=='unmatched' for r in rows),1)

    def test_complete_scoped_export_ranges_hashes_and_determinism(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,kwargs=self.make(root)
            original=zipfile.ZipFile.open
            def guarded(z,name,*a,**kw):
                self.assertNotIn('2025',str(name));self.assertNotIn('career',str(name));return original(z,name,*a,**kw)
            with patch.object(zipfile.ZipFile,'open',guarded):pin,m=prepare(source,root/'out',**kwargs)
            self.assertEqual(m['tables']['game_tracking']['rows'],5002)
            self.assertEqual(m['tables']['player_play']['rows'],2)
            self.assertEqual(m['tables']['players']['rows'],2)
            self.assertEqual(m['tables']['games']['rows'],2)
            self.assertEqual(m['tables']['combine_results']['columns'][2]['missing'],1)
            def get(h):
                raw=(root/'out'/(h+'.json')).read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),h);self.assertLessEqual(len(raw),65536);return json.loads(raw)
            entries=[]
            def walk(h):
                n=get(h)
                if 'children' in n:
                    for c in n['children']:walk(c['sha256'])
                else:entries.extend(n['entries'])
            walk(m['tables']['game_tracking']['root'])
            rows=[]
            for e in entries:
                if e['kind']!='shards':continue
                descriptors=e.get('values') or [d for h in e['pages'] for d in get(h)['shards']]
                selected=[]
                for d in descriptors:
                    compressed=(root/'out'/(d['sha256']+'.gz')).read_bytes();self.assertEqual(hashlib.sha256(compressed).hexdigest(),d['sha256']);self.assertLessEqual(len(compressed),262144)
                    raw=gzip.decompress(compressed);self.assertEqual(hashlib.sha256(raw).hexdigest(),d['decodedSha256']);self.assertLessEqual(len(raw),1048576)
                    a=json.loads(raw);self.assertLessEqual(len(a['rows']),2048)
                    part=a['rows'][d['start']:d['start']+d['count']];self.assertTrue(all(r['nfl_id']==e['selector']['nfl_id'] and r['play_id']==e['selector']['play_id'] for r in part));selected.extend(part)
                self.assertEqual(len(selected),e['rows']);rows.extend(selected)
            self.assertEqual(len(rows),5002)
            self.assertEqual(sorted(int(r['time']) for r in rows if r['play_id']=='1' and r['nfl_id']=='a'),list(range(5000)))
            self.assertEqual(sum(r['play_id']=='unmatched' for r in rows),1)
            self.assertTrue(all(r['dd_season']==r['dd_draft_year'] and r['dd_season_type']=='REG' and r['dd_nfl_position']=='WR' for r in rows))
            self.assertEqual(pin,prepare(source,root/'again',**kwargs)[0])
            self.assertEqual({p.name for p in (root/'out').iterdir()},{p.name for p in (root/'again').iterdir()})

    def test_schema_drift_hash_and_git_output_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,kwargs=self.make(root,drift=True)
            with self.assertRaisesRegex(ValueError,'schema drift'):prepare(source,root/'out',**kwargs)
            with self.assertRaisesRegex(ValueError,'identity mismatch'):prepare(source,root/'out')
            (root/'.git').mkdir()
            with self.assertRaisesRegex(ValueError,'outside Git'):prepare(source,root/'out',**kwargs)

    def test_empty_wr_cohort_retains_schemas_and_empty_lookup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,kwargs=self.make(root)
            empty=root/'empty.zip'
            with zipfile.ZipFile(source) as src,zipfile.ZipFile(empty,'w') as dst:
                for name in src.namelist():
                    dst.writestr(name,'nfl_id,draft_year,nfl_position\nq,2023,QB\n' if name=='players.csv' else src.read(name))
            _,m=prepare(empty,root/'out',expected_sha=hashlib.sha256(empty.read_bytes()).hexdigest(),expected_size=empty.stat().st_size)
            self.assertEqual(m['tables']['game_tracking']['rows'],0)
            self.assertIn('time',[c['name'] for c in m['tables']['game_tracking']['columns']])
            self.assertEqual(json.loads((root/'out'/(m['tables']['game_tracking']['root']+'.json')).read_text())['entries'],[])

    def test_identity_collisions_across_excluded_partitions_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,_=self.make(root)
            for table,row,message in [('players','a,2023,QB\n','player'),('players','a,2025,WR\n','player'),('games','g,2023,PRE\n','game'),('games','g,2025,REG\n','game')]:
                bad=root/('collision-'+message+'.zip')
                with zipfile.ZipFile(source) as src,zipfile.ZipFile(bad,'w') as dst:
                    for name in src.namelist():
                        raw=src.read(name)
                        dst.writestr(name,raw+row.encode() if name==table+'.csv' else raw)
                with self.assertRaisesRegex(ValueError,'duplicate '+message+' identity'):
                    prepare(bad,root/'badout',expected_sha=hashlib.sha256(bad.read_bytes()).hexdigest(),expected_size=bad.stat().st_size)

    def test_multibyte_discovery_pages_split_by_encoded_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'wide.zip'
            game='\u754c'*200;athlete='\u7403'*200
            plays=[str(i)+'\u8def'*197 for i in range(65)]
            with zipfile.ZipFile(source,'w') as z:
                z.writestr('players.csv',f'nfl_id,draft_year,nfl_position\n{athlete},2023,WR\n')
                z.writestr('games.csv',f'game_id,season,season_type\n{game},2023,REG\n')
                z.writestr('combine_results.csv','nfl_id,draft_year\n')
                z.writestr('combine_tracking.csv','nfl_id,draft_year,time\n')
                z.writestr('player_play.csv','game_id,play_id,nfl_id\n'+''.join(f'{game},{p},{athlete}\n' for p in plays))
                for year in (2023,2024):z.writestr(f'game_tracking_{year}.csv','game_id,play_id,nfl_id,time\n')
            _,m=prepare(source,root/'out',expected_sha=hashlib.sha256(source.read_bytes()).hexdigest(),expected_size=source.stat().st_size)
            pages=[]
            for p in (root/'out').glob('*.json'):
                raw=p.read_bytes();self.assertLessEqual(len(raw),65536)
                value=json.loads(raw)
                if value.get('kind')=='page' and value.get('selector')==dict(season='2023',season_type='REG',game_id=game):pages.append(value)
            self.assertGreaterEqual(len(pages),2)
            self.assertEqual(sum(len(p['children']) for p in pages),65)

if __name__=='__main__':unittest.main()
