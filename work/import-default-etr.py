"""Convert owner's CSV into the default season valuation input. Raw CSV stays outside git."""
import csv,json,sys,hashlib,datetime,math
from pathlib import Path
path=Path(sys.argv[1]);received=sys.argv[2] if len(sys.argv)>2 else datetime.date.today().isoformat()
columns={'full':'ETR Full PPR','half':'ETR Half PPR','std':'ETR Std','sfFull':'ETR Superflex Full','sfHalf':'ETR Superflex Half'}
rows=list(csv.DictReader(path.open(encoding='utf-8-sig')));players=[];seen=set()
for r in rows:
 ident=r['id'];assert ident and ident not in seen;seen.add(ident)
 values={k:float(r[c]) for k,c in columns.items()};assert all(math.isfinite(v) and v>=0 for v in values.values())
 players.append({'id':ident,'name':r['Player'],'pos':'DST' if r['Position'] in ['DEF','DST'] else r['Position'],'team':r['Team'],'values':values})
# Converted basis is scaled to a common 12-team comparison pool; source is dated by receipt only.
for k in columns:
 total=sum(p['values'][k] for p in players);assert total>0
 for p in players:p['values'][k]=round(p['values'][k]*2400/total,8)
d={'as_of':received,'source':'Owner-supplied ETR auction CSV, normalized to a $2400 comparison pool per format.','note':'Default season input, not weekly projections. Source publication date absent; as_of is receipt date.','data':{'received_at':received,'published_at':None,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'players':players}}
d.update(tier='labs',graded=False,tier_meaning=json.loads(Path('data/datadawg-dollars-values.json').read_text())['tier_meaning'])
Path('data/datadawg-default.json').write_text(json.dumps(d,separators=(',',':'))+'\n')
print(len(players),'players imported; five normalized format curves')
