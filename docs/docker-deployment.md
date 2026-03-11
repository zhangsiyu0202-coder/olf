# Docker 部署指南

本文档用于说明如何把主站、论文搜索服务、PostgreSQL、MinIO 和编译 Worker 一起用 Docker 跑起来。

## 1. 适用场景

- 你想在单机上快速把整站拉起来
- 你希望 API、Worker、论文服务和存储都走容器
- 你不想手工开四五个终端

当前 Docker 方案包含这些服务：

- `api`：主站 API，同时托管前端构建产物
- `worker`：LaTeX 编译 Worker，容器内已预装常用 TeX 环境
- `paper-service`：多源论文搜索服务
- `postgres`：元数据数据库
- `minio`：对象存储

## 2. 启动前准备

建议先在仓库根目录准备环境变量：

```bash
cp .env.example .env
```

至少把下面几项改掉：

```bash
AI_API_KEY=你的模型Key
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL_NAME=deepseek-chat
ALLOW_DEMO_AUTH=0
```

如果你只想先验证整站能跑，不关心正式登录，也可以临时打开演示登录：

```bash
ALLOW_DEMO_AUTH=1
```

## 3. 一键启动

在仓库根目录执行：

```bash
npm run docker:up
```

首次启动会做三件事：

1. 构建 `api` 镜像
2. 构建 `worker` 镜像
3. 构建 `paper-service` 镜像

然后会自动启动：

- `http://127.0.0.1:3000` 主站
- `http://127.0.0.1:8090/health` 论文服务健康检查
- `http://127.0.0.1:9011` MinIO 控制台

## 4. 查看日志

```bash
npm run docker:logs
```

只看某个服务：

```bash
docker compose -f infra/docker-compose.app.yml logs -f api
docker compose -f infra/docker-compose.app.yml logs -f worker
docker compose -f infra/docker-compose.app.yml logs -f paper-service
```

## 5. 停止服务

```bash
npm run docker:down
```

如果你还想连卷一起删掉：

```bash
docker compose -f infra/docker-compose.app.yml down -v
```

## 6. 服务说明

### 6.1 主站 API

- 对外端口：`3000`
- 同时托管前端页面和 `/api/*`
- 会自动通过容器内地址 `http://paper-service:8090` 调论文服务

### 6.2 编译 Worker

- 不直接暴露端口
- 容器内已预装 `latexmk / pdflatex / xelatex / lualatex`
- 当前默认走 `host` 编译模式，但这里的 `host` 指 Worker 容器自身环境，不依赖宿主机额外安装 TeX

### 6.3 论文服务

- 对外端口：`8090`
- 供主站调用，也可直接访问 `/health`
- 支持 `arXiv / PubMed / OpenAlex`

### 6.4 存储

- PostgreSQL：`5432`
- MinIO S3 API：`9010`
- MinIO Console：`9011`

## 7. 本地开发模式的一键启动

如果你暂时不想进 Docker，而是继续本机联调，可以用：

```bash
npm run dev:stack
```

它会自动：

- 统一 `API_PORT / WEB_PORT / PAPER_SERVICE_PORT`
- 自动把前端代理指向当前 API 端口
- 若未配置 `PAPER_ASSISTANT_BASE_URL`，默认顺手拉起本地论文服务

## 8. 常见问题

### 8.1 前端为什么不单独开一个容器？

当前主站 API 已经支持直接托管 `apps/web/dist`，所以 Docker 方案里让 API 统一对外即可。这样结构更简单，也更接近生产入口。

### 8.2 Worker 为什么也要单独一个容器？

编译任务是持续后台任务，不适合跟 API 放在一个进程里。拆成独立容器后，后续横向扩更多 Worker 也更自然。

### 8.3 Docker 里为什么还要 MinIO？

因为当前项目已经支持 `file / s3` 两套 blob 后端。Docker 方案默认把对象存储也带上，这样更接近成品化形态，避免本地容器里先跑文件后端、线上又换一套。
