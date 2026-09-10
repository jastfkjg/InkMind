This guide is for Coding Agents installing or starting InkMind: preserve existing configuration and data, prepare the environment, and verify the result; first identify the user's intended run mode and inspect the current environment.

# InkMind Agent Installation Guide

Execute this guide when the task involves installation, setup, or startup. Reading it alone does not authorize installation or deployment. Follow [AGENTS.md](AGENTS.md) for repository rules; see [README.en.md](README.en.md) for product information and [the desktop guide](docs/DESKTOP.en.md) for architecture, backups, and releases.

## 1. Choose one run mode

| User goal | Path |
| --- | --- |
| Use the released macOS app | Section 3: Desktop installer |
| Develop the Web app or run the source locally | Section 4: Web development |
| Develop Electron or desktop behavior | Section 5: Desktop development |
| Run in containers | Section 6: Docker Compose |
| Package, publish, or deploy remotely | Follow the relevant release documentation and deployment scripts within the requested scope |

Use the request and task context to choose. Default generic source startup to Web development and state that choice. If “install InkMind” leaves app usage versus source development unclear, inspect the environment, then ask briefly. Do not infer a request for public deployment or release publishing.

## 2. Inspect before changing anything

- Confirm the repository root and run `git status --short`; preserve existing changes.
- Check OS, CPU architecture, and shell. Commands below use Bash/zsh from the repository root unless stated otherwise.
- For source development, check Python 3.12+, Node.js 20+, and npm 9+. The desktop startup script invokes `python3.12`. For Docker, check the daemon and `docker compose version`.
- Inspect existing virtual environments, dependencies, lockfiles, and configuration. Reuse working installations. Use `npm ci` for fresh Node installs and the selected virtual environment's `python -m pip` for Python. Do not reinstall on every startup or casually upgrade dependencies and rewrite lockfiles.
- Check existing services and ports: Web defaults to 5173/8000, desktop development expects 5173, and Compose exposes 80. Identify a process before reusing or stopping it.

Copy configuration templates only when the destination is missing. Preserve existing secrets and databases; do not print credentials, erase app data, or run `docker compose down -v` to fix setup. Backend startup may migrate SQLite automatically, so back up important existing data first.

## 3. Desktop installer (macOS)

