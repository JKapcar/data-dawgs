"""Grade per date, then average dates per question, then questions: do not collapse this."""
from __future__ import annotations
from collections import defaultdict
from .common import read_json, stamped, write_json

def grade_cells(cells, outcomes, snapshots):
    dated=defaultdict(list)
    snap={(x["market_id"], x["as_of_date"]):x["market_prob"] for x in snapshots}
    for c in cells:
        if c["status"] != "ok" or outcomes.get(c["market_id"]) not in (0,1): continue
        y=outcomes[c["market_id"]]; market=snap[(c["market_id"],c["as_of_date"])]
        key=(c["model_requested"],c["arm"],c["division"],c["market_id"],c["as_of_date"])
        dated[key].append((c["probability"]-y)**2 - (market-y)**2)
    per_question=defaultdict(list)
    for (model,arm,div,q,date), vals in dated.items(): per_question[(model,arm,div,q)].append(sum(vals)/len(vals))
    groups=defaultdict(list)
    for (model,arm,div,q), vals in per_question.items(): groups[(model,arm,div)].append(sum(vals)/len(vals))
    return [{"model":k[0],"arm":k[1],"division":k[2],"n":len(v),"mean_brier_vs_market":sum(v)/len(v)} for k,v in sorted(groups.items())]

def main():
    import argparse; p=argparse.ArgumentParser(); p.add_argument("cohort"); p.add_argument("--dry-run",action="store_true");a=p.parse_args()
    root=f"data/cohorts/{a.cohort}"; forecasts=read_json(root+"/forecasts.json"); resolutions=read_json(root+"/resolutions.json")
    outcomes={r["market_id"]:1 if r["outcome"]=="yes" else 0 for r in resolutions.get("resolutions",[]) if r["outcome"] in ("yes","no")}
    snapshots=[]
    from pathlib import Path
    for f in Path(root,"snapshots").glob("*.json"): snapshots.extend(read_json(f).get("snapshots",[]))
    write_json(root+"/grades.json", stamped({"aggregates":grade_cells(forecasts.get("cells",[]),outcomes,snapshots)},dry_run=a.dry_run))
if __name__ == "__main__": main()
