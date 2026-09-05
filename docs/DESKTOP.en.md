# InkMind Desktop Development and Release Guide

InkMind Desktop is a local-only writing library. It does not synchronize manuscripts or application data with the Web deployment. It shares the existing React interface and FastAPI business logic, while Electron supplies the native window, local process lifecycle, and application packaging.

## Runtime Architecture

```text
Electron main
├── selects an available 127.0.0.1 port
├── creates a per-launch desktop session token
├── starts the PyInstaller-packaged FastAPI service
├── waits for /health
└── creates an isolated BrowserWindow
    └── preload exposes only the API URL and local-session method

React renderer ──HTTP/SSE──> local FastAPI ──SQLAlchemy──> local SQLite
```

In production, the FastAPI process also serves the compiled React assets. Browser routing, ordinary API calls, NDJSON, and SSE streams therefore use one local origin. During development, Vite serves the interface while Electron still owns the local API process.

`/auth/desktop-session` is usable only when `DESKTOP_MODE=true` and requires the per-launch token held by the Electron main process. The same request returns 404 in Web mode. Desktop creates one local author automatically and omits registration, login, logout, and admin entry points.

## Local Data and Network Boundary

Desktop provides no built-in models and ignores model credentials from `.env` and the launch environment. Add your API key and service URL under AI Settings → Custom LLM Management, then select a provider and model separately for the assistant and text generation. The assistant requires an Anthropic-compatible configuration. Missing or deleted configurations stay unconfigured without falling back to built-ins.

The default macOS data location is:

```text
~/Library/Application Support/inkmind-desktop/
├── data/inkmind.db       # Writing, versions, settings, model configuration, and usage
├── config/jwt-secret     # Local session signing secret, readable by the current user
└── logs/backend.log      # Local API startup and runtime log
```

These files live outside the `.app`, so replacing or upgrading the application does not overwrite them. InkMind does not implement Desktop-to-Web manuscript sync, cloud backup, or conflict resolution.

Novel management, editing, versions, and export work locally without a configured model. AI requests are sent to the selected OpenAI, Anthropic, Qwen, DeepSeek, MiniMax, Kimi, or GLM service when those features are used. A database backup may include custom model API keys and should be protected as a sensitive file.

## Backup and Restore

Quit InkMind completely and confirm that no `inkmind-backend` process remains. Copy the entire `data` directory to back up the writing library. To restore, quit the app before replacing the current `data` directory with a backup. Keeping `config/jwt-secret` preserves existing local tokens, although the app obtains a fresh valid session on its next launch.

TXT, Markdown, and PDF exports are useful readable copies. They omit full version history, characters, memos, and model settings, so they are not a database backup.

## Development

Development requires Python 3.12, Node.js 20+, and npm. From the repository root, run:

```bash
./start-desktop.sh
```

The script creates `backend/.venv-desktop` and installs dependencies when needed, then starts Vite and Electron. Electron looks for Python in this order:

1. the interpreter specified by `INKMIND_PYTHON`;
2. `backend/.venv-desktop/bin/python`;
3. `backend/.venv/bin/python`;
4. `python3.12`.

Run individual build checks with:

```bash
cd desktop
npm install
npm run build:main
npm run build:ui
npm run build:backend
```

## macOS Packaging

### Icon assets

The master artwork is `desktop/assets/icon-master.png`. Run `npm run build:icons` in `desktop` to generate a 1024px `icon.png` with transparent padding and a macOS `build/icon.icns` containing 16–1024px representations. Packaging runs this step automatically; electron-builder uses the ICNS. Do not copy the web favicon directly into the desktop icon: its opaque background or padding may be unsuitable for the Dock.

See [assets/README.md](../desktop/assets/README.md) for the design and provenance. Rebuild and restart the app after changing the icon; replace an existing installation with the new package.

### Build the installers

```bash
cd desktop
npm run package:mac
```

The command builds Electron TypeScript, the shared React interface, the PyInstaller backend, and electron-builder DMG/ZIP artifacts:

```text
desktop/release/
├── InkMind-<version>-<arch>.dmg
├── InkMind-<version>-<arch>.zip
└── mac-<arch>/InkMind.app
```

Claude Agent SDK includes platform runtime resources. Together with Electron and Python, this makes the installer substantially larger than the Web assets. PyInstaller is platform-specific: an Apple Silicon build contains an arm64 backend. Build Intel macOS, Windows, and Linux releases on the matching architecture and operating system.

## Automated GitHub Releases

