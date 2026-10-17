"""Local-only full development exporter. Never uploads or opens holdout tracking.

Context policy: retain only 2023/2024 cohort athletes, not other players or ball
tracks. Games are season-filtered; player_play is the cohort player-play table,
not a fabricated deduplicated plays table. All source units remain unverified.
"""
import argparse
import csv
import hashlib
import io
from pathlib import Path
import zipfile
from development import SOURCE_SHA, SOURCE_SIZE, NULLS, canonical, persist

CLASSES = ['2023', '2024']
POLICY = 'development-cohort-only-v1'
TABLES = ('players', 'combine_results', 'combine_tracking', 'games', 'player_play', 'game_tracking')

def prepare(source, out, expected_sha=SOURCE_SHA, expected_size=SOURCE_SIZE):
    source, out = Path(source).resolve(), Path(out).resolve()
    if any((p / '.git').exists() for p in (out, *out.parents)):
        raise ValueError('output must be outside Git')
    if out == source or source.is_relative_to(out):
        raise ValueError('output must be separate from source')
    with source.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    if digest != expected_sha or source.stat().st_size != expected_size:
        raise ValueError('source identity mismatch')
    out.mkdir(parents=True, exist_ok=True)
    manifest = dict(version=2, sourceSha256=digest, classes=CLASSES, seasons=CLASSES,
                    policy=POLICY, holdoutRead=False, tables={},
                    limitations=['Units unverified; no conversion or imputation.',
                                 'Only cohort athletes; other players and ball tracks excluded.',
                                 'Career successes excluded: career totals are not rookie snap share.',
                                 'time is a source timestamp, not an invented frame_id.',
                                 'player_play preserves player-level rows; no fabricated play outcome.'])
    with zipfile.ZipFile(source) as z:
        headers = {}
        def source_rows(table):
            names = [n for n in z.namelist() if Path(n).name == table + '.csv']
            if len(names) != 1:
                raise ValueError('missing or ambiguous table: ' + table)
            with io.TextIOWrapper(z.open(names[0]), encoding='utf-8-sig', newline='') as f:
                reader = csv.reader(f)
                columns = next(reader)
                if len(columns) != len(set(columns)) or any(c.startswith('dd_') for c in columns):
                    raise ValueError('invalid schema')
                headers[table] = columns
                for values in reader:
                    if len(values) != len(columns):
                        raise ValueError('malformed row')
                    yield dict(zip(columns, values))
        players = {}
        for r in source_rows('players'):
            if r['draft_year'] not in CLASSES:
                continue
            if r['nfl_id'] in NULLS or r['nfl_id'] in players:
                raise ValueError('missing or duplicate player identity')
            players[r['nfl_id']] = r
        games = {}
        for r in source_rows('games'):
            if r['season'] not in CLASSES:
                continue
            if r['game_id'] in NULLS or r['game_id'] in games:
                raise ValueError('missing or duplicate game identity')
            games[r['game_id']] = r

        def selected(table):
            sources = ('game_tracking_2023', 'game_tracking_2024') if table == 'game_tracking' else (table,)
            for name in sources:
                for r in source_rows(name):
                    if table in ('players', 'combine_results', 'combine_tracking'):
                        if r['draft_year'] not in CLASSES:
                            continue
                        if r['nfl_id'] not in players or players[r['nfl_id']]['draft_year'] != r['draft_year']:
                            raise ValueError('development cohort join failed')
                    elif table == 'games':
                        if r['season'] not in CLASSES:
                            continue
                    else:
                        if r['game_id'] not in games or r['nfl_id'] not in players:
                            continue
                        if table == 'game_tracking' and games[r['game_id']]['season'] != name[-4:]:
                            raise ValueError('tracking season mismatch')
                        r['dd_season'] = games[r['game_id']]['season']
                        r['dd_draft_year'] = players[r['nfl_id']]['draft_year']
                    yield {k: None if v in NULLS else v for k, v in r.items()}

        for table in TABLES:
            columns = None
            missing = {}
            count = 0
            chunk = []
            chunk_bytes = 0
            leaves = []
            descriptors = []
            def flush_leaf():
                if descriptors:
                    obj = dict(version=2, kind='index', sourceSha256=digest, table=table,
                               artifacts=descriptors.copy())
                    leaves.append(persist(out, obj))
                    descriptors.clear()
            def flush():
                nonlocal chunk_bytes
                if not chunk:
                    return
                obj = dict(version=2, sourceSha256=digest, table=table, columns=columns, rows=chunk.copy())
                raw = canonical(obj)
                if len(raw) > 131072:
                    raise ValueError('artifact exceeds read bound')
                descriptors.append(dict(sha256=persist(out, obj), rows=len(chunk)))
                chunk.clear()
                chunk_bytes = 0
                if len(descriptors) == 64:
                    flush_leaf()
            for row in selected(table):
                if columns is None:
                    columns = list(row)
                    missing = dict.fromkeys(columns, 0)
                if list(row) != columns:
                    raise ValueError('schema drift')
                for k, v in row.items():
                    missing[k] += v is None
                # Conservative bytes bound handles wide player_play rows.
                row_bytes = len(canonical(row)) + 1
                if chunk and (len(chunk) == 256 or chunk_bytes + row_bytes > 120000):
                    flush()
                chunk.append(row)
                chunk_bytes += row_bytes
                count += 1
            flush()
            flush_leaf()
            if table == 'game_tracking' and headers['game_tracking_2023'] != headers['game_tracking_2024']:
                raise ValueError('tracking member schema drift')
            if columns is None:
                columns = headers['game_tracking_2023' if table == 'game_tracking' else table].copy()
                if table in ('game_tracking', 'player_play'):
                    columns += ['dd_season', 'dd_draft_year']
                missing = dict.fromkeys(columns, 0)
            if not leaves:
                leaves.append(persist(out, dict(version=2, kind='index', sourceSha256=digest, table=table, artifacts=[])))
            depth = 0
            while len(leaves) > 1:
                leaves = [persist(out, dict(version=2, kind='index', sourceSha256=digest, table=table,
                                           children=leaves[i:i+64])) for i in range(0, len(leaves), 64)]
                depth += 1
            if depth > 6:
                raise ValueError('index exceeds depth bound')
            manifest['tables'][table] = dict(rows=count, root=leaves[0], depth=depth,
                columns=[dict(name=c, type='string|null', unit='unverified', missing=missing[c]) for c in columns or []])
    if len(canonical(manifest)) > 65536:
        raise ValueError('manifest exceeds read bound')
    return persist(out, manifest), manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    digest, manifest = prepare(args.source, args.out)
    print({'manifestSha256': digest, 'rows': {k: v['rows'] for k, v in manifest['tables'].items()}})
