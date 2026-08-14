"""Append-only snapshots and never-overwrite forecast cells."""
from __future__ import annotations
import argparse, json, os, time
from datetime import datetime, timezone
from pathlib import Path
import requests
from .common import read_json, sha256, stamped, write_json
from .config import load

def strip_fences(s): return s.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
def parse(raw):
    try:
        value=json.loads(strip_fences(raw)); p=value["probability"]
        if isinstance(p,bool) or not isinstance(p,(int,float)) or not 0<=p<=1: raise ValueError
        return "ok",float(p),value.get("reasoning","")
    except Exception:return "format_failure",None,None
def main():
    p=argparse.ArgumentParser();p.add_argument("cohort");p.add_argument("--dry-run",action="store_true");a=p.parse_args();cfg,_=load(); key=os.environ.get("OPENROUTER_API_KEY")
    if not key: raise RuntimeError("OPENROUTER_API_KEY is required for collect")
    root=Path("data/cohorts")/a.cohort; cohort=read_json(root/"cohort.json"); date=datetime.now(timezone.utc).date().isoformat(); snap=root/"snapshots"/(date+".json")
    if not snap.exists():
        rows=[]
        for m in cohort["markets"]:
            r=requests.get("https://clob.polymarket.com/midpoint",params={"token_id":m["yes_token_id"]},timeout=30);r.raise_for_status();rows.append({"market_id":m["id"],"as_of_date":date,"market_prob":float(r.json()["mid"]),"market_prob_source":"clob_midpoint","fetched_at":datetime.now(timezone.utc).isoformat()})
        write_json(snap,stamped({"snapshots":rows},dry_run=a.dry_run),api_key=key)
    forecast=root/"forecasts.json"; prior=read_json(forecast) if forecast.exists() else {"cells":[]}; done={c["key"] for c in prior["cells"] if c["status"] in ("ok","format_failure")}
    for m in cohort["markets"]:
      for model in cfg["models"]:
       for arm in cfg["arms"]:
        for division in cfg["divisions"]:
         cellkey="|".join((m["id"],model,arm,division,date))
         if cellkey in done: continue
         system=None if arm=="cold" else (Path(__file__).parent/"prompts"/(arm+".txt")).read_text(encoding="utf-8")
         user=f"Question: {m['question']}\nResolution deadline: {m['end_date']}\nToday's date: {date}\nRespond with ONLY a JSON object: {{\"probability\": <number between 0 and 1 that the answer is YES>, \"reasoning\": \"<your reasoning>\"}}"
         payload={"model":model,"temperature":0,"max_tokens":1600,"messages":([{"role":"system","content":system}] if system is not None else [])+[{"role":"user","content":user}]}
         raw=""; status="api_error"; probability=reasoning=None
         for delay in (0,2,8,32):
            if delay:time.sleep(delay)
            try:
                res=requests.post("https://openrouter.ai/api/v1/chat/completions",headers={"Authorization":"Bearer "+key},json=payload,timeout=90);res.raise_for_status(); data=res.json();raw=data["choices"][0]["message"]["content"];status,probability,reasoning=parse(raw);break
            except requests.RequestException: pass
         prior["cells"].append({"key":cellkey,"market_id":m["id"],"model_requested":model,"model_echoed":data.get("model",model) if status!="api_error" else None,"arm":arm,"division":division,"as_of_date":date,"status":status,"probability":probability,"reasoning":reasoning,"raw_response":raw,"tool_trace":None,"request_sha256":sha256(payload),"response_sha256":sha256(raw.encode()),"prompt_version":sha256(system.encode()) if system is not None else None,"response_format_mode":"prompt_only","tokens_in":None,"tokens_out":None,"fetched_at":datetime.now(timezone.utc).isoformat()})
    write_json(forecast,stamped(prior,dry_run=a.dry_run),api_key=key)
if __name__=="__main__":main()
