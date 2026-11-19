import csv, gzip, itertools, json, tempfile, unittest
from pathlib import Path
from archive import REQUIRED, RECORD, generate, load_source, legal_rows, sha256

def fixture(path,n=8):
    rows=[]
    for i in range(n):
        for role in ['CPT','FLEX']:
            ident=str(100+i*2+(role=='CPT')); name=f'Player {i}'
            rows.append({'Name + ID':f'{name} ({ident})','Name':name,'ID':ident,'Roster Position':role,'Salary':str(10000 if role=='CPT' else 8000),'Game Info':'IND@HOU 11/19/2026 08:15PM ET','TeamAbbrev':'IND' if i<4 else 'HOU'})
    save(path,rows);return rows

def save(path,rows):
    with open(path,'w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=sorted(REQUIRED)); w.writeheader();w.writerows(rows)

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.src=self.root/'in.csv';self.rows=fixture(self.src)
    def tearDown(self):self.temp.cleanup()
    def test_independent_bruteforce_boundary_and_roundtrip(self):
        a,_=load_source(self.src,'IND@HOU')
        # Independent 6-person sets, then captain designation, not generator traversal.
        want=set()
        for people in itertools.combinations(range(len(a)),6):
            for c in people:
                f=tuple(i for i in people if i!=c)
                cost=a[c]['roles']['CPT']['salary']+sum(a[i]['roles']['FLEX']['salary'] for i in f)
                if cost<=50000 and len({a[i]['team'] for i in people})==2:want.add((c,f,cost))
        m=generate(self.src,self.root/'out','IND@HOU','synthetic test fixture')
        got=set()
        for p in m['partitions']:
            path=self.root/'out'/p['file'];self.assertEqual(sha256(path),p['sha256'])
            b=gzip.decompress(path.read_bytes());self.assertEqual(len(b),p['count']*7)
            for *f,cost in RECORD.iter_unpack(b):got.add((p['captain_index'],tuple(f),cost))
        self.assertEqual(got,want); self.assertEqual(len(want),m['total_lineups']);self.assertTrue(want);self.assertTrue(all(x[2]==50000 for x in got))
        m2=generate(self.src,self.root/'out2','IND@HOU','synthetic test fixture')
        self.assertEqual(m['partitions'],m2['partitions'])
    def test_over_cap_and_one_team(self):
        a,_=load_source(self.src,'IND@HOU')
        for x in a:x['roles']['CPT']['salary']+=1
        self.assertFalse(list(legal_rows(a,0)))
        for x in a:x['roles']['CPT']['salary']-=1;x['team']='IND'
        self.assertFalse(list(legal_rows(a,0)))
    def test_reject_bad_inputs(self):
        mutations=[lambda r:r.append(dict(r[0])),lambda r:r.pop(),lambda r:r[0].update({'Roster Position':'CPT/FLEX'}),lambda r:r[0].update({'Game Info':'CLE@PIT'}),lambda r:r[0].update({'Salary':'8000.5'}),lambda r:r[0].update({'Name + ID':'wrong'}),lambda r:r[0].update({'TeamAbbrev':'CLE'}),lambda r:r[0].update({'ID':'bad'}),lambda r:r[0].update({'Salary':'0'}),lambda r:r[0].update({'Game Info':'IND@HOU different date'})]
        for change in mutations:
            with self.subTest(change=change):
                r=[dict(x) for x in self.rows];change(r);save(self.src,r)
                with self.assertRaises(ValueError):load_source(self.src,'IND@HOU')
    def test_missing_header_and_duplicate_headers(self):
        self.src.write_text('Name,ID\nA,1\n')
        with self.assertRaises(ValueError):load_source(self.src,'IND@HOU')
        self.src.write_text('Name,Name\nA,A\n')
        with self.assertRaises(ValueError):load_source(self.src,'IND@HOU')
    def test_same_identity_duplicate_role(self):
        r=[dict(x) for x in self.rows]
        extra=dict(r[0]);extra['ID']='9999';extra['Name + ID']=extra['Name']+' (9999)';r.append(extra);save(self.src,r)
        with self.assertRaises(ValueError):load_source(self.src,'IND@HOU')
    def test_sample_requires_explicit_mode(self):
        r=[dict(x) for x in self.rows]
        for i,x in enumerate(r):
            x['ID']=f"SAMPLE_{i//2:03d}_{x['Roster Position']}"
            x['Name + ID']=x['Name']+' ('+x['ID']+')'
        save(self.src,r)
        with self.assertRaises(ValueError):load_source(self.src,'IND@HOU')
        m=generate(self.src,self.root/'sample','IND@HOU','synthetic',sample=True)
        self.assertFalse(m['source']['official']);self.assertTrue(m['source']['sample_only'])
    def test_too_many_athletes(self):
        fixture(self.src,257)
        with self.assertRaises(ValueError):load_source(self.src,'IND@HOU')
    def test_no_overwrite(self):
        with self.assertRaises(ValueError):generate(self.src,self.root,'IND@HOU','test')

if __name__=='__main__':unittest.main()
