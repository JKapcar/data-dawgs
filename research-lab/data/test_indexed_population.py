from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import contextlib
import io
import json
from development import persist
from full_development import prepare as prepare_v2
from indexed_development import prepare as prepare_v3
import verify_indexed_population as proof
import test_indexed_development as fixtures
from verify_indexed_population import sorted_fingerprints

class PopulationProofTests(unittest.TestCase):
    def test_end_to_end_population_and_hash_valid_missing_occurrence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,kwargs=fixtures.IndexedDevelopmentTests().make(root)
            old_pin,_=prepare_v2(source,root/'old',**kwargs)
            new_pin,new=prepare_v3(source,root/'new',**kwargs)
            with patch.object(proof,'SOURCE_SHA',kwargs['expected_sha']),contextlib.redirect_stdout(io.StringIO()):
                result=proof.verify(root/'old',old_pin,root/'new',new_pin,root/'proof.json')
                self.assertEqual(result['tables']['game_tracking']['rows'],5006)
                self.assertEqual(result['tables']['game_tracking']['unmatchedTrackingRows'],1)
                self.assertGreater(result['tables']['game_tracking']['crossDraftYearRows'],0)
                node=json.loads((root/'new'/(new['tables']['game_tracking']['root']+'.json')).read_text())
                entry=max((e for e in node['entries'] if e['kind']=='shards'),key=lambda e:e['rows'])
                entry['values'][0]['count']-=1;entry['rows']-=1
                new['tables']['game_tracking']['root']=persist(root/'new',node)
                new['tables']['game_tracking']['rows']-=1
                altered=persist(root/'new',new)
                with self.assertRaisesRegex(ValueError,'identity or multiplicity changed'):
                    proof.verify(root/'old',old_pin,root/'new',altered,root/'bad-proof.json')

    def test_order_independent_identity_preserves_multiplicity_and_original_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)
            rows=[{'id':'a','value':None},{'id':'a','value':None},{'id':'b','value':'1'}]
            count,a=sorted_fingerprints(iter(rows),['id','value'],out,'a')
            count2,b=sorted_fingerprints(iter([{**r,'dd_extra':'derived'} for r in reversed(rows)]),['id','value'],out,'b')
            self.assertEqual(count,count2);self.assertEqual(list(a),list(b))
            _,missing=sorted_fingerprints(iter(rows[1:]),['id','value'],out,'missing')
            _,whole=sorted_fingerprints(iter(rows),['id','value'],out,'whole')
            self.assertNotEqual(list(missing),list(whole))
            with self.assertRaisesRegex(ValueError,'column missing'):
                sorted_fingerprints(iter([{'id':'a'}]),['id','value'],out,'bad')

if __name__=='__main__':unittest.main()
