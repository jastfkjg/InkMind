"""Exercise the real release script with isolated Docker/HTTPS failure injection."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'a'*40
OLD_REVISION = 'b'*40
BACKEND = 'registry.example.com/team/inkmind-backend@sha256:'+'c'*64
FRONTEND = 'registry.example.com/team/inkmind-frontend@sha256:'+'d'*64

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve(); self.root=self.base/'inkmind'
        for name in ['releases','data','backups']: (self.root/name).mkdir(parents=True)
        self.old=self.root/'releases/old'; self.release=self.root/'releases/new'
        for directory in [self.old,self.release]: shutil.copytree(ROOT/'deploy/cloud',directory)
        (self.old/'revision').write_text(OLD_REVISION+'\n')
        (self.old/'image.env').write_text('INKMIND_BACKEND_IMAGE='+BACKEND+'\nINKMIND_FRONTEND_IMAGE='+FRONTEND+'\n')
        (self.root/'current').symlink_to(self.old)
        (self.root/'deployment-target').write_text('aliyun-prod\n')
        (self.root/'app.env').write_text('SECRET_KEY=fixture-only-abcdefghijklmnopqrstuvwxyz\n'); (self.root/'app.env').chmod(0o600)
        self.db=self.root/'data/inkmind.db'
        with sqlite3.connect(self.db) as db:
            db.execute('CREATE TABLE manuscript(content TEXT)'); db.execute('INSERT INTO manuscript VALUES(?)',('原稿',))
        self.gateway=self.base/'gateway';self.gateway.mkdir();(self.gateway/'deployment-target').write_text('aliyun-beijing-01\n')
        self.bin=self.base/'bin';self.bin.mkdir()
        (self.base/'state').write_text(OLD_REVISION)
        stub=r'''#!/usr/bin/env python3
import json, os, pathlib, sqlite3, subprocess, sys
args=sys.argv[1:]; base=pathlib.Path(os.environ['TEST_BASE']);root=base/'inkmind';mode=os.environ.get('FAIL_MODE','')
with (base/'calls').open('a') as log: log.write(json.dumps(args)+'\n')
state=base/'state';marker=root/'data/.deploy-maintenance'
def health():
    return dict(status='ok',service='inkmind',revision=state.read_text(),mode='web',maintenance=marker.exists(),active_requests=0,active_tasks=1 if mode=='busy' else 0)
if args[:2]==['compose','version']: print('2.25.0');sys.exit(0)
if args[:2]==['ps','-aq']:
    if mode=='legacy': print('untracked')
    sys.exit(0)
if args and args[0]=='run':
    if '-c' in args:
        code=args[args.index('-c')+1].replace('/app/data',str(root/'data'))
        if 'sys.stdin.buffer' in code and mode=='restore': sys.exit(1)
        result=subprocess.run([sys.executable,'-c',code],input=sys.stdin.buffer.read()); sys.exit(result.returncode)
    code=sys.stdin.read().replace('/app/data/inkmind.db',str(root/'data/inkmind.db'))
    result=subprocess.run([sys.executable,'-c',code]);sys.exit(result.returncode)
if 'compose' not in args: sys.exit(0)
if 'config' in args:
    imagefile=pathlib.Path(args[args.index('-f')+1]).parent/'image.env'
    env=dict(line.split('=',1) for line in imagefile.read_text().splitlines())
    backend=dict(volumes=[dict(type='bind',source=str(root/'data'),target='/app/data')],image=env['INKMIND_BACKEND_IMAGE'],networks={'internal':{}},environment=dict(SITE_DOMAIN='inkmind.jastcraft.com',CORS_ORIGINS='https://inkmind.jastcraft.com',SECRET_KEY='fixture-only-abcdefghijklmnopqrstuvwxyz',DATABASE_URL='sqlite:////app/data/inkmind.db',INKMIND_MAINTENANCE_FILE='/app/data/.deploy-maintenance',DESKTOP_MODE='false'))
    frontend=dict(image=env['INKMIND_FRONTEND_IMAGE'],networks={'internal':{},'proxy':{}})
    print(json.dumps(dict(services=dict(backend=backend,frontend=frontend),networks=dict(proxy=dict(name='inkmind_proxy')))));sys.exit(0)
if 'pull' in args and mode=='pull': sys.exit(1)
if 'nginx' in args and mode=='nginx': sys.exit(1)
if 'exec' in args:
    if 'curl' in args: print(json.dumps(health()));sys.exit(0)
    if '-c' in args:
        code=args[args.index('-c')+1].replace('/app/data',str(root/'data'))
        result=subprocess.run([sys.executable,'-c',code]);sys.exit(1 if mode=='reopen' else result.returncode)
if 'up' in args:
    revision=(pathlib.Path(args[args.index('-f')+1]).parent/'revision').read_text().strip()
    state.write_text(revision)
    if revision==os.environ['NEW_REVISION']:
        with sqlite3.connect(root/'data/inkmind.db') as db: db.execute("UPDATE manuscript SET content='migrated'")
        if mode in ['startup','restore','stop']: sys.exit(1)
    elif mode=='rollback': sys.exit(1)
if 'stop' in args and mode=='stop' and state.read_text()==os.environ['NEW_REVISION']: sys.exit(1)
'''
        (self.bin/'docker').write_text(stub); (self.bin/'docker').chmod(0o755)
        curl=r'''#!/usr/bin/env python3
import json, os, pathlib, sys
base=pathlib.Path(os.environ['TEST_BASE']); revision=(base/'state').read_text();mode=os.environ.get('FAIL_MODE','')
if mode in ['public','rollback'] and revision==os.environ['NEW_REVISION']: sys.exit(1)
service='inkmind-frontend' if sys.argv[-1].endswith('frontend-health') else 'inkmind'
print(json.dumps(dict(status='ok',service=service,revision=revision if mode!='revision' or revision!=os.environ['NEW_REVISION'] else 'wrong',mode='web',maintenance=(base/'inkmind/data/.deploy-maintenance').exists())))
'''
        (self.bin/'curl').write_text(curl);(self.bin/'curl').chmod(0o755)
        for name in ['flock','sleep']:
            (self.bin/name).write_text('#!/bin/sh\nexit 0\n');(self.bin/name).chmod(0o755)
        self.env=dict(os.environ,PATH=str(self.bin)+os.pathsep+os.environ['PATH'],INKMIND_ROOT=str(self.root),GATEWAY_ROOT=str(self.gateway),TEST_BASE=str(self.base),NEW_REVISION=REVISION)

    def deploy(self,mode='',backend=BACKEND,target='aliyun-prod'):
        return subprocess.run(['bash',str(self.release/'deploy.sh'),backend,FRONTEND,REVISION,target],env=dict(self.env,FAIL_MODE=mode),capture_output=True,text=True)

    def content(self):
        with sqlite3.connect(self.db) as db: return db.execute('SELECT content FROM manuscript').fetchone()[0]

    def test_success_promotes_both_images_after_checks_and_keeps_snapshot(self):
        result=self.deploy();self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((self.root/'current').resolve(),self.release)
        self.assertEqual((self.root/'previous').resolve(),self.old)
        self.assertFalse((self.root/'data/.deploy-maintenance').exists())
        with sqlite3.connect(self.root/'backups/new.sqlite') as db: self.assertEqual(db.execute('SELECT content FROM manuscript').fetchone()[0],'原稿')

    def test_failures_before_switch_leave_database_and_current_intact(self):
        for mode in ['pull','nginx','busy']:
            with self.subTest(mode=mode):
                result=self.deploy(mode);self.assertNotEqual(result.returncode,0)
                self.assertEqual(self.content(),'原稿');self.assertEqual((self.root/'current').resolve(),self.old)
                self.assertFalse((self.root/'data/.deploy-maintenance').exists())
                (self.release/'image.env').unlink(missing_ok=True)

    def test_startup_https_and_revision_failures_restore_database_and_old_release(self):
        for mode in ['startup','public','revision']:
            with self.subTest(mode=mode):
                result=self.deploy(mode);self.assertNotEqual(result.returncode,0,result.stdout)
                self.assertEqual(self.content(),'原稿');self.assertEqual((self.root/'current').resolve(),self.old)
                self.assertEqual((self.base/'state').read_text(),OLD_REVISION)
                self.assertFalse((self.root/'data/.deploy-maintenance').exists())
                (self.release/'image.env').unlink(missing_ok=True)

    def test_unverified_rollback_retains_maintenance(self):
        result=self.deploy('rollback');self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.root/'data/.deploy-maintenance').exists())
        self.assertEqual(self.content(),'原稿')

    def test_invalid_digest_and_wrong_target_never_touch_docker(self):
        for backend,target in [(BACKEND.replace('@sha256:','@invalid:'),'aliyun-prod'),(BACKEND,'aws-prod')]:
            result=self.deploy(backend=backend,target=target);self.assertNotEqual(result.returncode,0)
            self.assertFalse((self.base/'calls').exists());self.assertEqual(self.content(),'原稿')

    def test_first_failed_release_preserves_existing_database(self):
        (self.root/'current').unlink()
        result=self.deploy('startup');self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.content(),'原稿');self.assertFalse((self.root/'current').exists())
        self.assertFalse((self.root/'data/.deploy-maintenance').exists())

    def test_untracked_legacy_project_is_not_replaced(self):
        (self.root/'current').unlink()
        result=self.deploy('legacy');self.assertNotEqual(result.returncode,0)
        self.assertIn('untracked',result.stderr)
        self.assertEqual(self.content(),'原稿');self.assertFalse((self.release/'image.env').exists())

    def test_missing_database_aborts_before_candidate_start(self):
        self.db.unlink()
        result=self.deploy();self.assertNotEqual(result.returncode,0)
        self.assertIn('database is missing',result.stderr)
        self.assertFalse(self.db.exists());self.assertEqual((self.root/'current').resolve(),self.old)

    def test_failed_stop_or_restore_preserves_maintenance_for_manual_recovery(self):
        for mode in ['stop', 'restore']:
            with self.subTest(mode=mode):
                result=self.deploy(mode); self.assertNotEqual(result.returncode,0)
                self.assertTrue((self.root/'data/.deploy-maintenance').exists())
                self.assertEqual(self.content(),'migrated')
                (self.root/'data/.deploy-maintenance').unlink()
                (self.release/'image.env').unlink()
                (self.base/'state').write_text(OLD_REVISION)
                with sqlite3.connect(self.db) as db: db.execute("UPDATE manuscript SET content='原稿'")

    def test_ambiguous_reopening_never_restores_database_after_admission(self):
        result=self.deploy('reopen'); self.assertNotEqual(result.returncode,0)
        self.assertEqual((self.root/'current').resolve(),self.release)
        self.assertEqual(self.content(),'migrated')
        self.assertFalse((self.root/'data/.deploy-maintenance').exists())
        self.assertIn('reopening could not be confirmed',result.stderr)
