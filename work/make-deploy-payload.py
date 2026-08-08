"""
Turn a commit range into a browser-deploy payload, and PROVE it before emitting.

This repo cannot be pushed from a Cowork session (the git proxy refuses to inject a
credential for it), so deploys go through the user's logged-in GitHub session at
/upload/main. The extension cannot read container files, so the exact bytes have to be
rebuilt IN PAGE JS from raw.githubusercontent at a pinned commit. That is affordable
only if the payload is a set of anchored edits rather than whole files — stats.html
alone is 2.2 MB.

    python3 work/make-deploy-payload.py <base-sha> <head-sha-or-HEAD>

What it emits, into /tmp/ddeploy/:
  cN.txt        gzip+base64 chunks of the payload, 2000 chars each (see below)
  manifest.json chunk lengths and hashes, so a chunk that arrives corrupted is caught
                the moment it lands rather than after twenty files have been uploaded

⚠️ THE PROOF IS THE POINT. Every patch is applied here, to the blobs actually stored at
the base commit, and the result must be byte-identical to the head commit. A patch that
does not reproduce head is a bug found for free instead of a bad deploy.

⚠️ ANCHOR UNIQUENESS IS NOT ASSUMED, IT IS MEASURED. Each hunk grows its context, one
line at a time, until the old text appears exactly once in the base file. A hunk that
cannot be made unique inside the growth limit falls back to shipping the whole file.

⚠️ THE PAGE MUST USE A FUNCTION REPLACER: s.replace(old, () => new). A string
replacement expands $$, $&, $` , $' and $1 in the REPLACEMENT — which silently ate five
bytes out of guillotine.html on 2026-08-08 and was only caught by the SHA check.
"""
import difflib, gzip, base64, hashlib, json, pathlib, subprocess, sys

REPO = pathlib.Path(__file__).resolve().parent.parent
BASE = sys.argv[1]
HEAD = sys.argv[2] if len(sys.argv) > 2 else "HEAD"
MAX_CONTEXT = 40          # lines of context a hunk may grow before we give up on it
WHOLE_FILE_LIMIT = 60000  # bytes; above this a whole-file fallback is refused


def git(*a):
    return subprocess.run(["git", *a], cwd=REPO, capture_output=True, check=True).stdout


def at(rev, path):
    return git("show", f"{rev}:{path}").decode("utf-8")


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


changed = git("diff", "--name-only", BASE, HEAD).decode().strip().splitlines()
changed = [f for f in changed if f]
assert changed, "nothing changed between those commits"

patches, whole, sizes = {}, {}, {}
for f in changed:
    try:
        old_text = at(BASE, f)
    except subprocess.CalledProcessError:
        whole[f] = at(HEAD, f)          # new file: nothing to anchor against
        continue
    new_text = at(HEAD, f)
    a, b = old_text.splitlines(keepends=True), new_text.splitlines(keepends=True)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    pairs, failed = [], False
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        ctx = 1
        while True:
            lo, hi = max(0, i1 - ctx), min(len(a), i2 + ctx)
            old_blk = "".join(a[lo:hi])
            new_blk = "".join(a[lo:i1]) + "".join(b[j1:j2]) + "".join(a[i2:hi])
            # unique in the BASE file, and not already satisfied — either would make the
            # page-side count check fail, which is exactly the signal we want here
            if old_blk and old_text.count(old_blk) == 1 and old_blk != new_blk:
                pairs.append([old_blk, new_blk])
                break
            ctx += 1
            if ctx > MAX_CONTEXT:
                failed = True
                break
        if failed:
            break
    if failed:
        assert len(new_text) < WHOLE_FILE_LIMIT, \
            f"{f}: no unique anchor and too large ({len(new_text)} B) to send whole"
        whole[f] = new_text
    else:
        patches[f] = pairs
    sizes[f] = sum(len(o) + len(n) for o, n in pairs) if not failed else len(new_text)

# ---- prove it, against the real base blobs ----
expected, produced = {}, {}
for f in changed:
    if f in whole:
        produced[f] = whole[f]
    else:
        s = at(BASE, f)
        for o, n in patches[f]:
            assert s.count(o) == 1, f"{f}: anchor is not unique at apply time"
            s = s.replace(o, n, 1)
        produced[f] = s
    expected[f] = sha(at(HEAD, f))
    got = sha(produced[f])
    assert got == expected[f], f"{f}: patched result does not reproduce {HEAD}"

payload = {"base": git("rev-parse", BASE).decode().strip(),
           "patches": patches, "whole": whole, "sha": expected}
raw = json.dumps(payload)
b64 = base64.b64encode(gzip.compress(raw.encode("utf-8"), 9)).decode()
# ⚠️ 2000, not 7000. The payload crosses into the page as text an assistant retypes,
# and a 7000-char base64 blob does not survive that reliably — two of the first three
# attempts on 2026-08-08 arrived corrupted or truncated, in the middle, with the right
# length. Smaller pieces make each one cheap to re-send, and the per-chunk hash in the
# manifest is what finds the bad one immediately instead of after the join.
chunks = [b64[i:i + 2000] for i in range(0, len(b64), 2000)]

out = pathlib.Path("/tmp/ddeploy")
out.mkdir(exist_ok=True)
for i, c in enumerate(chunks):
    (out / f"c{i}.txt").write_text(c)
(out / "manifest.json").write_text(json.dumps({
    "base": payload["base"], "head": git("rev-parse", HEAD).decode().strip(),
    "chunks": len(chunks), "b64len": len(b64),
    "chunkLen": [len(c) for c in chunks],
    "chunkSha": [hashlib.sha256(c.encode()).hexdigest()[:8] for c in chunks],
    "jsonSha": sha(raw)[:16],
    "patched": sorted(patches), "whole": sorted(whole),
}, indent=1))
print(f"{len(changed)} files reproduce {HEAD} exactly "
      f"({len(patches)} patched, {len(whole)} whole)")
print(f"raw {len(raw)} B -> gz+b64 {len(b64)} B in {len(chunks)} chunk(s) -> {out}/")
