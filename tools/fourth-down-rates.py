#!/usr/bin/env python3
"""Dated comparable fourth-down/FG counts; reuse frozen historical seasons daily."""
import argparse
from collections import defaultdict
import csv
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data/fourth-down-rates.json'
URL = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz'

def number(v):
    try: return float(v)
    except (ValueError, TypeError): return None

def summarize(path, season):
    with gzip.open(path, 'rt') as f:
        rows = list(csv.DictReader(f))
    complete = {r['game_id'] for r in rows if r.get('season_type') == 'REG' and 'END GAME' in r.get('desc', '')}
    groups = {'go': defaultdict(lambda: defaultdict(lambda: [0, 0])), 'fg': defaultdict(lambda: defaultdict(lambda: [0, 0]))}
    used = set()
    seen = set()
    for r in rows:
        if r['game_id'] not in complete or r.get('season_type') != 'REG': continue
        key = (r['game_id'], r['play_id'])
        if key in seen: raise ValueError('Duplicate play: '+str(key))
        seen.add(key)
        if number(r.get('no_play')) == 1 or number(r.get('qtr')) not in (1, 2, 3, 4): continue
        team = {'OAK':'LV','SD':'LAC','STL':'LA'}.get(r.get('posteam'), r.get('posteam'))
        if not team: continue
        kind = bucket = success = None
        y, d = number(r.get('yardline_100')), number(r.get('ydstogo'))
        converted, failed = number(r.get('fourth_down_converted')), number(r.get('fourth_down_failed'))
        if number(r.get('down')) == 4 and converted in (0, 1) and failed in (0, 1) and converted + failed == 1 and y and d:
            if number(r.get('qb_kneel')) == 1 or number(r.get('qb_spike')) == 1: continue
            kind = 'go'
            bucket = f'{min(11,int(d))}|'+('red' if y <= 20 else 'opp' if y <= 50 else 'own')
            success = int(converted)
        elif number(r.get('field_goal_attempt')) == 1 and r.get('field_goal_result') in ('made', 'missed', 'blocked'):
            distance = number(r.get('kick_distance'))
            if distance is None or r.get('roof') not in ('outdoors','dome','closed','open'): continue
            kind = 'fg'
            bucket = f'{int(distance)//10*10}|'+('out' if r['roof'] in ('outdoors','open') else 'in')
            success = int(r['field_goal_result'] == 'made')
        if kind:
            entry = groups[kind][bucket][team]
            entry[0] += success; entry[1] += 1
            used.add(r['game_id'])
    if not used: raise ValueError(f'No usable completed games in {season}')
    dates = [r['game_date'] for r in rows if r['game_id'] in complete]
    return {'through':max(dates), 'games':len(complete), 'game_ids':sorted(complete),
            'source_url':URL.format(season=season), 'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'go':dict(groups['go']), 'fg':dict(groups['fg'])}

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--season',type=int,default=None)
    p.add_argument('--pbp-dir',type=Path)
    p.add_argument('--rebuild-history',action='store_true')
    args=p.parse_args()
    now=dt.datetime.now(dt.timezone.utc)
    current=args.season or (now.year if now.month>=9 else now.year-1)
    old=json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {}
    previous=old.get('data',{}).get('seasons',{})
    seasons={}
    with tempfile.TemporaryDirectory() as tmp:
        for year in range(current-2,current+1):
            if year<current and str(year) in previous and not args.rebuild_history:
                seasons[str(year)]=previous[str(year)]; continue
            path=args.pbp_dir/f'{year}.csv.gz' if args.pbp_dir else Path(tmp)/f'{year}.csv.gz'
            if not args.pbp_dir: urllib.request.urlretrieve(URL.format(season=year),path)
            entry=summarize(path,year)
            if not set(previous.get(str(year),{}).get('game_ids',[])) <= set(entry['game_ids']):
                raise ValueError('Completed-game coverage regressed; preserving published snapshot')
            seasons[str(year)]=entry
    payload={'as_of':now.date().isoformat(), 'source':'nflverse regular-season play-by-play; completed regulation games',
             'note':'Observed comparable team rates. Fourth-down distance + field zone; field goals by 10-yard distance band + open/closed roof. Not a matchup forecast or calibration of nfl4th.',
             'canonical_url':'https://datadawgs216.com/data/fourth-down-rates.json','built':now.isoformat(),
             'tier':'labs','graded':False,'tier_meaning':'Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.',
             'data':{'seasons':seasons,'prior_attempts':20,'current_season':current}}
    OUTPUT.write_text(json.dumps(payload,separators=(',',':'))+'\n')
    print(json.dumps({y:{k:v[k] for k in ('through','games')} for y,v in seasons.items()}))

if __name__=='__main__': main()
