"""Run as container UID 1000 with read-only data mounted; stream a checked snapshot."""
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

source = Path('/app/data/inkmind.db')
if not source.is_file():
    sys.exit('Existing database is missing; provision or migrate data before deployment')
with tempfile.TemporaryDirectory() as directory:
    snapshot = Path(directory) / 'snapshot.sqlite'
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src, sqlite3.connect(snapshot) as dst:
        tables = {row[0] for row in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'background_tasks' in tables and src.execute("SELECT count(*) FROM background_tasks WHERE status IN ('pending','running')").fetchone()[0]:
            sys.exit('Unfinished background tasks remain; finish or cancel them before deploying')
        src.backup(dst)
        if dst.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            sys.exit('Database integrity check failed')
    with snapshot.open("rb") as stream:
        shutil.copyfileobj(stream, sys.stdout.buffer)
