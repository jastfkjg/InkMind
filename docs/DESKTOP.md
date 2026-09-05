# InkMind 桌面版开发与发布指南

InkMind 桌面版是纯本地作品库：正文和业务数据不与 Web 部署同步。它复用现有 React 页面和 FastAPI 业务逻辑，通过 Electron 增加窗口、本地进程管理和安装包分发能力。

## 运行架构

```text
Electron main
├── 选择空闲的 127.0.0.1 端口
├── 生成本次启动专用的桌面会话令牌
├── 启动 PyInstaller 打包的 FastAPI
├── 等待 /health 可用
└── 创建隔离的 BrowserWindow
    └── preload 只暴露 API 地址与获取本地会话的方法

React renderer ──HTTP/SSE──> local FastAPI ──SQLAlchemy──> local SQLite
```

生产环境由同一个 FastAPI 进程提供编译后的 React 静态文件，因此浏览器路由、普通 API、NDJSON 和 SSE 流都使用同一个本地 Origin。开发环境由 Vite 提供页面，API 仍由 Electron 启动。

桌面登录端点 `/auth/desktop-session` 仅在 `DESKTOP_MODE=true` 时启用，并要求 Electron 主进程持有的每次启动令牌。Web 模式即使传入同名请求头也只会得到 404。桌面端自动创建唯一的“本地作者”，不展示注册、登录、退出或管理后台入口。

## 本地数据与网络边界

桌面版不提供内置模型，也不使用 `.env` 或启动环境中的模型凭据。请在“AI 设置 → 自定义 LLM 管理”中添加 API Key 和服务地址，再分别为 AI 助手与正文生成选择供应商和模型；AI 助手需要 Anthropic 兼容的配置。未配置或删除配置后，对应功能保持“未配置”，不会回退到内置模型。

macOS 默认数据目录是：

```text
~/Library/Application Support/inkmind-desktop/
├── data/inkmind.db       # 作品、章节、设定、人物、备忘录、版本、模型配置与用量
├── config/jwt-secret     # 本地会话签名密钥，权限为当前用户可读写
└── logs/backend.log      # 本地 API 启动和运行日志
```

数据库和密钥位于 `.app` 外，覆盖安装或升级应用不会替换它们。InkMind 没有实现桌面与 Web 的作品同步、云端备份或冲突合并。

不配置模型时，作品管理、正文编辑、版本和导出仍在本地工作。使用 OpenAI、Anthropic、通义千问、DeepSeek、MiniMax、Kimi 或 GLM 等 AI 功能时，请求会发送给用户选择的模型服务。数据库备份可能包含自定义模型 API Key，应按敏感文件保管。

## 备份和恢复

完全退出 InkMind，确认没有 `inkmind-backend` 进程后，复制整个 `data` 目录即可备份作品库。恢复时也应先退出应用，再用备份的 `data` 目录替换当前目录。保留 `config/jwt-secret` 可以让已有本地令牌继续有效；应用下次启动也会自动生成新的有效会话。

导出的 TXT、Markdown 或 PDF 适合保存可阅读副本，但不包含完整版本历史、人物、备忘录和模型设置，不能替代数据库备份。

## 开发

需要 Python 3.12、Node.js 20+ 和 npm。首次运行：

```bash
./start-desktop.sh
```

脚本会在缺少依赖时创建 `backend/.venv-desktop` 并安装后端依赖，然后并行启动 Vite 和 Electron。Electron 的 Python 查找顺序为：

1. `INKMIND_PYTHON` 指定的解释器；
2. `backend/.venv-desktop/bin/python`；
3. `backend/.venv/bin/python`；
4. `python3.12`。

单独执行构建检查：

```bash
cd desktop
npm install
npm run build:main
npm run build:ui
npm run build:backend
```

## macOS 打包

### 图标资源

图标母版为 `desktop/assets/icon-master.png`。在 `desktop` 中运行 `npm run build:icons`，生成带透明留白的 1024px `icon.png`，并使用 macOS `iconutil` 生成包含 16–1024px 各档尺寸的 `build/icon.icns`。打包脚本会自动执行这一步，electron-builder 使用该 ICNS。不要把网页 favicon 直接复制为桌面图标，以免重新引入不透明方底或不合适的 Dock 留白。

图标设计与来源见 [assets/README.md](../desktop/assets/README.md)。更换图标后需重新构建并退出、重启应用；已有安装应使用新包覆盖安装。

### 构建安装包

```bash
cd desktop
npm run package:mac
```

此命令依次完成 Electron TypeScript、共享 React UI、PyInstaller 后端以及 electron-builder DMG/ZIP 构建。输出位于：

```text
desktop/release/
├── InkMind-<version>-<arch>.dmg
├── InkMind-<version>-<arch>.zip
└── mac-<arch>/InkMind.app
```

Claude Agent SDK 包含随平台分发的执行资源，加上 Electron 和 Python 运行时后，安装包会明显大于 Web 静态资源。PyInstaller 不是跨平台编译器：Apple Silicon 构建产生 arm64 后端；Intel macOS、Windows 和 Linux 应分别在对应架构与系统构建。

