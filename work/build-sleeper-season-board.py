"""Build a private Sleeper guillotine board using the existing season conversion.

All input/output paths must be outside the public repository. No credentials or
player prices belong in this script. The reference board pins the source SHA.
"""
import argparse, ast, collections, csv, datetime, hashlib, json, math, re
import unicodedata, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    ap = argparse.ArgumentParser()
    for arg in ['source', 'reference', 'projections', 'league', 'output']:
        ap.add_argument('--' + arg, required=True)
    args = ap.parse_args()
    for name in ['source', 'reference', 'projections', 'output']:
        assert not Path(getattr(args, name)).resolve().is_relative_to(ROOT), 'Private files must stay outside repo'
    ref = json.loads(Path(args.reference).read_text(encoding='utf-8-sig'))
    sha = hashlib.sha256(Path(args.source).read_bytes()).hexdigest()
    assert sha == ref['data']['source_snapshot_sha256'], 'Not the reference board source'
    source = list(csv.DictReader(open(args.source, encoding='utf-8-sig')))
    league = json.load(urllib.request.urlopen('https://api.sleeper.app/v1/league/' + args.league))
    assert league['season'] == '2026' and league['settings']['type'] == 3
    positions = league['roster_positions']
    assert not set(positions) & {'SUPER_FLEX', 'K', 'DEF', 'IDP_FLEX'}
    assert set(positions) <= {'QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'}
    teams = league['total_rosters']
    raw = json.loads(Path(args.projections).read_text())
    # Reuse the exact conversion function, including scenario and Hamilton logic.
    tree = ast.parse((ROOT / 'work/build-dd-boards.py').read_text(encoding='utf-8'))
    funcs = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                            and n.name in {'mvkey', 'build'}], type_ignores=[])
    ns = dict(re=re, unicodedata=unicodedata, collections=collections, ETR=source,
              SHA=sha, TODAY=ref['as_of'],
              COL={(False, 1): 'ETR Full PPR', (False, .5): 'ETR Half PPR'},
              BASE={1: 'ppr', .5: 'half'},
              SCENARIOS={'budget_only': (0, 0), 'cautious': (.25, .25),
                         'central': (.5, .5), 'full': (1, 1)})
    exec(compile(funcs, 'existing-season-conversion', 'exec'), ns)
    key = ns['mvkey']
    aliases = {'kenneth gainwell': 'kenny gainwell', 'cameron ward': 'cam ward'}
    def namekey(name):
        k = key(name)
        return aliases.get(k, k)
    rec = league['scoring_settings']['rec']
    base = dict(pass_yd=.04, pass_td=4, pass_int=-2, pass_2pt=2,
                rush_yd=.1, rush_td=6, rush_2pt=2, rec=rec, rec_yd=.1,
                rec_td=6, rec_2pt=2, fum_lost=-2, fum_rec_td=6)
    scored = {}
    pools = {'base': [], 'room': []}
    for row in raw:
        p = row.get('player') or {}
        pos = p.get('position')
        if pos not in {'QB', 'RB', 'WR', 'TE'}:
            continue
        name = p.get('full_name') or (p.get('first_name', '') + ' ' + p.get('last_name', ''))
        stats = row.get('stats') or {}
        values = {}
        for scheme, scoring in [('base', base), ('room', league['scoring_settings'])]:
            val = sum(float(stats.get(k) or 0) * float(v) for k, v in scoring.items())
            values[scheme] = val
            pools[scheme].append((pos, val))
        scored[namekey(name)] = values
    def replacement(pool, slots, count):
        by = {p: sorted([v for pos, v in pool if pos == p], reverse=True)
              for p in ['QB', 'RB', 'WR', 'TE']}
        used = {p: slots.count(p) * count for p in by}
        for _ in range(slots.count('FLEX') * count):
            p = max(['RB', 'WR', 'TE'], key=lambda p: by[p][used[p]])
            used[p] += 1
        return {p: by[p][used[p]] for p in by}
    baseline_slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
    sch = ns['BASE'][rec]
    ns['REPL'] = {('etr12', sch): replacement(pools['base'], baseline_slots, 12),
                  ('room', sch): replacement(pools['base'], positions, teams),
                  ('room', 'custom'): replacement(pools['room'], positions, teams)}
    ns['PROJ'] = {r['Player']: {sch: scored[namekey(r['Player'])]['base'],
                              'custom': scored[namekey(r['Player'])]['room']}
                  for r in source if namekey(r['Player']) in scored}
    config = dict(name=league['name'], provider='sleeper', league_id=args.league,
                  teams=teams, rec=rec, superflex=False, k=False, dst=False,
                  paid_slots_per_team=len(positions), budget_per_team=200,
                  budget_kind='nominal', floor=1, reserve=0, room_key='room',
                  custom_scheme='custom', dynasty=False,
                  scoring_note='Live Sleeper scoring settings, including reception and interception points.',
                  notes=['Same source snapshot and conversion function as the reference league.',
                         'Guillotine season-total valuation; not a survival model or a bid recommendation.'])
    board = ns['build'](config)
    # Match the reference guillotine denomination: scale exact nominal values
    # into FAAB, then Hamilton-round to the whole league budget.
    budget = int(league['settings']['waiver_budget'])
    rows = board['data']['players']
    exact = {r['id']: r['exact'] * budget / 200 for r in rows}
    rounded = {k: math.floor(v) for k, v in exact.items()}
    short = teams * budget - sum(rounded.values())
    assert 0 <= short <= len(rows)
    for k in sorted(exact, key=lambda k: (-(exact[k] % 1), k))[:short]:
        rounded[k] += 1
    for r in rows:
        r.update(target=rounded[r['id']], exact=round(exact[r['id']], 4))
        # The reference FAAB board carries no conversion bands.
        r.pop('low', None); r.pop('high', None)
    rows.sort(key=lambda r: (-r['target'], -r['exact'], r['player']))
    for rank, r in enumerate(rows, 1):
        r['rank'] = rank
    d = board['data']
    board['built'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    d['model_id'] = 'datadawgs-dd-guillotine-faab-2026-v1'
    d['source_reference_league_id'] = ref['data']['league_id']
    d['projection_snapshot_sha256'] = hashlib.sha256(Path(args.projections).read_bytes()).hexdigest()
    d['projection_as_of'] = board['built'][:10]
    d['scoring_settings'] = league['scoring_settings']
    d['room'] = dict(teams_start=teams, live_teams=teams, faab_per_team=budget,
                     faab_total=teams*budget, slots_per_team=len(positions),
                     paid_slots=teams*len(positions), reception=rec, kicker=False, dst=False)
    d['method']['baseline_slots'] = baseline_slots
    d['method']['denomination'] = 'live_teams x FAAB, Hamilton-rounded to an exact total'
    d['interpretation'] = 'Season-total roster comparator in FAAB units, not a survival model or a bid recommendation.'
    board['note'] = 'PRIVATE. Dated, ungraded season-total valuation in FAAB units. Rebuild as live teams change.'
    board['source'] += ' Re-denominated into the league FAAB budget using the reference board method.'
    d['validation'] = dict(rows=len(rows), priced_players=sum(r['target'] > 0 for r in rows),
                           paid_slots=teams*len(positions), target_sum=sum(r['target'] for r in rows),
                           faab_total=teams*budget, negative_prices=sum(r['target'] < 0 for r in rows))
    assert d['validation']['target_sum'] == teams * budget
    assert d['validation']['priced_players'] == teams * len(positions)
    assert not d['validation']['negative_prices']
    Path(args.output).write_text(json.dumps(board, indent=2), encoding='utf-8')
    print(json.dumps({'source_hash_matches': True, 'league': league['name'], **d['validation']}))

if __name__ == '__main__':
    main()
