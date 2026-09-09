"""Capture commit-pinned nfelo base ratings/config and full-season nfelohfa context.
Outputs JSON to stdout; standard-library only. No missing value is treated as zero.
"""
import argparse
import csv
import json
import math
import pathlib
import subprocess
import tempfile


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def number(value, label):
    if value is None or str(value).strip() == '':
        raise ValueError('Missing ' + label)
    n = float(value)
    if not math.isfinite(n):
        raise ValueError('Nonfinite ' + label)
    return n


def canonical(team):
    return {'OAK': 'LV', 'LA': 'LAR', 'SD': 'LAC', 'STL': 'LAR', 'WSH': 'WAS'}.get(team, team)


def collect(nfelo, hfa, season):
    config = json.loads((nfelo / 'config.json').read_text())['models']['nfelo']['nfelo_config']
    z = number(config.get('z'), 'z')
    if z <= 0:
        raise ValueError('z must be positive')
    qb_weight = number(config.get('qb_weight'), 'qb_weight')
    ratings = {}
    for r in csv.DictReader((nfelo / 'output_data/elo_snapshot.csv').open()):
        team = canonical(r['team'])
        if team in ratings or int(r['season']) != season:
            raise ValueError('Duplicate team or wrong rating season: ' + team)
        ratings[team] = {'base': number(r.get('nfelo_base'), team + ' base'),
                         'qb_adj': number(r.get('qb_adj'), team + ' QB'),
                         'season': int(r['season']), 'week': int(r['week'])}
    if len(ratings) != 32:
        raise ValueError('Expected 32 team ratings')
    games = {}
    for r in csv.DictReader((hfa / 'estimated_hfa.csv').open()):
        if int(r['season']) != season or not 1 <= int(r['week']) <= 18:
            continue
        home, away = canonical(r['home_team']), canonical(r['away_team'])
        key = f"{season}_{int(r['week']):02d}_{away}_{home}"
        if key in games or home not in ratings or away not in ratings:
            raise ValueError('Invalid HFA game: ' + key)
        games[key] = {'home': home, 'away': away, 'week': int(r['week']),
                      'hfa_elo': 25 * number(r.get('hfa_adj'), key + ' hfa_adj'),
                      'neutral': r['location'] == 'Neutral'}
    if len(games) != 272:
        raise ValueError(f'Expected 272 HFA rows, found {len(games)}')
    return {'method': 'nfelo-season-v1', 'season': season, 'z': z, 'qb_weight': qb_weight,
            'nfelo_sha': git(nfelo, 'rev-parse', 'HEAD'),
            'hfa_sha': git(hfa, 'rev-parse', 'HEAD'),
            'hfa_committed_at': git(hfa, 'log', '-1', '--format=%cI'),
            'hfa_repo': 'greerreNFL/nfelohfa', 'ratings': ratings, 'games': games,
            'assumption': 'Current base team strength and QB adjustments held fixed for future games; game-specific HFA from nfelohfa. No extra market regression.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--nfelo', required=True, type=pathlib.Path)
    parser.add_argument('--hfa', type=pathlib.Path)
    parser.add_argument('--season', type=int, required=True)
    a = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='nfelo-hfa-') as tmp:
        hfa = a.hfa or pathlib.Path(tmp) / 'hfa'
        if not a.hfa:
            subprocess.run(['git', 'clone', '-q', '--depth', '1', 'https://github.com/greerreNFL/nfelohfa.git', str(hfa)], check=True)
        print(json.dumps(collect(a.nfelo, hfa, a.season), allow_nan=False))


if __name__ == '__main__':
    main()
