# 论文服务部署指南（香港独立节点）

本指南是当前生产推荐版本：论文服务独立部署到香港服务器，并通过公网 HTTPS 提供服务，主站通过 `PAPER_ASSISTANT_BASE_URL` 调用。

## 1. 目标架构

- 主站（内地或主业务节点）
  - 负责项目、编辑、编译、协作、用户会话
  - 通过 HTTP 调用论文服务
- 香港论文服务节点
  - `paper-service` 容器处理搜索/详情/BibTeX/PDF 代理/论文 Agent
  - `paper-gateway`（Caddy）对外提供 `443`

约束：

- 采用公网 HTTPS + IP 白名单。
- 不新增应用层 token/mTLS。
- 香港服务不可用时，主站论文功能直接报错，不回退本地 CLI。

## 2. 前置准备

### 2.1 香港服务器

- Ubuntu 22.04+
- Docker + Docker Compose
- 固定公网 IP
- 允许 80/443 入站（之后 443 做白名单）

### 2.2 域名与证书

- 准备域名：`papers.your-domain.com`
- A 记录指向香港服务器公网 IP
- Caddy 自动申请证书，需要：
  - `PAPER_PUBLIC_DOMAIN`
  - `ACME_EMAIL`

## 3. 香港节点部署步骤

### 3.1 拉代码并准备环境

```bash
git clone <your-repo> /srv/overleaf
cd /srv/overleaf
cp .env.paper-hk.example .env.paper-hk
```

编辑 `.env.paper-hk`，至少填写：

```bash
AI_API_KEY=...
AI_BASE_URL=...
AI_MODEL_NAME=...
PAPER_PUBLIC_DOMAIN=papers.your-domain.com
ACME_EMAIL=ops@your-domain.com
PAPER_HK_IMAGE_TAG=latest
```

### 3.2 执行部署

```bash
npm install
npm run deploy:paper-hk
```

脚本会自动做：

1. `git pull --ff-only`
2. `docker compose -f infra/docker-compose.paper-hk.yml build`
3. `docker compose ... up -d`
4. `https://papers.your-domain.com/health` 探测
5. `/v1/search` smoke check

## 4. 主站侧接入

主站 `.env.main` 必须配置：

```bash
PAPER_ASSISTANT_BASE_URL=https://papers.your-domain.com
PAPER_ASSISTANT_TIMEOUT_MS=25000
```

然后在主站机器执行：

```bash
npm run deploy:main
```

## 5. IP 白名单策略

在云防火墙/安全组中配置：

1. 仅允许主站出口 IP 访问香港节点 `443`。
2. `8090` 不允许公网访问。
3. 若需要证书自动续期，`80` 仅用于 ACME challenge（可按网关策略限制）。

## 6. 健康检查与烟测

### 6.1 香港服务

```bash
curl -k --resolve papers.your-domain.com:443:127.0.0.1 \
  https://papers.your-domain.com/health
```

```bash
curl -k --resolve papers.your-domain.com:443:127.0.0.1 \
  -X POST https://papers.your-domain.com/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"deep learning","limit":3,"sources":["arxiv"]}'
```

### 6.2 主站到香港连通

在主站机器执行：

```bash
curl -fsS "$PAPER_ASSISTANT_BASE_URL/health"
```

## 7. 回滚

香港节点回滚：

```bash
bash scripts/deploy-paper-hk.sh rollback <old_tag>
```

主站回滚：

```bash
bash scripts/deploy-main.sh rollback <old_tag>
```

两者都遵循固定动作：

```bash
docker compose ... down
docker compose ... up -d
```

## 8. 常见问题

### 8.1 为什么主站不再内置 paper-service 容器？

为了把跨境检索链路稳定收敛到香港节点，避免主站机和论文机混部导致的网络波动与策略不一致。

### 8.2 为什么不用应用层 token？

当前安全决策是“公网 HTTPS + IP 白名单”，先减少系统复杂度。后续若要提升安全等级，可升级 mTLS。

### 8.3 香港服务挂了会怎样？

主站论文接口会直接返回错误（按当前产品决策），不会静默降级或回退本地 CLI。
