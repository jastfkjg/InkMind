<div align="center">

<img src="images/favicon.png?v=3" width="160" alt="InkMind Logo"/>

# InkMind

[![Python](https://img.shields.io/badge/Python-3.12+-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-red.svg)](LICENSE)

**为长篇创作而生的低干扰写作工作台。** 以正文为中心，将作品设定、人物、备忘录、AI 辅助、历史版本和导出放在触手可及的位置。

[功能概览](#功能概览) · [界面预览](#界面预览) · [桌面版](#macos-本地桌面版) · [快速开始](#快速开始) · [配置](#配置) · [开发指南](#开发指南)

🌐 Language: [English](README.en.md)

</div>

---

## 功能概览

### 专注写作

- **作品与章节管理**：按标题或类型搜索作品，按最近编辑排序，快速回到上次创作的位置。
- **舒适的编辑体验**：章节搜索、字号与行距调整、浅色与深色主题；专注模式隐藏导航和 AI 工具，按 `Esc` 返回。
- **自动保存与版本历史**：随时查看保存状态，恢复本地草稿，查看或回滚章节历史版本。详见[保存与恢复](#保存与恢复)。
- **人物与备忘录**：集中整理角色、世界观、伏笔和灵感，让设定与正文相互衔接。
- **作品导出**：导出已完成章节，用于备份、审阅或发布。

### AI 辅助创作

AI 助手支持围绕作品连续对话，读取作品设定、章节、人物和备忘录。你可以直接提出“续写当前章节”“检查这章的问题”等要求，查看执行进度，并在需要时中断任务。

| 能力 | 用途 |
| --- | --- |
| 章节生成 | 结合作品设定、人物和前文生成概要、标题与正文 |
| 改写与续写 | 按自定义要求重写章节，或从正文末尾继续创作 |
| 选区扩写与润色 | 针对选中的段落丰富细节、润色或调整表达 |
| 质量检查 | 分析章节问题，提供修改建议；支持生成后自动评估 |
| 生成预览 | 开启后可先审阅生成章节，再确认保存 |

### 模型与用量

- 支持 OpenAI、Anthropic、通义千问、DeepSeek、MiniMax、Kimi / Moonshot 和 GLM。
- 支持自定义 API Key、Base URL 和模型名，以及多种 Agent 模式。
- 统计调用次数、输入与输出 Token、额度消耗和模型来源。
- 支持后台写作任务与状态查看；Web 版提供用户、额度和调用日志管理。

## 界面预览

支持中英文界面、浅色与深色主题，并适配桌面与手机屏幕。

### 从作品列表继续写作

搜索和排序作品，一键回到创作；通过“更多”菜单导出或管理作品。

![作品列表：搜索、排序与继续写作](images/readme/library.jpg)

### 更安静的章节编辑器

章节搜索、行内保存状态与紧凑的 AI 命令，让正文保持在视线中心。

![章节写作：章节导航、正文与保存状态](images/readme/writing.jpg)

<details>
<summary>展开查看：AI 工具与深色专注模式</summary>

在编辑器中按需展开 AI 工具，结合作品上下文生成章节。

![按需展开的 AI 生成面板](images/readme/ai-tools.jpg)

专注模式隐藏导航与 AI 工具，可调节行宽，保持舒适阅读。

![深色专注模式与居中正文阅读区](images/readme/focus-dark.jpg)

</details>

<details>
<summary>展开查看：手机浅色编辑器与深色 AI 面板</summary>

<table>
  <tr>
    <td align="center"><img src="images/readme/mobile-light.jpg" width="300" alt="手机尺寸下的浅色章节编辑器"/><br/>浅色编辑器</td>
    <td align="center"><img src="images/readme/mobile-dark.jpg" width="300" alt="手机尺寸下的深色 AI 生成底部面板"/><br/>深色 AI 面板</td>
  </tr>
</table>

</details>

## 快速开始

### macOS 本地桌面版

**下载：** [最新 Release](https://github.com/jastfkjg/InkMind/releases/latest) · [Apple Silicon 安装包](https://github.com/jastfkjg/InkMind/releases/latest/download/InkMind-mac-arm64.dmg) · [Intel 安装包](https://github.com/jastfkjg/InkMind/releases/latest/download/InkMind-mac-x64.dmg)。固定下载链接在首次 Release 发布后生效；签名状态请查看对应发布说明。

桌面版无需注册或登录，作品保存在本机，不与 Web 版同步。安装包已包含 Python 后端，无需额外安装运行环境。

首次使用时，在 **AI 设置 → 自定义 LLM 管理** 中添加 API Key 和服务地址，再分别为 AI 助手与正文生成选择供应商和模型。AI 助手需要 Anthropic 兼容配置。桌面版不提供内置模型，也不读取 `.env` 中的模型凭据。

正文、设定、人物、备忘录、版本和用量记录保存在这台 Mac 上；使用在线模型时，AI 请求会发送到所选模型服务。

备份与故障排查可查阅[桌面版指南](docs/DESKTOP.md)。

### 从源码运行

- Python 3.12+
- Node.js 20+
- npm 9+

#### 1. 克隆项目

```bash
git clone https://github.com/jastfkjg/InkMind.git
cd InkMind
```

#### 2. 准备后端环境

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp env.example .env
```

Windows PowerShell 激活方式：

```powershell
.\.venv\Scripts\Activate.ps1
```

至少需要在 `backend/.env` 中配置一个可用模型 Key，并确保 `DEFAULT_LLM_PROVIDER` 指向它：

```env
DEFAULT_LLM_PROVIDER=qwen
QWEN_API_KEY=sk-...
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-max
```

启动后端：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：

```bash
curl http://localhost:8000/health
```

#### 3. 准备前端环境

在项目根目录新开一个终端：

```bash
cd frontend
npm ci
npm run dev
```

默认访问地址：

- 前端：<http://localhost:5173>
- 后端：<http://localhost:8000>
- API 文档：<http://localhost:8000/docs>

前端开发服务器会把 `/api/*` 代理到后端，并去掉 `/api` 前缀。

#### 4. 一键启动开发环境

安装依赖后，在项目根目录激活后端虚拟环境并运行：

```bash
source backend/.venv/bin/activate
./start-dev.sh
```

自定义端口：

```bash
VITE_FRONTEND_PORT=5174 VITE_BACKEND_PORT=8001 ./start-dev.sh
```

## 配置

仓库内有两份环境变量模板：

- `.env.example`：项目级开发配置，包含前端端口、后端端口、JWT、模型、Agent、观测配置。
- `backend/env.example`：后端运行所需配置模板，复制到 `backend/.env` 后生效。

常用配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./inkmind.db` | 数据库连接，默认使用后端目录下的 SQLite |
| `SECRET_KEY` | `change-me...` | JWT 签名密钥，生产环境必须替换 |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | 允许访问后端的前端来源 |
| `DEFAULT_LLM_PROVIDER` | `qwen` | 默认模型提供商 |
| `OPENAI_API_KEY` | 空 | OpenAI 或兼容网关 Key |
| `QWEN_API_KEY` | 空 | 通义千问 DashScope Key |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek Key |
| `MINIMAX_API_KEY` | 空 | MiniMax Key |
| `MOONSHOT_API_KEY` / `KIMI_API_KEY` | 空 | Kimi / Moonshot Key |
| `ANTHROPIC_API_KEY` | 空 | Anthropic Key，也可用于 Claude Agent SDK |
| `GLM_API_KEY` | 空 | 智谱 GLM Key |
| `AGENT_MAX_TURNS` | `30` | Agent 最大推理轮数 |
| `AGENT_PERMISSION_MODE` | `bypassPermissions` | AI 助手 Agent 权限模式 |
| `CLAUDE_CLI_PATH` | 空 | Claude Code CLI 路径，默认自动检测 |
| `PROMETHEUS_ENABLED` | `false` | 是否启用 Prometheus 指标服务 |
| `OTEL_ENABLED` | `false` | 是否启用 OpenTelemetry |

> 不要提交真实 API Key、生产账号、数据库文件或本地 `.env`。

## Docker 部署

复制项目级配置：

```bash
cp .env.example .env
```

编辑 `.env`，至少设置 `SECRET_KEY` 和一个模型提供商 Key，然后启动：

```bash
docker compose up -d --build
```

默认服务：

- 前端 Nginx：<http://localhost>
- 后端容器内端口：`8000`
- SQLite 数据卷：`inkmind-data`

查看日志：

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

停止服务：

```bash
docker compose down
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 后端 | Python 3.12+ · FastAPI · Uvicorn · SQLAlchemy 2.0 · Pydantic 2 |
| 前端 | React 18 · TypeScript · Vite 6 · React Router 7 · Ant Design 6 · Axios |
| 数据库 | SQLite（默认） |
| 认证 | JWT · passlib/bcrypt |
| AI 接入 | OpenAI SDK · Anthropic SDK · OpenAI 兼容接口 |
| 可观测性 | OpenTelemetry · Prometheus 指标 |
| 桌面端 | Electron · electron-builder · PyInstaller |
| Web 部署 | Docker · Docker Compose · Nginx |

## 开发指南

前端测试与构建：

```bash
cd frontend
npm ci
npm test
npm run build
```

桌面开发（在项目根目录运行）：

```bash
./start-desktop.sh
```

构建 macOS 安装包：

```bash
cd desktop
npm install
npm run package:mac
```

| 目录 | 内容 |
| --- | --- |
| `backend/app/` | API、数据模型、AI 接入与写作业务逻辑 |
| `frontend/src/` | 页面、组件、主题与国际化 |
| `desktop/` | Electron 桌面端与打包脚本 |
| `docs/` | 桌面架构、备份与部署文档 |

视觉规范见 [DESIGN.md](DESIGN.md)，桌面构建与发布流程见[桌面版指南](docs/DESKTOP.md)。

## 常见问题

### 保存与恢复

- 普通编辑会自动保存。失败时请留在当前页并点击重试；有未保存修改时，站内导航与退出登录会先等待保存成功。
- 浏览器存储可用时，未同步正文也会保留为本地草稿；重新打开后可选择恢复，或保留服务器版本，不会静默覆盖。
- 草稿与阅读位置属于当前浏览器和账号，不是跨设备同步或可靠备份。隐私模式、清理缓存或存储空间限制都可能影响恢复，重要作品请定期导出。
- AI 流式生成内容和未确认的生成预览不会作为普通编辑自动保存；请先确认或取消预览，再继续编辑。
- 关闭浏览器不同于站内跳转：尤其在网络异常时，应等待“已保存”再关闭页面。

### 前端接口 404 或无法登录

确认后端已经启动在 `VITE_BACKEND_HOST:VITE_BACKEND_PORT`，默认是 `127.0.0.1:8000`。开发环境下前端会请求 `/api/*`，再由 Vite 代理到后端。

桌面版不会显示登录页。若桌面窗口无法进入作品库，请先完全退出 InkMind，再查看 `~/Library/Application Support/inkmind-desktop/logs/backend.log`；不要同时手动启动安装包内的后端程序。

### AI 功能提示未配置模型

桌面版请在应用内 AI 设置中添加自定义模型，并分别检查 AI 助手和正文生成的模型选择。Web 版可在 AI 设置中配置自定义模型，或检查 `backend/.env` 中的 API Key 是否与 `DEFAULT_LLM_PROVIDER` 匹配。

### CORS 报错

把当前前端地址加入后端 `CORS_ORIGINS`，例如：

```env
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174
```

## 许可证

本项目基于 [GNU General Public License v3.0](LICENSE) 开源。
