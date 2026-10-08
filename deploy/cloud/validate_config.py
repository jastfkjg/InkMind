"""Enforce the application's network, data and domain contract before deployment."""
import json
import os
from pathlib import Path
import sys
from validate_image import image_reference

DOMAIN = 'inkmind.jastcraft.com'


def validate(config: dict) -> None:
    services = config['services']
    if set(services) != {'backend', 'frontend'}:
        raise ValueError('Unexpected application services')
    for service in services.values():
        image_reference(service['image'])
        if service.get('ports') or service.get('network_mode') == 'host':
            raise ValueError('Only the shared gateway may publish ports')
    env = services['backend']['environment']
    if env['SITE_DOMAIN'] != DOMAIN or env['CORS_ORIGINS'] != 'https://' + DOMAIN:
        raise ValueError('Use the configured InkMind HTTPS hostname for domain and CORS')
    if env['DATABASE_URL'] != 'sqlite:////app/data/inkmind.db' or env['INKMIND_MAINTENANCE_FILE'] != '/app/data/.deploy-maintenance':
        raise ValueError('Unexpected database or maintenance path')
    if len(env.get('SECRET_KEY', '')) < 32 or env['SECRET_KEY'].startswith(('REPLACE', 'change-me')):
        raise ValueError('Preserve a valid existing SECRET_KEY or generate a secure one')
    if env.get('DESKTOP_MODE', '').lower() != 'false':
        raise ValueError('Cloud deployment must use Web mode')
    data_mounts = [mount for mount in services['backend'].get('volumes', []) if mount.get('target') == '/app/data']
    expected_source = str(Path(os.environ.get('INKMIND_ROOT', '/opt/inkmind')).resolve() / 'data')
    if len(data_mounts) != 1 or data_mounts[0].get('type') != 'bind' or str(Path(data_mounts[0].get('source', '')).resolve()) != expected_source or data_mounts[0].get('read_only'):
        raise ValueError('Database must use the same writable host data directory as snapshots')
    if 'proxy' in services['backend']['networks'] or config['networks']['proxy']['name'] != 'inkmind_proxy':
        raise ValueError('Unexpected proxy network')


if __name__ == '__main__':
    try:
        validate(json.load(sys.stdin))
    except (ValueError, KeyError, TypeError) as error:
        sys.exit(str(error))