## GitHub Actions 自动发布

流程定义：`.github/workflows/release-macos.yml`，参考 ContextCue 的标签发布方式。普通分支提交不会发布桌面版本，也不会改变现有 `main` 分支的 Web 部署流程。

1. 首次发布可使用当前 `desktop/package.json` 的 `0.1.0`；后续先运行 `npm version patch --prefix desktop --no-git-tag-version`（或指定版本），提交 `desktop/package.json` 和锁文件及本次发布代码。
2. 将提交推到远程，再推送与桌面版本严格一致的标签：

   ```bash
   git push origin HEAD
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. 在仓库 Actions 的 **Release macOS** 查看进度。流程分别使用 `macos-15`（arm64）和 `macos-15-intel`（x64），每台机器安装 Node 22 / Python 3.12 并原生构建后端。标签与桌面版本不符会在构建前失败。
4. 前后端测试、应用签名校验、打包后本地 API 启动检查和 DMG/ZIP 完整性校验全部通过后，才创建草稿、上传两种架构的全部文件，再公开 Release 并标记 Latest。

产物包括 `InkMind-<version>-arm64/x64.dmg`、对应 ZIP、固定名称 `InkMind-mac-arm64.dmg` / `InkMind-mac-x64.dmg`，以及 `SHA256SUMS`。README 的固定下载链接始终指向最新 Release；首次发布前链接尚不可用。当前应用不使用自动更新元数据，也不提供应用内自动安装更新。

失败时可在 Actions 重新运行；发布阶段会续传已有草稿，但拒绝覆盖已公开的同名版本。版本已经公开时，应增加版本号并使用新标签。`workflow_dispatch` 支持手动输入已有标签重试；该入口需要工作流先存在于默认分支，首次在功能分支发布可直接推送标签。

### 签名模式

默认不需要 Apple Secrets，会生成 ad-hoc 签名、未经过 Apple 公证的早期体验包。Release 会明确说明该状态，macOS 可能阻止安装；这不等同于正式可信分发。

正式发布时，在仓库 Settings → Secrets and variables → Actions 设置变量 `MACOS_SIGNING_ENABLED=true`，并添加以下 Secrets：

| Secret | 用途 |
| --- | --- |
| `CSC_LINK` | Developer ID Application 证书的 Base64 编码 `.p12` |
| `CSC_KEY_PASSWORD` | 证书导出密码 |
| `APPLE_ID` | Apple 开发者账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 专用密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

开启后流程会强制签名、公证并验证票据，缺少凭据或公证失败会阻止发布，不会降级为早期体验包。不要向此流程传入作品数据库、`.env` 或模型 API Key；它只使用本次运行的 `GITHUB_TOKEN` 上传 Release，以及上述可选签名凭据。

本地验证发布逻辑：

```bash
node --test desktop/tests/*.test.mjs
python3 desktop/scripts/smoke-backend.py \
  desktop/release/mac-arm64/InkMind.app/Contents/Resources/backend/inkmind-backend \
  desktop/release/mac-arm64/InkMind.app/Contents/Resources/frontend
```

Runner 与签名配置依据：[GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[electron-builder v26 macOS 签名说明](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)。

## 发布检查

面向其他用户发布前至少完成以下检查：

1. 使用 Developer ID Application 证书签名，而不是仅供开发的 Apple Development 证书；
2. 为 DMG/ZIP 对应的应用执行 Apple notarization，并 stapling 公证票据；
3. 在一台没有项目源码、Python 和 Node.js 的干净 Mac 上安装；
4. 验证首次启动、创建作品、正文自动保存、重启恢复、AI 流式响应和导出；
5. 验证退出应用后没有遗留 `inkmind-backend` 进程；
6. 验证覆盖安装后 `data/inkmind.db` 保持不变。

当前版本没有桌面自动更新。升级包应当先走完整安装与数据保留验证。

## 故障排查

### 窗口提示本地 API 无法启动

查看 `~/Library/Application Support/inkmind-desktop/logs/backend.log`。常见原因包括安装资源不完整、后端可执行文件失去执行权限，或安全软件阻止子进程。

开发模式还应确认 `backend/.venv-desktop/bin/python` 可执行，并能导入 `fastapi`、`uvicorn` 和 `claude_agent_sdk`。

### 页面一直停在加载状态或出现登录页

完全退出再启动 InkMind。桌面前端必须通过 preload 获得实际 API 地址，并由 Electron 主进程换取本地 JWT。直接在普通浏览器打开 Vite 地址不会获得桌面会话，出现登录页属于预期行为。

### macOS 阻止打开安装包

本地开发证书签名不等同于公开分发签名。使用 Developer ID Application 签名并完成 Apple notarization；不要依赖用户绕过 Gatekeeper 作为发布流程。

### AI 不可用但本地编辑正常

这通常说明尚未在“AI 设置”中配置有效模型，或模型服务网络不可达。本地作品保存不依赖模型服务，可以继续写作和导出。
