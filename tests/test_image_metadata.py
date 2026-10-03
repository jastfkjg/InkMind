import sys
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'deploy/cloud'))
from image_metadata import resolve
from check_health import check
from validate_config import validate

class MetadataTests(unittest.TestCase):
    def test_rejects_wrong_revision_run_registry_or_mutable_tag(self):
        names = {s:f'registry.example.com/team/inkmind-{s}' for s in ['backend','frontend']}
        metadata = {'revision':'a'*40,'run_id':'12','images':{s:name+'@sha256:'+'b'*64 for s,name in names.items()}}
        self.assertEqual(resolve(metadata, 'a'*40, '12', names), metadata['images'])
        for revision, run in [('c'*40,'12'),('a'*40,'13')]:
            with self.assertRaises(ValueError): resolve(metadata, revision, run, names)
        for image in ['registry.example.com/other/backend@sha256:'+'b'*64, names['backend']+':latest']:
            data=dict(metadata,images=dict(metadata['images'],backend=image))
            with self.assertRaises(ValueError): resolve(data, 'a'*40, '12', names)

    def test_drain_rejects_old_versions_tasks_and_inflight_streams(self):
        data={'status':'ok','service':'inkmind','revision':'a'*40,'mode':'web','maintenance':True,'active_requests':0,'active_tasks':0}
        self.assertTrue(check(data,'inkmind','a'*40,True))
        for field,value in [('revision','b'*40),('mode','desktop'),('maintenance',False),('active_requests',1),('active_tasks',1)]:
            with self.subTest(field=field): self.assertFalse(check(dict(data,**{field:value}),'inkmind','a'*40,True))
        self.assertFalse(check({'status':'ok','mode':'web'},'inkmind','a'*40,True))

class ConfigTests(unittest.TestCase):
    def config(self):
        return {'services': {'backend': {
            'image':'registry.example.com/team/inkmind-backend@sha256:'+'a'*64,
            'networks':{'internal':{}},
            'volumes':[{'type':'bind','source':'/opt/inkmind/data','target':'/app/data'}],
            'environment':{'SITE_DOMAIN':'inkmind.jastcraft.com','CORS_ORIGINS':'https://inkmind.jastcraft.com',
                'SECRET_KEY':'fixture-only-'+'a'*40,'DATABASE_URL':'sqlite:////app/data/inkmind.db',
                'INKMIND_MAINTENANCE_FILE':'/app/data/.deploy-maintenance','DESKTOP_MODE':'false'}},
            'frontend':{'image':'registry.example.com/team/inkmind-frontend@sha256:'+'b'*64,'networks':{'proxy':{},'internal':{}}}},
            'networks':{'proxy':{'name':'inkmind_proxy'}}}

    def test_public_ports_wrong_database_or_domain_are_rejected(self):
        validate(self.config())
        for field,value in [('SITE_DOMAIN','other.example.com'),('DATABASE_URL','sqlite:///./inkmind.db'),('SECRET_KEY','REPLACE_WITH_EXISTING_KEY_OR_NEW_RANDOM_KEY'),('DESKTOP_MODE','true')]:
            config=self.config();config['services']['backend']['environment'][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError): validate(config)
        config=self.config();config['services']['frontend']['ports']=[{'published':'80','target':80}]
        with self.assertRaises(ValueError): validate(config)

    def test_database_bind_source_must_match_snapshot_source(self):
        for change in [{'source':'/opt/wrong/data'},{'type':'volume'},{'read_only':True}]:
            config=self.config();config['services']['backend']['volumes'][0].update(change)
            with self.assertRaises(ValueError): validate(config)
