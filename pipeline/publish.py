"""Publish an auditable, provisional surface without inventing receipts schema."""
from __future__ import annotations
import argparse, subprocess
from pathlib import Path
from .common import read_json,stamped,write_json
from .config import load
def main():
 p=argparse.ArgumentParser();p.add_argument("cohort");p.add_argument("--dry-run",action="store_true");a=p.parse_args();_,prereg=load();root=Path("data/cohorts")/a.cohort;out=Path("docs/data");out.mkdir(parents=True,exist_ok=True);forecast=read_json(root/"forecasts.json");grades=read_json(root/"grades.json") if (root/"grades.json").exists() else {"aggregates":[]};res=read_json(root/"resolutions.json") if (root/"resolutions.json").exists() else {"resolutions":[]};sha=subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip();base={"pipeline_version":sha,"preregistration_sha256":prereg}
 write_json(out/"leaderboard.json",stamped(base|{"aggregates":grades["aggregates"],"market_control":"synthetic control uses snapshot probability"},dry_run=a.dry_run));write_json(out/"questions.json",stamped(base|{"cohort_id":a.cohort,"cells":forecast["cells"],"resolutions":res["resolutions"]},dry_run=a.dry_run));write_json(out/"status.json",stamped(base|{"cohort_id":a.cohort,"states":res["resolutions"]},dry_run=a.dry_run));write_json(out/"receipts.provisional.json",stamped(base|{"cells":forecast["cells"],"status":"provisional; receipts schema needed"},dry_run=a.dry_run))
if __name__=="__main__":main()
