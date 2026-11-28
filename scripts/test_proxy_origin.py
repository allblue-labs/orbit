"""Local-only tests for the privileged installer; never accesses /etc or live env."""
import importlib.util
import stat
import tempfile
import unittest
import sys
from pathlib import Path

module_path = Path(__file__).resolve().parents[1] / 'deploy/staging/bin/configure-proxy-origin.py'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('proxy_origin', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProxyOriginTest(unittest.TestCase):
    def test_generation_permissions_and_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / '.env'
            include = Path(directory) / 'nginx.inc'
            env.write_text('# Preserve\nOTHER_SETTING=kept\nTRUSTED_PROXY_SECRET=change-me\n')
            module.configure(env, include)
            first = env.read_text()
            self.assertIn('OTHER_SETTING=kept', first)
            values = dict(line.split('=', 1) for line in first.splitlines() if '=' in line)
            self.assertRegex(values['TRUSTED_PROXY_SECRET'], r'^[a-f0-9]{64}$')
            self.assertNotEqual(values['TRUSTED_PROXY_SECRET'], values['AUTH_RATE_LIMIT_SECRET'])
            self.assertIn(values['TRUSTED_PROXY_SECRET'], include.read_text())
            self.assertNotIn(values['AUTH_RATE_LIMIT_SECRET'], include.read_text())
            self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(include.stat().st_mode), 0o600)
            env.chmod(0o644)
            include.chmod(0o644)
            module.configure(env, include)
            self.assertEqual(env.read_text(), first)
            self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(include.stat().st_mode), 0o600)

    def test_invalid_existing_secret_does_not_modify_files(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / '.env'
            original = 'AUTH_RATE_LIMIT_SECRET=invalid\n'
            env.write_text(original)
            include = Path(directory) / 'nginx.inc'
            with self.assertRaises(ValueError):
                module.configure(env, include)
            self.assertEqual(env.read_text(), original)
            self.assertFalse(include.exists())


if __name__ == '__main__':
    unittest.main()
