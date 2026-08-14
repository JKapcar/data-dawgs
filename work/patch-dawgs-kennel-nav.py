"""Replace the Dawgs tier explainer with the DawgHouse's actual visible work."""
from pathlib import Path
import glob
ROOT=Path(__file__).resolve().parent.parent
OLD='''    {label:"Dawgs", href:"index.html#tiers", items:[
      ["index.html#tiers","How the tiers work","tiers"],
      ["dawgs.html","Rollo Â· OG Data Dawg","dawgs"],
    ]},'''
NEW='''    {label:"Dawgs", href:"dawgs.html", key:"dawgs", items:[
      ["dawgs.html","🐾 Rollo · OG Data Dawg","dawgs"],
      ["#","The DawgHouse","nav-section"],
      ["dawghouse.html#scoreboard","📊 Model Scoreboard","kennel-scoreboard"],
      ["dawghouse.html#inventory","🧪 nfeloml · EP / EPA / WP","kennel-nfeloml"],
      ["dawghouse.html#inventory","🏈 QB Context","kennel-qb"],
      ["dawghouse.html#inventory","⚖️ Weighted EPA","kennel-wepa"],
      ["dawghouse.html#inventory","📈 SRS / Win-Total Ratings","kennel-srs"],
      ["dawghouse.html#inventory","🏟️ Home-Field Tracker","kennel-hfa"],
      ["dawghouse.html#inventory","🛡️ Unit Ratings","kennel-units"],
      ["dawghouse.html#inventory","🧾 Immutable Receipts","kennel-receipts"],
      ["dawghouse.html#inventory","🌦️ Regime Analysis","kennel-regimes"],
    ]},'''
CSS='''.grpmenu a[class*="kennel-"]{font-family:ui-rounded,"Trebuchet MS",system-ui,sans-serif;font-weight:800;letter-spacing:.01em}.grpmenu a.kennel-scoreboard{color:#8ed6ff}.grpmenu a.kennel-nfeloml{color:#c9b3ff}.grpmenu a.kennel-qb{color:#ffc06a}.grpmenu a.kennel-wepa{color:#7ce7b0}.grpmenu a.kennel-srs{color:#ff9bb4}.grpmenu a.kennel-hfa{color:#ffe082}.grpmenu a.kennel-units{color:#8ee8e3}.grpmenu a.kennel-receipts{color:#f2c4ff}.grpmenu a.kennel-regimes{color:#a8d88c}'''
def main():
 staged={}
 for f in glob.glob(str(ROOT/'*.html')):
  p=Path(f); s=p.read_text(encoding='utf-8')
  if 'const NAV = [' not in s: continue
  if OLD not in s: raise SystemExit(f'{p.name}: Dawgs anchor drifted')
  if CSS in s: raise SystemExit(f'{p.name}: already patched')
  staged[p]=s.replace(OLD,NEW,1).replace('</style>',CSS+'</style>',1)
 if len(staged)!=28: raise SystemExit(f'expected 28 banners, got {len(staged)}')
 for p,s in staged.items():p.write_text(s,encoding='utf-8')
 print(f'updated {len(staged)} Dawgs menus')
if __name__=='__main__':main()
