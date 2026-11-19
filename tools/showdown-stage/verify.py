#!/usr/bin/env python3
"""Validate all records, partition counts, salaries, identities and compressed hashes."""
import gzip,json,sys
from pathlib import Path
from archive import RECORD,FORMAT,sha256

def verify(root):
    root=Path(root)
    if (root/'INCOMPLETE').exists():raise ValueError('incomplete archive')
    m=json.loads((root/'manifest.json').read_text());assert m['format']==FORMAT
    a=m['flex'];total=0
    assert len(m['partitions'])==len(a)
    for index,p in enumerate(m['partitions']):
        c=p['captain_index'];assert c==index
        assert p['captain_id']==a[c]['roles']['CPT']['id']
        path=root/p['file'];assert path.parent==root
        assert sha256(path)==p['sha256'];assert path.stat().st_size==p['compressed_bytes']
        count=0;previous=None
        with gzip.open(path,'rb') as f:
            while True:
                data=f.read(RECORD.size*16384)
                if not data:break
                assert len(data)%7==0
                for *indices,salary in RECORD.iter_unpack(data):
                    indices=tuple(indices)
                    assert tuple(sorted(set(indices)))==indices and len(indices)==5
                    assert c not in indices and max(indices)<len(a)
                    assert previous is None or indices>previous
                    previous=indices
                    assert salary==a[c]['roles']['CPT']['salary']+sum(a[i]['roles']['FLEX']['salary'] for i in indices)
                    assert salary<=50000
                    assert len({a[i]['team'] for i in (c,)+indices})==2
                    count+=1
        assert count==p['count'];assert count*7==p['uncompressed_bytes'];total+=count
    assert total==m['total_lineups']
    return {'status':'verified','partitions':len(a),'records':total,'official':m['source']['official']}
if __name__=='__main__':print(json.dumps(verify(sys.argv[1])))
