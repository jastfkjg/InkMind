#!/usr/bin/env bash
# Application only; never changes the shared gateway or another application's data.
set -euo pipefail
umask 077
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
app_root=${INKMIND_ROOT:-/opt/inkmind}
backend=${1:?Usage: deploy.sh BACKEND_DIGEST FRONTEND_DIGEST REVISION TARGET}
frontend=${2:?Set frontend digest}
revision=${3:?Set tested source revision}
target=${4:?Set target}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
python3 "$release/validate_image.py" "$backend"
python3 "$release/validate_image.py" "$frontend"
bash "$release/preflight.sh" "$target"
app_root=$(cd -- "$app_root" && pwd -P)
[[ "$(dirname -- "$release")" == "$app_root/releases" && ! -e "$release/image.env" ]]
exec 9>"$app_root/deploy.lock"
flock -w 120 9
previous=""
if [[ -e "$app_root/current" || -L "$app_root/current" ]]; then
    [[ -L "$app_root/current" ]]
    previous=$(readlink -f "$app_root/current")
    [[ "$(dirname -- "$previous")" == "$app_root/releases" && -r "$previous/compose.sh" && -r "$previous/image.env" && -r "$previous/revision" ]]
    [[ "$(cat "$previous/revision")" =~ ^[a-f0-9]{40}$ ]]
elif [[ -n "$(docker ps -aq --filter label=com.docker.compose.project=inkmind)" ]]; then
    echo 'Existing deployment is untracked. Back up and reconcile the legacy deployment first.' >&2
    exit 1
fi

