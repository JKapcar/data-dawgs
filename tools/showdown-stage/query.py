#!/usr/bin/env python3
"""Bounded local archive query. No lineup upload/entry, network or external writes."""
import argparse,gzip,json,math,time
from pathlib import Path
from archive import FORMAT,RECORD,sha256

def number(x,cap):
    return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) and 0<=x<=cap

def query(root,captain,team_count,min_salary=0,max_salary=50000,max_ownership=None,min_ceiling=None,sort='ceiling',limit=20):
    started=time.perf_counter();root=Path(root)
    if not isinstance(limit,int) or not 1<=limit<=100:raise ValueError('limit must be 1..100')
    if not 1<=team_count<=5:raise ValueError('team-count must be 1..5 for first manifest team')
    if not 0<=min_salary<=max_salary<=50000:raise ValueError('invalid salary range')
    if max_ownership is not None and not number(max_ownership,6):raise ValueError('ownership cap must be fractional sum 0..6')
    if min_ceiling is not None and not number(min_ceiling,6500):raise ValueError('invalid ceiling minimum')
    if sort not in ('ceiling','ownership','salary'):raise ValueError('invalid sort')
    if (root/'INCOMPLETE').exists():raise ValueError('incomplete archive')
    mh=sha256(root/'manifest.json');modelhash=sha256(root/'metrics.json')
    m=json.loads((root/'manifest.json').read_text());model=json.loads((root/'metrics.json').read_text())
    if m['format']!=FORMAT or m['record']['struct']!='<5BH' or m['record']['bytes']!=7:raise ValueError('unsupported archive')
    if model['format']!='showdown-stage-metrics/1' or model['manifest_sha256']!=mh:raise ValueError('metrics/archive binding mismatch')
    if model['units']!={'ceiling':'DK fantasy points','ownership':'fraction'}:raise ValueError('unsupported metric units')
    a=m['flex'];metrics={}
    for x in model['players']:
        i=x['index']
        if not isinstance(i,int) or i<0 or i>=len(a) or i in metrics or x['identity']!=a[i]['identity']:raise ValueError('unknown/duplicate metrics identity')
        v={}
        for role in ('CPT','FLEX'):
            r=x[role]
            if r['role_id']!=a[i]['roles'][role]['id']:raise ValueError('metrics role mismatch')
            v[role]={k:r.get(k) if number(r.get(k),cap) else None for k,cap in [('ceiling',1500 if role=='CPT' else 1000),('ownership',1)]}
        if v['FLEX']['ceiling'] is None or v['CPT']['ceiling'] is None or abs(v['CPT']['ceiling']-1.5*v['FLEX']['ceiling'])>1e-8:v['CPT']['ceiling']=None
        if all(v[r]['ownership'] is not None for r in v) and sum(v[r]['ownership'] for r in v)>1+1e-8:
            for r in v:v[r]['ownership']=None
        metrics[i]=v
    if len(metrics)!=len(a):raise ValueError('incomplete metric dictionary')
    choices=[i for i,p in enumerate(a) if captain in (p['name'],p['identity'],p['roles']['CPT']['id'])]
    if len(choices)!=1:raise ValueError('captain must match exactly one name, identity or CPT ID')
    c=choices[0];parts=[p for p in m['partitions'] if p['captain_index']==c]
    if len(parts)!=1:raise ValueError('ambiguous partition')
    p=parts[0];path=root/p['file']
    if path.resolve().parent!=root.resolve() or sha256(path)!=p['sha256']:raise ValueError('partition path/hash mismatch')
    if p['captain_id']!=a[c]['roles']['CPT']['id']:raise ValueError('partition captain mismatch')
    count=0;scanned=0;best=[];previous=None
    def key(row):
        v=row['summed_ceiling' if sort=='ceiling' else 'summed_ownership' if sort=='ownership' else 'salary']
        return (v is None,0 if v is None else v if sort=='ownership' else -v,tuple(row['flex_indices']))
    with gzip.open(path,'rb') as f:
        while True:
            data=f.read(7*16384)
            if not data:break
            if len(data)%7:raise ValueError('truncated record')
            for *indices,salary in RECORD.iter_unpack(data):
                scanned+=1;idx=tuple(indices)
                if len(set(idx))!=5 or idx!=tuple(sorted(idx)) or max(idx)>=len(a) or c in idx or (previous is not None and idx<=previous):raise ValueError('invalid record indices/order')
                previous=idx
                if salary!=a[c]['roles']['CPT']['salary']+sum(a[i]['roles']['FLEX']['salary'] for i in idx) or salary>50000:raise ValueError('invalid record salary')
                teams=[a[i]['team'] for i in (c,)+idx]
                if set(teams)!=set(m['game']['teams']):raise ValueError('invalid record teams')
                if teams.count(m['game']['teams'][0])!=team_count or not min_salary<=salary<=max_salary:continue
                roles=[metrics[c]['CPT']]+[metrics[i]['FLEX'] for i in idx]
                sums={k:sum(r[k] for r in roles) if all(r[k] is not None for r in roles) else None for k in ('ceiling','ownership')}
                if max_ownership is not None and (sums['ownership'] is None or sums['ownership']>max_ownership):continue
                if min_ceiling is not None and (sums['ceiling'] is None or sums['ceiling']<min_ceiling):continue
                count+=1
                row={'captain_index':c,'flex_indices':list(idx),'salary':salary,'summed_ceiling':sums['ceiling'],'summed_ownership':sums['ownership']}
                if len(best)<limit or key(row)<key(best[-1]):best.append(row);best.sort(key=key);best=best[:limit]
    if scanned!=p['count']:raise ValueError('partition count mismatch')
    for r in best:
        r['captain']={'name':a[c]['name'],'role_id':a[c]['roles']['CPT']['id']}
        r['flex']=[{'name':a[i]['name'],'role_id':a[i]['roles']['FLEX']['id']} for i in r['flex_indices']]
    return {'manifest_sha256':mh,'model_sha256':modelhash,'partition_sha256':p['sha256'],'source':model['source'],'query':{'captain':captain,'team_split':dict(zip(m['game']['teams'],[team_count,6-team_count])),'min_salary':min_salary,'max_salary':max_salary,'max_ownership_fraction':max_ownership,'min_ceiling':min_ceiling,'sort':sort,'limit':limit},'metric_labels':{'summed_ceiling':'Summed ceiling (not simulated)','summed_ownership':'Summed ownership (fraction, not duplication probability)'},'scanned':scanned,'matching_count':count,'returned':len(best),'elapsed_seconds':round(time.perf_counter()-started,4),'lineups':best}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive');p.add_argument('--captain',required=True);p.add_argument('--team-count',type=int,required=True,help='Players from FIRST manifest team, including captain');p.add_argument('--min-salary',type=int,default=0);p.add_argument('--max-salary',type=int,default=50000);p.add_argument('--max-ownership',type=float,help='Sum of role ownership fractions, e.g. 1.5 means150%%');p.add_argument('--min-ceiling',type=float);p.add_argument('--sort',choices=['ceiling','ownership','salary'],default='ceiling');p.add_argument('--limit',type=int,default=20)
    x=p.parse_args()
    try:r=query(x.archive,x.captain,x.team_count,x.min_salary,x.max_salary,x.max_ownership,x.min_ceiling,x.sort,x.limit)
    except (ValueError,OSError,KeyError,TypeError) as e:p.exit(2,'ERROR: '+str(e)+'\n')
    print(json.dumps(r,allow_nan=False))
if __name__=='__main__':main()
