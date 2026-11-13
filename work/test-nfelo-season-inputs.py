"""Offline regression and fail-closed checks using retained public data, no upstream software."""
import copy
import csv
import importlib.util
import json
import pathlib
import tempfile
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inputs', ROOT / 'tools/nfelo-season-inputs.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
nf = json.loads((ROOT / 'data/nfelo.json').read_text())['data']
i = nf['season_inputs']
parameters = json.loads((ROOT / 'tools/nfelo-season-parameters.json').read_text())
assert (parameters['z'], parameters['qb_weight']) == (i['z'], i['qb_weight']) == (401.62, 1)
ratings = [dict(team=t, season=r['season'], week=r['week'], nfelo_base=r['base'], qb_adj=r['qb_adj'], nfelo=r['base']+r['qb_adj']) for t,r in i['ratings'].items()]
hfa = [dict(season=i['season'], week=g['week'], home_team=g['home'], away_team=g['away'], hfa_adj=g['hfa_elo']/25, location='Neutral' if g['neutral'] else 'Home') for g in i['games'].values()]
forecasts = [dict(game_id=g['id'], nfelo_dif_open=1, nfelo_dif_close=1, nfelo_home_probability_open=g['nfelo']['p_home_open'], nfelo_home_probability_close=g['nfelo']['p_home_close']) for g in nf['games']]
def run(rs, hs, fs):
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        (root/'output_data').mkdir()
        for name,rows in [('output_data/elo_snapshot.csv',rs),('estimated_hfa.csv',hs),('output_data/nfelo_games.csv',fs)]:
            with (root/name).open('w',newline='') as f:
                w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
        with patch.object(m,'git',return_value='fixture'):
            return m.collect(root,root,i['season'])
result=run(ratings,hfa,forecasts)
assert len(result['games'])==272 and len(result['ratings'])==32
assert result['compatibility']['forecasts_checked']==len(forecasts)
assert 'frozen' in result['assumption'] and result['parameters']['owner']=='Data Dawgs'
cases=[]
for field,value in [('qb_adj',''),('nfelo_base','nan'),('nfelo',0),('season',2025)]:
    rs=copy.deepcopy(ratings);rs[0][field]=value;cases.append((rs,hfa,forecasts))
cases.append((ratings+[ratings[0]],hfa,forecasts))
for field,value in [('hfa_adj',''),('home_team','UNKNOWN')]:
    hs=copy.deepcopy(hfa);hs[0][field]=value;cases.append((ratings,hs,forecasts))
cases.append((ratings,hfa[:-1],forecasts))
for field,value in [('nfelo_home_probability_close',''),('nfelo_home_probability_open','inf'),('nfelo_home_probability_close',1.1),('game_id','2026_18_NE_NE')]:
    fs=copy.deepcopy(forecasts);fs[0][field]=value;cases.append((ratings,hfa,fs))
cases.append((ratings,hfa,forecasts+[forecasts[0]]))
for case in cases:
    try: run(*case)
    except (ValueError,KeyError): pass
    else: raise AssertionError('Invalid input accepted')
print(f'PASS: retained parameters, {len(forecasts)} forecasts, 272 contexts; {len(cases)} fail-closed cases')
