"""Offline exhaustive V2/V3 population equivalence. Hashes only in temporary sort files.

Compares sorted SHA-256 fingerprints of every original-column row occurrence,
so order changes are allowed but duplicate multiplicity cannot disappear.
Never opens the source archive, holdout members, a network connection or a token.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import heapq
import itertools
import json
from pathlib import Path
import tempfile
from development import canonical, SOURCE_SHA

def checked_json(directory, digest):
    if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('invalid hash')
    raw=(directory/(digest+'.json')).read_bytes()
    if len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=digest:
        raise ValueError('metadata integrity failed')
    return json.loads(raw)

def v2_rows(directory, manifest, table):
    def walk(digest):
        node=checked_json(directory,digest)
        if 'children' in node:
            for child in node['children']:yield from walk(child)
        else:
            for descriptor in node['artifacts']:
                raw=(directory/(descriptor['sha256']+'.json')).read_bytes()
                if len(raw)>131072 or hashlib.sha256(raw).hexdigest()!=descriptor['sha256']:
                    raise ValueError('V2 artifact integrity failed')
                a=json.loads(raw)
                if a['table']!=table or len(a['rows'])!=descriptor['rows']:
                    raise ValueError('V2 descriptor mismatch')
                yield from a['rows']
    yield from walk(manifest['tables'][table]['root'])

def v3_rows(directory, manifest, table):
    references={}
    def artifact(d):
        compressed=(directory/(d['sha256']+'.gz')).read_bytes()
        if len(compressed)>262144 or len(compressed)!=d['compressedBytes'] or hashlib.sha256(compressed).hexdigest()!=d['sha256']:
            raise ValueError('V3 compressed integrity failed')
        # Local bounded streaming decompression, before parsing JSON.
        import io
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            raw=stream.read(1048577)
        if len(raw)>1048576 or len(raw)!=d['decodedBytes'] or hashlib.sha256(raw).hexdigest()!=d['decodedSha256']:
            raise ValueError('V3 decoded integrity failed')
        a=json.loads(raw)
        if a['table']!=table or a['sourceSha256']!=SOURCE_SHA or a['policy']!=manifest['policy'] or len(a['rows'])!=d['rows'] or len(a['rows'])>2048:
            raise ValueError('V3 descriptor mismatch')
        return a['rows']
    def walk(digest, depth=0):
        if depth>6:raise ValueError('index depth')
        node=checked_json(directory,digest)
        if node['table']!=table or node['sourceSha256']!=SOURCE_SHA:raise ValueError('index identity')
        if 'children' in node:
            for child in node['children']:yield from walk(child['sha256'],depth+1)
        else:
            for entry in node['entries']:
                if entry['kind']!='shards':continue
                pages=[entry['values']] if 'values' in entry else [checked_json(directory,h)['shards'] for h in entry['pages']]
                count=0
                for descriptors in pages:
                    for d in descriptors:
                        references.setdefault(d['sha256'],[]).append((d,entry['selector']))
                        count+=d['count']
                if count!=entry['rows']:raise ValueError('partition total')
    # Group only metadata references; decode each compressed shard once even when
    # the hash trie puts neighbouring row ranges on distant lookup leaves.
    list(walk(manifest['tables'][table]['root']))
    for digest,occurrences in sorted(references.items()):
        rows=artifact(occurrences[0][0])
        first=occurrences[0][0]
        for d,selection in occurrences:
            if any(d[k]!=first[k] for k in ('decodedSha256','compressedBytes','decodedBytes','rows')):raise ValueError('conflicting shared descriptor')
            selected=rows[d['start']:d['start']+d['count']]
            if len(selected)!=d['count']:raise ValueError('range count')
            for row in selected:
                for k,v in selection.items():
                    column='dd_'+k if table in ('player_play','game_tracking') and k in ('season','season_type') else k
                    if row[column]!=v:raise ValueError('partition mismatch')
                yield row

def sorted_fingerprints(rows, columns, directory, prefix, inspect=lambda r:None):
    chunk=[];files=[];count=0
    def flush():
        if not chunk:return
        chunk.sort();p=directory/(prefix+'-'+str(len(files))+'.hashes');p.write_bytes(b''.join(chunk));files.append(p);chunk.clear()
    for row in rows:
        inspect(row)
        if any(c not in row for c in columns):raise ValueError('original column missing')
        chunk.append(hashlib.sha256(canonical({c:row[c] for c in columns})).digest());count+=1
        if len(chunk)==100000:flush()
    flush()
    def stream(p):
        with p.open('rb') as f:
            while True:
                value=f.read(32)
                if not value:return
                if len(value)!=32:raise ValueError('truncated sort chunk')
                yield value
    def merged():
        iterators=[stream(p) for p in files]
        try:yield from heapq.merge(*iterators)
        finally:
            for iterator in iterators:iterator.close()
    return count,merged()

def verify(v2_directory, v2_pin, v3_directory, v3_pin, receipt):
    v2_directory,v3_directory,receipt=map(lambda p:Path(p).resolve(),(v2_directory,v3_directory,receipt))
    if any((p/'.git').exists() for p in (receipt.parent,*receipt.parents)):raise ValueError('receipt must be outside Git')
    old,new=checked_json(v2_directory,v2_pin),checked_json(v3_directory,v3_pin)
    if old['sourceSha256']!=SOURCE_SHA or new['sourceSha256']!=SOURCE_SHA or new['policy']!='all-position-development-v1':raise ValueError('population identity')
    if old['classes']!=['2023','2024'] or new['classes']!=['2023','2024'] or old['holdoutRead'] is not False or new['holdoutRead'] is not False:raise ValueError('development boundary')
    players={r['nfl_id']:r for r in v2_rows(v2_directory,old,'players')}
    games={r['game_id']:r for r in v2_rows(v2_directory,old,'games')}
    play_keys=set()
    report=dict(localOnly=True,sourceArchiveOpened=False,authenticatedClientProof=False,v2ManifestSha256=v2_pin,v3ManifestSha256=v3_pin,method='Exact sorted sequence equality of SHA-256(original-column canonical row) including every occurrence; subject only to SHA-256 collision resistance.',tables={})
    for table in ('players','combine_results','combine_tracking','games','player_play','game_tracking'):
        columns=[c['name'] for c in old['tables'][table]['columns'] if not c['name'].startswith('dd_')]
        if columns!=[c['name'] for c in new['tables'][table]['columns'] if not c['name'].startswith('dd_')]:raise ValueError('source schema changed')
        positions,types,years=Counter(),Counter(),Counter();cross=unmatched=0
        def inspect(row):
            nonlocal cross,unmatched
            if table in ('player_play','game_tracking'):
                p,g=players[row['nfl_id']],games[row['game_id']]
                if row['dd_season']!=g['season'] or row['dd_season_type']!=g['season_type'] or row['dd_draft_year']!=p['draft_year'] or row['dd_nfl_position']!=p['nfl_position']:raise ValueError('derived eligibility join differs')
                if row['dd_season'] not in ('2023','2024') or row['dd_draft_year'] not in ('2023','2024') or row['dd_season_type'] not in ('PRE','REG','POST'):raise ValueError('scope breach')
                positions[row['dd_nfl_position']]+=1;types[row['dd_season_type']]+=1;years[row['dd_season']]+=1;cross+=row['dd_season']!=row['dd_draft_year']
                key=(row['game_id'],row['play_id'],row['nfl_id'])
                if table=='player_play':play_keys.add(key)
                else:unmatched+=key not in play_keys
            elif table=='players':positions[row['nfl_position']]+=1;years[row['draft_year']]+=1
            elif table=='games':types[row['season_type']]+=1;years[row['season']]+=1
            else:
                p=players[row['nfl_id']]
                if row['draft_year']!=p['draft_year'] or row['dd_nfl_position']!=p['nfl_position']:raise ValueError('combine join differs')
                positions[row['dd_nfl_position']]+=1;years[row['draft_year']]+=1
        with tempfile.TemporaryDirectory(prefix='v3-multiset-',dir=receipt.parent) as tmp:
            directory=Path(tmp)
            old_count,old_hashes=sorted_fingerprints(v2_rows(v2_directory,old,table),columns,directory,'v2')
            new_count,new_hashes=sorted_fingerprints(v3_rows(v3_directory,new,table),columns,directory,'v3',inspect)
            aggregate=hashlib.sha256();compared=0
            try:
                for a,b in itertools.zip_longest(old_hashes,new_hashes):
                    if a!=b:raise ValueError('row identity or multiplicity changed: '+table)
                    aggregate.update(a);compared+=1
            finally:
                old_hashes.close();new_hashes.close()
            if compared!=old_count or compared!=new_count or compared!=old['tables'][table]['rows'] or compared!=new['tables'][table]['rows']:raise ValueError('table total mismatch')
        report['tables'][table]=dict(rows=compared,originalColumnMultisetSha256=aggregate.hexdigest(),positionCounts=dict(positions),seasonTypeCounts=dict(types),yearCounts=dict(years),crossDraftYearRows=cross,unmatchedTrackingRows=unmatched)
        print(table+': '+str(compared)+' original-column occurrences match',flush=True)
    receipt.write_text(json.dumps(report,indent=2))
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('v2_directory','v2_pin','v3_directory','v3_pin','receipt'):p.add_argument(name)
    a=p.parse_args();verify(**vars(a))
