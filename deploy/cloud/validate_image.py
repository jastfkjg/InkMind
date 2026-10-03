"""Validate a registry-qualified, immutable Docker image without shell evaluation."""
import re
import sys


def repository(value):
    host, separator, path = value.partition('/')
    if not separator or not re.fullmatch(r'[a-z0-9][a-z0-9.-]*(?::[0-9]+)?', host):
        raise ValueError('Use a registry hostname and repository path, without a scheme')
    if ':' in host and not 1 <= int(host.rsplit(':', 1)[1]) <= 65535:
        raise ValueError('Invalid registry port')
    if not path or any(not re.fullmatch(r'[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*', part) for part in path.split('/')):
        raise ValueError('Invalid image repository path')
    return value


def image_reference(value):
    name, separator, digest = value.partition('@')
    repository(name)
    if not separator or not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('An immutable registry image @sha256 digest is required')
    return value


if __name__ == '__main__':
    try:
        image_reference(sys.argv[1])
    except (ValueError, IndexError) as exc:
        sys.exit(str(exc))
