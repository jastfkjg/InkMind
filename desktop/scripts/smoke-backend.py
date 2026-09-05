"""Smoke-test the bundled API without source imports, user data, or AI calls."""

import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


def main() -> None:
    executable, frontend = (Path(arg).resolve() for arg in sys.argv[1:])
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base_url = f"http://127.0.0.1:{port}"
    session_token = secrets.token_urlsafe(32)

    def request(path: str, method: str = "GET", headers: dict[str, str] | None = None) -> bytes:
        with urlopen(Request(base_url + path, method=method, headers=headers or {}), timeout=3) as response:
            return response.read()

    with tempfile.TemporaryDirectory(prefix="inkmind-smoke-") as temporary:
        workdir = Path(temporary)
        env = {**os.environ, "DESKTOP_MODE": "true", "DESKTOP_SESSION_TOKEN": session_token,
               "DESKTOP_FRONTEND_DIR": str(frontend), "DATABASE_URL": f"sqlite:///{workdir / 'test.db'}",
               "SECRET_KEY": secrets.token_urlsafe(48), "OTEL_ENABLED": "false", "PROMETHEUS_ENABLED": "false"}
        with (workdir / "backend.log").open("w+") as log:
            child = subprocess.Popen([str(executable), "--host", "127.0.0.1", "--port", str(port)],
                                     cwd=workdir, env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 45
                while True:
                    if child.poll() is not None:
                        raise RuntimeError(f"Bundled backend exited with code {child.returncode}")
                    try:
                        request("/health")
                        break
                    except (URLError, TimeoutError):
                        if time.monotonic() >= deadline:
                            raise RuntimeError("Bundled backend failed its readiness check")
                        time.sleep(0.2)
                token = json.loads(request("/auth/desktop-session", "POST",
                                           {"X-InkMind-Desktop-Token": session_token}))["access_token"]
                authorization = {"Authorization": f"Bearer {token}"}
                providers = json.loads(request("/meta/llm-providers", headers=authorization))
                assert providers["builtin"] == [] and providers["agent_builtin"] is None
                assert json.loads(request("/novels", headers=authorization)) == []
                assert b"InkMind" in request("/")
                assert (workdir / "test.db").is_file()
                print("Bundled API passed: local session, empty library, custom-only models, static UI.")
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read(), file=sys.stderr)
                raise
            finally:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()


if __name__ == "__main__":
    main()
