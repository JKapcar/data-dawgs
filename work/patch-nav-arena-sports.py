"""Sitewide banner restructure: one exact NAV replacement per flattened page."""
from pathlib import Path
import re
import glob

ROOT = Path(__file__).resolve().parent.parent
OLD = '''    {label:"Receipts", short:"Rcpt", href:"receipts.html", key:"receipts", items:[
      ["receipts.html#models","Model scoreboard","receipts-models"],
      ["receipts.html","Pre-registered calls","receipts"],
      ["receipts.html#scoreboard","Grading","receipts-scoreboard"],
      ["receipts.html#provenance","Provenance","pound-provenance"],
      ["dawghouse.html","The DawgHouse","pound"],
    ]},
    /* Arena = the surfaces where a person competes against other people. */
    {label:"Arena", href:"arena.html", key:"arena", items:[
      ["arena.html","All the games","arena"],
      ["bozo.html","Bozo","bozo"],
      ["challenge.html","Forecast Challenge","challenge"],
      ["dashboard.html","Fantasy Draft Dashboard","dashboard","hot"],
      ["dfs.html","DFS Solver","dfs"],
      ["guillotine.html","Guillotine Companion","guillotine"],
      ["survivor.html","Survivor","survivor"],
      ["teamdraft.html","NFL Team Draft","teamdraft"],
    ]},'''
NEW = '''    /* Arena is split so games can have a little casino character without making tools noisy. */
    {label:"Arena", href:"arena.html", key:"arena", items:[
      ["arena.html","Arena home","arena"],
      ["#","Games","nav-section"],
      ["dashboard.html","Fantasy Draft Dashboard","dashboard","hot"],
      ["bozo.html","Bozo","bozo"],
      ["challenge.html","Forecast Challenge","challenge"],
      ["teamdraft.html","NFL Team Draft","teamdraft"],
      ["#","Tools","nav-section"],
      ["dfs.html","DFS Solver","dfs"],
      ["guillotine.html","Guillotine Companion","guillotine"],
      ["survivor.html","Survivor","survivor"],
    ]},'''
OLD_SPORTS = '''    {label:"NFL", href:"nfl.html", key:"nfl", items:[
      ["nfl.html","The NFL work","nfl"],
      ["stats.html","NFL EPA Stats","stats"],
      ["nfelo.html","nfelo Power Ratings","nfelo"],
      ["calculators.html","Calculators Â· NFL","calculators"],
    ]},
    {label:"CFB", href:"cfb.html", key:"cfb", items:[
      ["cfb.html","College Football Lab","cfb"],
      ["cfb.html#matchup","Calculators Â· CFB matchup","cfb-matchup"],
      ["cfb.html#roadmap","Build roadmap","cfb-roadmap"],
    ]},
    {label:"Data", href:"data.html", key:"data", items:[
      ["data.html","The Library","data"],
      ["master.html","Master Data","master"],
      ["strategy.html","2026 Strategy","strategy"],
    ]},'''
NEW_SPORTS = '''    {label:"Sports", href:"nfl.html", key:"sports", items:[
      ["#","NFL","nav-section"],
      ["nfl.html","NFL hub","nfl"],
      ["stats.html","NFL EPA Stats","stats"],
      ["nfelo.html","nfelo Power Ratings","nfelo"],
      ["calculators.html","Calculators · NFL","calculators"],
      ["#","CFB","nav-section"],
      ["cfb.html","College Football Lab","cfb"],
      ["cfb.html#matchup","Calculators · CFB matchup","cfb-matchup"],
      ["cfb.html#roadmap","Build roadmap","cfb-roadmap"],
    ]},
    {label:"Data", href:"data.html", key:"data", items:[
      ["data.html","The Library","data"],
      ["receipts.html","Receipts","receipts"],
      ["master.html","Master Data","master"],
      ["strategy.html","2026 Strategy","strategy"],
    ]},'''
def main():
  files=[Path(p) for p in glob.glob(str(ROOT/'*.html'))]
  staged={}
  for p in files:
    s=p.read_text(encoding='utf-8')
    if 'const NAV = [' not in s: continue
    s,n1=re.subn(r'    \{label:"Receipts"[\s\S]*?    \]\},\n    /\* Two sections', NEW+'\n    /* Two sections', s, count=1)
    s,n2=re.subn(r'    \{label:"NFL"[\s\S]*?    \{label:"Data"[\s\S]*?    \]\},', NEW_SPORTS, s, count=1)
    if n1 != 1 or n2 != 1: raise SystemExit(f'{p.name}: NAV anchors drifted')
    staged[p]=s
  for p,s in staged.items(): p.write_text(s,encoding='utf-8')
  print(f'updated {len(staged)} nav blocks')
if __name__=='__main__': main()
