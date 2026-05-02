# InkMind AI Assistant Guide

> AI 辅助小说写作工具 — 作品管理、章节编辑、人物设定、多模型 AI 生成、导出发布，一站式解决方案。

## 项目概览

**InkMind** 是一个 AI 辅助小说写作工具，帮助作家：
- 管理小说作品（大纲、类型、风格、背景设定）
- 编辑章节（增删改排序、正文编辑、字体调整）
- 管理人物（人物卡、关系）
- 利用 AI 辅助写作（生成、改写、追加、扩写、润色、评估）
- 统计和导出（Token 用量、导出 PDF）

## 技术栈

### 后端 (Python)

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.10+ | 运行环境 |
| FastAPI | 0.115.6 | Web 框架 |
| Uvicorn | 0.34.0 | ASGI 服务器 |
| SQLAlchemy | 2.0.36 | ORM |
| Pydantic | 2.10.3 | 数据验证 |
| SQLite | 默认 | 数据库 |
| JWT (python-jose) | 3.3.0 | 认证 |
| bcrypt | 3.2.2 | 密码哈希 |
| OpenAI SDK | 1.58.1 | AI 模型集成 |
| Anthropic SDK | 0.42.0 | AI 模型集成 |
| fpdf2 | 2.8.2 | PDF 导出 |
| OpenTelemetry | 1.28.2 | 可观测性 |

### 前端 (React)

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.3.1 | UI 框架 |
| TypeScript | 5.7.2 | 类型安全 |
| Vite | 6.0.6 | 构建工具 |
| React Router | 7.1.1 | 路由 |
| Ant Design | 6.3.6 | UI 组件库 |
| Axios | 1.7.9 | HTTP 客户端 |

## 设计系统 (DESIGN.md)

### 核心颜色

| 用途 | 变量 | Hex 值 |
|------|------|--------|
| **主色 (珊瑚色)** | `primary` | `#cc785c` |
| 主色激活态 | `primary-active` | `#a9583e` |
| **画布背景 (暖米色)** | `canvas` | `#faf9f5` |
| 卡片表面 | `surface-card` | `#efe9de` |
| **深色表面 (深海军蓝)** | `surface-dark` | `#181715` |
| 墨水色 (主文字) | `ink` | `#141413` |
| 柔和文字 | `muted` | `#6c6a64` |
| 边框/分割线 | `hairline` | `#e6dfd8` |

### 字体系统

| 用途 | 字体 |
|------|------|
| 标题 (衬线) | `Copernicus`, `Tiempos Headline`, `Noto Serif SC`, `Cormorant Garamond` |
| 正文/UI (无衬线) | `Inter`, `StyreneB`, `system-ui` |
| 代码 | `JetBrains Mono`, `Sarasa Mono SC` |

### 圆角系统

| Token | 值 | 用途 |
|-------|-----|------|
| `xs` | 4px | 小程序徽标 |
| `sm` | 6px | 小按钮、下拉项 |
| `md` | 8px | 标准按钮、输入框 |
| `lg` | 12px | 内容卡片 |
| `xl` | 16px | 大型组件 |
| `pill` | 9999px | 徽章、标签 |

### 主题模式

支持三种主题：
1. **light** (日间) — 暖米色画布 `#faf9f5`
2. **sepia** (护眼) — 棕黄色调 `#f5eddd`
3. **dark** (夜间) — 深海军蓝 `#181715`

## 项目结构

