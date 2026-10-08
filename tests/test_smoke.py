"""Verify smoke-test failures remain diagnosable and always clean up."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SmokeFailureTests(unittest.TestCase):
    def test_probe_failure_keeps_diagnostics_and_original_exit_code(self):
        self.run_failure('up')

    def test_nginx_failure_also_cleans_up(self):
        self.run_failure('nginx')

    def run_failure(self, stage):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            docker = base / 'docker'
            docker.write_text(r'''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]; base = pathlib.Path(os.environ['SMOKE_TEST_DIR'])
with (base / 'calls').open('a') as output: output.write(json.dumps(args) + '\n')
if args[0] == 'run':
    assert '--network' in args and 'none' in args and 'backend:127.0.0.1' in args
    sys.exit(42 if os.environ['FAIL_STAGE'] == 'nginx' else 0)
if args[0] == 'inspect':
    print('health probe diagnostic'); sys.exit(9)
spec = pathlib.Path(args[args.index('-f') + 1])
(base / 'spec.json').write_text(spec.read_text())
(base / 'temporary').write_text(str(spec.parent))
command = args[args.index('-f') + 2:]
if command[0] == 'up': sys.exit(42)
if command == ['ps', '-aq']: print('test-container')
if command[0] == 'logs': print('frontend startup diagnostic')
''')
            docker.chmod(0o755)
            result = subprocess.run(['bash', str(ROOT / 'deploy/cloud/smoke-test.sh'),
                                     'backend:test', 'frontend:test', 'test-revision'],
                env=dict(os.environ, PATH=str(base) + os.pathsep + os.environ['PATH'],
                         SMOKE_TEST_DIR=str(base), FAIL_STAGE=stage), capture_output=True, text=True)
            self.assertEqual(result.returncode, 42, result.stderr)
            self.assertIn('frontend startup diagnostic', result.stderr)
            self.assertIn('health probe diagnostic', result.stderr)
            calls = [json.loads(line) for line in (base / 'calls').read_text().splitlines()]
            self.assertTrue(any('down' in call for call in calls))
            self.assertFalse(Path((base / 'temporary').read_text()).exists())
            spec = json.loads((base / 'spec.json').read_text())
            for service in spec['services'].values():
                self.assertTrue(service['healthcheck']['test'][-1].startswith('http://127.0.0.1'))
