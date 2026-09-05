#!/usr/bin/env bash
set -euo pipefail

desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
backend_dir="$(cd "$desktop_dir/../backend" && pwd)"
python_bin="${INKMIND_BUILD_PYTHON:-python3.12}"
venv_dir="$backend_dir/.venv-desktop"

if [[ ! -x "$venv_dir/bin/python" ]]; then
  "$python_bin" -m venv "$venv_dir"
fi

"$venv_dir/bin/python" -m pip install -r "$backend_dir/requirements.txt" -r "$backend_dir/requirements-desktop.txt"
cd "$backend_dir"
"$venv_dir/bin/pyinstaller" \
  --noconfirm \
  --clean \
  --onedir \
  --name inkmind-backend \
  --hidden-import app.main \
  --hidden-import passlib.handlers.bcrypt \
  --collect-all claude_agent_sdk \
  --collect-all tiktoken \
  --collect-all fpdf \
  desktop_entry.py
