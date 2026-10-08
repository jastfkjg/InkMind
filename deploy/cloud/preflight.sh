#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; printf "Remote preflight failed at line %s (exit %s).\n" "$LINENO" "$status" >&2; exit "$status"' ERR
fail() { printf '%s\n' "$1" >&2; exit 1; }
app_root=${INKMIND_ROOT:-/opt/inkmind}
target=${1:?Usage: preflight.sh TARGET}
[[ "$target" == aliyun-prod && -r "$app_root/deployment-target" && "$(cat "$app_root/deployment-target")" == "$target" ]] || {
    echo 'This host does not match the selected deployment target.' >&2; exit 1;
}
gateway_root=${GATEWAY_ROOT:-/opt/gateway}
[[ -r "$gateway_root/deployment-target" && "$(cat "$gateway_root/deployment-target")" == aliyun-beijing-01 ]] || fail 'Gateway host must be aliyun-beijing-01.'
for tool in docker python3 curl flock tar readlink; do
    command -v "$tool" >/dev/null || { echo "Missing dependency: $tool" >&2; exit 1; }
done
[[ -d "$app_root/releases" ]] || fail "Release directory is missing: $app_root/releases. Create it with the deployment user as owner."
[[ -w "$app_root" ]] || fail "The SSH deployment user cannot write to $app_root. Check its owner and permissions."
[[ -w "$app_root/releases" ]] || fail "The SSH deployment user cannot write to $app_root/releases. Check its owner and permissions."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 6) else "Host Python 3.6+ required")'
[[ -s "$app_root/app.env" ]] || fail 'app.env is missing or empty; restore the existing application configuration before deployment.'
python3 - "$app_root/app.env" <<'PY'
import os, stat, sys
info = os.stat(sys.argv[1])
if stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid():
    sys.exit('app.env must be owned by the deployment user, mode 600')
PY
docker info >/dev/null || fail 'The SSH deployment user cannot access Docker. Check Docker Engine and account permissions.'
architecture=$(docker info --format '{{.Architecture}}')
[[ "$architecture" == x86_64 || "$architecture" == amd64 ]] || fail 'Published images require an amd64/x86_64 Docker host.'
version=$(docker compose version --short)
python3 - "$version" <<'PY'
import re, sys
match = re.match(r'v?(\d+)\.(\d+)\.(\d+)', sys.argv[1])
if not match or tuple(map(int, match.groups())) < (2, 24, 0):
    sys.exit('Docker Compose 2.24+ required')
PY
docker network inspect inkmind_proxy >/dev/null || \
    fail 'Docker network inkmind_proxy is missing or inaccessible. Publish the aliyun-beijing-01 gateway first.'
[[ -d "$app_root/data" && -d "$app_root/backups" && -w "$app_root/backups" ]] || { echo "Provision data and backups directories first." >&2; exit 1; }
printf 'Remote deployment prerequisites passed.\n'
