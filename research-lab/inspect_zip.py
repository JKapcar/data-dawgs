"""Offline quarantine inspector. No network, shell execution, or schema inference.
Run on a private local volume, never the public checkout. ZIPs are untrusted input.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import stat
import struct
import time
import zipfile

MAX_ARCHIVE = 10 * 1024**3
MAX_EXPANDED = 20 * 1024**3
MAX_MEMBER = 8 * 1024**3
MAX_FILES = 1000
MAX_DIRECTORY = 16 * 1024**2


def directory_bounds(path):
    size = path.stat().st_size
    if not 22 <= size <= MAX_ARCHIVE:
        raise ValueError('archive size outside pilot limit')
    with path.open('rb') as stream:
        stream.seek(max(0, size - 65557))
        tail = stream.read()
        pos = tail.rfind(b'PK\x05\x06')
        if pos < 0 or len(tail) - pos < 22:
            raise ValueError('missing ZIP end record')
        _, disk, cd_disk, local_count, count, cd_size, cd_offset, comment = struct.unpack('<4s4H2LH', tail[pos:pos+22])
        end = size - len(tail) + pos
        if pos + 22 + comment != len(tail) or disk or cd_disk or local_count != count:
            raise ValueError('split archive or invalid end record')
        has_zip64 = False
        if end >= 20:
            stream.seek(end - 20)
            has_zip64 = stream.read(4) == b'PK\x06\x07'
        if (count == 65535 or cd_size == 0xffffffff or cd_offset == 0xffffffff) and not has_zip64:
            raise ValueError('missing ZIP64 locator')
        # Match the exact adjacent ZIP64 record Python's parser consumes, including
        # optional ZIP64 records even when the legacy fields are not sentinels.
        if has_zip64:
            stream.seek(end - 20)
            signature, disk, offset, disks = struct.unpack('<4sLQL', stream.read(20))
            if signature != b'PK\x06\x07' or disk or disks != 1 or offset != end - 76:
                raise ValueError('invalid ZIP64 locator')
            stream.seek(offset)
            record = stream.read(56)
            signature, length, _, _, disk, cd_disk, local_count, count, cd_size, cd_offset = struct.unpack('<4sQ2H2L4Q', record)
            if signature != b'PK\x06\x06' or length != 44 or disk or cd_disk or local_count != count:
                raise ValueError('unsupported ZIP64 end record')
            end = offset
        if not 0 < count <= MAX_FILES or cd_size > MAX_DIRECTORY or cd_offset + cd_size != end:
            raise ValueError('directory limit or offset violation')


def safe_name(info):
    name = info.orig_filename
    if not name or '\x00' in name or '\\' in name or ':' in name or name.startswith('/'):
        raise ValueError('unsafe archive path')
    parts = name.rstrip('/').split('/')
    reserved = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(10)), *(f'LPT{i}' for i in range(10))}
    if len(name) > 240 or any(p in ('', '.', '..') or p.endswith((' ', '.')) or p.split('.')[0].upper() in reserved or any(ord(c) < 32 for c in p) for p in parts):
        raise ValueError('unsafe archive component')
    mode = info.external_attr >> 16
    if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
        raise ValueError('links and special files forbidden')
    if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise ValueError('encrypted or unsupported compression')
    if not info.is_dir() and pathlib.PurePosixPath(name).suffix.lower() != '.csv':
        raise ValueError('only CSV members accepted in this pilot')
    return pathlib.PurePosixPath(*parts)


def inspect(path, extract=None, seconds=300):
    path = pathlib.Path(path).resolve(strict=True)
    directory_bounds(path)  # bound central-directory allocation BEFORE ZipFile opens
    deadline = time.monotonic() + seconds
    def check():
        if time.monotonic() > deadline:
            raise ValueError('inspection runtime limit exceeded')
    destination = pathlib.Path(extract).resolve() if extract else None
    made = False
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) > MAX_FILES:
                raise ValueError('member limit exceeded')
            seen, expanded = set(), 0
            for member in members:
                name = safe_name(member)
                key = str(name).casefold()
                if key in seen:
                    raise ValueError('duplicate archive path')
                seen.add(key)
                expanded += member.file_size
                if member.file_size > MAX_MEMBER or expanded > MAX_EXPANDED or member.file_size > max(1, member.compress_size) * 100:
                    raise ValueError('expansion limit exceeded')
            if destination:
                destination.mkdir(exist_ok=False)  # never overlay a preexisting tree
                made = True
            receipt = {'version': 1, 'kind': 'archive-inspection', 'schema': 'unverified', 'measurements': 'unverified', 'members': [], 'limits': {'seconds': seconds, 'expandedBytes': MAX_EXPANDED, 'members': MAX_FILES}}
            total = 0
            for member in members:
                check()
                name = safe_name(member)
                if member.is_dir():
                    continue
                target = destination.joinpath(*name.parts) if destination else None
                if target:
                    if not target.resolve().is_relative_to(destination):
                        raise ValueError('path escaped destination')
                    target.parent.mkdir(parents=True, exist_ok=True)
                output = target.open('xb') if target else None
                count, sha = 0, hashlib.sha256()
                try:
                    with archive.open(member) as stream:
                        while chunk := stream.read(1024 * 1024):
                            check()
                            count += len(chunk)
                            total += len(chunk)
                            if count > member.file_size or total > MAX_EXPANDED:
                                raise ValueError('stream expansion limit exceeded')
                            sha.update(chunk)
                            if output:
                                output.write(chunk)
                finally:
                    if output:
                        output.close()
                if count != member.file_size:
                    raise ValueError('member length mismatch')
                receipt['members'].append({'path': str(name), 'bytes': count, 'sha256': sha.hexdigest(), 'crc32': f'{member.CRC:08x}'})
            sha = hashlib.sha256()
            with path.open('rb') as stream:
                while chunk := stream.read(1024 * 1024):
                    check()
                    sha.update(chunk)
            receipt.update(archiveSha256=sha.hexdigest(), archiveBytes=path.stat().st_size, expandedBytes=total)
            return receipt
    except BaseException:
        if made:
            # Only the fresh directory created by THIS invocation, never an existing path.
            shutil.rmtree(destination)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('--extract', help='New private directory; omitted means inspection only')
    args = parser.parse_args()
    print(json.dumps(inspect(args.archive, args.extract), indent=2))
