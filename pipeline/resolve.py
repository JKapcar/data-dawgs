"""Conservative settlement state machine; anomalies are published, never guessed."""
from __future__ import annotations
import argparse,json
from datetime import datetime, timezone
from pathlib import Path
import requests
from .common import read_json,sha256,stamped,write_json
from .config import load
FINAL=("yes","no","voided","resolution_anomaly")
def settle(raw):
    # Gamma serves outcomePrices as a JSON string of decimal strings: '["0", "1"]'.
    prices=[float(x) for x in json.loads(raw["outcomePrices"])]
    if abs(prices[0]-1)<=.005 and abs(prices[1])<=.005:return "yes",None
    if abs(prices[1]-1)<=.005 and abs(prices[0])<=.005:return "no",None
    if all(abs(x-.5)<=.005 for x in prices):return "voided","refund_split"
    return "resolution_anomaly","unexpected_settlement"
def outcome(m,now=None):
    r=requests.get("https://gamma-api.polymarket.com/markets/"+m["id"],timeout=30)
    if r.status_code==404:return "voided","market_removed",None
    r.raise_for_status(); raw=r.json()
    if not raw.get("closed"):
        # Open before its end date is not news. Open after it is overdue, and checked again daily.
        now=now or datetime.now(timezone.utc); end=datetime.fromisoformat(m["end_date"].replace("Z","+00:00"))
        return ("open" if now<end else "resolution_overdue"),None,raw
    state,reason=settle(raw)
    return state,reason,raw
def resolve(markets,prior,check=outcome):
    # Only a settled row is final; an overdue row is replaced by the next check, never kept as the answer.
    rows=[x for x in prior["resolutions"] if x["outcome"] in FINAL]; seen={x["market_id"] for x in rows}
    for m in markets:
        if m["id"] in seen:continue
        state,reason,raw=check(m)
        if state=="open":continue
        rows.append({"market_id":m["id"],"outcome":state,"reason":reason,"resolved_at":datetime.now(timezone.utc).isoformat(),"source_payload_sha256":sha256(raw) if raw else None,"raw_source_payload":raw})
    return {**prior,"resolutions":rows}
def main():
    p=argparse.ArgumentParser();p.add_argument("cohort");p.add_argument("--dry-run",action="store_true");a=p.parse_args();load();root=Path("data/cohorts")/a.cohort;cohort=read_json(root/"cohort.json");out=root/"resolutions.json";prior=read_json(out) if out.exists() else {"resolutions":[]}
    write_json(out,stamped(resolve(cohort["markets"],prior),dry_run=a.dry_run,source="https://gamma-api.polymarket.com/markets/{id}"))
if __name__=="__main__":main()
