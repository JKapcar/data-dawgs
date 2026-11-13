"""Capture commit-pinned public nfelo ratings and Data Dawgs retained parameters and full-season nfelohfa context.
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
    config = json.loads(pathlib.Path(__file__).with_name('nfelo-season-parameters.json').read_text())
    z = number(config.get('z'), 'z')
    if z <= 0:
        raise ValueError('z must be positive')
    qb_weight = number(config.get('qb_weight'), 'qb_weight')
    ratings = {}
    for r in csv.DictReader((nfelo / 'output_data/elo_snapshot.csv').open()):
        team = canonical(r['team'])
        if team in ratings or int(r['season']) != season:
            raise ValueError('Duplicate team or wrong rating season: ' + team)
        if not math.isclose(number(r.get('nfelo'), team + ' nfelo'), number(r.get('nfelo_base'), team + ' base') + qb_weight * number(r.get('qb_adj'), team + ' QB'), rel_tol=0, abs_tol=1e-6):
            raise ValueError('Incompatible rating/QB schema: ' + team)
        ratings[team] = {'base': number(r.get('nfelo_base'), team + ' base'),
                         'qb_adj': number(r.get('qb_adj'), team + ' QB'),
                         'season': int(r['season']), 'week': int(r['week'])}
    if len(ratings) != 32:
        raise ValueError('Expected 32 team ratings')
    # Validate the public forecast schema independently of the retained extrapolation.
    # Published probabilities may include upstream transforms; do not recompute them.
    forecast_ids = set()
    for row in csv.DictReader((nfelo / 'output_data/nfelo_games.csv').open()):
        if not row['game_id'].startswith(str(season) + '_'):
            continue
        parts = row['game_id'].split('_')
        if len(parts) != 4:
            raise ValueError('Invalid forecast game id')
        key = f'{season}_{int(parts[1]):02d}_{canonical(parts[2])}_{canonical(parts[3])}'
        if key in forecast_ids:
            raise ValueError('Duplicate forecast: ' + key)
        forecast_ids.add(key)
        for phase in ('open', 'close'):
            number(row.get('nfelo_dif_' + phase), row['game_id'] + ' Elo difference')
            probability = number(row.get('nfelo_home_probability_' + phase), row['game_id'] + ' probability')
            if not 0 <= probability <= 1:
                raise ValueError('Incompatible forecast scale: ' + row['game_id'])
    if not forecast_ids:
        raise ValueError('No current-season forecasts')
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
    if not forecast_ids.issubset(games):
        raise ValueError('Forecast missing full-season game context')
    return {'method': 'nfelo-season-v1', 'season': season, 'z': z, 'qb_weight': qb_weight,
            'nfelo_sha': git(nfelo, 'rev-parse', 'HEAD'),
            'hfa_sha': git(hfa, 'rev-parse', 'HEAD'),
            'hfa_committed_at': git(hfa, 'log', '-1', '--format=%cI'),
            'hfa_repo': 'greerreNFL/nfelohfa', 'ratings': ratings, 'games': games,
            'parameters': config,
            'compatibility': {'forecasts_checked': len(forecast_ids), 'rating_qb_tolerance': 1e-6},
            'assumption': 'Data Dawgs-owned extrapolation with frozen retained z=401.62 and qb_weight=1 (2026-11-11), not current upstream configuration or an official nfelo forecast. Current base team strength and QB adjustments held fixed for future games; game-specific HFA from nfelohfa. No extra market regression.'}


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
