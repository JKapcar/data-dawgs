"""Refresh the current NFL week's fourth-down inputs; Python stdlib only.

Play identity, score BEFORE the play, timeouts, and field orientation come from
ESPN's public play-by-play, following nfl4th's get_4th_plays approach. Market
inputs and venue roof come from nflverse schedules. Failed games retain their
previous dated snapshot and carry an error; an empty/bad feed cannot erase them.
"""
import argparse
import concurrent.futures
import csv
import datetime as dt
import io
import json
import re
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PREVIOUS = ROOT/'data/fourth-down-previous.json'
TIER_MEANING = 'Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.'
SCHEDULE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event='
ALIASES = {'WSH':'WAS','LAR':'LA','JAC':'JAX','CLV':'CLE','BLT':'BAL','ARZ':'ARI','HST':'HOU','SL':'LA'}
def team(value):
    return ALIASES.get(value,value)
def read_url(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'DataDawgsFourthDown/1.0'}), timeout=45) as r:
        return r.read().decode()
def parse_game(payload, game):
    competitors = payload['header']['competitions'][0]['competitors']
    teams = {str(c['team']['id']):team(c['team']['abbreviation']) for c in competitors}
    home,away = game['home_team'],game['away_team']
    drives = list(payload.get('drives',{}).get('previous',[]))
    if payload.get('drives',{}).get('current'): drives.append(payload['drives']['current'])
    seen={}
    for d in drives:
        for p in d.get('plays',[]):
            seen[p['id']] = {**p,'offense':team(d.get('team',{}).get('abbreviation'))}
    plays=sorted(seen.values(),key=lambda p:int(p.get('sequenceNumber',p['id'])))
    if not plays:
        status=payload['header']['competitions'][0].get('status',{}).get('type',{})
        if status.get('state')=='pre':return dict(id=game['game_id'],espn=game['espn'],home=home,away=away,date=game['gameday'],status='Scheduled',captured_at=dt.datetime.now(dt.timezone.utc).isoformat(),decisions=[])
        raise ValueError('No play-by-play yet')
    first=next((p['offense'] for p in plays if p.get('offense') in (home,away)),None)
    if first is None: raise ValueError('Opening possession unknown')
    remaining={home:3,away:3}; current_half=1; home_score=0;away_score=0;decisions=[];skipped=0
    for p in plays:
        q=p.get('period',{}).get('number',0)
        half=1 if q<=2 else 2
        if half!=current_half: remaining={home:3,away:3};current_half=half
        text=p.get('text','');kind=p.get('type',{}).get('text','')
        timeout=re.search(r'Timeout #(\d) by ([A-Z]{2,3})\b',text)
        if timeout:
            t=team(timeout[2])
            if t in remaining:remaining[t]=max(0,3-int(timeout[1]))
        elif kind.lower()=='timeout':
            for participant in p.get('teamParticipants',[]):
                if participant.get('timeout') and str(participant.get('id')) in teams:
                    t=teams[str(participant['id'])];remaining[t]=max(0,remaining[t]-1)
        start=p.get('start',{});off=teams.get(str(start.get('team',{}).get('id')),p['offense'])
        if start.get('down')==4 and 1<=q<=4 and not timeout and kind.lower() not in ['timeout','two-minute warning','end period','end of half','end of game']:
            try:
                clock=p['clock']['displayValue'];m,sec=map(int,clock.split(':'));seconds=m*60+sec
                if seconds<15 and q==4: continue
                # No-play penalties and reviews do not reveal the actual decision.
                if re.search(r'no play|challenged|under review',text,re.I): continue
                spot=re.fullmatch(r'([A-Z]{2,3})\s+(\d+)',start.get('possessionText',''))
                y=100-int(spot[2]) if spot and team(spot[1])==off else int(spot[2]) if spot else start.get('yardsToEndzone')
                distance=int(start['distance'])
                if off not in (home,away) or not isinstance(y,(int,float)) or not 1<=y<=99 or not 1<=distance<=y or seconds<=0:raise ValueError('Incomplete situation')
                opponent=away if off==home else home
                roof=game['roof'] if game['roof'] in ('outdoors','dome') else 'retractable'
                inp=dict(qtr=q,seconds=seconds,yardline=int(y),toGo=distance,diff=home_score-away_score if off==home else away_score-home_score,
                         home=int(off==home),offTO=remaining[off],defTO=remaining[opponent],homeKickoff=int(first==home),
                         spread=float(game['spread_line']),total=float(game['total_line']),roof=roof,runoff=0,touchback=25)
                actual='punt' if 'punt' in kind.lower() else 'fg' if 'field goal' in kind.lower() else 'go' if any(x in kind.lower() for x in ['rush','pass','sack','fumble','intercept']) else None
                decisions.append(dict(id=p['id'],offense=off,clock=clock,description=text,actual=actual,input=inp))
            except (KeyError,ValueError,TypeError):skipped+=1
        home_score=p.get('homeScore',home_score);away_score=p.get('awayScore',away_score)
    status=payload['header']['competitions'][0].get('status',{}).get('type',{}).get('description','Unknown')
    return dict(id=game['game_id'],espn=game['espn'],home=home,away=away,date=game['gameday'],status=status,homeScore=home_score,awayScore=away_score,
                captured_at=dt.datetime.now(dt.timezone.utc).isoformat(),decisions=decisions,skipped=skipped)

