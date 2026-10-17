"""Local indexed development export. All positions/seasons by default; WR is an explicit study."""
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import zipfile
from development import SOURCE_SHA, SOURCE_SIZE, NULLS, canonical, persist

TABLES = ('players', 'combine_results', 'combine_tracking', 'games', 'player_play', 'game_tracking')
YEARS = ('2023', '2024')
WR_POLICY = 'wr-draft-season-reg-v1'
POLICY = 'all-position-development-v1'
MAX_ROWS, MAX_RAW, MAX_GZIP = 2048, 1048576, 262144

def selector(table, r):
    if table == 'games':
        return {k: r[k] for k in ('season', 'season_type', 'game_id')}
    if table in ('player_play', 'game_tracking'):
        return dict(season=r['dd_season'], season_type=r['dd_season_type'], game_id=r['game_id'], play_id=r['play_id'], nfl_id=r['nfl_id'])
    return {k: r[k] for k in ('draft_year', 'nfl_id')}

def prepare(source, out, expected_sha=SOURCE_SHA, expected_size=SOURCE_SIZE, policy=POLICY):
    if policy not in (POLICY, WR_POLICY):
        raise ValueError('unknown population policy')
    wr_only = policy == WR_POLICY
    source, out = Path(source).resolve(), Path(out).resolve()
    if any((p/'.git').exists() for p in (out, *out.parents)):
        raise ValueError('output must be outside Git')
    if out == source or source.is_relative_to(out):
        raise ValueError('output must be separate from source')
    with source.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    if digest != expected_sha or source.stat().st_size != expected_size:
        raise ValueError('source identity mismatch')
    out.mkdir(parents=True, exist_ok=True)
    manifest = dict(version=3, sourceSha256=digest, classes=list(YEARS), seasons=list(YEARS),
                    holdoutRead=False, policy=policy, tables={},
                    limitations=[('WR study: REG season equals draft_year.' if wr_only else 'All source positions; PRE/REG/POST and cross-draft-year development seasons retained.'),
                    'Draft classes and NFL seasons 2023-2024 only; cohort players only, no ball/context players.',
                    'Tracking without player_play match is retained. No outcome construction.',
                    'Units and timestamp timezone unverified. Nulls preserved without imputation.',
                    'Prefix lookup discovers bounded child-selector pages; full selectors address row ranges.',
                    'Compressed artifacts can contain adjacent eligible partitions; ranges identify exact lookup rows.'])
    with zipfile.ZipFile(source) as z, tempfile.TemporaryDirectory(prefix='v3-stage-', dir=out) as stage:
        headers = {}
        def rows(table):
            names = [n for n in z.namelist() if Path(n).name == table+'.csv']
            if len(names) != 1:
                raise ValueError('missing or ambiguous table: '+table)
            with io.TextIOWrapper(z.open(names[0]), encoding='utf-8-sig', newline='') as f:
                reader = csv.reader(f)
                cols = next(reader)
                if len(set(cols)) != len(cols) or any(not c or c.startswith('dd_') for c in cols):
                    raise ValueError('invalid schema')
                headers[table] = cols
                for values in reader:
                    if len(values) != len(cols):
                        raise ValueError('malformed row')
                    yield dict(zip(cols, values))
        players, games, player_ids, game_ids = {}, {}, set(), set()
        for r in rows('players'):
            if r['nfl_id'] not in NULLS:
                if r['nfl_id'] in player_ids:
                    raise ValueError('duplicate player identity across partitions')
                player_ids.add(r['nfl_id'])
            if r['draft_year'] not in YEARS or (wr_only and r['nfl_position'] != 'WR'):
                continue
            if r['nfl_id'] in NULLS or r['nfl_id'] in players:
                raise ValueError('missing or duplicate player identity')
            players[r['nfl_id']] = r
        for r in rows('games'):
            if r['game_id'] not in NULLS:
                if r['game_id'] in game_ids:
                    raise ValueError('duplicate game identity across partitions')
                game_ids.add(r['game_id'])
            if r['season'] not in YEARS or (wr_only and r['season_type'] != 'REG'):
                continue
            if r['season_type'] not in ('PRE', 'REG', 'POST'):
                raise ValueError('unknown season type')
            if r['game_id'] in NULLS or r['game_id'] in games:
                raise ValueError('missing or duplicate game identity')
            games[r['game_id']] = r
        def selected(table):
            sources = ('game_tracking_2023', 'game_tracking_2024') if table == 'game_tracking' else (table,)
            for name in sources:
                for r in rows(name):
                    if table in ('players', 'combine_results', 'combine_tracking'):
                        if table == 'players' and wr_only and r['nfl_position'] != 'WR':
                            continue
                        if r['draft_year'] not in YEARS or r['nfl_id'] not in players:
                            continue
                        if r['draft_year'] != players[r['nfl_id']]['draft_year']:
                            raise ValueError('cohort year mismatch')
                        if table != 'players':
                            r['dd_nfl_position'] = players[r['nfl_id']]['nfl_position']
                    elif table == 'games':
                        if r['season'] not in YEARS or (wr_only and r['season_type'] != 'REG') or r['game_id'] not in games:
                            continue
                    else:
                        p, g = players.get(r['nfl_id']), games.get(r['game_id'])
                        if p is None or g is None or (wr_only and p['draft_year'] != g['season']):
                            continue
                        if table == 'game_tracking' and g['season'] != name[-4:]:
                            raise ValueError('tracking season mismatch')
                        r.update(dd_season=g['season'], dd_season_type=g['season_type'], dd_draft_year=p['draft_year'], dd_nfl_position=p['nfl_position'])
                    yield {k: None if v in NULLS else v for k, v in r.items()}
        db = sqlite3.connect(str(Path(stage)/'rows.sqlite'))
        try:
            for table in TABLES:
                db.execute('CREATE TABLE staged (partition TEXT, ordinal INTEGER, payload TEXT)')
                columns, missing, count = None, {}, 0
                for r in selected(table):
                    if columns is None:
                        columns, missing = list(r), dict.fromkeys(r, 0)
                    if list(r) != columns:
                        raise ValueError('schema drift')
                    for k, v in r.items():
                        missing[k] += v is None
                    s = selector(table, r)
                    if any(not isinstance(v, str) or not v or len(v) > 200 for v in s.values()):
                        raise ValueError('invalid partition identity')
                    db.execute('INSERT INTO staged VALUES (?, ?, ?)', (canonical(s).decode(), count, canonical(r).decode()))
                    count += 1
                db.commit()
                if table == 'game_tracking' and headers['game_tracking_2023'] != headers['game_tracking_2024']:
                    raise ValueError('tracking member schema drift')
                if columns is None:
                    columns = headers['game_tracking_2023' if table == 'game_tracking' else table].copy()
                    if table in ('player_play', 'game_tracking'):
                        columns += ['dd_season', 'dd_season_type', 'dd_draft_year', 'dd_nfl_position']
                    elif table in ('combine_results', 'combine_tracking'):
                        columns += ['dd_nfl_position']
                    missing = dict.fromkeys(columns, 0)
                entries = {}
                chunk, partitions, estimated = [], [], 0
                def flush():
                    nonlocal estimated
                    if not chunk:
                        return
                    obj = dict(version=3, sourceSha256=digest, policy=policy, table=table, columns=columns, rows=chunk)
                    raw = canonical(obj)
                    compressed = gzip.compress(raw, compresslevel=6, mtime=0)
                    if len(raw) > MAX_RAW or len(compressed) > MAX_GZIP:
                        # Split deterministically; retain ranges and row multiplicity.
                        if len(chunk) == 1:
                            raise ValueError('single row exceeds shard bound')
                        saved_rows, saved_parts = chunk.copy(), partitions.copy()
                        middle = len(chunk)//2
                        chunk[:], partitions[:] = saved_rows[:middle], saved_parts[:middle]
                        flush()
                        chunk[:], partitions[:] = saved_rows[middle:], saved_parts[middle:]
                        flush()
                        return
                    h = hashlib.sha256(compressed).hexdigest()
                    target = out/(h+'.gz')
                    if target.exists() and target.read_bytes() != compressed:
                        raise ValueError('immutable artifact conflict')
                    target.write_bytes(compressed)
                    desc = dict(sha256=h, decodedSha256=hashlib.sha256(raw).hexdigest(), compressedBytes=len(compressed), decodedBytes=len(raw), rows=len(chunk))
                    start = 0
                    while start < len(chunk):
                        key = partitions[start]
                        end = start+1
                        while end < len(chunk) and partitions[end] == key:
                            end += 1
                        entry = entries.setdefault(key, dict(selector=json.loads(key), rows=0, shards=[]))
                        entry['shards'].append(dict(**desc, start=start, count=end-start))
                        entry['rows'] += end-start
                        start = end
                    chunk.clear(); partitions.clear(); estimated = 0
                for key, payload in db.execute('SELECT partition, payload FROM staged ORDER BY partition, ordinal'):
                    size = len(payload.encode())+1
                    if chunk and (len(chunk) >= MAX_ROWS or estimated+size > 1000000):
                        flush()
                    chunk.append(json.loads(payload)); partitions.append(key); estimated += size
                flush()
                fields = list(selector(table, {c:'x' for c in columns}))
                prefixes = {}
                for entry in entries.values():
                    full = entry['selector']
                    for length in range(len(fields)):
                        partial = {k:full[k] for k in fields[:length]}
                        child = {k:full[k] for k in fields[:length+1]}
                        parent = prefixes.setdefault(canonical(partial).decode(), dict(selector=partial, children={}))
                        parent['children'][canonical(child).decode()] = child
                keyed = []
                for key, entry in [*entries.items(), *prefixes.items()]:
                    kind = 'shards' if 'shards' in entry else 'children'
                    values = entry['shards'] if kind == 'shards' else [v for _,v in sorted(entry['children'].items())]
                    indexed = dict(key=hashlib.sha256(key.encode()).hexdigest(),selector=entry['selector'],kind=kind,rows=entry.get('rows'))
                    if len(values)<=64 and len(canonical(values))<=16384:
                        indexed['values'] = values
                    else:
                        pages, page_values = [], []
                        def page_object(items):
                            return dict(version=3,kind='page',sourceSha256=digest,table=table,selector=entry['selector'], **{kind:items})
                        for value in values:
                            trial = page_values+[value]
                            if page_values and (len(trial)>64 or len(canonical(page_object(trial)))>65536):
                                pages.append(persist(out,page_object(page_values)))
                                page_values = []
                            page_values.append(value)
                            if len(canonical(page_object(page_values)))>65536:
                                raise ValueError('single metadata item exceeds page bound')
                        if page_values:
                            pages.append(persist(out,page_object(page_values)))
                        if len(pages)>256:
                            raise ValueError('partition exceeds bounded page capacity')
                        indexed['pages'] = pages
                    keyed.append(indexed)
                def index(items, depth=0):
                    leaf = dict(version=3, kind='lookup', sourceSha256=digest, table=table, entries=items)
                    if len(items) <= 32 and len(canonical(leaf)) <= 65536:
                        return persist(out, leaf)
                    if depth >= 6:
                        raise ValueError('lookup index exceeds depth/entry bound')
                    groups = {}
                    for item in items:
                        groups.setdefault(item['key'][depth], []).append(item)
                    children = [dict(prefix=k, sha256=index(v, depth+1)) for k,v in sorted(groups.items())]
                    return persist(out, dict(version=3, kind='lookup', sourceSha256=digest, table=table, children=children))
                manifest['tables'][table] = dict(root=index(keyed), rows=count, partitions=len(entries), selector=fields, columns=[dict(name=c,type='string|null',unit='unverified',missing=missing[c]) for c in columns])
                db.execute('DROP TABLE staged'); db.commit()
        finally:
            db.close()
    if len(canonical(manifest)) > 65536:
        raise ValueError('manifest exceeds read bound')
    return persist(out, manifest), manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source'); parser.add_argument('--out', required=True)
    parser.add_argument('--policy', choices=(POLICY, WR_POLICY), default=POLICY)
    args = parser.parse_args()
    pin, manifest = prepare(args.source, args.out, policy=args.policy)
    print(json.dumps(dict(manifestSha256=pin, tables={t:dict(rows=d['rows'],partitions=d['partitions']) for t,d in manifest['tables'].items()})))