printf 'INKMIND_BACKEND_IMAGE=%s\nINKMIND_FRONTEND_IMAGE=%s\n' "$backend" "$frontend" > "$release/image.env"
printf '%s\n' "$revision" > "$release/revision"
compose() { bash "$release/compose.sh" "$@"; }
compose config --format json | python3 "$release/validate_config.py"
compose pull
docker run --rm --network none -v "$app_root/data:/app/data:ro" --entrypoint python "$backend" -c 'from pathlib import Path; import sys; sys.exit("Maintenance already enabled; inspect previous deployment" if Path("/app/data/.deploy-maintenance").exists() else "Existing database is missing; provision or migrate data first" if not Path("/app/data/inkmind.db").is_file() else 0)'
# Syntax validation must also work before the first backend container exists.
docker run --rm --network none --add-host backend:127.0.0.1 "$frontend" nginx -t
# Checking /health through local TLS also verifies the selected hostname and gateway routing.
health() {
    local expected=$1 path=$2 service=$3
    curl --noproxy '*' --resolve inkmind.jastcraft.com:443:127.0.0.1 --fail --silent --show-error \
        --connect-timeout 5 --max-time 10 "https://inkmind.jastcraft.com/$path" |
        python3 "$release/check_health.py" "$service" "$expected"
}
verify() {
    for attempt in {1..12}; do
        if health "$1" health inkmind && health "$1" api/health inkmind && health "$1" frontend-health inkmind-frontend; then return 0; fi
        if (( attempt < 12 )); then sleep 5; fi
    done
    return 1
}
marker=false
stopped=false
snapshot="$app_root/backups/$(basename "$release").sqlite"
rollback() {
    status=$?
    trap - EXIT INT TERM
    if [[ "$status" != 0 ]]; then
        # Capture the candidate failure before rollback replaces its containers.
        compose ps -a >&2 || true
        compose logs --no-color --tail=100 >&2 || true
        local container
        while IFS= read -r container; do
            [[ -n "$container" ]] || continue
            docker inspect --format '{{.Name}} health={{json .State.Health}}' "$container" >&2 || true
        done < <(compose ps -aq)
    fi
    if [[ "$status" != 0 && "$marker" == true ]]; then
        if [[ "$stopped" == true ]]; then
            echo 'Deployment failed; restoring pre-migration database and previous images.' >&2
            # Never restore while a candidate writer could still be alive.
            if ! compose stop frontend backend; then
                echo 'Could not stop candidate; maintenance retained. Restore manually.' >&2
                exit "$status"
            fi
            if [[ -f "$snapshot" ]]; then
                if ! docker run --rm -i --network none -v "$app_root/data:/app/data" --entrypoint python "$backend" -c "$(cat "$release/restore_sqlite.py")" < "$snapshot"; then
                    echo 'Database restore failed; maintenance retained.' >&2; exit "$status"
                fi
            fi
            if [[ -n "$previous" ]]; then
                if ! bash "$previous/compose.sh" up -d --wait --wait-timeout 180 || ! verify "$(cat "$previous/revision")"; then
                    echo 'Previous release could not be verified; maintenance retained.' >&2; exit "$status"
                fi
            else
                compose rm -f -s frontend backend || { echo 'Failed containers could not be removed; maintenance retained.' >&2; exit "$status"; }
                echo 'No previous release; data retained for inspection.' >&2
            fi
        fi
        if [[ "$stopped" == true ]]; then
            if [[ -n "$previous" ]]; then
                python3 - "$app_root" "$previous" <<'PYTHON'
import os, sys
from pathlib import Path
root = Path(sys.argv[1]); temp = root / '.current-rollback'
if os.path.lexists(temp): temp.unlink()
temp.symlink_to(sys.argv[2]); os.replace(temp, root / 'current')
PYTHON
            else
                rm -f "$app_root/current"
            fi
        fi
        docker run --rm --network none -v "$app_root/data:/app/data" --entrypoint python "$backend" -c 'from pathlib import Path; Path("/app/data/.deploy-maintenance").unlink(missing_ok=True)'
        rm -f "$snapshot.tmp"
    fi
    exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Marker is created via the container user; the data directory may be mode 700 UID 1000.
docker run --rm --network none -v "$app_root/data:/app/data" --entrypoint python "$backend" -c 'from pathlib import Path; Path("/app/data/.deploy-maintenance").touch(mode=0o644)'
marker=true
if [[ -n "$previous" ]]; then
    drained=false
    for attempt in {1..60}; do
        if bash "$previous/compose.sh" exec -T backend curl -fsS http://127.0.0.1:8000/health |
            python3 "$release/check_health.py" inkmind "$(cat "$previous/revision")" --drain; then drained=true; break; fi
        sleep 5
    done
    [[ "$drained" == true ]] || { echo 'Requests or AI tasks still active; deployment aborted.' >&2; exit 1; }
    stopped=true
    bash "$previous/compose.sh" stop frontend backend
fi
# Provisioning creates a real, empty SQLite file for a fresh installation.
docker run --rm -i --network none -v "$app_root/data:/app/data:ro" --entrypoint python "$backend" - < "$release/backup_sqlite.py" > "$snapshot.tmp"
mv "$snapshot.tmp" "$snapshot"
stopped=true
compose up -d --wait --wait-timeout 180
verify "$revision" || { echo 'HTTPS health/revision check failed.' >&2; exit 1; }
python3 - "$app_root" "$release" "$previous" <<'PY'
import os, sys
from pathlib import Path
root, release, previous = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
for name, destination in [('previous', previous), ('current', release)]:
    if destination:
        temporary = root / ('.' + name + '-next')
        if os.path.lexists(temporary): temporary.unlink()
        temporary.symlink_to(destination)
        os.replace(temporary, root / name)
PY
# The release is committed before reopening admission. Never restore a snapshot
# after unlink may have succeeded: an SSH/exec error can have an ambiguous outcome.
marker=false
stopped=false
if ! compose exec -T backend python -c 'from pathlib import Path; Path("/app/data/.deploy-maintenance").unlink()'; then
    echo 'Release verified and promoted, but reopening could not be confirmed. Inspect the maintenance marker and API; do not restore a snapshot over new writes.' >&2
    exit 1
fi
printf 'Deployed %s\nBackend: %s\nFrontend: %s\nURL: https://inkmind.jastcraft.com\n' "$revision" "$backend" "$frontend"
