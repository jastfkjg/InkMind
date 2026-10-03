"""Bind both immutable images to one tested source revision and CI run."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import sys
from validate_image import image_reference, repository


def repositories() -> dict[str, str]:
    registry = os.environ['ACR_REGISTRY']
    namespace = os.environ['ACR_NAMESPACE']
    return {service: repository(f'{registry}/{namespace}/inkmind-{service}') for service in ('backend', 'frontend')}


def resolve(metadata: dict, revision: str, run_id: str, names: dict[str, str]) -> dict[str, str]:
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Invalid source revision')
    if metadata['revision'] != revision or str(metadata['run_id']) != run_id:
        raise ValueError('Image metadata does not match the selected CI run')
    images = {service: image_reference(metadata['images'][service]) for service in names}
    if any(images[service].split('@')[0] != names[service] for service in names):
        raise ValueError('Image metadata uses a different repository')
    return images


def output(key: str, value: str) -> None:
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(f'{key}={value}\n')


if __name__ == '__main__':
    try:
        names = repositories()
        command = sys.argv[1]
        if command == 'repository':
            output('registry', os.environ['ACR_REGISTRY'])
            for service, name in names.items():
                output(service, name)
        elif command == 'create':
            images = {service: image_reference(name + '@' + os.environ[service.upper() + '_DIGEST']) for service, name in names.items()}
            data = {'revision': os.environ['GITHUB_SHA'], 'run_id': os.environ['GITHUB_RUN_ID'], 'images': images}
            path = Path(sys.argv[2]); path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=2) + '\n')
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
                stream.write(f'Build run ID: `{data["run_id"]}`\n\nRevision: `{data["revision"]}`\n\n')
                for service, image in images.items(): stream.write(f'{service}: `{image}`\n\n')
        elif command == 'resolve':
            images = resolve(json.loads(Path(sys.argv[2]).read_text()), os.environ['EXPECTED_REVISION'], os.environ['EXPECTED_RUN_ID'], names)
            for service, image in images.items(): output(service, image)
        else:
            raise ValueError('Unknown command')
    except (ValueError, KeyError, IndexError, OSError) as error:
        sys.exit(str(error))
