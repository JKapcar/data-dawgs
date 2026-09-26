#!/usr/bin/env python3
"""tools/stats-epa-refresh.py — append (or replace) one season of nflverse play-by-play
in the columnar DATA object embedded in stats.html.

Until 2026-09-26 there was no encoder in this repo: the blob arrived in the initial commit
(2026-07-29) and nothing could reproduce it. This script is the encoder, reverse-engineered
from the page's own decoder and PROVEN against the frozen snapshot: run with --verify and it
re-encodes a past season from the nflverse file and compares every column row by row
(2023 matches the committed blob exactly; 2024/2025 differ on a handful of rows only because
nflverse has re-processed those seasons since the capture).

Encoding (one row per play; stats.html aggregate() and tools/build-data.js decode it):
  rows      nflverse plays with pass == 1 or rush == 1 and a non-null epa, in file order
  season    uint8  index into DATA.seasons
  week      uint8  nflverse week
  pos/def   uint8  index into DATA.teams (def 255 = missing)
  down      uint8  0 = no down (2-pt tries etc.), else 1-4
  qtr       uint8  1-5 (5 = OT)
  wp        uint8  floor(wp * 100 + 0.5)
  flags     uint8  bit0 pass, bit1 success, bit2 has cpoe, bit3 postseason
  epa       int16  floor(epa * 100 + 0.5)            little-endian
  cpoe      int16  floor(cpoe * 10 + 0.5), 0 if null  little-endian
  name      uint16 index into DATA.names (sorted, "" at 0): `passer` on a dropback,
                   `rusher` on a rush                  little-endian

Rows for seasons OTHER than the one being written are carried over byte-for-byte (only the
name index is re-mapped, because DATA.names stays sorted); the frozen 2023-2025 snapshot is
never silently re-pulled.

Completeness gate (refuses to write, exit 2): every requested week must contain exactly the
expected number of games, every game must have an END GAME row, and no pass/rush play may
have a null EPA. A partial week is never encoded.

Standard library only.

  python3 tools/stats-epa-refresh.py --pbp play_by_play_2026.csv.gz --season 2026 \
      --weeks 1,2 --games-per-week 16 --as-of 2026-09-26
  python3 tools/stats-epa-refresh.py --verify play_by_play_2023.csv.gz --season 2023
"""
import argparse, base64, csv, gzip, io, json, math, os, struct, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'stats.html')
MARK = 'const DATA = '
U8 = ['season', 'week', 'pos', 'def', 'down', 'qtr', 'wp', 'flags']


def rnd(x):
    return int(math.floor(x + 0.5))


def load_page():
    s = open(PAGE, encoding='utf-8', newline='').read()
    i = s.index(MARK + '{')
    j = s.index('\n', i)
    body = s[i + len(MARK):j]
    assert body.endswith(';'), 'DATA line no longer ends in ";" — the page layout changed'
    return s, i, j, json.loads(body[:-1])


def decode(D):
    n = D['n']
    cols = {k: base64.b64decode(D['cols'][k]) for k in D['cols']}
    for k in U8:
        assert len(cols[k]) == n, k
    epa = struct.unpack('<%dh' % n, cols['epa'])
    cpoe = struct.unpack('<%dh' % n, cols['cpoe'])
    name = struct.unpack('<%dH' % n, cols['name'])
    rows = []
    for r in range(n):
        row = {k: cols[k][r] for k in U8}
        row.update(epa=epa[r], cpoe=cpoe[r], name=D['names'][name[r]])
        rows.append(row)
    return rows


def encode(D, rows):
    names = [''] + sorted({r['name'] for r in rows} - {''})
    ni = {nm: i for i, nm in enumerate(names)}
    n = len(rows)
    cols = {k: base64.b64encode(bytes(r[k] for r in rows)).decode() for k in U8}
    cols['epa'] = base64.b64encode(struct.pack('<%dh' % n, *(r['epa'] for r in rows))).decode()
    cols['cpoe'] = base64.b64encode(struct.pack('<%dh' % n, *(r['cpoe'] for r in rows))).decode()
    cols['name'] = base64.b64encode(struct.pack('<%dH' % n, *(ni[r['name']] for r in rows))).decode()
    out = {'n': n, 'seasons': D['seasons'], 'teams': D['teams'], 'names': names,
           'cols': {k: cols[k] for k in D['cols']}}
    if 'coverage' in D:
        out['coverage'] = D['coverage']
    return out


def read_pbp(path):
    with gzip.open(path, 'rt', encoding='utf-8', newline='') as fh:
        yield from csv.DictReader(fh)


def f(v):
    return None if v in ('', 'NA', None) else float(v)