def archive(old_env, season, week, now):
    """Freeze the outgoing week when the live snapshot rolls forward.

    Returns the envelope for data/fourth-down-previous.json, or None when there is
    nothing to freeze: same week, an earlier week requested by hand, or a week with
    no captured decisions (keeping the last useful archive beats replacing it with
    an empty one). The games are kept exactly as last captured.
    """
    d = (old_env or {}).get('data') or {}
    if not d.get('games') or not isinstance(d.get('season'), int) or not isinstance(d.get('week'), int):
        return None
    if (d['season'], d['week']) >= (season, week):
        return None
    if not any(g.get('decisions') for g in d['games']):
        return None
    captured = d.get('refreshed_at') or now
    return dict(as_of=captured[:10], built=now, tier='labs', graded=False, tier_meaning=TIER_MEANING,
                source=(old_env or {}).get('source') or 'ESPN public play-by-play + nflverse/nfldata schedules; nfl4th browser port',
                canonical_url='https://datadawgs216.com/data/fourth-down-previous.json',
                note=('Previous captured week, frozen when the live snapshot rolled forward. As captured at refreshed_at; '
                      'later ESPN revisions are not applied. Delayed snapshot; pregame lines, not live prices.'),
                data=dict(season=d['season'], week=d['week'], refreshed_at=d.get('refreshed_at'), archived_at=now, games=d['games']))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--week',type=int);parser.add_argument('--season',type=int);args=parser.parse_args()
    today=dt.datetime.now(ZoneInfo('America/New_York')).date()
    games=list(csv.DictReader(io.StringIO(read_url(SCHEDULE))))
    season=args.season or (today.year if today.month>=8 else today.year-1)
    eligible=[g for g in games if int(g['season'])==season and g['game_type']=='REG']
    played=[g for g in eligible if g['gameday']<=today.isoformat()]
    week=args.week or max(int(g['week']) for g in played)
    selected=[g for g in eligible if int(g['week'])==week]
    if not selected:raise RuntimeError('Schedule returned no games')
    path=ROOT/'data/fourth-down.json';old={};old_env=None
    if path.exists():
        old_env=json.loads(path.read_text())
        old={g['id']:g for g in old_env.get('data',{}).get('games',[])}
    def get(g):
        if g['gameday']>today.isoformat():return dict(id=g['game_id'],espn=g['espn'],home=g['home_team'],away=g['away_team'],date=g['gameday'],status='Scheduled',decisions=[])
        try:return parse_game(json.loads(read_url(SUMMARY+g['espn'])),g)
        except Exception as e:
            fallback=old.get(g['game_id'],dict(id=g['game_id'],espn=g['espn'],home=g['home_team'],away=g['away_team'],date=g['gameday'],decisions=[]))
            return {**fallback,'refresh_error':str(e),'status':fallback.get('status','Feed unavailable')}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex: results=list(ex.map(get,selected))
    if not any(g.get('captured_at') and not g.get('refresh_error') for g in results):raise RuntimeError('No games refreshed; preserving last snapshot')
    now=dt.datetime.now(dt.timezone.utc).isoformat()
    envelope=dict(as_of=today.isoformat(),built=now,tier='labs',graded=False,tier_meaning='Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.',source='ESPN public play-by-play + nflverse/nfldata schedules; nfl4th browser port',
                  canonical_url='https://datadawgs216.com/data/fourth-down.json',note='Delayed game-decision snapshot. Check per-game capture time and refresh_error. No overtime recommendations. Pregame lines, not live betting prices.',
                  data=dict(season=season,week=week,refreshed_at=now,games=results))
    frozen=archive(old_env,season,week,now)
    if frozen:
        PREVIOUS.write_text(json.dumps(frozen,separators=(',',':'))+'\n')
        print(f'Froze week {frozen["data"]["week"]} into {PREVIOUS.name}')
    path.write_text(json.dumps(envelope,separators=(',',':'))+'\n')
    print(f'Week {week}: {len(results)} games, {sum(len(g["decisions"]) for g in results)} fourth downs, {sum("refresh_error" in g for g in results)} feed errors')
if __name__=='__main__': main()
