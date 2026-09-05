#!/usr/bin/env bash
set -euo pipefail

desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
backend_dir="$(cd "$desktop_dir/../backend" && pwd)"
python_bin="${INKMIND_BUILD_PYTHON:-python3.12}"
venv_dir="$backend_dir/.venv-desktop"

if [[ ! -x "$venv_dir/bin/python" ]]; then
  "$python_bin" -m venv "$venv_dir"
fi

pip_options=(--disable-pip-version-check)
if [[ "$(uname -s)" == Darwin && "$(uname -m)" == x86_64 ]]; then
  # Recent cryptography releases build from source on Intel macOS. Link their
  # OpenSSL statically so PyInstaller cannot substitute Python's older libssl.
  # Ignore cached wheels that may have been built with dynamic linking.
  export OPENSSL_STATIC=1
  pip_options+=(--no-cache-dir)
fi
"$venv_dir/bin/python" -m pip install "${pip_options[@]}" -r "$backend_dir/requirements.txt" -r "$backend_dir/requirements-desktop.txt"
if [[ "$(uname -s)" == Darwin && "$(uname -m)" == x86_64 ]]; then
  crypto_binding="$("$venv_dir/bin/python" -c 'import importlib.util; print(importlib.util.find_spec("cryptography.hazmat.bindings._rust").origin)')"
  if otool -L "$crypto_binding" | grep -Eq 'lib(ssl|crypto)[.0-9]*\.dylib'; then
    crypto_version="$("$venv_dir/bin/python" -c 'from importlib.metadata import version; print(version("cryptography"))')"
    "$venv_dir/bin/python" -m pip install --force-reinstall --no-deps --no-cache-dir \
      --no-binary cryptography "cryptography==$crypto_version"
    if otool -L "$crypto_binding" | grep -Eq 'lib(ssl|crypto)[.0-9]*\.dylib'; then
      echo "cryptography must link OpenSSL statically for the Intel desktop bundle." >&2
      exit 1
    fi
  fi
fi
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
