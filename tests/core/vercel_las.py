"""Syntetiska bytes; ingen CLI, inloggning, token eller nätkontakt."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

script = Path(__file__).resolve().parents[2] / 'scripts/vercel_las.py'
spec = importlib.util.spec_from_file_location('vakt', script)
vakt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vakt)


class CLI(unittest.TestCase):
    def test_andrad_lasfil_binar_symlank_och_plattform_stoppar(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve(); pins = {}
            for rel, raw in [('verktyg/vercel-cli/package.json', b'{"version":"fixture"}'),
                             ('verktyg/vercel-cli/package-lock.json', b'fixture lock'),
                             (vakt.BINARY, b'NEVER EXECUTE THIS FIXTURE')]:
                p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(raw); p.chmod(0o755)
                pins[rel] = hashlib.sha256(raw).hexdigest()
            with patch.object(vakt.os, 'execve', side_effect=AssertionError('must not execute')):
                self.assertEqual(vakt.kontrollera(root, pins, ('darwin', 'arm64')), root / vakt.BINARY)
                for rel in pins:
                    p = root / rel; original = p.read_bytes(); p.write_bytes(original + b'changed')
                    with self.assertRaises(ValueError): vakt.kontrollera(root, pins, ('darwin', 'arm64'))
                    p.write_bytes(original)
                with self.assertRaises(ValueError): vakt.kontrollera(root, pins, ('linux', 'x86_64'))
                p = root / vakt.BINARY; p.rename(p.with_suffix('.original')); p.symlink_to(p.with_suffix('.original'))
                with self.assertRaises(ValueError): vakt.kontrollera(root, pins, ('darwin', 'arm64'))

    def test_verkligt_kommando_stannar_fore_exec_vid_guardfel(self):
        with patch.object(vakt, 'kontrollera', side_effect=ValueError('ändrad binär')), patch.object(vakt.os, 'execve') as run:
            self.assertEqual(vakt.main(['deploy', '--prod']), 2)
            run.assert_not_called()


if __name__ == '__main__': unittest.main()
