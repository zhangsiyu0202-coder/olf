# Docker 部署指南（主站 + 香港论文服务拆分）

本文档给出当前推荐的生产部署形态：

- 主站机器：`api + worker + paper-report-worker + postgres + minio`（全容器化）
- 香港机器：`paper-service + HTTPS 网关`（独立容器化）

主站通过 `PAPER_ASSISTANT_BASE_URL` 调用香港论文服务。论文服务不可用时，主站按当前策略直接报错，不回退本地 CLI。

## 1. 部署文件

新增两套编排文件：

- 主站编排：`infra/docker-compose.main.yml`
- 香港论文服务编排：`infra/docker-compose.paper-hk.yml`

仍保留历史单机编排 `infra/docker-compose.app.yml`，仅用于本地或一体化调试。

## 2. 环境文件准备

仓库根目录先复制两份示例：

```bash
cp .env.main.example .env.main
cp .env.paper-hk.example .env.paper-hk
```

你至少需要填写：

- `.env.main`
  - `PAPER_ASSISTANT_BASE_URL=https://papers.your-domain.com`
  - `PLATFORM_POSTGRES_PASSWORD`
  - `AI_API_KEY`（如果需要远端 AI 能力）
- `.env.paper-hk`
  - `PAPER_PUBLIC_DOMAIN=papers.your-domain.com`
  - `ACME_EMAIL`
  - `AI_API_KEY`

## 3. 主站机器部署

### 3.1 一键部署

```bash
npm run deploy:main
```

等价于：

1. `git pull --ff-only`
2. `docker compose --env-file .env.main -f infra/docker-compose.main.yml build`
3. `docker compose ... up -d`
4. 健康检查：`/api/health`
5. 远端论文服务 smoke check：`$PAPER_ASSISTANT_BASE_URL/health` + `/v1/search`
6. 启动定时探测脚本：`scripts/monitor-paper-service.sh start`

### 3.2 回滚

```bash
bash scripts/deploy-main.sh rollback <上一版本镜像tag>
```

脚本会执行：

```bash
docker compose ... down
docker compose ... up -d
```

并再次执行健康检查和 smoke check。

## 4. 香港论文服务部署

### 4.1 一键部署

```bash
npm run deploy:paper-hk
```

等价于：

1. `git pull --ff-only`
2. `docker compose --env-file .env.paper-hk -f infra/docker-compose.paper-hk.yml build`
3. `docker compose ... up -d`
4. 本机 HTTPS 探测：`https://$PAPER_PUBLIC_DOMAIN/health`（通过 `--resolve`）
5. 搜索 smoke check：`/v1/search`

### 4.2 回滚

```bash
bash scripts/deploy-paper-hk.sh rollback <上一版本镜像tag>
```

## 5. 网络与安全（公网 HTTPS + IP 白名单）

### 5.1 香港侧入口

- 对外仅暴露 `443`（可保留 `80` 用于证书挑战）。
- `paper-service` 的 `8090` 不对公网开放。
- 反向代理配置文件：`infra/docker/Caddyfile.paper-hk`

### 5.2 白名单策略

IP 白名单在云防火墙/安全组配置：

1. 允许 `主站出口 IP -> 香港服务器:443`
2. 拒绝其他来源访问 `443`
3. 禁止公网访问 `8090`

## 6. 运维检查

### 6.1 主站论文连通监控

```bash
bash scripts/monitor-paper-service.sh status
tail -f .runtime/paper-service-monitor.log
```

手工单次探测：

```bash
PAPER_ASSISTANT_BASE_URL=https://papers.your-domain.com \
  bash scripts/monitor-paper-service.sh once
```

### 6.2 常用日志

```bash
npm run docker:main:logs
npm run docker:paper-hk:logs
```

只看单服务：

```bash
docker compose --env-file .env.main -f infra/docker-compose.main.yml logs -f api
docker compose --env-file .env.main -f infra/docker-compose.main.yml logs -f worker
docker compose --env-file .env.paper-hk -f infra/docker-compose.paper-hk.yml logs -f paper-service
docker compose --env-file .env.paper-hk -f infra/docker-compose.paper-hk.yml logs -f paper-gateway
```

## 7. 本地验证命令

主站：

```bash
npm run docker:main:up
curl http://127.0.0.1:3000/api/health
```

香港服务（在香港机器）：

```bash
npm run docker:paper-hk:up
curl -k --resolve papers.your-domain.com:443:127.0.0.1 https://papers.your-domain.com/health
```
