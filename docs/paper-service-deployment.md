# 论文搜索服务部署指南

本指南面向“第一次部署也能照着做”的场景，目标是把论文搜索能力独立部署到香港服务器，再让主站通过 HTTP 调用它。

## 1. 这套结构是什么

当前论文模块已经拆成两层：

- 主站
  - 继续负责项目、文件、编辑、编译、协作、引用写入
  - 通过 `PAPER_ASSISTANT_BASE_URL` 调用论文搜索服务

- 论文搜索服务
  - 适合部署在香港服务器
  - 负责多源论文搜索、详情、BibTeX、PDF 代理和研究 Agent

一句话理解：

- 主站负责“写论文”
- 香港服务负责“搜论文、读论文”

## 2. 当前支持什么

当前论文搜索服务已经支持：

- 多源搜索
  - `arXiv`
  - `Semantic Scholar`
  - `PubMed`
- 单篇论文详情
- BibTeX 生成
- PDF 代理与缓存
- 研究场景 Agent

## 3. 部署前你需要准备什么

### 3.1 香港服务器

建议最低配置：

- Ubuntu 22.04 或兼容 Linux
- 2 核 CPU
- 4 GB 内存
- 20 GB 磁盘

### 3.2 本地与服务器都要有的东西

- Node.js 20+
- Python 3.10+
- 仓库代码
- 可联网安装依赖

### 3.3 可选但推荐

- 一个域名，例如 `papers.your-domain.com`
- Nginx
- HTTPS 证书

## 4. 最简单的本地验证

先在当前仓库本地验证论文搜索服务能跑，再上香港服务器。

### 第一步：安装前端/Node 依赖

```bash
npm install
```

### 第二步：确认 Python 虚拟环境可用

如果你的虚拟环境还没准备好，最简单做法：

```bash
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install fastapi uvicorn httpx langchain langchain-community langchain-openai arxiv pymupdf semanticscholar xmltodict
```

如果仓库当前 `.venv` 已经可用，可以跳过这一步。

### 第三步：启动论文搜索服务

```bash
npm run dev:paper-service
```

默认监听：

```text
http://127.0.0.1:8090
```

### 第四步：健康检查

```bash
curl http://127.0.0.1:8090/health
```

预期返回：

```json
{"status":"ok","service":"paper-search"}
```

### 第五步：搜索测试

```bash
curl -X POST http://127.0.0.1:8090/v1/search \
  -H 'content-type: application/json' \
  --data '{"query":"multimodal reasoning","limit":4,"sources":["arxiv","semantic_scholar","pubmed"]}'
```

如果返回包含 `results` 数组和 `source/sourceLabel/sourceId` 字段，说明多源搜索已通。

## 5. 在香港服务器上部署论文搜索服务

下面这套是最直接、最容易照着做的部署步骤。

### 5.0 一次性复制执行版

如果你想从一台空白香港服务器开始，直接复制下面这整段命令即可。

需要你自己替换的只有两处：

- `你的仓库地址`
- `你的模型Key`（如果暂时不用研究 Agent，可以先留空）

```bash
ssh root@你的香港服务器IP

apt-get update
apt-get install -y git curl python3 python3-venv python3-pip

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

mkdir -p /srv
cd /srv

if [ ! -d /srv/overleaf ]; then
  git clone 你的仓库地址 /srv/overleaf
fi

cd /srv/overleaf

npm install

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install fastapi uvicorn httpx langchain langchain-community langchain-openai arxiv pymupdf semanticscholar xmltodict

cat >/etc/systemd/system/overleaf-paper.service <<'SERVICE'
[Unit]
Description=Overleaf Clone Paper Search Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/overleaf
Environment=AI_API_KEY=你的模型Key
Environment=AI_BASE_URL=https://api.deepseek.com/v1
Environment=AI_MODEL_NAME=deepseek-chat
ExecStart=/srv/overleaf/.venv/bin/uvicorn main:app --app-dir apps/paper-service --host 0.0.0.0 --port 8090
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable overleaf-paper
systemctl restart overleaf-paper
systemctl status overleaf-paper --no-pager

curl http://127.0.0.1:8090/health
```

如果最后一条 `curl` 返回：

```json
{"status":"ok","service":"paper-search"}
```

说明香港服务器上的论文服务已经可用了。

然后你在主站机器上这样启动 API：

```bash
PAPER_ASSISTANT_BASE_URL=http://你的香港服务器IP:8090 npm run dev:api
```

如果你已经给香港服务挂了域名和 HTTPS，就改成：

```bash
PAPER_ASSISTANT_BASE_URL=https://papers.your-domain.com npm run dev:api
```

### 第一步：登录香港服务器

```bash
ssh root@你的香港服务器IP
```

### 第二步：安装系统依赖

```bash
apt-get update
apt-get install -y git curl python3 python3-venv python3-pip nodejs npm
```

如果你的服务器 Node 版本太旧，建议改用 NodeSource 或 nvm 安装 Node 20+。

### 第三步：拉代码

```bash
git clone 你的仓库地址 /srv/overleaf
cd /srv/overleaf
```

### 第四步：安装 Node 依赖

```bash
npm install
```

### 第五步：创建 Python 虚拟环境并安装论文服务依赖

```bash
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install fastapi uvicorn httpx langchain langchain-community langchain-openai arxiv pymupdf semanticscholar xmltodict
```

