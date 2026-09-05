#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -d "$root_dir/desktop/node_modules" ]]; then
  npm --prefix "$root_dir/desktop" install
fi

if [[ ! -x "$root_dir/backend/.venv-desktop/bin/python" ]]; then
  python3.12 -m venv "$root_dir/backend/.venv-desktop"
  "$root_dir/backend/.venv-desktop/bin/python" -m pip install -r "$root_dir/backend/requirements.txt"
fi

exec env INKMIND_FRONTEND_DEV_URL=http://127.0.0.1:5173 npm --prefix "$root_dir/desktop" run dev
