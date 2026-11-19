#!/usr/bin/env python3
"""Strict, exhaustive DraftKings Showdown archive. Python 3.10+, standard library only."""
import argparse, csv, gzip, hashlib, itertools, json, re, struct, unicodedata
from pathlib import Path

FORMAT = 'showdown-stage/1'
RECORD = struct.Struct('<5BH')
REQUIRED = {'Name + ID', 'Name', 'ID', 'Roster Position', 'Salary', 'Game Info', 'TeamAbbrev'}

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1048576), b''): h.update(b)
    return h.hexdigest()

def norm(s):
    return ' '.join(unicodedata.normalize('NFKC', s).casefold().split())

def load_source(path, expected_game, sample=False):
    """Identity is normalized name + exact team; ambiguous identities are rejected."""
    if not re.fullmatch(r'[A-Z0-9]+@[A-Z0-9]+', expected_game):
        raise ValueError('expected game must be AWAY@HOME, e.g. IND@HOU')
    teams = expected_game.split('@')
    if teams[0] == teams[1]: raise ValueError('game requires two different teams')
    athletes, ids, game_infos = {}, set(), set()
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError('missing or duplicate CSV headers')
        if not REQUIRED <= set(reader.fieldnames): raise ValueError('missing columns: '+str(sorted(REQUIRED-set(reader.fieldnames))))
        for line, row in enumerate(reader, 2):
            if None in row or any(row[k] is None for k in REQUIRED): raise ValueError(f'line {line}: malformed CSV row')
            v = {k: row[k].strip() for k in REQUIRED}
            if any(not x for x in v.values()): raise ValueError(f'line {line}: empty required value')
            role = v['Roster Position']
            if role not in ('CPT','FLEX'): raise ValueError(f'line {line}: ambiguous role {role!r}')
            ident = v['ID']
            if not re.fullmatch(r'SAMPLE_[0-9]+_(?:CPT|FLEX)' if sample else r'[0-9]+',ident) or ident in ids: raise ValueError(f'line {line}: invalid/duplicate ID')
            ids.add(ident)
            if v['Name + ID'] != f"{v['Name']} ({ident})": raise ValueError(f'line {line}: Name + ID mismatch')
            if not re.fullmatch(r'[0-9]+',v['Salary']): raise ValueError(f'line {line}: salary must be integer dollars')
            salary = int(v['Salary'])
            if not 0 < salary <= 50000: raise ValueError(f'line {line}: salary outside supported range')
            game = v['Game Info'].split()[0]
            if game != expected_game or v['TeamAbbrev'] not in teams: raise ValueError(f'line {line}: wrong/ambiguous game or team')
            game_infos.add(v['Game Info'])
            key = v['TeamAbbrev'] + ':' + norm(v['Name'])
            athlete = athletes.setdefault(key, {'identity':key, 'name':v['Name'], 'team':v['TeamAbbrev'], 'roles':{}})
            if athlete['name'] != v['Name'] or role in athlete['roles']: raise ValueError(f'line {line}: ambiguous athlete identity/duplicate role')
            athlete['roles'][role] = {'id':ident, 'salary':salary, 'name_plus_id':v['Name + ID']}
    if len(game_infos) != 1: raise ValueError('source must contain exactly one complete Game Info value')
    if not 6 <= len(athletes) <= 256: raise ValueError('supported athlete count is 6..256')
    if {a['team'] for a in athletes.values()} != set(teams): raise ValueError('both teams required in source')
    if any(set(a['roles']) != {'CPT','FLEX'} for a in athletes.values()): raise ValueError('every athlete must have exactly one CPT and one FLEX role')
    return sorted(athletes.values(), key=lambda a:a['identity']), sorted(game_infos)

def legal_rows(athletes, captain):
    c = athletes[captain]
    salaries = [a['roles']['FLEX']['salary'] for a in athletes]
    same = [a['team'] == c['team'] for a in athletes]
    base = c['roles']['CPT']['salary']
    for combo in itertools.combinations((i for i in range(len(athletes)) if i != captain), 5):
        total = base + sum(salaries[i] for i in combo)
        if total <= 50000 and not all(same[i] for i in combo):
            yield combo, total

def generate(source, output, game, provenance, sample=False):
    source, output = Path(source), Path(output)
    before = sha256(source)
    athletes, infos = load_source(source, game, sample)
    if sha256(source) != before: raise ValueError('source changed while reading')
    if output.exists(): raise ValueError('output directory already exists; refusing overwrite')
    output.mkdir(parents=True)
    manifest = {'format':FORMAT, 'record':{'struct':'<5BH','bytes':7,'compression':'gzip','captain':'implicit per partition','flex_indices':'strictly increasing zero-based indices into flex dictionary','salary':'uint16 little-endian total dollars'},'source':{'file_name':source.name,'sha256':before,'provenance':provenance,'official':not sample,'sample_only':sample}, 'game':{'requested':game,'observed':infos,'teams':game.split('@'),'validation':'passed'}, 'rules':{'salary_cap':50000,'distinct_athletes':6,'captains':1,'flex':5,'both_teams_required':True,'additional_filters':[]},'identity_method':'NFKC casefold whitespace-normalized name + exact TeamAbbrev; ambiguity rejected','flex':athletes,'partitions':[], 'total_lineups':0}
    try:
        for i, a in enumerate(athletes):
            name = f'captain_{i:03d}.bin.gz'
            dest = output/name
            count = 0
            with open(dest,'wb') as raw, gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0,compresslevel=6) as z:
                for combo, total in legal_rows(athletes,i):
                    z.write(RECORD.pack(*combo,total)); count += 1
            manifest['partitions'].append({'captain_index':i,'captain_id':a['roles']['CPT']['id'],'file':name,'count':count,'uncompressed_bytes':count*7,'compressed_bytes':dest.stat().st_size,'sha256':sha256(dest)})
            manifest['total_lineups'] += count
        (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    except BaseException:
        (output/'INCOMPLETE').write_text('Generation interrupted. Do not consume this archive.\n')
        raise
    return manifest

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sample',action='store_true',help='Non-official sample only, requires SAMPLE_* slot IDs'); p.add_argument('source'); p.add_argument('output'); p.add_argument('--game',required=True)
    p.add_argument('--provenance',required=True,help='Actual source provenance, e.g. official DraftKings salary export downloaded YYYY-MM-DD')
    args=p.parse_args()
    try:
        m=generate(args.source,args.output,args.game,args.provenance,args.sample)
    except (ValueError,OSError,csv.Error) as e: p.exit(2, f'ERROR: {e}\n')
    print(json.dumps({'manifest':str(Path(args.output)/'manifest.json'),'total_lineups':m['total_lineups']}))

if __name__=='__main__': main()
