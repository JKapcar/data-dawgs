"""Prepare private immutable development artifacts OUTSIDE Git; never upload or open holdout tables.

Only two small tables are supported. CSV cells remain strings; missing tokens become null.
Units cannot be verified from headers and are explicitly unverified, never guessed.
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile

SOURCE_SHA = '27d52f594d6d31d4f617f9c94b0b37d11e280397ad8293c0987da5f91a8d0ced'
SOURCE_SIZE = 512718566
TABLES = ('players', 'combine_results')
NULLS = {'', 'NA', 'N/A', 'NaN', 'nan', 'NULL', 'null', 'None'}

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')

def persist(out, value):
    raw = canonical(value)
    digest = hashlib.sha256(raw).hexdigest()
    target = out / (digest + '.json')
    if target.exists() and target.read_bytes() != raw:
        raise ValueError('immutable artifact conflict')
    target.write_bytes(raw)
    return digest

def prepare(source, out, expected_sha=SOURCE_SHA, expected_size=SOURCE_SIZE):
    source, out = Path(source).resolve(), Path(out).resolve()
    # No restricted bytes in any repository, including a separate checkout.
    if any((p / '.git').exists() for p in (out, *out.parents)):
        raise ValueError('output must be outside Git')
    if out == source or source.is_relative_to(out):
        raise ValueError('output must be separate from source')
    with source.open('rb') as f:
        sha = hashlib.file_digest(f, 'sha256').hexdigest()
    if sha != expected_sha or source.stat().st_size != expected_size:
        raise ValueError('source identity mismatch')
    out.mkdir(parents=True, exist_ok=True)
    manifest = {'version': 1, 'sourceSha256': sha, 'classes': ['2023', '2024'],
                'holdoutRead': False, 'artifacts': [], 'tables': {},
                'unavailable': ['combine_tracking', 'game_tracking', 'games', 'player_play', 'player_career_successes'],
                'limitations': ['Only draft classes 2023-2024 in players and combine_results.',
                                'Career totals are not rookie-season snap share.',
                                'No verified unit dictionary supplied; do not convert or model units without validation.']}
    with zipfile.ZipFile(source) as z:
        for table in TABLES:
            members = [i for i in z.infolist() if Path(i.filename).name == table + '.csv']
            if len(members) != 1:
                raise ValueError('missing or ambiguous table: ' + table)
            with io.TextIOWrapper(z.open(members[0]), encoding='utf-8-sig', newline='') as f:
                reader = csv.reader(f)
                columns = next(reader)
                if len(set(columns)) != len(columns) or 'draft_year' not in columns or 'nfl_id' not in columns:
                    raise ValueError('invalid schema')
                year_index = columns.index('draft_year')
                rows, ids = [], set()
                for cells in reader:
                    # Only inspect the partition cell before deciding whether to retain a row.
                    # Mixed CSVs must be parsed to reach it; no holdout measurements are analyzed.
                    if len(cells) != len(columns):
                        raise ValueError('malformed row')
                    if cells[year_index] not in ('2023', '2024'):
                        continue
                    row = {k: None if v in NULLS else v for k, v in zip(columns, cells)}
                    if row['nfl_id'] is None or row['nfl_id'] in ids:
                        raise ValueError('missing or duplicate development identity')
                    ids.add(row['nfl_id'])
                    rows.append(row)
                rows.sort(key=lambda r: (r['draft_year'], r['nfl_id']))
                manifest['tables'][table] = {'rows': len(rows), 'columns': [
                    {'name': c, 'type': 'string|null', 'unit': 'unverified',
                     'missing': sum(r[c] is None for r in rows)} for c in columns],
                    'missingPolicy': 'explicit null; no imputation',
                    'requiredMissing': [c for c in ('position', 'rookie_offensive_snap_share') if c not in columns]}
                for start in range(0, len(rows), 256):
                    chunk = {'version': 1, 'sourceSha256': sha, 'table': table, 'columns': columns, 'rows': rows[start:start+256]}
                    if len(canonical(chunk)) > 131072:
                        raise ValueError('artifact exceeds read bound')
                    digest = persist(out, chunk)
                    manifest['artifacts'].append({'table': table, 'sha256': digest, 'rows': len(chunk['rows'])})
    if len(manifest['artifacts']) > 32 or len(canonical(manifest)) > 65536:
        raise ValueError('manifest exceeds read bound')
    return persist(out, manifest), manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    digest, manifest = prepare(args.source, args.out)
    print(json.dumps({'manifestSha256': digest, 'sourceVerified': True, 'holdoutRead': False,
                      'artifacts': len(manifest['artifacts']),
                      'rows': {k: v['rows'] for k, v in manifest['tables'].items()}}))
