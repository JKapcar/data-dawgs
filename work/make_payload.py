#!/usr/bin/env python3
"""Build the browser-side ship payload for a staged commit.

    git add -A && python3 work/make_payload.py <base-sha> [outdir]

Writes <outdir>/payload.b64.NN (~7,000-char chunks) and <outdir>/manifest.json.
Default outdir is work/.payload.

The repo cannot be pushed from a Cowork session, so a commit is assembled in page JS on the
github.com origin. See project memory deploy-payload and deploy-payload-v2 for the whole
pipeline; this script is the container half of it.

WHY LINE-SPLICE OPS RATHER THAN ANCHORED STRING PAIRS
Each modified file ships as `[i1, i2, [newLines]]` triples against `split("\\n")` of the base
blob. In the page they are applied from the BOTTOM UP so earlier indices stay valid. This
avoids the trap that cost real bytes on 2026-08-08: JS `String.replace` expands `$$`, `$&`,
`` $` ``, `$'` and `$1` in the REPLACEMENT text, so a payload of anchored pairs needs a
function replacer everywhere and one forgotten call corrupts a file silently. Splicing an
array by index cannot do that. It relies on the repo being all-LF, which .gitattributes
enforces; the per-file SHA-256 is what would catch it if that ever changed.

A whole-file rewrite ships as full text whenever that is smaller than carrying the entire old
file as context, so new files and heavily-rewritten ones cost no more than they have to.
"""
import base64
import gzip
import hashlib
import json
import pathlib
import subprocess
import sys
from difflib import SequenceMatcher

ROOT = pathlib.Path(__file__).resolve().parent.parent
# ⚠️ 2000, not 7000. A 7,000-char chunk retyped into the page corrupted EVERY time it was
# tried: three chunks on 2026-08-10 each arrived with one character wrong, and a fourth
# arrived seven characters LONG with 11 of 14 blocks bad -- unpatchable, resend required.
# 2000 is what project memory prescribed before that experiment, and the experiment
# confirmed it. Same total characters either way; the difference is that a bad 2,000-char
# chunk costs one cheap resend instead of a forensic hunt.
CHUNK = 2000


def git(*args):
    r = subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True)
    if r.returncode:
        sys.exit("git " + " ".join(args) + ": " + r.stderr.decode()[:400])
    return r.stdout


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    base = git("rev-parse", sys.argv[1]).decode().strip()
    out = ROOT / (sys.argv[2] if len(sys.argv) > 2 else "work/.payload")

    status = git("diff", "--cached", "--name-status").decode().strip().splitlines()
    if not status:
        sys.exit("nothing is staged — run git add -A first")
    added, modified = [], []
    for line in status:
        kind, path = line.split("\t", 1)
        (added if kind == "A" else modified).append(path)

    payload = {"base": base, "full": {}, "ops": {}}
    targets = {}

    for path in added:
        text = (ROOT / path).read_text(encoding="utf-8")
        payload["full"][path] = text
        targets[path] = hashlib.sha256(text.encode()).hexdigest()

    for path in modified:
        base_bytes = git("show", f"{base}:{path}")
        new_bytes = (ROOT / path).read_bytes()
        targets[path] = hashlib.sha256(new_bytes).hexdigest()

        a = base_bytes.decode("utf-8").split("\n")
        b = new_bytes.decode("utf-8").split("\n")
        ops = [[i1, i2, b[j1:j2]]
               for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
               if tag != "equal"]
        if len(json.dumps(new_bytes.decode("utf-8"))) < len(json.dumps(ops)):
            payload["full"][path] = new_bytes.decode("utf-8")
        else:
            payload["ops"][path] = ops

    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    gz = gzip.compress(raw, 9)
    b64 = base64.b64encode(gz).decode()

    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*"):
        f.unlink()
    chunks = [b64[i:i + CHUNK] for i in range(0, len(b64), CHUNK)]
    for n, c in enumerate(chunks):
        (out / f"payload.b64.{n:02d}").write_text(c)

    # ⚠️ The 500-char BLOCK hashes are the point of this manifest. Expect roughly one
    # single-character corruption per 7,000-char chunk in transit, and expect it to arrive
    # with the right LENGTH — 2026-08-10 saw a substitution, not a drop, so a length check
    # proves nothing. Send a chunk and its block hashes in ONE call and have the page return
    # only the offsets that disagree; then reprint just that 500-char block.
    (out / "manifest.json").write_text(json.dumps({
        "base": base,
        "files": len(added) + len(modified),
        "full": sorted(payload["full"]),
        "ops": sorted(payload["ops"]),
        "b64_len": len(b64),
        "b64_sha256": hashlib.sha256(b64.encode()).hexdigest(),
        "chunks": [{"n": n, "len": len(c), "sha8": hashlib.sha256(c.encode()).hexdigest()[:8],
                    "blocks": [hashlib.sha256(c[i:i + 500].encode()).hexdigest()[:6]
                               for i in range(0, len(c), 500)]}
                   for n, c in enumerate(chunks)],
        "targets": targets,
    }, indent=1))

    print(f"base       {base[:10]}")
    print(f"files      {len(added) + len(modified)}  ({len(payload['full'])} full, {len(payload['ops'])} spliced)")
    print(f"raw        {len(raw):>9,} B")
    print(f"gzip       {len(gz):>9,} B")
    print(f"base64     {len(b64):>9,} chars  ->  {len(chunks)} chunks of <= {CHUNK}")
    print(f"full-content files: {sorted(payload['full'])}")
    print(f"out        {out}")


if __name__ == "__main__":
    main()
