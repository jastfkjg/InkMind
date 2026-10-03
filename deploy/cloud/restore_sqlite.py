"""Restore only with every application container stopped and maintenance enabled."""
import os
from pathlib import Path
import shutil
import sqlite3
import sys

root = Path('/app/data')
if not (root / '.deploy-maintenance').is_file():
    sys.exit('Maintenance marker missing; refusing database restore')
temporary = root / '.inkmind-restore.sqlite'
try:
    with temporary.open("wb") as stream:
        shutil.copyfileobj(sys.stdin.buffer, stream)
    temporary.chmod(0o600)
    with sqlite3.connect(temporary) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            sys.exit('Snapshot integrity check failed')
    for suffix in ['-wal', '-shm']:
        (root / ('inkmind.db' + suffix)).unlink(missing_ok=True)
    os.replace(temporary, root / 'inkmind.db')
finally:
    temporary.unlink(missing_ok=True)