### 第六步：启动论文搜索服务

最简单的启动方式：

```bash
.venv/bin/uvicorn main:app \
  --app-dir apps/paper-service \
  --host 0.0.0.0 \
  --port 8090
```

如果你还要让研究 Agent 正常工作，需要额外配置模型环境变量，例如：

```bash
export AI_API_KEY=你的模型Key
export AI_BASE_URL=https://api.deepseek.com/v1
export AI_MODEL_NAME=deepseek-chat
```

然后再启动：

```bash
.venv/bin/uvicorn main:app \
  --app-dir apps/paper-service \
  --host 0.0.0.0 \
  --port 8090
```

## 6. 推荐的长期运行方式：systemd

如果你不想手动一直挂着进程，推荐用 `systemd`。

### 创建服务文件

```bash
cat >/etc/systemd/system/overleaf-paper.service <<'SERVICE'
[Unit]
Description=Overleaf Clone Paper Search Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/overleaf
Environment=AI_API_KEY=你的模型Key
Environment=AI_BASE_URL=https://api.deepseek.com/v1
Environment=AI_MODEL_NAME=deepseek-chat
ExecStart=/srv/overleaf/.venv/bin/uvicorn main:app --app-dir apps/paper-service --host 0.0.0.0 --port 8090
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SERVICE
```

### 启动并设为开机自启

```bash
systemctl daemon-reload
systemctl enable overleaf-paper
systemctl start overleaf-paper
systemctl status overleaf-paper
```

## 7. 推荐的对外暴露方式：Nginx 反向代理

如果你有域名，推荐把论文服务挂成：

```text
https://papers.your-domain.com
```

### Nginx 示例配置

```nginx
server {
    listen 80;
    server_name papers.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

改完后：

```bash
nginx -t
systemctl reload nginx
```

## 8. 主站如何接入香港论文搜索服务

主站这边不需要再本地跑 Python 论文搜索逻辑，只要配置：

```bash
PAPER_ASSISTANT_BASE_URL=http://你的香港服务器IP:8090
```

如果你挂了域名和 HTTPS：

```bash
PAPER_ASSISTANT_BASE_URL=https://papers.your-domain.com
```

### 本地启动主站示例

```bash
RUNTIME_POSTGRES_URL=postgresql://overleaf:overleaf@127.0.0.1:5433/overleaf \
PAPER_ASSISTANT_BASE_URL=https://papers.your-domain.com \
npm run dev:api
```

这时主站会：

- 搜索论文时调香港论文服务
- 打开论文详情时调香港论文服务
- 导入 BibTeX 时调香港论文服务
- 打开 PDF 时先调香港论文服务，再由主站本地缓存

## 9. 论文服务接口一览

### 9.1 健康检查

```http
GET /health
```

### 9.2 多源搜索

```http
POST /v1/search
Content-Type: application/json
```

请求体：

```json
{
  "query": "multimodal reasoning",
  "limit": 6,
  "sources": ["arxiv", "semantic_scholar", "pubmed"]
}
```

### 9.3 单篇详情

```http
GET /v1/papers/{paperId}?max_chars=18000
```

示例：

```bash
curl "http://127.0.0.1:8090/v1/papers/arxiv%3A2505.04921v2?max_chars=3000"
```

### 9.4 BibTeX

```http
GET /v1/papers/{paperId}/bibtex
```

### 9.5 PDF 代理

```http
GET /v1/papers/{paperId}/pdf
```

### 9.6 研究 Agent

```http
POST /v1/agent
Content-Type: application/json
```

请求体：

```json
{
  "message": "帮我比较 multimodal reasoning 的代表论文",
  "selectedPaperIds": ["arxiv:2505.04921v2"],
  "sources": ["arxiv", "semantic_scholar", "pubmed"]
}
```

## 10. 现在前端会看到什么变化

接上香港论文服务后，论文搜索结果会：

- 带明确来源标签
- 聚合多个来源
- 区分是否可直接获取 PDF
- 导入项目文献库时保留来源信息

## 11. 常见问题

### 11.1 为什么我搜得到，但打不开 PDF？

因为“搜索发现源”和“全文获取源”不是同一层。

常见情况：

- `Semantic Scholar` 只给摘要和元数据
- `PubMed` 只有摘要，没有 PMC PDF
- 只有 `arXiv` 或开放 PDF 链接时，才更容易直接读

### 11.2 为什么主站不直接访问这些海外论文站点？

因为主站面向中国大陆用户，跨境访问稳定性差。把论文服务单独部署到香港节点，更符合实际网络条件。

### 11.3 如果香港服务挂了怎么办？

主站目前仍保留本地 CLI 回退模式。只要不配置 `PAPER_ASSISTANT_BASE_URL`，主站就会改走本地 Python 论文工具。

## 12. 最短上手版

如果你只想最快跑起来，看这 4 步就够：

1. 在香港服务器拉代码并安装依赖
2. 启动论文服务：

```bash
cd /srv/overleaf
.venv/bin/uvicorn main:app --app-dir apps/paper-service --host 0.0.0.0 --port 8090
```

3. 本地或主站配置：

```bash
PAPER_ASSISTANT_BASE_URL=http://香港服务器IP:8090
```

4. 启动主站 API

```bash
npm run dev:api
```

到这里，主站的论文搜索就会自动走香港服务器。
