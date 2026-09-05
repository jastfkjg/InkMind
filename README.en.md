<div align="center">

<img src="images/favicon.png?v=2" width="160" alt="InkMind Logo"/>

# InkMind

[![Python](https://img.shields.io/badge/Python-3.12+-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-red.svg)](LICENSE)

**A low-distraction workspace for long-form fiction.** Keep your prose at the center, with novel settings, characters, memos, AI assistance, version history, and export close at hand.

[Features](#features) · [Preview](#preview) · [Desktop](#local-macos-desktop-app) · [Quick Start](#quick-start) · [Configuration](#configuration) · [Development Guide](#development-guide)

🌐 Language: [中文](README.md)

</div>

---

## Features

InkMind is designed for long-form fiction, web novels, and story-driven writing. Its core goal is to keep settings, prose, AI assistance, and confirmation flows in one low-distraction writing experience.

### A Writing-First Workflow

1. **Pick up where you left off** — search novels by title or genre, sort by recent edits, and continue writing with one click.
2. **Write with fewer distractions** — search chapters, adjust typography, and enter focus mode to hide global navigation and AI controls. Press `Esc` to return.
3. **Know your save state** — autosave shows pending, saving, saved, or retry states. In-app navigation and logout wait for pending edits to save.
4. **Bring in AI when needed** — open generation, rewriting, continuation, checks, or the assistant from the editor. Tool panels and the assistant minimize each other to reduce overlap.

The browser remembers the last chapter, cursor selection, and scroll position per account and novel. Unsynced drafts offer an explicit recovery choice when reopened; see [Saving and recovery](#saving-and-recovery) for limitations.

### AI Assistant

The AI Assistant is InkMind's primary intelligent writing entry point. It appears as a floating panel across the novel list and writing workspace, supports continuous conversations around the current novel, and can actively read novel settings, chapters, characters, and memo context.

- **Context-aware**: reads novel state, chapter details, character profiles, and writing memos to reduce repeated background explanation.
- **Natural-language driven**: accepts instructions like "write a chapter", "continue the current chapter", "check this chapter", and "save as an official chapter".
- **Traceable execution**: shows stages such as reading context, drafting summary, generating prose, quality checking, and saving chapters.
- **Human-in-the-loop confirmation**: asks the user for choices or missing details when needed; generated content can be edited before being applied.
- **Interruptible tasks**: long-running tasks can be stopped before they continue in the wrong direction or consume more quota.
- **Chapter persistence**: generated and confirmed content can be saved directly into the current novel's chapter list.

### Writing and Creation

- **Novel management**: manage title, genre, writing style, and background.
- **Chapter writing**: add, delete, search, and edit chapters; review and restore historical versions.
- **Character system**: manage names, profiles, and notes; record appearance, relationships, and story roles in the profile.
- **Memo system**: record worldbuilding, foreshadowing, ideas, setting notes, and todos.
- **Novel export**: export completed chapters for backup, review, or publishing.

### AI Writing Tools

| Capability | Description |
| --- | --- |
| AI Assistant | Floating intelligent writing panel for continuous conversation, context reading, task orchestration, and chapter saving |
| AI Generation | Generate chapter summaries, titles, and prose from novel settings, characters, and previous chapters |
| AI Rewrite | Rewrite the current chapter according to custom instructions |
| AI Continuation | Continue writing from the end of the current chapter |
| AI Check | Analyze chapter issues and provide concrete revision directions |
| Selection Expand / Polish | Expand, polish, or adjust selected paragraphs |
| Preview Confirmation | When generation preview is enabled, review a generated chapter before confirming it; not a universal confirmation step for every AI operation |
| Auto Audit | Automatically evaluate generated content quality and detect issues |

### Models and Management

- **Multi-model support**: OpenAI, Anthropic, Qwen, DeepSeek, MiniMax, Kimi / Moonshot, and GLM.
- **Multiple Agent modes**: Flexible Agent, ReAct, and direct LLM calls, configurable per user.
- **Custom model configuration**: use built-in providers or user-level custom API keys, base URLs, and model names.
- **Token usage tracking**: records call counts, input/output tokens, quota usage, and model source.
- **Background tasks**: submit supported writing operations in background mode and monitor them from the tasks page.
- **Admin console**: admins can inspect users, quota, and usage logs.

## Preview

Captured from the current frontend using fictional novels and an isolated in-memory fixture. No real accounts, manuscripts, API keys, or production usage are shown. Screenshots use the Chinese interface; the app also supports English.

### Continue writing

Search, sort, and return to your work; export and deletion remain in the More menu.

![Novel library with search, sorting, and Continue writing actions](images/readme/library.jpg)

### A quieter editor

Chapter search, inline save status, and compact AI commands keep the prose in view.

![Writing workspace with chapter navigation and save status](images/readme/writing.jpg)

<details>
<summary>AI tools and dark focus mode</summary>

Open AI commands only when needed. This screenshot shows the generation form, not a real model response.

![On-demand AI generation panel beside the editor](images/readme/ai-tools.jpg)

Hide navigation and AI controls in focus mode; adjust line width for comfortable reading.

![Dark focus mode with a centered reading column](images/readme/focus-dark.jpg)

</details>

<details>
<summary>Mobile layouts: light editor and dark AI panel</summary>

<table>
  <tr>
    <td align="center"><img src="images/readme/mobile-light.jpg" width="300" alt="Mobile light-mode chapter editor"/><br/>Light editor</td>
    <td align="center"><img src="images/readme/mobile-dark.jpg" width="300" alt="Mobile dark-mode AI generation bottom panel"/><br/>Dark AI panel</td>
  </tr>
</table>

</details>

Capture sizes: desktop 1440 × 900, mobile 390 × 844. See [screenshot reproduction notes](images/readme/README.md).

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Python 3.12+ · FastAPI · Uvicorn · SQLAlchemy 2.0 · Pydantic 2 |
| Frontend | React 18 · TypeScript · Vite 6 · React Router 7 · Ant Design 6 · Axios |
| Database | SQLite (default) |
| Authentication | JWT · passlib/bcrypt |
| AI Integration | OpenAI SDK · Anthropic SDK · OpenAI-compatible APIs |
| Observability | OpenTelemetry · Prometheus metrics |
| Desktop | Electron · electron-builder · PyInstaller |
| Web deployment | Docker · Docker Compose · Nginx |

## Quick Start

### Local macOS Desktop App

The desktop app starts a FastAPI service bound only to the loopback interface and stores its SQLite database in the macOS application data directory. It uses one automatic local author, has no registration or login flow, and does not sync writing with the Web deployment. Prose, settings, characters, memos, versions, and usage records stay on this Mac. Configured AI features still send requests to the selected model provider.

Start the desktop development environment from the repository root:

```bash
./start-desktop.sh
```

Build installable DMG and ZIP artifacts:

```bash
cd desktop
npm install
npm run package:mac
```

Artifacts are written to `desktop/release/`. PyInstaller bundles the Python runtime and backend dependencies, so installed users do not need Python. The build targets the current machine's CPU architecture. Distribution to other users requires Developer ID signing and Apple notarization.

See the [desktop development and release guide](docs/DESKTOP.en.md) for architecture, data paths, backup, packaging checks, and troubleshooting.

### Requirements

- Python 3.12+
- Node.js 20+ for local development; the frontend Docker image builds with Node 20
- npm 9+

### 1. Clone the Project

```bash
git clone https://github.com/jastfkjg/InkMind.git
cd InkMind
```

### 2. Prepare the Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp env.example .env
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Configure at least one usable model key in `backend/.env`, and make sure `DEFAULT_LLM_PROVIDER` points to it:

```env
DEFAULT_LLM_PROVIDER=qwen
QWEN_API_KEY=sk-...
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-max
```

Start the backend:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

### 3. Prepare the Frontend

Open a new terminal:

```bash
cd frontend
npm ci
npm run dev
```

Default URLs:

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:8000>
- API docs: <http://localhost:8000/docs>

The Vite development server proxies `/api/*` to the backend and strips the `/api` prefix.

### 4. One-command Development Startup

The project also includes a development startup script. Install backend and frontend dependencies first:

```bash
./start-dev.sh
```

Custom ports:

```bash
VITE_FRONTEND_PORT=5174 VITE_BACKEND_PORT=8001 ./start-dev.sh
```

## Configuration

The repository includes two environment templates:

- `.env.example`: project-level development configuration, including frontend/backend ports, JWT, model, Agent, and observability settings.
- `backend/env.example`: backend runtime template; copy it to `backend/.env`.

Common settings:

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./inkmind.db` | Database URL; defaults to SQLite under the backend directory |
| `SECRET_KEY` | `change-me...` | JWT signing secret; replace it in production |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed frontend origins |
| `DEFAULT_LLM_PROVIDER` | `qwen` | Default model provider |
| `OPENAI_API_KEY` | empty | OpenAI or compatible gateway key |
| `QWEN_API_KEY` | empty | Qwen DashScope key |
| `DEEPSEEK_API_KEY` | empty | DeepSeek key |
| `MINIMAX_API_KEY` | empty | MiniMax key |
| `MOONSHOT_API_KEY` / `KIMI_API_KEY` | empty | Kimi / Moonshot key |
| `ANTHROPIC_API_KEY` | empty | Anthropic key, also usable for Claude Agent SDK |
| `GLM_API_KEY` | empty | Zhipu GLM key |
| `AGENT_MAX_TURNS` | `30` | Maximum Agent reasoning turns |
| `AGENT_PERMISSION_MODE` | `bypassPermissions` | AI Assistant Agent permission mode |
| `CLAUDE_CLI_PATH` | empty | Claude Code CLI path; auto-detected by default |
| `PROMETHEUS_ENABLED` | `false` | Enable Prometheus metrics server |
| `OTEL_ENABLED` | `false` | Enable OpenTelemetry |

> Do not commit real API keys, production accounts, database files, or local `.env` files.

## Docker Deployment

Copy the project-level configuration:

```bash
cp .env.example .env
```

Edit `.env`, set at least `SECRET_KEY` and one model provider key, then start the stack:

```bash
docker compose up -d --build
```

Default services:

- Frontend Nginx: <http://localhost>
- Backend container port: `8000`
- SQLite data volume: `inkmind-data`

View logs:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

Stop services:

```bash
docker compose down
```

## Development Guide

### Build and Regression Checks

Run in `frontend/`:

```bash
npm ci
npm test
npm run build
```

The unit tests cover draft storage, account/novel isolation, concurrent save coalescing, and retry after failure. The [browser regression guide](frontend/tests/README.md) includes an isolated fixture and a checklist for navigation, AI previews, version restoration, and responsive layouts. These checks do not replace real backend or model integration tests.

To explore the interface without a database or API key, start the fixture with `node tests/ui-fixture.mjs --demo` and follow the guide's separate Vite command. This is a local UI sample, not a complete offline application.

### Main Routes

Frontend:

| Path | Page |
| --- | --- |
| `/` | Novel list |
| `/login` / `/register` | Login and registration |
| `/settings` | AI settings |
| `/usage` | Token usage |
| `/tasks` | Background tasks |
| `/novels/:novelId/write` | Chapter writing |
| `/novels/:novelId/settings` | Novel settings |
| `/novels/:novelId/people` | Character management |
| `/novels/:novelId/memos` | Memos |
| Global floating panel inside novels | AI Assistant with current-novel context and writing task orchestration |
| `/admin/users` | User management |
| `/admin/logs` | Usage logs |

Backend route prefixes:

| Prefix | Description |
| --- | --- |
| `/auth` | Registration, login, current user |
| `/novels` | Novel management |
| `/chapters` | Chapter management |
| `/characters` | Character management |
| `/memos` | Memos |
| `/usage` | Token usage |
| `/background-tasks` | Background tasks |
| `/workflow` | Writing workflow |
| `/novels/{novel_id}/agent` | AI Assistant sessions, SSE chat, user confirmation, interruption, and result application |
| `/custom-llms` | User custom models |
| `/admin` | Admin console |
| `/meta` | Metadata |

### Project Structure

```text
InkMind/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry, CORS, route registration, SQLite auto-migration
│   │   ├── config.py            # Pydantic Settings configuration
│   │   ├── database.py          # SQLAlchemy engine and sessions
│   │   ├── models.py            # ORM models
│   │   ├── routers/             # API routes
│   │   ├── schemas/             # Request/response models
│   │   ├── services/            # Chapter generation, evaluation, versions, export, task logic
│   │   ├── llm/                 # Multi-model integration, streaming, token counting
│   │   ├── agent/               # AI Assistant orchestration, tool calls, task queue
│   │   ├── workflow/            # Writing workflow engine
│   │   └── observability/       # OpenTelemetry and metrics
│   ├── scripts/                 # Helper scripts
│   ├── requirements.txt
│   └── env.example
├── frontend/
│   ├── src/
│   │   ├── api/                 # Axios client
│   │   ├── components/          # Shared components, writing components, AI Assistant panel
│   │   ├── context/             # Auth, theme, and navigation contexts
│   │   ├── i18n/                # Chinese and English copy
│   │   ├── pages/               # Page components
│   │   ├── styles/              # Theme, base styles, page styles
│   │   ├── types/               # TypeScript types
│   │   └── App.tsx              # Route entry
│   ├── tests/                   # Save regression tests and local UI fixture
│   ├── package.json
│   └── vite.config.ts
├── desktop/                     # Electron main process, preload, and macOS packaging
│   ├── main.ts                  # Local API lifecycle, window, and session bridge
│   ├── preload.ts               # Restricted desktop API
│   └── scripts/                 # PyInstaller backend build
├── docs/
│   ├── DESKTOP.md               # Chinese desktop guide
│   └── DESKTOP.en.md            # Desktop architecture, data, and release guide
├── images/                      # README screenshots
├── docker-compose.yml
├── start-desktop.sh             # Desktop development entry point
├── start-dev.sh
├── DESIGN.md                    # Visual system and UI guidelines
├── AGENTS.md                    # Collaboration and engineering conventions
├── README.en.md
└── README.md
```

### Internationalization and Theme

- Frontend copy lives in `frontend/src/i18n/`.
- Add both Chinese and English translation keys for new visible text.
- Theme and visual variables live in `frontend/src/styles/`; `DESIGN.md` is the source of truth for visual rules.
- UI changes should be checked in light mode, dark mode, wide desktop, and mobile layouts.

## FAQ

### Saving and recovery

- Ordinary edits are saved automatically. If saving fails, stay on the page and use Retry; in-app navigation and logout are blocked until pending changes save.
- Unsynced text is also kept in browser-local storage when available. Reopening offers Restore or Keep server version, rather than silently overwriting either version.
- Local drafts and reading position belong to this browser and account. They are not cross-device sync or a backup guarantee: private browsing, cleared storage, or storage limits can prevent recovery. Export important work regularly.
- AI streaming and unconfirmed generation previews are not treated as ordinary edits by autosave. Review and confirm or cancel the preview before continuing to edit.
- Closing the browser is not the same as an in-app navigation: wait for Saved before closing, especially during network problems.

### Frontend API calls return 404 or login does not work

Make sure the backend is running at `VITE_BACKEND_HOST:VITE_BACKEND_PORT`, which defaults to `127.0.0.1:8000`. In development, the frontend calls `/api/*`, and Vite proxies those requests to the backend.

The desktop app does not show a login page. If it cannot enter the novel library, quit InkMind completely and inspect `~/Library/Application Support/inkmind-desktop/logs/backend.log`. Do not start the backend executable inside the installed app manually.

### AI features say no model is configured

Check that `backend/.env` contains the API key for the selected provider and that `DEFAULT_LLM_PROVIDER` matches it. You can also configure user-level custom models in the app's AI settings.

### CORS errors

Add the current frontend URL to backend `CORS_ORIGINS`, for example:

```env
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174
```

## License

This project is open source under [GNU General Public License v3.0](LICENSE).
