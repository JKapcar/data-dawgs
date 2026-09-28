#!/usr/bin/env python3
"""Daily completed-game EPA refresh. No third-party Python dependencies.

Download the current NFL season, validate complete games against nflverse's
schedule, and replace only that season in stats.html. Historical seasons and
unrelated page edits are preserved. Rebuild machine mirrors separately.
"""
import argparse
import csv
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import urllib.request
from collections import Counter, defaultdict

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('epa_encoder', ROOT/'tools/stats-epa-refresh.py')
encoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(encoder)
PBP_URL = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz'
SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent':'DataDawgsEPADaily/1.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read(), response.headers.get('Last-Modified')


def select_games(pbp, schedule, season):
    expected = {g['game_id']:g for g in schedule if int(g['season'])==season and g['game_type'] in ('REG','WC','DIV','CON','SB')}
    if not expected:
        raise ValueError('Schedule has no games for the requested season')
    seen = defaultdict(lambda: {'ended':False,'usable':0,'bad':set(),'plays':set()})
    for p in encoder.read_pbp(pbp):
        if int(p['season']) != season:
            raise ValueError('Unexpected season in play-by-play')
        if p['season_type'] not in ('REG','POST'):
            continue
        gid = p['game_id']
        if gid not in expected:
            raise ValueError('Play-by-play game absent from schedule: '+gid)
        g, record = expected[gid], seen[gid]
        if int(p['week']) != int(g['week']) or {p['home_team'],p['away_team']} != {g['home_team'],g['away_team']}:
            raise ValueError('Game identity disagrees with schedule: '+gid)
        if p['home_team'] != g['home_team'] or (p['season_type']=='REG') != (g['game_type']=='REG'):
            raise ValueError('Home team or season type disagrees: '+gid)
        if p['play_id'] in record['plays']:
            raise ValueError('Duplicate play: '+gid+'/'+p['play_id'])
        record['plays'].add(p['play_id'])
        record['ended'] |= 'END GAME' in (p.get('desc') or '')
        if encoder.f(p['pass'])==1 or encoder.f(p['rush'])==1:
            if encoder.f(p['epa']) is None:
                record['bad'].add('missing EPA')
            else:
                record['usable'] += 1
    accepted, pending = [], []
    for gid,g in expected.items():
        final = g.get('home_score') not in ('','NA',None) and g.get('away_score') not in ('','NA',None)
        r = seen.get(gid)
        if not final and not r:
            continue
        reasons = []
        if not final: reasons.append('schedule not final')
        if not r or not r['ended']: reasons.append('no END GAME')
        if not r or not r['usable']: reasons.append('no EPA plays')
        if r: reasons.extend(sorted(r['bad']))
        if reasons: pending.append({'game_id':gid,'reason':'; '.join(reasons)})
        else: accepted.append(g)
    return sorted(accepted,key=lambda g:g['game_id']), sorted(pending,key=lambda g:g['game_id'])


def build_candidate(data, pbp, schedule, season, captured, source_updated=None):
    accepted, pending = select_games(pbp, schedule, season)
    if not accepted:
        if season in data['seasons']:
            raise ValueError('No complete games; preserving previous snapshot')
        return None
    previous = data.get('coverage',{}).get(str(season),{})
    ids = {g['game_id'] for g in accepted}
    if not set(previous.get('game_ids',[])) <= ids:
        raise ValueError('Previously published games disappeared; preserving snapshot')
    counts = Counter(int(g['week']) for g in accepted if g['game_type']=='REG')
    # Initial migration has counts but no IDs. Require every previous week to survive.
    for week,count in previous.get('games_per_week',{}).items():
        if counts[int(week)] < count:
            raise ValueError('Previously published week lost games; preserving snapshot')
    if len(ids) < previous.get('games',0):
        raise ValueError('Game count regressed; preserving snapshot')
    seasons = sorted(set(data['seasons']) | {season})
    index = seasons.index(season)
    new, _, _, null_epa = encoder.pbp_rows(pbp,index,data['teams'],game_ids=ids)
    if null_epa or not new:
        raise ValueError('Selected games have incomplete EPA')
    old = encoder.decode(data)
    kept = [dict(r,season=seasons.index(data['seasons'][r['season']])) for r in old if data['seasons'][r['season']] != season]
    rows = [r for r in kept if r['season']<index]+new+[r for r in kept if r['season']>index]
    post = [g for g in accepted if g['game_type']!='REG']
    cov = dict(data.get('coverage',{}))
    cov[str(season)] = {
        'plays':len(new),'reg_plays_with_down':sum(bool(r['down']) and not r['flags']&8 for r in new),
        'season_types':['REG','POST'] if post else ['REG'],
        'weeks':sorted(counts),'postseason_weeks':sorted({int(g['week']) for g in post}),
        'games':len(ids),'regular_games':sum(counts.values()),'games_per_week':dict(sorted(counts.items())),
        'game_ids':sorted(ids),'games_by_team':dict(sorted(Counter(t for g in accepted for t in (g['home_team'],g['away_team'])).items())),
        'through':max(g['gameday'] for g in accepted),'captured':captured[:10],'refreshed_at':captured,
        'source_url':PBP_URL.format(season=season),'source_updated':source_updated,
        'source_sha256':hashlib.sha256(Path(pbp).read_bytes()).hexdigest(),
        'schedule_sha256':hashlib.sha256(json.dumps(schedule,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
        'pending_games':pending,'refresh_frequency':'daily at 11:43 UTC',
        'note':'Completed games only, including incomplete weeks. Daily published nflverse EPA; not live. Historical seasons retained; current-season corrections incorporated.'}
    out = encoder.encode(dict(data,seasons=seasons,coverage=cov),rows)
    carried = [r for r in encoder.decode(out) if r['season']!=index]
    if carried != kept:
        raise ValueError('Historical rows changed')
    return out


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--season',type=int)
    ap.add_argument('--pbp',type=Path)
    ap.add_argument('--schedule',type=Path)
    ap.add_argument('--source-updated')
    ap.add_argument('--as-of',help='Fixed UTC capture timestamp for reproducible replay')
    args=ap.parse_args()
    now=dt.datetime.now(dt.timezone.utc)
    season=args.season or (now.year if now.month>=9 else now.year-1)
    captured=args.as_of or now.isoformat().replace('+00:00','Z')
    with tempfile.TemporaryDirectory(prefix='epa-') as tmp:
        source_updated=args.source_updated
        pbp=args.pbp
        if not pbp:
            raw,source_updated=download(PBP_URL.format(season=season))
            pbp=Path(tmp)/'pbp.csv.gz';pbp.write_bytes(raw)
        schedule_text=args.schedule.read_text() if args.schedule else download(SCHEDULE_URL)[0].decode('utf-8-sig')
        schedule=list(csv.DictReader(io.StringIO(schedule_text)))
        html,i,j,data=encoder.load_page()
        out=build_candidate(data,pbp,schedule,season,captured,source_updated)
        if out is None:
            print('No completed games in new season yet; previous snapshot retained.');return
        content=html[:i]+encoder.MARK+json.dumps(out)+';'+html[j:]
        page=Path(encoder.PAGE)
        with tempfile.NamedTemporaryFile('w',dir=page.parent,encoding='utf-8',delete=False) as f:
            f.write(content);temporary=f.name
        os.replace(temporary,page)
        c=out['coverage'][str(season)]
        print(json.dumps({k:c[k] for k in ['games','weeks','through','refreshed_at','pending_games']}))


if __name__=='__main__':
    main()
