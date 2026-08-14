"""Render NAV `nav-section` rows as headings, not links, on every banner."""
from pathlib import Path
import glob
ROOT=Path(__file__).resolve().parent.parent
OLD='''    entry.items.forEach(([href,label,key,hot,sep])=>{
      const a = document.createElement("a");
      a.href = href; a.textContent = label;'''
NEW='''    entry.items.forEach(([href,label,key,hot,sep])=>{
      if(key==="nav-section"){
        const h=document.createElement("div"); h.className="nav-section"; h.textContent=label;
        menu.appendChild(h); return;
      }
      const a = document.createElement("a");
      a.href = href; a.textContent = label;'''
CSS='''.nav-section{padding:9px 13px 3px;color:var(--accent);font:800 10px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}.nav-section:not(:first-child){margin-top:5px;border-top:1px solid var(--grid);padding-top:10px}'''
def main():
  staged={}
  for f in glob.glob(str(ROOT/'*.html')):
    p=Path(f); s=p.read_text(encoding='utf-8')
    if OLD not in s: continue
    if CSS in s: raise SystemExit(f'{p.name}: already styled')
    if s.count('</style>')<1: raise SystemExit(f'{p.name}: no style anchor')
    staged[p]=s.replace(OLD,NEW,1).replace('</style>',CSS+'</style>',1)
  if len(staged)!=28: raise SystemExit(f'expected 28 shared-nav pages, found {len(staged)}')
  for p,s in staged.items():p.write_text(s,encoding='utf-8')
  print(f'updated {len(staged)} renderers')
if __name__=='__main__':main()
