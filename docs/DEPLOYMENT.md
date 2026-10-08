# InkMind 云端部署

正式域名：`https://inkmind.jastcraft.com`。目标主机：jastcraft-infra 中的
`aliyun-beijing-01`，业务 GitHub Environment：`aliyun-prod`。

推送 main 只测试、构建并验证镜像。正式发布只能手动选择成功 CI 的 build_run_id；
后端与前端以同一 SHA 的固定 digest 发布，服务器不拉取 main、不覆盖 app.env。
原 Deploy workflow 已在 GitHub 禁用；新流程合入 main、配置完成后才手动重新启用。
启用入口为 Actions → Deploy tested images → Enable workflow；禁用状态下无法手动发布。
macOS Release 工作流独立，不受此流程影响。

## GitHub 配置

优先复用已经配置的仓库 Secrets，无需复制或改名：

| 配置 | 现有 Secret | 可选兼容配置 |
| --- | --- | --- |
| ACR 地址 / 命名空间 | `ACR_REGISTRY` / `ACR_NAMESPACE` | 同名 Variables，仅在 Secret 缺失时使用 |
| ACR 登录 | `ACR_USERNAME` / `ACR_PASSWORD` | 保持现有配置 |
| 部署主机 | `ALIYUN_HOST` | `SSH_HOST` 优先，用于 Environment 覆盖 |
| 部署账号 | `ALIYUN_USER` | `SSH_USER` 优先 |
| SSH 私钥 | `ALIYUN_SSH_KEY` | `SSH_KEY` 优先 |
| SSH 主机密钥 | 新增 `ALIYUN_KNOWN_HOSTS` | 也可使用优先级更高的 `SSH_KNOWN_HOSTS` |
| SSH 端口 | 默认22 | 可选 `SSH_PORT` Secret |

镜像仓库沿用 `<ACR_REGISTRY>/<ACR_NAMESPACE>/inkmind-backend` 和 `inkmind-frontend`。
不使用另一组 `DOCKER_*` 替代 ACR，以免把镜像切换到不同仓库。
由于 registry/namespace 是 Secrets，镜像引用仅在部署 job 内解析和使用，
避免 GitHub 过滤包含 Secret 值的跨 job outputs；跨 job 只传已验证的源代码 SHA。

最少只需补充一个已核验的 `ALIYUN_KNOWN_HOSTS` Secret。22端口使用普通 known_hosts
格式；非22端口使用 `[host]:port`。主机密钥须通过云控制台/可信管理连接核验，
不关闭 StrictHostKeyChecking，也不把未核验的 ssh-keyscan 结果直接作为信任依据。

Environment 名称仍为 `aliyun-prod`，可以在 Settings 中提前建立并设置审批和 main 分支限制；
不必重复录入上述仓库 Secrets。可选 Variable `DEPLOY_TARGET` 默认 `aliyun-prod`。
如果已有 Environment 下的 `SSH_*` 覆盖项，请确保它们指向同一目标主机与账号。
**核实现有 ALIYUN_HOST 是北京 ECS**：若仍指向旧 InkMind 主机，需更新它或使用
Environment 的 SSH_HOST/USER/KEY 覆盖；服务器会同时校验业务及网关目标标记。

服务器部署账号事先登录 ACR，使用仅拉取镜像的凭据；发布脚本不会重写 Docker 登录信息。
现有 `SECRET_KEY`、`QWEN_API_KEY`、`DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY` 等保留；
迁移时从旧服务器 `.env` 复用这些值到 `/opt/inkmind/app.env`，无需生成新 Key 或改名。
运行时配置以服务器 app.env 为准，工作流不会每次覆盖它。
GitHub 的 `CORS_ORIGINS` 不再自动写入服务器；app.env 中明确使用新的 HTTPS 域名，
不要沿用旧 HTTP/IP 来源。GitHub 不支持读回 Secret 明文，若旧服务器配置不可用，
需要从原凭据保管处恢复；不要尝试在 Actions 日志中输出密钥。

## 主机目录与配置

