# InkMind

AI 辅助小说写作：FastAPI 后端 + React（Vite/TypeScript）前端。支持多 LLM、作品与章节管理、人物与关系设定，以及根据章节概要生成正文。

## 功能概览

- **用户**：注册、登录（JWT）、会话恢复（`/auth/me`）
- **作品**：大纲、类型、写作风格
- **章节**：增删改、排序、在当前页编辑正文
- **生成**：根据本章概要调用所选模型生成正文（新建一章或覆盖当前章）
- **人物与关系**：人物设定、两人关系说明（生成时会纳入上下文）

## 环境要求

- **Python** 3.11–3.13（推荐 3.12；3.14 部分依赖可能尚无预编译包）
- **Node.js** 18+（用于前端）

## 后端

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env
```

编辑 `backend/.env`：至少设置 `SECRET_KEY`；若要 AI 生成，按需配置 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`QWEN_API_KEY`（通义千问 / DashScope）、`DEEPSEEK_API_KEY` 等。`DEFAULT_LLM_PROVIDER` 可设为 `openai`、`anthropic`、`qwen`、`deepseek` 之一。详见 `env.example`。

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API 文档：<http://127.0.0.1:8000/docs>
- 健康检查：`GET /health`

## 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 <http://localhost:5173>。开发模式下请求会经 Vite 代理到 `http://127.0.0.1:8000`（见 `frontend/vite.config.ts`）。

生产构建：

```bash
npm run build
```

若前后端不同域，设置环境变量 `VITE_API_URL` 为后端根地址（例如 `https://api.example.com`）。

## 目录结构

```
InkMind/
├── backend/          # FastAPI 应用（app/）
├── frontend/         # React + Vite
└── README.md
```

## 许可证

按你的项目需要自行补充。