```
InkMind/
├── backend/                          # Python 后端
│   ├── app/
│   │   ├── agent/                    # AI Agent 实现
│   │   │   ├── base.py               # 基类
│   │   │   ├── flexible_agent.py     # Flexible Agent 模式
│   │   │   ├── react.py              # ReAct 模式
│   │   │   ├── tools.py              # Agent 工具定义
│   │   │   └── memory.py             # 记忆系统
│   │   ├── llm/                       # 多模型 LLM 集成
│   │   │   ├── base.py               # 基类接口
│   │   │   ├── openai_llm.py         # OpenAI 兼容
│   │   │   ├── anthropic_llm.py      # Anthropic Claude
│   │   │   ├── providers.py          # 提供者配置
│   │   │   ├── metered_llm.py        # 计量包装器
│   │   │   ├── token_counter.py      # Token 计数
│   │   │   ├── token_estimator.py    # Token 估算
│   │   │   └── llm_errors.py         # 错误定义
│   │   ├── routers/                   # API 路由
│   │   │   ├── auth.py               # 认证 (登录/注册)
│   │   │   ├── novels.py             # 小说管理
│   │   │   ├── chapters.py           # 章节管理
│   │   │   ├── characters.py         # 人物管理
│   │   │   ├── memos.py              # 备忘录
│   │   │   ├── usage.py              # Token 用量
│   │   │   ├── meta.py               # 元信息
│   │   │   └── background_tasks.py   # 后台任务
│   │   ├── schemas/                   # Pydantic 模型
│   │   ├── services/                  # 业务逻辑
│   │   │   ├── chapter_gen.py        # 章节生成
│   │   │   ├── chapter_eval.py       # 章节评估
│   │   │   ├── chapter_llm.py        # 章节 LLM 调用
│   │   │   ├── chapter_version.py    # 版本管理
│   │   │   ├── novel_ai.py           # 小说 AI 功能
│   │   │   ├── novel_export_pdf.py   # PDF 导出
│   │   │   └── task_manager.py       # 任务管理
│   │   ├── observability/             # OpenTelemetry
│   │   ├── middleware/                # 中间件
│   │   ├── main.py                    # FastAPI 入口
│   │   ├── config.py                  # 配置 (Pydantic Settings)
│   │   ├── database.py                # SQLAlchemy 引擎
│   │   ├── models.py                  # ORM 模型
│   │   ├── deps.py                    # 依赖注入
│   │   ├── security.py                # 安全 (密码/JWT)
│   │   ├── language.py                # 语言检测
│   │   └── prompts.py                 # AI 提示词模板
│   ├── scripts/                       # 脚本工具
│   ├── env.example                    # 环境变量模板
│   └── requirements.txt               # Python 依赖
│
├── frontend/                          # React 前端
│   ├── src/
│   │   ├── pages/                     # 页面组件
│   │   │   ├── Dashboard.tsx          # 首页/作品列表
│   │   │   ├── Login.tsx              # 登录
│   │   │   ├── Register.tsx           # 注册
│   │   │   ├── NovelLayout.tsx        # 小说布局 (壳)
│   │   │   ├── NovelWrite.tsx         # 写作页面
│   │   │   ├── NovelSettings.tsx      # 小说设定
│   │   │   ├── NovelPeople.tsx        # 人物列表
│   │   │   ├── NovelPeopleForm.tsx    # 人物表单
│   │   │   ├── NovelMemos.tsx         # 备忘录列表
│   │   │   ├── NovelMemoForm.tsx      # 备忘录表单
│   │   │   ├── AiSettings.tsx         # AI 设置
│   │   │   ├── UsageDashboard.tsx     # Token 用量统计
│   │   │   └── BackgroundTasks.tsx    # 后台任务
│   │   ├── components/                # 通用组件
│   │   │   ├── UserMenu.tsx           # 用户菜单
│   │   │   ├── AIRail.tsx             # AI 工具栏
│   │   │   ├── ChapterSidebar.tsx     # 章节侧边栏
│   │   │   ├── EditorSettings.tsx     # 编辑器设置
│   │   │   ├── SelectionToolbar.tsx   # 选中工具栏
│   │   │   ├── ExportNovelModal.tsx   # 导出模态框
│   │   │   └── NovelAiNamingAskDock.tsx # AI 命名询问
│   │   ├── context/                   # React Context
│   │   │   ├── AuthContext.tsx        # 认证
│   │   │   ├── ThemeContext.tsx       # 主题 (light/sepia/dark)
│   │   │   └── NavigationContext.tsx  # 导航
│   │   ├── styles/
│   │   │   ├── theme.ts               # Ant Design 主题配置
│   │   │   └── global.css             # 全局样式 (CSS 变量)
│   │   ├── api/
│   │   │   └── client.ts              # Axios API 客户端
│   │   ├── i18n/                      # 国际化
│   │   ├── utils/                     # 工具函数
│   │   ├── types/                     # TypeScript 类型
│   │   ├── App.tsx                    # 路由配置
│   │   └── main.tsx                   # 入口
│   ├── vite.config.ts                 # Vite 配置 (代理端口 8000)
│   ├── tsconfig.json
│   └── package.json
│
├── images/                            # README 截图
├── DESIGN.md                          # 设计系统文档
├── README.md                          # 项目说明 (中文)
├── README.en.md                       # 项目说明 (英文)
├── LICENSE                            # GPL-3.0
├── TODO.md                            # 待办事项
└── start-dev.sh                       # 开发启动脚本
```

## 路由结构

### 前端路由 (React Router)

| 路径 | 页面 | 说明 |
|------|------|------|
| `/login` | `Login` | 登录页 |
| `/register` | `Register` | 注册页 |
| `/` | `Dashboard` | 首页 - 作品列表 |
| `/usage` | `UsageDashboard` | Token 用量统计 |
| `/settings` | `AiSettings` | AI 设置 |
| `/tasks` | `BackgroundTasks` | 后台任务 |
| `/novels/:novelId/*` | `NovelLayout` | 小说布局壳 |
| `/novels/:novelId/write` | `NovelWrite` | 写作页面 |
| `/novels/:novelId/settings` | `NovelSettings` | 小说设定 |
| `/novels/:novelId/people` | `PeopleLayout` | 人物布局 |
| `/novels/:novelId/memos` | `MemosLayout` | 备忘录布局 |

### 后端 API 路由 (FastAPI)

| 路由前缀 | 模块 | 说明 |
|----------|------|------|
| `/auth` | `routers/auth.py` | 认证 |
| `/novels` | `routers/novels.py` | 小说管理 |
| `/chapters` | `routers/chapters.py` | 章节管理 |
| `/characters` | `routers/characters.py` | 人物管理 |
| `/memos` | `routers/memos.py` | 备忘录 |
| `/usage` | `routers/usage.py` | 用量统计 |
| `/meta` | `routers/meta.py` | 元信息 |
| `/background-tasks` | `routers/background_tasks.py` | 后台任务 |

