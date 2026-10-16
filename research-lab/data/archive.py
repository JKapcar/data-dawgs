#!/usr/bin/env python3
"""Verify the owner's local competition archive. Read-only; prints JSON; changes nothing.

    py research-lab\\data\\archive.py verify C:\\path\\to\\archive.zip
    py research-lab\\data\\archive.py verify archive.zip --connector-digest <partHashesSha256>

Checks, in one streaming pass:
  * byte size and whole-file SHA-256 against the verified archive (512,718,566 bytes,
    SHA-256 27d52f59...8d0ced) unless --expect-size/--expect-sha256 override them;
  * the 8 MiB part-hash list the site uploader recorded, folded into one digest
    (partHashesSha256). dd_owner_bdb_read reports the same digest for the uploaded copy, so
    equal digests mean the uploaded object holds exactly these bytes.
Exit status 0 when every supplied expectation matches, 1 otherwise. Standard library only.
"""
import argparse, hashlib, json, os, sys

PART_BYTES = 8 * 1024 * 1024  # must equal research-lab/upload-gateway.mjs PART_BYTES
VERIFIED_SIZE = 512718566
VERIFIED_SHA256 = "27d52f594d6d31d4f617f9c94b0b37d11e280397ad8293c0987da5f91a8d0ced"


def fingerprint(path):
    whole, parts, size = hashlib.sha256(), [], 0
    with open(path, "rb") as f:
        while True:
            chunk = f.read(PART_BYTES)
            if not chunk:
                break
            size += len(chunk)
            whole.update(chunk)
            parts.append(hashlib.sha256(chunk).hexdigest())
    return {
        "file": os.path.basename(path),
        "bytes": size,
        "sha256": whole.hexdigest(),
        "parts": len(parts),
        "partBytes": PART_BYTES,
        "partHashesSha256": hashlib.sha256("\n".join(parts).encode()).hexdigest(),
    }


def verify(path, expect_size=VERIFIED_SIZE, expect_sha256=VERIFIED_SHA256, connector_digest=None):
    fp = fingerprint(path)
    checks = {}
    if expect_size is not None:
        checks["size_matches_verified_archive"] = fp["bytes"] == expect_size
    if expect_sha256:
        checks["sha256_matches_verified_archive"] = fp["sha256"] == expect_sha256.lower()
    if connector_digest:
        checks["matches_uploaded_copy"] = fp["partHashesSha256"] == connector_digest.lower()
    return {"kind": "bdb-archive-verify", "version": 1, **fp, "checks": checks, "ok": all(checks.values())}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify", help="fingerprint a local archive and compare")
    v.add_argument("zip")
    v.add_argument("--expect-size", type=int, default=VERIFIED_SIZE)
    v.add_argument("--expect-sha256", default=VERIFIED_SHA256)
    v.add_argument("--connector-digest", help="partHashesSha256 from dd_owner_bdb_read")
    args = ap.parse_args(argv)
    result = verify(args.zip, args.expect_size, args.expect_sha256, args.connector_digest)
    print(json.dumps(result, indent=1))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
