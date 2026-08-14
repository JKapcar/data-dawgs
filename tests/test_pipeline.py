import hashlib, tempfile, unittest
from pathlib import Path
from pipeline.common import canonical_json, sha256, write_json
from pipeline.draw import ordered, select
from pipeline.grade import grade_cells

class PipelineTests(unittest.TestCase):
 def test_t1_deterministic_draw(self):
  pool=[{"id":str(i)} for i in (9,2,17,4)]; r="ab"*32
  expected=sorted(pool,key=lambda m:hashlib.sha256(f"{r}:{m['id']}".encode()).hexdigest())[:2]
  self.assertEqual(select(pool,r,2),expected)
 def test_t6_t9_grade_by_date_then_question(self):
  cells=[{"market_id":"a","model_requested":"m","arm":"cold","division":"blinded","as_of_date":"2026-01-01","status":"ok","probability":.4},{"market_id":"a","model_requested":"m","arm":"cold","division":"blinded","as_of_date":"2026-01-02","status":"ok","probability":.6}]
  snapshots=[{"market_id":"a","as_of_date":"2026-01-01","market_prob":.5},{"market_id":"a","as_of_date":"2026-01-02","market_prob":.5}]
  got=grade_cells(cells,{"a":1},snapshots);self.assertEqual(got[0]["n"],1);self.assertAlmostEqual(got[0]["mean_brier_vs_market"],((.16-.25)+(.36-.25))/2)
 def test_t8_secret_writer(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(ValueError):write_json(Path(d)/"x.json",{"secret":"abc"},api_key="abc")
 def test_canonical_hash(self):self.assertEqual(sha256({"b":1,"a":2}),hashlib.sha256(b'{"a":2,"b":1}').hexdigest())
if __name__=="__main__":unittest.main()
