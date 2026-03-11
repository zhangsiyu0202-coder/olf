# 主站 Docker 化 + 香港论文服务联通部署教程（完整实操版）

本文是一份从零开始可直接执行的实操手册，目标是把当前项目部署成以下形态：

- 主站机器：`api + worker + paper-report-worker + postgres + minio`（Docker）
- 香港机器：`paper-service + HTTPS 网关(caddy)`（Docker）
- 主站通过 `PAPER_ASSISTANT_BASE_URL` 访问香港论文服务
- 香港入口走公网 HTTPS，靠云防火墙/安全组做 IP 白名单

说明：

- 本文对应当前仓库里的新编排与脚本：
  - `infra/docker-compose.main.yml`
  - `infra/docker-compose.paper-hk.yml`
  - `scripts/deploy-main.sh`
  - `scripts/deploy-paper-hk.sh`
  - `scripts/monitor-paper-service.sh`
- 当前策略是“远端论文服务失败就直接报错”，不回退本地 CLI。

## 1. 部署前准备

### 1.1 资源与账号

你需要准备：

1. 一台主站服务器（运行主 API/Worker/DB/对象存储）
2. 一台香港服务器（运行 paper-service）
3. 一个可解析到香港服务器的域名子域，如 `papers.example.com`
4. 云厂商安全组/防火墙可配置权限
5. 两台机器都能拉取你的 Git 仓库

### 1.2 软件依赖

两台机器都需要安装：

- Docker
- Docker Compose（`docker compose` 子命令可用）
- Git

可选：

- Node.js / npm（用于 `npm run deploy:*`，也可直接执行 `bash scripts/*.sh`）

### 1.3 网络前提（非常关键）

1. `papers.<your-domain>` 的 A 记录先指向香港服务器公网 IP
2. 香港服务器先开放 `80/443`（证书签发阶段必须）
3. 香港服务器 `8090` 不要对公网开放
4. 主站服务器需具备固定出口 IP（用于白名单）

## 2. 目录与配置文件说明

### 2.1 主站编排

- 文件：`infra/docker-compose.main.yml`
- 服务：`postgres`、`minio`、`minio-init`、`api`、`worker`、`paper-report-worker`
- 关键点：`api` 强制要求 `PAPER_ASSISTANT_BASE_URL`

### 2.2 香港编排

- 文件：`infra/docker-compose.paper-hk.yml`
- 服务：`paper-service`、`paper-gateway(caddy)`
- 对外端口：仅 `80/443`
- 内部转发：`paper-gateway -> paper-service:8090`

### 2.3 环境文件模板

- 主站模板：`.env.main.example`
- 香港模板：`.env.paper-hk.example`

## 3. 第一步：部署香港论文服务（先做这一步）

建议先把香港服务部署好，确保 `https://papers.<your-domain>/health` 可用，再部署主站。

### 3.1 拉代码并准备环境文件

```bash
git clone <your-repo-url> /srv/overleaf
cd /srv/overleaf
cp .env.paper-hk.example .env.paper-hk
```

编辑 `.env.paper-hk`，至少填好：

```env
AI_API_KEY=<你的key>
AI_BASE_URL=<你的AI网关地址>
AI_MODEL_NAME=<你的模型名>
PAPER_SOURCE_TIMEOUT_MS=15000

PAPER_PUBLIC_DOMAIN=papers.example.com
ACME_EMAIL=ops@example.com

PAPER_HK_IMAGE_TAG=latest
```

### 3.2 启动部署

方式 A（推荐）：

```bash
npm install
npm run deploy:paper-hk
```

方式 B（不依赖 npm）：

```bash
bash scripts/deploy-paper-hk.sh deploy
```

脚本会自动做：

1. `git pull --ff-only`
2. `docker compose build paper-service`
3. `docker compose up -d`
4. HTTPS 健康检查（`/health`）
5. 搜索烟测（`/v1/search`）

如果你不希望脚本自动 `git pull`，可执行：

```bash
SKIP_GIT_PULL=1 bash scripts/deploy-paper-hk.sh deploy
```

### 3.3 在香港机器本机验证

```bash
curl -k --resolve papers.example.com:443:127.0.0.1 \
  https://papers.example.com/health
```

```bash
curl -k --resolve papers.example.com:443:127.0.0.1 \
  -X POST https://papers.example.com/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"deep learning","limit":3,"sources":["arxiv"]}'
```

成功标准：

- `/health` 返回 200
- `/v1/search` 返回 JSON，且包含 `results` 和 `sourceStatuses`

## 4. 第二步：配置香港安全组白名单

在云防火墙/安全组里配置：

1. 允许 `主站出口IP -> 香港服务器:443`
2. 拒绝其他来源访问 `443`
3. `8090` 保持不开放（仅容器内部网络访问）
4. `80` 可以保留用于证书续签（也可按云厂商建议最小放通）

校验方法：

- 主站机器 `curl https://papers.example.com/health` 成功
- 非白名单机器访问应被拒绝/超时

## 5. 第三步：部署主站 Docker 栈

### 5.1 拉代码并准备主站环境文件

```bash
git clone <your-repo-url> /srv/overleaf
cd /srv/overleaf
cp .env.main.example .env.main
```

编辑 `.env.main`，至少填好：

