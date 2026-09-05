# InkMind Desktop

This directory contains the Electron runtime and packaging configuration for the local macOS edition. The React interface and FastAPI business logic remain shared with the Web edition.

The full architecture, data, backup, release, and troubleshooting guide is in [`docs/DESKTOP.en.md`](../docs/DESKTOP.en.md). A [Chinese version](../docs/DESKTOP.md) is also available.

## Development

Run from the repository root:

```bash
./start-desktop.sh
```

The script installs missing desktop dependencies, prepares `backend/.venv-desktop`, starts Vite, launches the local API on an available loopback port, and opens Electron.

Set `INKMIND_PYTHON` to override the Python used by Electron. The default lookup order is `backend/.venv-desktop`, `backend/.venv`, then `python3.12`.

## Build

```bash
npm install
npm run build          # Electron TypeScript and shared React UI
npm run build:backend  # PyInstaller backend bundle
npm run package:mac    # DMG and ZIP in release/
```

PyInstaller output is platform and architecture specific. Build future Intel macOS, Windows, or Linux artifacts on the corresponding target environment.