`.github/workflows/release-macos.yml` follows ContextCue's tag-based release flow. Ordinary branch pushes do not publish desktop releases; the existing Web deployment on `main` is unchanged.

1. The current desktop version is `0.1.1`. For subsequent versions, run `npm version patch --prefix desktop --no-git-tag-version` (or specify a version), then commit the desktop manifest, lockfile, and release changes.
2. Push the commit and a stable tag that exactly matches `desktop/package.json`:

   ```bash
   git push origin HEAD
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. Watch **Release macOS** under repository Actions. `macos-15` builds arm64 and `macos-15-intel` builds x64, each with native Node 22 / Python 3.12. Tag/version mismatches fail before packaging.
4. Both architectures must pass frontend/backend tests, signature verification, a bundled API startup check, and DMG/ZIP integrity checks. Only then does the workflow create a draft, upload all assets, publish it, and mark it Latest.

Assets include versioned DMG/ZIP files for both architectures, stable `InkMind-mac-arm64.dmg` / `InkMind-mac-x64.dmg` aliases, and `SHA256SUMS`. The README download URLs follow the latest Release and become available after the first publication. In-app automatic installation and updater metadata are not included.

Retry failures with Actions' rerun control. Publication resumes existing drafts but refuses to overwrite a published version; increment the version and use a new tag instead. Manual `workflow_dispatch` accepts an existing tag and requires the workflow to be on the default branch. Tag pushes also work for the first release from a feature branch.

### Signing modes

The default creates ad-hoc signed, non-notarized early-access builds without Apple Secrets. Release notes identify this status; macOS may block installation. This is not standard trusted distribution.

For production, set the repository Actions variable `MACOS_SIGNING_ENABLED=true` and add these Secrets:

| Secret | Purpose |
| --- | --- |
| `CSC_LINK` | Base64-encoded Developer ID Application `.p12` certificate |
| `CSC_KEY_PASSWORD` | Certificate export password |
| `APPLE_ID` | Apple developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

This mode requires signing, notarization, and ticket verification. Missing credentials or notarization failures stop publication rather than falling back. Do not provide writing databases, `.env`, or model API keys to the release workflow. It uses the run's `GITHUB_TOKEN` for release uploads and the optional signing credentials above.

Local release checks:

```bash
node --test desktop/tests/*.test.mjs
python3 desktop/scripts/smoke-backend.py \
  desktop/release/mac-arm64/InkMind.app/Contents/Resources/backend/inkmind-backend \
  desktop/release/mac-arm64/InkMind.app/Contents/Resources/frontend
```

References: [GitHub runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [electron-builder v26 macOS signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/).

Intel macOS source builds of `cryptography` use `OPENSSL_STATIC=1` to avoid symbol conflicts when PyInstaller bundles Python's different `libssl`. The build script checks and rebuilds dynamically linked copies in existing virtual environments. Native compilation needs Xcode, Rust and OpenSSL development libraries, provided by GitHub's macOS runner. See [cryptography's static linking instructions](https://cryptography.io/en/latest/installation/).

## Release Checklist

Before distributing a release:

1. Sign with a Developer ID Application certificate instead of an Apple Development certificate.
2. Submit the application for Apple notarization and staple the ticket.
3. Install it on a clean Mac without the repository, Python, or Node.js.
4. Verify first launch, novel creation, autosave, restart recovery, AI streaming, and export.
5. Verify that quitting the app leaves no `inkmind-backend` process.
6. Verify that an in-place upgrade preserves `data/inkmind.db`.

Desktop automatic updates are not implemented yet. Validate installation and data preservation for every upgrade package.

## Troubleshooting

### The local API cannot start

Inspect `~/Library/Application Support/inkmind-desktop/logs/backend.log`. Typical causes are an incomplete application bundle, lost execute permission on the backend, or endpoint-security software blocking the subprocess.

In development, also verify that `backend/.venv-desktop/bin/python` can import `fastapi`, `uvicorn`, and `claude_agent_sdk`.

### The page remains loading or shows login

Quit and reopen InkMind. The desktop renderer must receive its API URL through preload, and the Electron main process exchanges its launch token for the local JWT. Opening the Vite URL in an ordinary browser does not supply a desktop session, so seeing login there is expected.

### macOS blocks the installer

A local Apple Development signature is not a public distribution signature. Use Developer ID Application signing and Apple notarization. Do not make bypassing Gatekeeper part of the release process.

### AI is unavailable while editing works

The selected provider may be unconfigured or unreachable. Local saving does not depend on the model service, so writing and export remain available.
