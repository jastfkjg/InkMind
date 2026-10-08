"""Run with host Python 3.6 as well as CI Python 3.12; no app dependencies."""
import copy
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'deploy/cloud'))
from check_health import check
from validate_config import validate
from validate_image import image_reference


class HostRuntimeTests(unittest.TestCase):
    def test_real_preflight_python_checks(self):
        script = (ROOT / 'deploy/cloud/preflight.sh').read_text()
        snippets = re.findall(r"<<'PY'\n(.*?)\nPY", script, re.S)
        self.assertEqual(len(snippets), 2)
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'app.env'
            config.write_text('fixture-only')
            config.chmod(0o600)
            with patch.object(sys, 'argv', ['-', str(config)]):
                exec(compile(snippets[0], 'permissions', 'exec'), {})
                config.chmod(0o644)
                with self.assertRaises(SystemExit):
                    exec(compile(snippets[0], 'permissions', 'exec'), {})
        for version in ['2.24.0', 'v2.25.0', '5.1.1']:
            with patch.object(sys, 'argv', ['-', version]):
                exec(compile(snippets[1], 'compose-version', 'exec'), {})
        with patch.object(sys, 'argv', ['-', '2.23.3']), self.assertRaises(SystemExit):
            exec(compile(snippets[1], 'compose-version', 'exec'), {})

    def test_config_and_health_checks_on_system_python(self):
        image = 'registry.example.com/team/inkmind@sha256:' + 'a' * 64
        self.assertEqual(image_reference(image), image)
        with tempfile.TemporaryDirectory() as directory:
            config = {'services': {
                'backend': {'image': image, 'networks': {'internal': {}},
                    'volumes': [{'type': 'bind', 'source': directory + '/data', 'target': '/app/data'}],
                    'environment': {'SITE_DOMAIN': 'inkmind.jastcraft.com',
                        'CORS_ORIGINS': 'https://inkmind.jastcraft.com', 'SECRET_KEY': 'x' * 48,
                        'DATABASE_URL': 'sqlite:////app/data/inkmind.db',
                        'INKMIND_MAINTENANCE_FILE': '/app/data/.deploy-maintenance', 'DESKTOP_MODE': 'false'}},
                'frontend': {'image': image, 'networks': {'internal': {}, 'proxy': {}}}},
                'networks': {'proxy': {'name': 'inkmind_proxy'}}}
            with patch.dict(os.environ, INKMIND_ROOT=directory):
                validate(config)
                bad = copy.deepcopy(config)
                bad['services']['backend']['environment']['SECRET_KEY'] = 'short'
                with self.assertRaises(ValueError): validate(bad)
        health = dict(status='ok', service='inkmind', revision='a' * 40, mode='web',
                      maintenance=True, active_requests=0, active_tasks=0)
        self.assertTrue(check(health, 'inkmind', 'a' * 40, drain=True))
        health['active_tasks'] = 1
        self.assertFalse(check(health, 'inkmind', 'a' * 40, drain=True))

    def test_real_promotion_and_rollback_snippets_with_stale_symlinks(self):
        script = (ROOT / 'deploy/cloud/deploy.sh').read_text()
        snippets = dict(re.findall(r"<<'(PYTHON|PY)'\n(.*?)\n\1", script, re.S))
        self.assertEqual(set(snippets), {'PY', 'PYTHON'})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            old, new = root / 'old', root / 'new'
            old.mkdir(); new.mkdir()
            for name in ('.previous-next', '.current-next', '.current-rollback'):
                (root / name).symlink_to(root / 'missing')
            with patch.object(sys, 'argv', ['-', directory, str(new), str(old)]):
                exec(compile(snippets['PY'], 'promotion', 'exec'), {})
            self.assertEqual((root / 'current').resolve(), new)
            self.assertEqual((root / 'previous').resolve(), old)
            with patch.object(sys, 'argv', ['-', directory, str(old)]):
                exec(compile(snippets['PYTHON'], 'rollback', 'exec'), {})
            self.assertEqual((root / 'current').resolve(), old)
