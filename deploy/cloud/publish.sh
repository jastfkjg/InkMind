#!/usr/bin/env bash
# Workflow maps existing ALIYUN_* repository Secrets; SSH_* Environment overrides take precedence.
set -Eeuo pipefail
stage='validate deployment inputs'
# Report only the stage/line, never the command or secret-bearing arguments.
trap 'status=$?; printf "Publication failed during %s (line %s, exit %s).\n" "$stage" "$LINENO" "$status" >&2; exit "$status"' ERR
fail() { printf '%s\n' "$1" >&2; exit 1; }
printf 'Validating deployment inputs.\n'
[[ "${TARGET_ENVIRONMENT:-}" == aliyun-prod && "${DEPLOY_TARGET:-}" == "$TARGET_ENVIRONMENT" ]] || {
    echo 'Set DEPLOY_TARGET=aliyun-prod in the selected Environment.' >&2; exit 1;
}
[[ "${SSH_HOST:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || \
    fail 'SSH_HOST must contain only an IPv4 address or hostname, without ssh://, a username, port, spaces or newlines.'
[[ "${SSH_USER:-}" =~ ^[a-z_][a-z0-9_-]*$ ]] || \
    fail 'SSH_USER must contain only the Linux deployment account name, without @host, spaces or newlines.'
SSH_PORT=${SSH_PORT:-22}
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || fail 'SSH_PORT must be a number between 1 and 65535.'
SSH_PORT=$((10#$SSH_PORT))
(( SSH_PORT >= 1 && SSH_PORT <= 65535 )) || fail 'SSH_PORT must be a number between 1 and 65535.'
[[ "${REVISION:-}" =~ ^[a-f0-9]{40}$ ]] || fail 'REVISION must be the full tested source SHA.'
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || \
    fail 'GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must be present; run this script through GitHub Actions.'
[[ -n "${SSH_KEY:-}" && -n "${SSH_KNOWN_HOSTS:-}" ]] || { echo 'Set ALIYUN_SSH_KEY and ALIYUN_KNOWN_HOSTS, or SSH_KEY/SSH_KNOWN_HOSTS overrides.' >&2; exit 1; }
[[ -n "${BACKEND_IMAGE:-}" && -n "${FRONTEND_IMAGE:-}" ]] || fail 'Set both tested immutable image digests.'
python3 deploy/cloud/validate_image.py "$BACKEND_IMAGE"
python3 deploy/cloud/validate_image.py "$FRONTEND_IMAGE"
ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
SSH=(ssh -i "$ssh_dir/key" -p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=15)
destination="$SSH_USER@$SSH_HOST"
stage='remote preflight'
printf 'Checking the remote deployment prerequisites.\n'
"${SSH[@]}" "$destination" "bash -s -- '$TARGET_ENVIRONMENT'" < deploy/cloud/preflight.sh
release="/opt/inkmind/releases/${REVISION}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
stage='create remote release directory'
printf 'Creating a fresh remote release directory.\n'
"${SSH[@]}" "$destination" "umask 077; mkdir '$release'"
stage='upload release scripts'
printf 'Uploading the release scripts.\n'
tar -C deploy/cloud --exclude='__pycache__' -czf - . | "${SSH[@]}" "$destination" "tar -xzf - -C '$release'"
stage='deploy application'
printf 'Deploying the tested application image.\n'
"${SSH[@]}" "$destination" "bash '$release/deploy.sh' '$BACKEND_IMAGE' '$FRONTEND_IMAGE' '$REVISION' '$TARGET_ENVIRONMENT'"
