"""Conservative settlement state machine; anomalies are published, never guessed."""
from __future__ import annotations
import argparse,json
from datetime import datetime, timezone
from pathlib import Path
import requests
from .common import read_json,sha256,stamped,write_json
from .config import load
def outcome(m):
    r=requests.get("https://gamma-api.polymarket.com/markets/"+m["id"],timeout=30)
    if r.status_code==404:return "voided","market_removed",None
    r.raise_for_status(); raw=r.json()
    if not raw.get("closed"):return "resolution_overdue",None,raw
    prices=json.loads(raw["outcomePrices"])
    if abs(prices[0]-1)<=.005 and abs(prices[1])<=.005:return "yes",None,raw
    if abs(prices[1]-1)<=.005 and abs(prices[0])<=.005:return "no",None,raw
    if all(abs(x-.5)<=.005 for x in prices):return "voided","refund_split",raw
    return "resolution_anomaly","unexpected_settlement",raw
def main():
    p=argparse.ArgumentParser();p.add_argument("cohort");p.add_argument("--dry-run",action="store_true");a=p.parse_args();load();root=Path("data/cohorts")/a.cohort;cohort=read_json(root/"cohort.json");out=root/"resolutions.json";prior=read_json(out) if out.exists() else {"resolutions":[]}; seen={x["market_id"] for x in prior["resolutions"]}
    for m in cohort["markets"]:
        if m["id"] in seen:continue
        state,reason,raw=outcome(m);prior["resolutions"].append({"market_id":m["id"],"outcome":state,"reason":reason,"resolved_at":datetime.now(timezone.utc).isoformat(),"source_payload_sha256":sha256(raw) if raw else None,"raw_source_payload":raw})
    write_json(out,stamped(prior,dry_run=a.dry_run))
if __name__=="__main__":main()
