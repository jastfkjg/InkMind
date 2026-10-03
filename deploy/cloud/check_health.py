"""Check exact revisions and admission state; input contains no credentials."""
from __future__ import annotations
import json
import sys

def check(data: dict, service: str, revision: str, drain: bool = False) -> bool:
    if data.get('status') != 'ok' or data.get('service') != service or data.get('revision') != revision:
        return False
    if service == 'inkmind':
        if data.get('mode') != 'web' or data.get('maintenance') is not True:
            return False
        if drain and (data.get('active_requests') != 0 or data.get('active_tasks') != 0):
            return False
    return True

if __name__ == '__main__':
    try:
        sys.exit(0 if check(json.load(sys.stdin), sys.argv[1], sys.argv[2], '--drain' in sys.argv) else 1)
    except (ValueError, KeyError, IndexError):
        sys.exit(1)
