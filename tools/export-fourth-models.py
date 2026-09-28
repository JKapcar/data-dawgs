"""Export XGBoost JSON models to a compact, lossless float32 browser bundle.

Usage: python tools/export-fourth-models.py INPUT_DIR
INPUT_DIR contains fd.json, ep.json, wp.json, home_wp.json, two_pt.json and
kicking.json exported from the pinned upstream R objects (see docs/fourth-down.md).
No fitting, interpolation, or invented coefficients occurs here.
"""
import gzip
import hashlib
import json
import struct
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / 'assets/fourth-down'
out.mkdir(parents=True, exist_ok=True)
blob = bytearray()
manifest = {'format': 1, 'models': {}, 'exported': '2026-09-28'}
for name in ['fd', 'ep', 'wp', 'home_wp', 'two_pt']:
    learner = json.loads((src / (name + '.json')).read_text())['learner']
    model = learner['gradient_booster']['model']
    param = learner['learner_model_param']
    classes = max(1, int(param['num_class']))
    base = json.loads(param['base_score'])
    if not isinstance(base, list):
        base = [base] * classes
    meta = {'classes': classes, 'features': int(param['num_feature']),
            'base': base, 'offset': len(blob), 'roots': [],
            'objective': learner['objective']['name']}
    count = 0
    for tree, group in zip(model['trees'], model['tree_info']):
        assert not any(tree['split_type']), 'Categorical splits need a different evaluator'
        meta['roots'].extend([count, group])
        for i, left in enumerate(tree['left_children']):
            right = tree['right_children'][i]
            flags = tree['split_indices'][i] | (int(tree['default_left'][i]) << 16)
            blob.extend(struct.pack('<iiIf', left + count if left >= 0 else -1,
                                    right + count if right >= 0 else -1,
                                    flags, tree['split_conditions'][i]))
        count += len(tree['left_children'])
    meta['nodes'] = count
    manifest['models'][name] = meta
manifest['kicking'] = json.loads((src / 'kicking.json').read_text())
compressed = gzip.compress(blob, compresslevel=9, mtime=0)
digest = hashlib.sha256(compressed).hexdigest()
manifest['sha256'] = digest
manifest['bytes'] = len(compressed)
manifest['file'] = 'models-' + digest[:12] + '.bin.gz'
(out / manifest['file']).write_bytes(compressed)
(out / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
print(f'Exported {len(blob):,} raw / {len(compressed):,} compressed bytes; SHA256 {digest}')