def pbp_rows(path, sidx, teams, weeks=None):
    ti = {t: i for i, t in enumerate(teams)}
    rows, games, ended, null_epa = [], defaultdict(set), set(), []
    for p in read_pbp(path):
        wk = int(p['week'])
        if weeks is not None and (p['season_type'] != 'REG' or wk not in weeks):
            continue
        games[wk].add(p['game_id'])
        if 'END GAME' in (p['desc'] or ''):
            ended.add(p['game_id'])
        is_pass, is_rush = f(p['pass']) == 1, f(p['rush']) == 1
        if not (is_pass or is_rush):
            continue
        epa = f(p['epa'])
        if epa is None:
            null_epa.append(p['game_id'] + ' ' + p['play_id'])
            continue
        cpoe, wp, down = f(p['cpoe']), f(p['wp']), f(p['down'])
        rows.append({
            'season': sidx, 'week': wk, 'pos': ti[p['posteam']],
            'def': ti.get(p['defteam'], 255), 'down': int(down) if down is not None else 0,
            'qtr': int(f(p['qtr'])), 'wp': rnd(wp * 100) if wp is not None else 0,
            'flags': int(is_pass) | (int(f(p['success']) == 1) << 1) | ((cpoe is not None) << 2)
                     | ((p['season_type'] == 'POST') << 3),
            'epa': rnd(epa * 100), 'cpoe': rnd(cpoe * 10) if cpoe is not None else 0,
            'name': (p['passer'] if is_pass else p['rusher']) or '',
        })
        if rows[-1]['name'] == 'NA':
            rows[-1]['name'] = ''
    return rows, games, ended, null_epa


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--season', type=int, required=True)
    ap.add_argument('--pbp')
    ap.add_argument('--weeks', help='comma list of REG weeks to include, e.g. 1,2')
    ap.add_argument('--games-per-week', type=int, default=16)
    ap.add_argument('--as-of')
    ap.add_argument('--source-note', default='')
    ap.add_argument('--verify', metavar='PBP', help='re-encode a season already in the blob and diff it')
    a = ap.parse_args()
    s, i, j, D = load_page()
    old = decode(D)

    if a.verify:
        sidx = D['seasons'].index(a.season)
        mine, *_ = pbp_rows(a.verify, sidx, D['teams'])
        theirs = [r for r in old if r['season'] == sidx]
        print(f'{a.season}: blob {len(theirs)} rows, re-encoded {len(mine)} rows')
        if len(mine) == len(theirs):
            diff = {k: sum(x[k] != y[k] for x, y in zip(mine, theirs)) for k in theirs[0]}
            print('per-column mismatches:', diff)
            sys.exit(0 if not any(diff.values()) else 1)
        sys.exit(1)

    weeks = sorted(int(w) for w in a.weeks.split(',')) if a.weeks else None
    if weeks is None or not a.pbp or not a.as_of:
        ap.error('--pbp, --weeks and --as-of are required when writing')
    seasons = list(D['seasons'])
    if a.season not in seasons:
        seasons.append(a.season)
        seasons.sort()
    sidx = seasons.index(a.season)
    remap = {old_i: seasons.index(yr) for old_i, yr in enumerate(D['seasons'])}

    new, games, ended, null_epa = pbp_rows(a.pbp, sidx, D['teams'], set(weeks))
    problems = []
    for w in weeks:
        if len(games.get(w, ())) != a.games_per_week:
            problems.append(f'week {w}: {len(games.get(w, ()))} games, expected {a.games_per_week}')
    all_games = set().union(*games.values()) if games else set()
    if all_games - ended:
        problems.append('games without END GAME: ' + ', '.join(sorted(all_games - ended)))
    if null_epa:
        problems.append(f'{len(null_epa)} pass/rush plays with null EPA, e.g. {null_epa[:3]}')
    if problems:
        print('COMPLETENESS GATE FAILED — nothing written:\n  ' + '\n  '.join(problems))
        sys.exit(2)

    kept = []
    for r in old:
        if D['seasons'][r['season']] == a.season:
            continue
        r = dict(r, season=remap[r['season']])
        kept.append(r)
    rows = sorted(kept, key=lambda r: r['season'])  # stable: file order within a season
    before = [r for r in rows if r['season'] < sidx]
    after = [r for r in rows if r['season'] > sidx]
    rows = before + new + after

    D2 = dict(D, seasons=seasons)
    cov = dict(D.get('coverage', {}))
    for yr in seasons:
        k = str(yr)
        yi = seasons.index(yr)
        sr = [r for r in rows if r['season'] == yi]
        entry = dict(cov.get(k, {}))
        entry['plays'] = len(sr)
        entry['reg_plays_with_down'] = sum(1 for r in sr if not (r['flags'] >> 3) & 1 and r['down'])
        if yr != a.season and 'weeks' not in entry:
            entry.update(season_types=['REG', 'POST'] if any((r['flags'] >> 3) & 1 for r in sr) else ['REG'],
                         weeks='all', captured='2026-07-29')
        cov[k] = entry
    cov[str(a.season)].update(season_types=['REG'], weeks=weeks, games=len(all_games),
                              games_per_week={str(w): len(games[w]) for w in weeks},
                              captured=a.as_of)
    if a.source_note:
        cov[str(a.season)]['note'] = a.source_note
    D2['coverage'] = {k: cov[k] for k in sorted(cov)}
    out = encode(D2, rows)

    # carried-over seasons must survive byte-for-byte
    chk = decode(out)
    olds = [r for r in chk if seasons[r['season']] != a.season]
    ref = [dict(r, season=remap[r['season']]) for r in old if D['seasons'][r['season']] != a.season]
    assert olds == ref, 'carried-over rows changed'
    s2 = s[:i] + MARK + json.dumps(out) + ';' + s[j:]
    open(PAGE, 'w', encoding='utf-8', newline='').write(s2)
    print(json.dumps(out['coverage'], indent=1))
    print(f"n: {D['n']} -> {out['n']}; names: {len(D['names'])} -> {len(out['names'])}")


if __name__ == '__main__':
    main()
