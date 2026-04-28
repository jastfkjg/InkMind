<div align="center">

<img src="images/favicon.png?v=2" width="180" alt="InkMind Logo"/>

# InkMind

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-red.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)

**AI-Powered Novel Writing Tool** — Novel management, chapter editing, character settings, multi-model AI generation, export and publishing, an all-in-one solution.

[Features](#feature-overview) · [Quick Start](#quick-start) · [Project Structure](#project-structure) · [Getting Help](#getting-help)

🌐 **语言切换 / Language Switch**: [中文](README.md)

</div>

---

## Feature Overview

### Writing Toolkit

| Feature | Description |
|---------|-------------|
| **AI Generation** | Automatically generate chapter summary, title and content based on novel settings and previous chapters |
| **AI Rewrite** | Rewrite current chapter content as requested |
| **AI Append** | Append new content at the end of current text |
| **AI Ask** | General Q&A, available anytime |
| **AI Evaluation** | Analyze chapter shortcomings and provide improvement suggestions |
| **AI Expand / Polish** | Select paragraphs for expansion or polishing |
| **Preview Confirmation** | Preview AI-generated content before saving |
| **Auto Audit** | Automatically evaluate content quality after generation (De-AI score, issue detection) |

### Core Features

- **Multi-LLM Support** — OpenAI / Anthropic / Qwen / DeepSeek / MiniMax / Kimi, switch with one click
- **Multiple Agent Modes** — Flexible Agent / ReAct Mode / Direct LLM Call, choose as needed
- **Configurable AI Behavior** — Customize max LLM interaction rounds, Token consumption threshold
- **Novel Management** — Outline, genre (literature/fantasy/urban/romance/philosophy, etc.), writing style, background setting
- **Chapter Editing** — Add/delete/reorder, in-page text editing, font adjustment
- **Character System** — Character management
- **Novel Export** — Support exporting completed chapters in multiple formats
- **Token Statistics** — Clear view of model usage and call counts

## Preview

### Novel List
<img src="images/novellistpage.png?v=2" width="800"/>

### Novel Settings
<img src="images/novelsettingpage.png?v=2" width="600"/>

Novel information, genre, writing style and background settings.

### Character Management
<img src="images/characterpage.png?v=2" width="800"/>

Character cards support name, nickname, description, character relationships, automatically included in context when generating chapters.

### Chapter Writing
<img src="images/writingpage.png?v=2" width="800"/>

Right AI toolbar provides: Generate, Rewrite, Append, Ask, Evaluate five major functions.

### AI Evaluation
<img src="images/ai-evaluate.png?v=2" width="600"/>

AI evaluates current chapter issues and shortcomings, provides specific improvement suggestions.

### AI Generation
<img src="images/ai-generate.png?v=2" width="600"/>

### Selection Expand & Polish
<img src="images/textaugmentation.png?v=2" width="800"/>

Select any paragraph in the chapter, one-click expand or polish.

### Token Usage Statistics
<img src="images/tokenusage.png?v=2" width="800"/>

Real-time statistics of monthly call counts and consumption amounts for each model.

### AI Settings
<img src="images/ai-settings.png?v=2" width="600"/>

Support different Agent working modes (Flexible Agent / ReAct Mode / Direct LLM Call), configure max LLM interaction rounds, Token consumption threshold, auto audit switch and preview confirmation feature.

### Novel Export
<img src="images/novelexport.png?v=2" width="800"/>

---

## Quick Start

### Environment Requirements

- **Python** 3.10+
- **Node.js** 18+

### 1. Clone the Project

```bash
git clone https://github.com/yourname/InkMind.git
cd InkMind
```

### 2. Start Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env                # Copy environment variable template
```

Set model API key in `backend/.env`:

```env
# AI Model Key (fill as needed)
QWEN_API_KEY=sk-xxxxxxxx
# DEEPSEEK_API_KEY=sk-xxxxxxxx
# MINIMAX_API_KEY=sk-xxxxxxxx
# Other models similarly
```

Start service:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> in browser, start creating.

---

## Project Structure

```
InkMind/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI entry, lifespan, route registration
│   │   ├── config.py        # Pydantic Settings configuration
│   │   ├── database.py      # SQLAlchemy engine and session
│   │   ├── models.py        # ORM model definitions
│   │   ├── routers/         # API routes (auth, novels, chapters, characters, memos, meta, usage)
│   │   ├── schemas/         # Pydantic request/response models
│   │   ├── services/        # Business logic layer
│   │   ├── llm/             # Multi-model LLM integration
│   │   └── observability/   # OpenTelemetry configuration
│   ├── scripts/
│   ├── requirements.txt
│   └── env.example
│
├── frontend/
│   ├── src/
│   │   ├── api/             # Axios API client
│   │   ├── components/      # React components
│   │   ├── pages/           # Page components
│   │   ├── types/           # TypeScript type definitions
│   │   └── App.tsx
│   ├── vite.config.ts       # Vite configuration (including dev proxy)
│   ├── package.json
│   └── dist/                # Production build output
│
├── images/                   # README screenshots
├── LICENSE
├── README.md
└── README.en.md
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | FastAPI · Uvicorn · SQLAlchemy 2.0 · Pydantic 2.10 |
| Frontend | React 18 · Vite 6 · TypeScript 5.7 · React Router 7 · Axios |
| Database | SQLite (default) |
| Authentication | JWT (python-jose) · bcrypt |
| AI | OpenAI · Anthropic · Qwen · DeepSeek · MiniMax · Kimi |
| Observability | OpenTelemetry (supports OTLP export) |

---

## Getting Help

- 🐛 Encountered issues? Please submit an [Issue](https://github.com/yourname/InkMind/issues)
- 💡 Pull Requests are welcome

---

## License

This project is open source under [GNU General Public License v3.0](LICENSE).
