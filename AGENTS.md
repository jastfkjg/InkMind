# InkMind Agent Guide

> 给 AI / 协作者的仓库工作指南。完整产品说明看 `README.md`，完整视觉规范看 `DESIGN.md`。

## 项目定位

InkMind 是一个 AI 辅助小说写作工具，核心体验围绕作品管理、章节写作、人物/备忘录设定、AI 生成与改写、Token 用量统计和导出。

写作页面是主工作流。任何 UI 调整都应优先服务“沉浸、低干扰、长时间正文写作”，避免把页面做成营销页或装饰型面板。

## 技术栈

- 后端：Python 3.10+、FastAPI、SQLAlchemy、Pydantic、SQLite、JWT、OpenAI/Anthropic SDK。
- 前端：React 18、TypeScript、Vite、React Router、Ant Design、Axios。
- 设计系统：`DESIGN.md` 是唯一权威来源，前端主题配置在 `frontend/src/styles/`。

## 关键目录

- `backend/app/main.py`：FastAPI 入口、CORS、SQLite 自动迁移。
- `backend/app/models.py`：SQLAlchemy ORM。
- `backend/app/routers/`：API 路由，包含认证、小说、章节、人物、备忘录、用量、后台任务等。
- `backend/app/services/`：章节生成、评估、版本、导出、后台任务等业务逻辑。
- `backend/app/llm/`：多模型 LLM 接入、Token 统计、计量包装器。
- `frontend/src/pages/`：页面级组件，写作页在 `NovelWrite.tsx`。
- `frontend/src/components/`：通用组件，如 `UserMenu`、章节侧栏、AI 工具栏、编辑器设置。
- `frontend/src/context/`：认证、主题、导航上下文。
- `frontend/src/i18n/`：国际化文案。
- `frontend/src/api/client.ts`：Axios 客户端。

## 常用命令

后端：

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev
npm run build
```

一键启动：

```bash
./start-dev.sh
```

Vite 默认代理后端 `http://localhost:8000`。排查接口问题时先确认后端已启动。

## 路由速查

前端主要路由：

- `/`：作品列表
- `/login`、`/register`：认证
- `/settings`：AI 设置
- `/usage`：Token 用量
- `/tasks`：后台任务
- `/novels/:novelId/write`：写作页
- `/novels/:novelId/settings`：作品设定
- `/novels/:novelId/people`：人物
- `/novels/:novelId/memos`：备忘录

后端主要前缀：

- `/auth`、`/novels`、`/chapters`、`/characters`、`/memos`
- `/usage`、`/meta`、`/background-tasks`

## UI 与设计约束

- 遵循 `DESIGN.md`，不要随手引入新色系或新圆角体系。
- 核心色：`#cc785c`；画布：`#faf9f5`；卡片：`#efe9de`；深色表面：`#181715`；主文字：`#141413`；弱文字：`#6c6a64`；分割线：`#e6dfd8`。
- 圆角优先使用 6 / 8 / 12 / 16px；卡片不要过度圆润。
- 支持 `light`、`sepia`、`dark` 三种主题，深色模式下正文、输入框、弹层和工具栏都要检查。
- 页面已本地化时，新增可见文案必须进入 i18n，不要出现 `quota_remaining` 这类裸 key。
- 写作页应尽量减少外框、嵌套卡片和装饰噪音；正文区域要有足够宽度与舒适行高。
- 后台/设置/用量类页面应安静、紧凑、便于扫描，不做夸张 hero 或营销布局。
- 导航、返回按钮、语言切换、日夜模式、用户菜单在不同页面要保持一致。

## 前端约定

- TypeScript 严格模式；组件用 `PascalCase`；CSS 类名用 `kebab-case`。
- 优先复用现有 Context、API client、组件和 CSS 变量。
- `@/` 指向 `frontend/src`。
- 修改用户菜单、返回逻辑或布局壳时，要检查跨页面一致性。
- 修改 Token 用量 UI 时，注意已用量、剩余额度、总输入/输出 Token 的口径一致。
- 构建前端至少运行 `npm run build`；若失败，修复相关类型错误，或明确说明失败来自无关既有问题。

## 后端约定

- 函数保持类型注解；Pydantic schema 命名使用 `XxxCreate`、`XxxUpdate`、`XxxResponse`。
- 路由函数使用 FastAPI 依赖注入，如 `Depends`。
- 新增数据库字段时，同时更新 ORM、schema、业务逻辑，并在 `backend/app/main.py` 的 SQLite 自动迁移中补迁移。
- Token/额度相关逻辑要同时关注用户累计字段和 `LLMUsageEvent` 明细，避免只展示 0 或只看事件表。
- 后台任务、LLM 调用和导出逻辑要返回用户可理解的错误信息，不泄露密钥。

## 工作原则

- 改动保持聚焦，不顺手重构无关模块。
- 不要回滚用户已有改动；遇到脏工作区时只处理本任务相关文件。
- 不提交数据库文件、`node_modules`、构建产物、日志、临时截图。
- 优先用结构化 API/类型定义解决问题，不用脆弱字符串拼接。
- UI 任务完成后尽量用浏览器或截图检查真实布局，尤其是移动端、暗色模式和中文文案。

## 已知依赖注意

不要在无明确需求时升级到 bcrypt 4.x。

## 参考文档

- `DESIGN.md`：视觉系统、颜色、字体、圆角、组件语气。
- `README.md` / `README.en.md`：完整产品说明。
- `TODO.md`：待办和方向。
- `backend/requirements.txt`：后端依赖。
- `frontend/package.json`：前端脚本和依赖。
