"""Build an eligible-market pool from Gamma. Never runs before ratification."""
from __future__ import annotations
import argparse, json
from datetime import datetime, timezone, timedelta
import requests
from .common import stamped, write_json
from .config import load

GAMMA="https://gamma-api.polymarket.com"
def main():
    p=argparse.ArgumentParser();p.add_argument("cohort");p.add_argument("--dry-run",action="store_true");a=p.parse_args();cfg,_=load()
    response=requests.get(GAMMA+"/markets/keyset?closed=false&limit=500",timeout=30);response.raise_for_status(); rows=response.json()
    now=datetime.now(timezone.utc); low,high=cfg["price_band"]; min_days,max_days=cfg["end_date_window_days"]; kept=[]
    for m in rows if isinstance(rows,list) else rows.get("data",[]):
        try:
            outcomes=json.loads(m["outcomes"]); prices=json.loads(m["outcomePrices"]); end=datetime.fromisoformat(m["endDate"].replace("Z","+00:00"))
            if not(outcomes==["Yes","No"] and m.get("active") and not m.get("closed") and not m.get("archived") and not m.get("restricted") and m.get("enableOrderBook") and float(m["volumeNum"])>=cfg["volume_floor_usd"] and now+timedelta(days=min_days)<=end<=now+timedelta(days=max_days) and low<=float(prices[0])<=high):continue
            tokens=json.loads(m["clobTokenIds"]); kept.append({"id":str(m["id"]),"question":m["question"],"slug":m.get("slug"),"conditionId":m.get("conditionId"),"yes_token_id":tokens[0],"no_token_id":tokens[1],"end_date":m["endDate"],"volume_num":float(m["volumeNum"]),"price_at_pool":float(prices[0])})
        except (KeyError,ValueError,TypeError,json.JSONDecodeError): continue
    kept.sort(key=lambda x:int(x["id"])); write_json(f"data/cohorts/{a.cohort}/pool.json",stamped({"filter_version":"v2","markets":kept},dry_run=a.dry_run))
if __name__=="__main__":main()