## 开发指南

### 环境准备

**要求：**
- Python 3.10+
- Node.js 18+

### 启动后端

```bash
cd backend

# 创建虚拟环境
python -m venv .venv

# 激活 (macOS/Linux)
source .venv/bin/activate
# 激活 (Windows)
# .venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp env.example .env
# 编辑 .env 添加 API Keys

# 启动服务 (端口 8000)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器 (端口 5173)
npm run dev
```

### 一键启动 (使用脚本)

```bash
./start-dev.sh
```

## 核心功能说明

### AI 模型支持

支持的 LLM 提供者：
- **OpenAI** — GPT 系列
- **Anthropic** — Claude 系列
- **通义千问** (Qwen)
- **DeepSeek**
- **MiniMax**
- **Kimi**

### Agent 模式

1. **Flexible Agent** (默认) — 灵活的工具调用模式
2. **ReAct** — 推理-行动交替模式
3. **直接调用 LLM** — 简单直接调用

### Token 用量统计

- 按模型统计调用次数
- 按模型统计 Token 消耗 (输入/输出)
- 估算费用

### 版本管理

章节支持多版本：
- 自动保存历史版本
- 版本对比 (diff)
- 恢复旧版本

## 样式规范

### CSS 变量

```css
:root {
  --bg: #f5f0e8;           /* 背景 */
  --bg-deep: #e6dfd8;      /* 深色背景 */
  --bg-elevated: #faf9f5;  /* 提升背景 (卡片) */
  --accent: #cc785c;       /* 主色 */
  --accent-soft: #d88a6d;  /* 主色柔和 */
  --ink: #141413;          /* 文字 */
  --muted: #6c6a64;        /* 次要文字 */
  --radius: 12px;          /* 默认圆角 */
  --radius-md: 8px;        /* 中圆角 */
  --radius-sm: 6px;        /* 小圆角 */
  --radius-pill: 9999px;   /* 胶囊 */
}
```

### 主题类名

```css
.write-theme--light    /* 日间主题 (默认) */
.write-theme--sepia    /* 护眼主题 */
.write-theme--dark     /* 夜间主题 */
```

### CSS 变量覆盖 (主题)

```css
/* Sepia 主题变量 */
.write-theme--sepia {
  --theme-bg: #f5eddd;
  --theme-card: #faf9f5;
  --theme-ink: #4a392b;
  --theme-muted: #8b7762;
  --theme-border: #d9cbb0;
}

/* Dark 主题变量 */
.write-theme--dark {
  --theme-bg: #181715;
  --theme-card: #1e1d1b;
  --theme-ink: #e7e5e1;
  --theme-muted: #a3a19b;
  --theme-border: #2a2926;
}
```

## 依赖版本注意事项

### bcrypt 版本兼容性

**已知问题：** `passlib[bcrypt]==1.7.4` 与 `bcrypt>=4.0.0` 不兼容。

**解决方案：** 使用 `bcrypt==3.2.2`

```
# requirements.txt 中已正确配置
passlib[bcrypt]==1.7.4
bcrypt==3.2.2
```

### 迁移到 bcrypt 4.x

如需使用 bcrypt 4.x，需要：
1. 升级 passlib 到 `1.8.0+` (检查是否已发布稳定版)
2. 或使用替代方案：`from passlib.context import CryptContext` 配合 `bcrypt>=4.0.1`

## 代码约定

### 前端

- 使用 TypeScript 严格模式
- 组件命名：`PascalCase`
- CSS 类名：`kebab-case`
- 导入别名：`@/` 指向 `src/`

### 后端

- 使用类型注解 (`def func() -> ReturnType:`)
- Pydantic 模型命名：`XxxCreate`, `XxxUpdate`, `XxxResponse`
- 路由函数：使用依赖注入 (`Depends`)

## 常见问题

### 1. 后端启动时 bcrypt 错误

```
AttributeError: module 'bcrypt' has no attribute '__about__'
```

**原因：** bcrypt 版本过高 (4.x) 与 passlib 1.7.4 不兼容。

**解决：**
```bash
pip uninstall bcrypt -y
pip install bcrypt==3.2.2
```

### 2. 前端无法连接后端

检查：
- 后端是否在 `http://localhost:8000` 运行
- `frontend/vite.config.ts` 中的代理配置是否正确
- CORS 配置 (`backend/app/main.py` 中的 `cors_origins`)

### 3. 数据库迁移

后端使用 `_migrate_sqlite()` 函数在启动时自动迁移 SQLite 数据库。

如需手动添加列：
1. 修改 `app/models.py` 中的模型
2. 在 `_migrate_sqlite()` 中添加迁移逻辑

## 相关文档

- `DESIGN.md` — 完整设计系统文档
- `README.md` — 项目说明 (中文)
- `TODO.md` — 待办事项
- `backend/requirements.txt` — Python 依赖
- `frontend/package.json` — Node 依赖
