"""Apply the Dawgs item key as a CSS class in every shared banner renderer."""
from pathlib import Path
import glob
ROOT=Path(__file__).resolve().parent.parent
OLD='''      if(key===page) a.classList.add("on");
      if(hot) a.classList.add("hot");'''
NEW='''      if(key===page) a.classList.add("on");
      if(key && key.indexOf("kennel-")===0) a.classList.add(key);
      if(hot) a.classList.add("hot");'''
def main():
 staged={}
 for f in glob.glob(str(ROOT/'*.html')):
  p=Path(f);s=p.read_text(encoding='utf-8')
  if 'const NAV = [' not in s:continue
  if OLD not in s:raise SystemExit(f'{p.name}: renderer anchor drifted')
  staged[p]=s.replace(OLD,NEW,1)
 if len(staged)!=28:raise SystemExit(f'expected 28, got {len(staged)}')
 for p,s in staged.items():p.write_text(s,encoding='utf-8')
 print(f'updated {len(staged)} banner renderers')
if __name__=='__main__':main()