1. Check the actual assets and signing notes on the [latest Release](https://github.com/jastfkjg/InkMind/releases/latest). Select arm64 for Apple Silicon or x64 for Intel; fixed README links alone do not prove an asset is available.
2. Install and open the app. The backend runtime is bundled; source development dependencies are unnecessary.
3. Verify that the local novel library opens without registration or login.
4. In AI settings, add the user's custom provider and credentials, then select models separately for the AI assistant and text generation. The assistant needs an Anthropic-compatible configuration. Desktop model credentials are configured in the app, not through `.env`.

macOS data lives in `~/Library/Application Support/inkmind-desktop/` and does not sync with Web deployments. Follow the [desktop guide](docs/DESKTOP.en.md) for backups and blocked launches; do not automatically disable OS security controls.

## 4. Web development

### Prepare

For a fresh environment, use a verified Python 3.12+ interpreter:

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

On Windows PowerShell, create the environment with an available interpreter such as `py -3.12`, use `backend\.venv\Scripts\python.exe`, and start both services manually instead of running `.sh` scripts.

- Copy `backend/env.example` to `backend/.env` only if missing.
- Start the backend from `backend/`: it loads `.env` from its working directory, and the default SQLite path is relative to that directory.
- Generate a random `SECRET_KEY` for new environments without echoing it; preserve existing keys to avoid invalidating sessions.
- Use the user's model credentials and matching `DEFAULT_LLM_PROVIDER`, or configure custom models in the app. Without credentials, complete basic startup and mark AI as pending configuration.
- `start-dev.sh` does not load the root `.env`. Vite loads environment files from `frontend/` and accepts process environment variables.

### Start

After dependencies are ready:

```bash
source backend/.venv/bin/activate
./start-dev.sh
```

The script requires an activated Python environment and installed frontend dependencies. For custom ports:

```bash
VITE_FRONTEND_PORT=5174 VITE_BACKEND_PORT=8001 ./start-dev.sh
```

Include the actual frontend origin in backend `CORS_ORIGINS`. To start manually or bind the backend only to localhost, use two terminals:

```bash
# Terminal 1: backend/ directory, with the virtual environment activated
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2: frontend/ directory
npm run dev
```

### Verify

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://localhost:5173/api/health
```

Both should return `status: "ok"` and `mode: "web"`; substitute custom ports as needed. The second request checks the Vite proxy. Open the actual frontend address and verify that the page and authentication entry points load. A printed startup URL is not proof of success.

## 5. Desktop development

The current scripts use Unix paths and shell syntax; do not assume they run unchanged on Windows. For a fresh environment:

```bash
npm --prefix frontend ci
npm --prefix desktop ci
python3.12 -m venv backend/.venv-desktop
backend/.venv-desktop/bin/python -m pip install -r backend/requirements.txt
```

Skip preparation steps for working existing environments, then run:

```bash
./start-desktop.sh
```

Project-specific behavior:

- The script installs desktop dependencies only when `desktop/node_modules` is missing. It does **not** install frontend dependencies.
- It creates the Python environment and installs requirements only when `.venv-desktop/bin/python` is not executable. Install missing packages explicitly in an existing environment.
- Electron selects Python in this order: `INKMIND_PYTHON`, `backend/.venv-desktop/bin/python`, `backend/.venv/bin/python`, then `python3.12`. Setting `INKMIND_PYTHON` does not bypass the startup script's environment check.
- The script waits for `http://127.0.0.1:5173`; ensure that address belongs to the intended frontend. Changing only the Vite port is insufficient.
- Electron manages the backend and desktop session. Do not substitute a separately started Web backend or construct desktop session tokens yourself.

Verify inside Electron: the library loads without login or registration, and existing works open. A browser tab lacks the preload bridge and cannot validate the desktop session. Configure AI as in section 3.

For startup failures, inspect `~/Library/Application Support/inkmind-desktop/logs/backend.log` and report relevant errors with secrets redacted. Do not manually launch the backend executable inside an installed app.

## 6. Docker Compose

From the repository root, copy `.env.example` to `.env` only if missing. Preserve valid existing settings and check:

| Setting | Value for a fresh local build |
| --- | --- |
| `DOCKER_REGISTRY` | `local` (an image namespace; no push required) |
| `DOCKER_IMAGE_PREFIX` | `inkmind` |
| `DOCKER_IMAGE_TAG` | `dev` |
| `DATABASE_URL` | `sqlite:////app/data/inkmind.db` to store SQLite in the mounted volume |
| `SECRET_KEY` | A random value for new installations; retain existing values |
| Model settings | User-provided credentials and models, or configure them in the app |

The root template currently omits the three image variables and defaults to a database path outside `/app/data`. Correct these for new installations. For existing deployments with data outside the volume, locate and back up the database before planning migration; changing the path alone would open an empty library.

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl -fsS http://localhost/health
curl -fsS http://localhost/api/health
```

Use `config --quiet` to avoid printing expanded secrets. The host port is 80; backend port 8000 is not published. Verify backend health, Web mode in both health responses, and the page at `http://localhost`.

For failures:

```bash
docker compose logs --tail=100 backend
docker compose logs --tail=100 frontend
```

Stop with `docker compose down`, preserving the volume. Local container validation does not establish production readiness; handle domains, TLS, and remote deployment within the user's requested scope.

## 7. Troubleshoot and report

| Symptom | Check first |
| --- | --- |
| Missing Python module or `uvicorn` | Selected interpreter, virtual environment, installed requirements |
| Missing `vite`, `electron`, or `concurrently` | Dependencies in the corresponding directory, including `frontend/` |
| Page loads but `/api/*` fails | Backend health, actual ports, Vite proxy or Nginx upstream |
| Desktop blank, loading indefinitely, or showing login | Electron context, correct service on 5173, backend log |
| AI reports no configuration | Run mode, provider credentials, and separate model selections |
| Invalid Docker image name or database write failure | Image variables, absolute database path, volume permissions |

On installation failure, retain the exit code and first actionable error. Address the specific network, runtime, or build dependency issue instead of retrying indefinitely, disabling TLS verification, or upgrading everything. Resolve documentation discrepancies against actual code and report remaining limitations.

Report the run mode, actual address or app state, checks completed, missing configuration, and how to stop the services. Track processes started for the task and leave requested services running. Distinguish basic startup from AI verification; make a minimal AI call only when needed for the task and credentials are available.

Installation alone does not require business code changes. If frontend code also changes, follow `AGENTS.md` and run `npm --prefix frontend run build`. Do not commit secrets, databases, dependencies, logs, or build output.
