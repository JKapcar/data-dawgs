import hashlib, tempfile, unittest
from datetime import datetime, timezone
from unittest import mock
from pathlib import Path
from pipeline.common import canonical_json, sha256, write_json
from pipeline.draw import ordered, select
from pipeline.grade import grade_cells
from pipeline.resolve import outcome, resolve, settle

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
 def test_settle_reads_gamma_string_prices(self):
  # Gamma's outcomePrices is a JSON string of decimal strings, not numbers.
  self.assertEqual(settle({"outcomePrices":'["1", "0"]'}),("yes",None))
  self.assertEqual(settle({"outcomePrices":'["0", "1"]'}),("no",None))
  self.assertEqual(settle({"outcomePrices":'["0.5", "0.5"]'}),("voided","refund_split"))
  self.assertEqual(settle({"outcomePrices":'["0.7", "0.3"]'}),("resolution_anomaly","unexpected_settlement"))
 def test_open_is_not_recorded_and_overdue_is_checked_again(self):
  markets=[{"id":"a"},{"id":"b"},{"id":"c"}]
  states={"a":("open",None,{}),"b":("resolution_overdue",None,{"closed":False}),"c":("yes",None,{"closed":True})}
  first=resolve(markets,{"resolutions":[]},check=lambda m:states[m["id"]])
  self.assertEqual([(r["market_id"],r["outcome"]) for r in first["resolutions"]],[("b","resolution_overdue"),("c","yes")])
  states["b"]=("no",None,{"closed":True}); calls=[]
  second=resolve(markets,first,check=lambda m:calls.append(m["id"]) or states[m["id"]])
  self.assertEqual(calls,["a","b"])  # c is final and never re-fetched
  self.assertEqual(sorted((r["market_id"],r["outcome"]) for r in second["resolutions"]),[("b","no"),("c","yes")])
 def test_unclosed_market_is_open_before_its_end_date_and_overdue_after(self):
  res=mock.Mock(status_code=200); res.json.return_value={"closed":False,"outcomePrices":'["0.4", "0.6"]'}
  m={"id":"7","end_date":"2026-11-03T12:00:00Z"}
  with mock.patch("pipeline.resolve.requests.get",return_value=res):
   self.assertEqual(outcome(m,now=datetime(2026,11,1,tzinfo=timezone.utc))[0],"open")
   self.assertEqual(outcome(m,now=datetime(2026,11,4,tzinfo=timezone.utc))[0],"resolution_overdue")
if __name__=="__main__":unittest.main()
