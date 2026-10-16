import importlib.util
import pathlib
import tempfile
import unittest
import zipfile
import struct

spec = importlib.util.spec_from_file_location('inspector', pathlib.Path(__file__).with_name('inspect_zip.py'))
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)

class InspectionTests(unittest.TestCase):
    def test_zip64_hidden_and_conflicting_records(self):
        with tempfile.TemporaryDirectory() as folder:
            source = pathlib.Path(folder) / 'data.zip'
            with zipfile.ZipFile(source, 'w') as z:
                z.writestr('ok.csv', 'a')
            original = source.read_bytes()
            end = len(original) - 22
            fields = struct.unpack('<4s4H2LH', original[end:])
            record = struct.pack('<4sQ2H2L4Q', b'PK\x06\x06', 44, 45, 45, 0, 0, 1, 1, fields[5], fields[6])
            locator = struct.pack('<4sLQL', b'PK\x06\x07', 0, end, 1)
            # Optional ZIP64 is valid even without sentinel legacy values.
            source.write_bytes(original[:end] + record + locator + original[end:])
            self.assertEqual(len(inspector.inspect(source)['members']), 1)
            # A decoy locator offset must not hide a second record from preflight.
            source.write_bytes(original[:end] + record + record + locator + original[end:])
            with self.assertRaises(ValueError):
                inspector.inspect(source)
            oversized = struct.pack('<4sQ2H2L4Q', b'PK\x06\x06', 44, 45, 45, 0, 0, 1, 1, 100000000, fields[6])
            source.write_bytes(original[:end] + oversized + locator + original[end:])
            with self.assertRaises(ValueError):
                inspector.inspect(source)

    def test_valid_and_safe_extraction(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source = root / 'data.zip'
            with zipfile.ZipFile(source, 'w') as z:
                z.writestr('data/players.csv', 'id,x\n1,3\n')
            result = inspector.inspect(source, root / 'new')
            self.assertEqual(result['schema'], 'unverified')
            self.assertEqual(len(result['archiveSha256']), 64)
            self.assertEqual((root / 'new/data/players.csv').read_text(), 'id,x\n1,3\n')
            with self.assertRaises(FileExistsError):
                inspector.inspect(source, root / 'new')

    def test_malicious_archives(self):
        for names in [['../evil.csv'], ['/evil.csv'], ['C:evil.csv'], ['NUL.csv'], ['x.csv', 'X.csv'], ['script.exe']]:
            with self.subTest(names=names), tempfile.TemporaryDirectory() as folder:
                source = pathlib.Path(folder) / 'data.zip'
                with zipfile.ZipFile(source, 'w') as z:
                    for name in names:
                        z.writestr(name, 'a')
                with self.assertRaises(ValueError):
                    inspector.inspect(source)

    def test_bomb_link_and_runtime(self):
        with tempfile.TemporaryDirectory() as folder:
            source = pathlib.Path(folder) / 'data.zip'
            with zipfile.ZipFile(source, 'w', compression=zipfile.ZIP_DEFLATED) as z:
                z.writestr('bomb.csv', b'0' * 1000000)
            with self.assertRaises(ValueError):
                inspector.inspect(source)
            with zipfile.ZipFile(source, 'w') as z:
                entry = zipfile.ZipInfo('link.csv'); entry.external_attr = 0o120777 << 16
                z.writestr(entry, 'target')
            with self.assertRaises(ValueError):
                inspector.inspect(source)
            with zipfile.ZipFile(source, 'w') as z:
                z.writestr('ok.csv', 'a')
            with self.assertRaises(ValueError):
                inspector.inspect(source, pathlib.Path(folder) / 'out', seconds=-1)
            self.assertFalse((pathlib.Path(folder) / 'out').exists())

if __name__ == '__main__':
    unittest.main()
