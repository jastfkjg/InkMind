#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
app_root=${INKMIND_ROOT:-/opt/inkmind}
exec docker compose --project-name inkmind \
    --env-file "$app_root/app.env" --env-file "$release/image.env" \
    -f "$release/compose.yaml" "$@"
