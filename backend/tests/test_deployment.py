"""Admission, stream draining, database readiness and migration failures."""
import asyncio
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
from app.deployment import MaintenanceMiddleware
from app import main


class AdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_remains_counted_and_new_requests_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'maintenance'
            started, finish = asyncio.Event(), asyncio.Event()
            async def stream(scope, receive, send):
                await send({'type': 'http.response.start', 'status': 200, 'headers': []})
                started.set(); await finish.wait()
                await send({'type': 'http.response.body', 'body': b'done'})
            gate = MaintenanceMiddleware(stream, str(marker))
            messages = []
            async def send(message): messages.append(message)
            async def receive(): return {'type': 'http.request', 'body': b''}
            task = asyncio.create_task(gate({'type': 'http', 'path': '/stream'}, receive, send))
            await started.wait()
            self.assertEqual(gate.active_requests, 1)
            marker.touch()
            await gate({'type': 'http', 'path': '/novels'}, receive, send)
            self.assertEqual(messages[1]['status'], 503)
            self.assertEqual(gate.active_requests, 1)
            finish.set(); await task
            self.assertEqual(gate.active_requests, 0)

    async def test_exception_releases_inflight_count(self) -> None:
        async def broken(scope, receive, send): raise RuntimeError('broken')
        gate = MaintenanceMiddleware(broken)
        with self.assertRaises(RuntimeError): await gate({'type':'http','path':'/novels'}, None, None)
        self.assertEqual(gate.active_requests, 0)


class ReadinessTests(unittest.TestCase):
    def test_health_retains_existing_contract_and_checks_database(self) -> None:
        db = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread':False})
        self.addCleanup(db.dispose)
        with patch.object(main, 'engine', db), patch.dict('os.environ', {'INKMIND_REVISION':'a'*40}):
            client = TestClient(main.app)
            response = client.get('/health')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['mode'], 'web')
            self.assertEqual(response.json()['revision'], 'a'*40)
        with patch.object(main.engine, 'connect', side_effect=RuntimeError('secret connection data')):
            response = TestClient(main.app).get('/health')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('secret', response.text)

    def test_migration_failure_aborts_instead_of_becoming_healthy(self) -> None:
        db = create_engine('sqlite://')
        self.addCleanup(db.dispose)
        with db.begin() as connection: connection.execute(text('CREATE TABLE users(id INTEGER PRIMARY KEY)'))
        with patch.object(main, 'engine', db), patch.object(db, 'begin', side_effect=RuntimeError('fixture failure')):
            with self.assertRaisesRegex(RuntimeError, '数据库迁移失败'): main._migrate_sqlite()
