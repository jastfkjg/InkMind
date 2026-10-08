#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")" && pwd)"
task_python="${INKMIND_SANDBOX_PYTHON:-$task_root/backend/.venv/bin/python}"
if [ ! -x "$task_python" ]; then
  echo "请先按 INSTALL.md 安装后端，或通过 INKMIND_SANDBOX_PYTHON 指定已安装依赖的 Python。" >&2
  exit 1
fi
task_backend_pid=""
cleanup_payment_review() {
  if [ -n "$task_backend_pid" ]; then kill "$task_backend_pid" 2>/dev/null || true; fi
}
trap cleanup_payment_review EXIT INT TERM
PYTHONPATH="$task_root/backend" "$task_python" "$task_root/backend/scripts/run_payment_sandbox.py" &
task_backend_pid=$!
for task_attempt in {1..30}; do
  if ! kill -0 "$task_backend_pid" 2>/dev/null; then
    wait "$task_backend_pid"
    exit 1
  fi
  if "$task_python" -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=1)' 2>/dev/null; then
    break
  fi
  sleep 0.2
done
if ! "$task_python" -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=1)' 2>/dev/null; then
  echo "支付沙箱后端未就绪，请检查启动错误。" >&2
  exit 1
fi
cd "$task_root/frontend"
npm run dev -- --host 127.0.0.1