已有服务器不要重新初始化、覆盖配置或删除卷。由管理员仅创建缺失目录：

- `/opt/inkmind`、`releases`、`backups`：部署账号所有，700。
- `/opt/inkmind/data`：容器 UID/GID 1000 所有，700。已有数据需确认 UID 与权限再调整。
- `/opt/inkmind/deployment-target`：部署账号所有，内容 `aliyun-prod`。
- `/opt/inkmind/app.env`：部署账号所有，600。以 `deploy/cloud/app.env.example` 为参考，
  保留真实 SECRET_KEY 和提供商配置。SITE_DOMAIN 与 CORS 必须使用上述 HTTPS 域名。

Compose 将数据库固定为 `/app/data/inkmind.db`，HOME 为 `/app/data/home`。
数据目录对部署账号不可写也正常；发布使用 UID1000 容器备份、恢复和控制维护标记。
新安装可由 UID1000 使用 `sqlite3.connect` 创建空数据库文件；现有部署必须迁移真实库，
绝不可通过创建空文件掩盖缺失数据。Docker Compose 需要 2.24+，主机 Python 需要3.6+；完整依赖见 preflight.sh。

Alibaba Cloud Linux 3.2104 的系统 Python 3.6 可直接运行主机发布脚本，无需替换系统 Python；
应用在容器内使用 Python 3.12。主机必须是 x86_64/amd64，使用 Docker Engine 与 Compose V2
插件（`docker compose`，不是旧版 `docker-compose`）。已有主机不要执行旧的
`deploy/setup-server.sh`：它针对旧的独立部署，会覆盖 Docker daemon 配置并重启 Docker，
也不会准备本流程需要的共享网关、目标标记和数据目录。Docker 安装方式参考
[阿里云官方文档](https://help.aliyun.com/zh/ecs/user-guide/install-and-use-docker)。

## 首次迁移旧 Docker 部署

1. 确认真正运行的容器、Compose project、数据卷和数据库位置。原卷实际名称可能为
   `inkmind_inkmind-data`，不要仅依据 YAML 名称判断；数据库也可能在容器可写层。
2. 安排维护时间，暂停访问并等待所有生成、改写、后台任务结束；旧版没有可靠 drain
   指标，首次不能自动接管。备份整个原数据目录、原部署文件和配置，记录旧镜像 digest。
3. 停止旧前后端容器，但保留原容器、卷、配置与数据库归档作为首次人工回退依据。
   发布脚本会拒绝接管同一 project 内未由 current 记录的容器；确认停机和备份后，
   移除旧容器（禁止 `down -v`），再执行新流程。
4. 使用 SQLite backup API 从原库生成一致快照（包含已提交 WAL 数据），导入
   `/opt/inkmind/data/inkmind.db`；核对完整性、作品与章节数、权限。保留 SECRET_KEY。
5. 配置 DNS A 记录指向北京 ECS，确认实际 IPv6 路由后才添加 AAAA。
   在 `/opt/gateway/gateway.env` 加 `INKMIND_DOMAIN=inkmind.jastcraft.com`。
6. 从新版 jastcraft-infra 手动发布北京网关，保留现有服务与证书卷。
   网关创建 `inkmind_proxy` 并代理 `inkmind-upstream:80`，提供 TLS 和实时 SSE 转发。
   首次应用启动前 InkMind 路由返回 502 属预期。
7. 在 GitHub 手动发布成功 CI 的 build_run_id，检查首页、登录、现有作品、保存与 AI SSE。
   首次失败会恢复预部署数据库并移除失败容器，原部署恢复仍需用保留的旧文件人工操作。

## 后续发布与故障恢复

手动发布 `Deploy tested images`，target 选 aliyun-prod，输入成功的 main 分支
`Container CI and build` 运行 ID。工作流校验构建来源、结果、SHA 和镜像仓库，
使用该 SHA 的部署脚本上传到独立 releases 目录。

脚本验证配置、拉镜像、检查 Nginx 后才进入维护：创建数据目录标记，API 返回503，
等待已接纳请求（包含完整 SSE 生命周期）和内存任务完成，最长5分钟。
随后停止应用、检查数据库不存在 pending/running 后台任务、生成权限600的一致快照，
启动新镜像，通过本机 HTTPS 网关检查 `/health`、`/api/health` 和 `/frontend-health`
的 service/revision/mode，再切换 current/previous，退出维护。两层 health 均检查版本；
后端也检查数据库连接。此过程有短暂停机，不能按无状态静态站的方式做零停机切换。

若尚有任务，发布中止并解除维护，继续原版本。切换失败则先确认候选容器已停止，
恢复数据库快照，再启动旧版本并验证后解除维护。恢复失败保留维护标记，禁止继续发布。
不要删除标记绕过错误；先停止所有应用写入，检查日志、备份、current 和镜像记录。
版本验证并提交 current 后才解除维护；若解除维护命令结果不明，保留已验证版本，
禁止自动恢复数据库覆盖可能的新写入，需检查实际标记和 API 状态。
对于已完成发布后的手动回退，先重新进入维护并备份当前数据库；仅在 schema 向后兼容时
发布旧 CI 镜像。需要回退 schema 时必须显式选择快照，并确认会丢弃快照之后的写入。

数据库迁移错误会阻止启动；迁移前快照记录在 `/opt/inkmind/backups/<release>.sqlite`。
后端使用一个 Uvicorn worker，线程与 asyncio 队列仍可并发执行任务；多进程/多副本部署
须先实现共享队列与任务恢复。维护中浏览器静态页面仍可打开，但 API 明确返回503。

## 日常备份

jastcraft-infra 提供 `BACKUP_SERVICE=inkmind` 与独立 systemd 模板。
管理员更新 operations 脚本，复制 `host/backup-inkmind.env.example` 到
`/etc/jastcraft/backup-inkmind.env`（root所有，600），填写真实私有 OSS 桶及 inkmind 前缀，
核实上传权限；原 ShadowTable 备份不受影响。

```bash
sudo bash host/install-operations.sh
sudo systemctl start jastcraft-backup@inkmind.service
sudo journalctl -u jastcraft-backup@inkmind.service --no-pager -n 50
sudo systemctl enable --now jastcraft-backup@inkmind.timer
```

在线备份使用 SQLite backup API、quick_check 和发布锁，上传成功后保留14天本地在线备份。
部署快照独立保留，不被在线备份清理。必须做恢复演练；云桶保留期和权限由 infra 管理。

## 本地与 CI 验证

```bash
python3 -m unittest discover -s tests -v
(cd backend && .venv-desktop/bin/python -m pip install -r requirements-dev.txt)
(cd backend && DATABASE_URL=sqlite:// .venv-desktop/bin/python -m pytest tests -q)
npm --prefix frontend test
npm --prefix frontend run build
for script in deploy/cloud/*.sh; do bash -n "$script"; done
```

CI 在独立临时 Compose project 中对真实镜像检查数据库启动、前后端版本、API 和 SPA
路由；使用临时卷，清理时不触碰生产数据。Docker 构建明确设置 VITE_API_URL=/api，浏览器通过同源 HTTPS 访问 API。
容器健康探针使用 `127.0.0.1`，避免 Alpine 的 `wget` 将 localhost 解析到 Nginx 未监听的 IPv6。
首次发布的 Nginx 配置检查在隔离容器中用临时 hosts 映射完成，不依赖已有 backend 容器。
冒烟测试及部署失败时，在清理或回滚前输出容器日志和健康探针结果；不输出容器环境变量。
CI 另用 Python 3.6 检查主机脚本兼容性，后端使用 pytest 同时执行 unittest 与计费测试。
同一 CI run 重跑会覆盖其镜像元数据 artifact，避免同名上传冲突；部署仍须选择最终成功的 run。
北京目标只构建 linux/amd64，新增架构须扩展
CI 并对每个发布架构执行相同检查。根目录 docker-compose.yml 继续用于本地独立运行。