```env
AI_API_KEY=<你的key>
AI_BASE_URL=<你的AI网关地址>
AI_MODEL_NAME=<你的模型名>

API_PORT=3000

PLATFORM_POSTGRES_DB=overleaf
PLATFORM_POSTGRES_USER=overleaf
PLATFORM_POSTGRES_PASSWORD=<强密码>
PLATFORM_POSTGRES_PORT=5432

PLATFORM_MINIO_ROOT_USER=overleafminio
PLATFORM_MINIO_ROOT_PASSWORD=<强密码>
RUNTIME_BLOB_S3_BUCKET=overleaf-runtime

PAPER_ASSISTANT_BASE_URL=https://papers.example.com
PAPER_ASSISTANT_TIMEOUT_MS=25000

MAIN_IMAGE_TAG=latest
```

### 5.2 启动部署

方式 A（推荐）：

```bash
npm install
npm run deploy:main
```

方式 B（不依赖 npm）：

```bash
bash scripts/deploy-main.sh deploy
```

脚本会自动做：

1. `git pull --ff-only`
2. `docker compose build api worker paper-report-worker`
3. `docker compose up -d`
4. 主站健康检查（`/api/health`）
5. 远端论文服务健康检查与搜索烟测
6. 启动远端论文服务定时监控脚本

如果不想自动 `git pull`：

```bash
SKIP_GIT_PULL=1 bash scripts/deploy-main.sh deploy
```

## 6. 第四步：主站与香港链路联通验证

### 6.1 在主站机器验证基础健康

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

```bash
curl -fsS https://papers.example.com/health
```

### 6.2 在主站容器内验证（建议）

```bash
docker compose --env-file .env.main -f infra/docker-compose.main.yml exec api \
  sh -lc 'wget -qO- "$PAPER_ASSISTANT_BASE_URL/health"'
```

### 6.3 查看远端论文监控状态

```bash
bash scripts/monitor-paper-service.sh status
tail -f .runtime/paper-service-monitor.log
```

单次人工探测：

```bash
PAPER_ASSISTANT_BASE_URL=https://papers.example.com \
  bash scripts/monitor-paper-service.sh once
```

## 7. 前端如何连接主站 API

如果你本地跑前端调试（Vite）：

```bash
VITE_API_PROXY_TARGET=http://<主站IP>:3000 npm run dev:web
```

如果你直接用主站 API 托管前端静态文件，按项目现有方式执行：

```bash
npm run build:web
npm run dev:api
```

## 8. 发布与回滚（手工流程）

### 8.1 日常发布

香港机器：

```bash
bash scripts/deploy-paper-hk.sh deploy
```

主站机器：

```bash
bash scripts/deploy-main.sh deploy
```

建议顺序始终为：先香港，后主站。

### 8.2 指定镜像 tag 回滚

香港：

```bash
bash scripts/deploy-paper-hk.sh rollback <old_tag>
```

主站：

```bash
bash scripts/deploy-main.sh rollback <old_tag>
```

回滚后务必重跑健康检查和烟测。

## 9. 常见故障与排查

### 9.1 主站启动报错：缺少 `PAPER_ASSISTANT_BASE_URL`

原因：

- `.env.main` 未配置或变量名拼写错误

处理：

1. 检查 `.env.main` 里是否有 `PAPER_ASSISTANT_BASE_URL=https://papers.example.com`
2. 重新执行主站部署脚本

### 9.2 `https://papers.../health` 不通

常见原因：

- DNS 未生效
- 香港安全组未放通 443
- Caddy 证书签发失败（80 不通、域名不对）

处理：

1. `dig papers.example.com` 看是否指向香港公网 IP
2. 查看香港网关日志：
   ```bash
   docker compose --env-file .env.paper-hk -f infra/docker-compose.paper-hk.yml logs -f paper-gateway
   ```
3. 查看 paper-service 日志：
   ```bash
   docker compose --env-file .env.paper-hk -f infra/docker-compose.paper-hk.yml logs -f paper-service
   ```

### 9.3 主站可启动，但论文接口全部报错

常见原因：

- IP 白名单没放主站出口 IP
- 主站出网 IP 变更
- 香港服务虽然在线，但被白名单拒绝

处理：

1. 在主站机器直接执行：
   ```bash
   curl -v https://papers.example.com/health
   ```
2. 核对当前主站真实出口 IP
3. 更新香港安全组白名单

### 9.4 返回“接口不存在 / Not Found”

常见原因：

- `PAPER_ASSISTANT_BASE_URL` 填错路径（例如带了错误子路径）
- 网关反代配置未生效

处理：

1. `PAPER_ASSISTANT_BASE_URL` 必须是根地址，例如 `https://papers.example.com`
2. 不要写成 `https://papers.example.com/v1` 或其他路径前缀
3. 重新加载香港编排后再测 `/health`

## 10. 生产建议（当前阶段）

1. 主站与香港服务都固定镜像 tag，不要长期 `latest`
2. 香港服务和主站都保留最近两版可回滚镜像
3. 每次发布后执行一次论文搜索烟测
4. 监控日志接入你的集中日志系统（ELK/Loki 等）
5. 将白名单变更纳入变更流程，避免主站 IP 变化导致不可用

## 11. 一份最短执行清单（Checklist）

1. 香港：`cp .env.paper-hk.example .env.paper-hk` 并填值
2. 香港：`bash scripts/deploy-paper-hk.sh deploy`
3. 安全组：仅放通主站出口 IP 到香港 443
4. 主站：`cp .env.main.example .env.main` 并填 `PAPER_ASSISTANT_BASE_URL`
5. 主站：`bash scripts/deploy-main.sh deploy`
6. 主站：`curl http://127.0.0.1:3000/api/health`
7. 主站：`curl https://papers.example.com/health`
8. 主站：检查 `.runtime/paper-service-monitor.log`

到这里，“启动 + 链接 + 联通验证 + 故障定位”就全部闭环了。
