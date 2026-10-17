"""Pinned, local descriptive WR development audit; no modeling or unit inference."""
import argparse
import collections
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import zipfile
from development import SOURCE_SHA, SOURCE_SIZE, NULLS, canonical


def distribution(values):
    ordered = sorted(values)
    if not ordered:
        return {'n': 0}
    def quantile(p):
        pos = (len(ordered)-1)*p
        lo = math.floor(pos)
        hi = math.ceil(pos)
        return ordered[lo]+(ordered[hi]-ordered[lo])*(pos-lo)
    return dict(n=len(ordered), min=ordered[0], p25=quantile(.25), median=quantile(.5),
                p75=quantile(.75), max=ordered[-1], mean=math.fsum(ordered)/len(ordered))


def audit(source, out, expected_sha=SOURCE_SHA, expected_size=SOURCE_SIZE):
    source, out = Path(source).resolve(), Path(out).resolve()
    if any((p/'.git').exists() for p in (out, *out.parents)):
        raise ValueError('restricted output must be outside Git')
    if source == out or source.is_relative_to(out):
        raise ValueError('output must be separate from source')
    with source.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    if digest != expected_sha or source.stat().st_size != expected_size:
        raise ValueError('source identity mismatch')
    code_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    dependency_hash = hashlib.sha256(Path(__file__).with_name('development.py').read_bytes()).hexdigest()
    years = ('2023', '2024')
    totals = {y:dict(player_play_rows=0, missing=0, invalid=0, numeric=[]) for y in years}
    athlete = {}
    drills = {}
    athlete_drills = {}
    plays = set()
    gameplays = {y:set() for y in years}
    tracking = {y:dict(rows=0, matched_rows=0, unmatched_rows=0, trajectories=set(), unmatched_trajectories=set()) for y in years}
    combine_results = set()
    with zipfile.ZipFile(source) as z:
        def rows(name):
            if name not in ('players','games','player_play','combine_results','combine_tracking','game_tracking_2023','game_tracking_2024'):
                raise ValueError('member not allowed')
            names = [n for n in z.namelist() if Path(n).name == name+'.csv']
            if len(names) != 1:
                raise ValueError('ambiguous or absent member')
            with io.TextIOWrapper(z.open(names[0]), encoding='utf-8-sig', newline='') as f:
                reader = csv.DictReader(f)
                required = {
                    'players': ('nfl_id','draft_year','nfl_position'),
                    'games': ('game_id','season','season_type'),
                    'player_play': ('game_id','play_id','nfl_id','separation_at_pass_forward'),
                    'combine_results': ('nfl_id','draft_year'),
                    'combine_tracking': ('nfl_id','draft_year','event_id','drill_type','drill_name','attempt','time','x','y','s','a','dis','dir')
                }.get(name, ('game_id','play_id','nfl_id'))
                if not reader.fieldnames or len(reader.fieldnames)!=len(set(reader.fieldnames)) or not set(required).issubset(reader.fieldnames):
                    raise ValueError('invalid schema')
                for row in reader:
                    if None in row or any(v is None for v in row.values()):
                        raise ValueError('malformed row width')
                    yield row
        players = {}
        for r in rows('players'):
            if r['draft_year'] not in years:
                continue
            if r['nfl_position'] != 'WR':
                continue
            if r['nfl_id'] in players or r['nfl_id'] in NULLS:
                raise ValueError('duplicate or missing player identity')
            players[r['nfl_id']] = r['draft_year']
            athlete[r['nfl_id']] = dict(draft_year=r['draft_year'], player_play_rows=0, missing=0, invalid=0, numeric=[])
        games = {}
        for r in rows('games'):
            if r['season'] not in years:
                continue
            if r['season_type'] != 'REG':
                continue
            if r['game_id'] in games:
                raise ValueError('duplicate game identity')
            games[r['game_id']] = r['season']
        def eligible(r):
            return r['nfl_id'] in players and r['game_id'] in games and players[r['nfl_id']] == games[r['game_id']]
        for r in rows('player_play'):
            if not eligible(r):
                continue
            key = (r['game_id'],r['play_id'],r['nfl_id'])
            if key in plays:
                raise ValueError('duplicate player-play identity')
            plays.add(key)
            y = games[r['game_id']]
            gameplays[y].add(key[:2])
            raw = r['separation_at_pass_forward']
            value = None
            state = 'missing'
            if raw not in NULLS:
                try:
                    value = float(raw)
                    state = 'numeric' if math.isfinite(value) else 'invalid'
                except ValueError:
                    state = 'invalid'
            for target in (totals[y], athlete[r['nfl_id']]):
                target['player_play_rows'] += 1
                if state == 'numeric':
                    target['numeric'].append(value)
                else:
                    target[state] += 1
        for r in rows('combine_results'):
            if r['draft_year'] not in years:
                continue
            if r['nfl_id'] in players and players[r['nfl_id']] == r['draft_year']:
                combine_results.add(r['nfl_id'])
        for r in rows('combine_tracking'):
            if r['draft_year'] not in years:
                continue
            if r['nfl_id'] not in players or players[r['nfl_id']] != r['draft_year']:
                continue
            tag = (r['draft_year'],r['drill_type'],r['drill_name'])
            group = drills.setdefault(tag, dict(rows=0, athletes=set(), trials=set(), missing=collections.Counter(), invalid=collections.Counter()))
            group.setdefault('ranges', {})
            group['rows'] += 1
            group['athletes'].add(r['nfl_id'])
            group['trials'].add((r['event_id'],r['nfl_id'],r['attempt']))
            ad = athlete_drills.setdefault((r['nfl_id'], *tag), dict(rows=0, missing=collections.Counter(), invalid=collections.Counter()))
            ad['rows'] += 1
            for field in ('x','y','s','a','dis','dir','time','attempt'):
                if r[field] in NULLS:
                    group['missing'][field] += 1
                    ad['missing'][field] += 1
                elif field in ('x','y','s','a','dis','dir'):
                    try:
                        valid = math.isfinite(float(r[field]))
                    except ValueError:
                        valid = False
                    if not valid:
                        group['invalid'][field] += 1
                        ad['invalid'][field] += 1
                    else:
                        value = float(r[field])
                        bounds = group['ranges'].setdefault(field, {'min':value,'max':value})
                        bounds['min'] = min(bounds['min'], value)
                        bounds['max'] = max(bounds['max'], value)
        for name in ('game_tracking_2023','game_tracking_2024'):
            for r in rows(name):
                if not eligible(r):
                    continue
                y = games[r['game_id']]
                if y != name[-4:]:
                    raise ValueError('tracking season mismatch')
                key = (r['game_id'],r['play_id'],r['nfl_id'])
                group = tracking[y]
                group['rows'] += 1
                group['trajectories'].add(key)
                if key in plays:
                    group['matched_rows'] += 1
                else:
                    group['unmatched_rows'] += 1
                    group['unmatched_trajectories'].add(key)
    report = dict(sourceSha256=digest, codeSha256=code_hash, dependencySha256=dependency_hash, holdoutRead=False,
                  population='players.nfl_position == WR; REG; season == draft_year; 2023/2024',
                  units='unverified raw source values; no conversions',
                  missingPolicy='explicit counts; no imputation; no zero substitution',
                  separationValidity='finite float only; no physical bounds inferred',
                  quantiles='linear interpolation at (n-1)*p; pooled player-play rows',
                  years={}, athletes={}, combineDrills=[])
    for y in years:
        ids = {p for p,v in players.items() if v == y}
        active = {p for p in ids if athlete[p]['player_play_rows']}
        t = tracking[y]
        report['years'][y] = dict(cohort_athletes=len(ids), athletes_with_player_play=len(active),
            distinct_game_plays=len(gameplays[y]), player_play_rows=totals[y]['player_play_rows'],
            separation_missing=totals[y]['missing'], separation_invalid=totals[y]['invalid'],
            separation_nonmissing=totals[y]['player_play_rows']-totals[y]['missing'],
            separation_raw_distribution=distribution(totals[y]['numeric']),
            combine_results_athletes=len(ids & combine_results),
            tracking_rows=t['rows'], tracking_matched_rows=t['matched_rows'], tracking_unmatched_rows=t['unmatched_rows'],
            tracking_trajectories=len(t['trajectories']), tracking_unmatched_trajectories=len(t['unmatched_trajectories']),
            player_play_without_tracking=len({k for k in plays if players[k[2]] == y}-t['trajectories']))
    for p,v in sorted(athlete.items()):
        report['athletes'][p] = {k:val for k,val in v.items() if k!='numeric'}
        report['athletes'][p]['separation_raw_distribution'] = distribution(v['numeric'])
        report['athletes'][p]['combine_drill_missingness'] = [dict(draft_year=k[1], drill_type=k[2], drill_name=k[3], rows=v['rows'], missing=dict(v['missing']), invalid=dict(v['invalid'])) for k,v in sorted(athlete_drills.items()) if k[0]==p]
        report['athletes'][p]['combine_results_present'] = p in combine_results
        report['athletes'][p]['combine_drills'] = [dict(drill_type=k[1],drill_name=k[2],trials=sum(t[1]==p for t in v['trials'])) for k,v in sorted(drills.items()) if p in v['athletes']]
    for k,v in sorted(drills.items()):
        report['combineDrills'].append(dict(draft_year=k[0],drill_type=k[1],drill_name=k[2],rows=v['rows'],
            athletes=len(v['athletes']), athletes_without_drill=sum(y==k[0] for y in players.values())-len(v['athletes']),
            trials=len(v['trials']), missing=dict(v['missing']),invalid=dict(v['invalid']), raw_ranges=v['ranges'],
            athletes_with_player_play=sum(athlete[p]['player_play_rows']>0 for p in v['athletes']),
            athletes_with_numeric_separation=sum(bool(athlete[p]['numeric']) for p in v['athletes'])))
    out.mkdir(parents=True, exist_ok=True)
    raw = canonical(report)
    output_hash = hashlib.sha256(raw).hexdigest()
    (out/(output_hash+'.json')).write_bytes(raw)
    receipt = dict(sourceSha256=digest, codeSha256=code_hash, dependencySha256=dependency_hash, outputSha256=output_hash, localOnly=True, holdoutRead=False)
    (out/'receipt.json').write_bytes(canonical(receipt))
    return report, receipt

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source');parser.add_argument('--out',required=True)
    args=parser.parse_args()
    report,receipt=audit(args.source,args.out)
    print(json.dumps({'receipt':receipt,'years':report['years'],'combineDrills':report['combineDrills']}))
