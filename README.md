# Overleaf Clone

本仓库用于实现一个模仿 Overleaf 的网站应用。当前阶段已从 MVP 打通进入成品化阶段，当前重点能力为：

1. 项目管理
2. 文件树管理
3. 在线编辑
4. LaTeX 编译
5. PDF 预览
6. 自动快照
7. AI 问答助手
8. 实时协作编辑
9. 项目成员与邀请
10. 论文检索与 PDF 阅读
11. 模板探索页与全局聚合搜索

## 目录结构

```text
apps/
  api/          API 服务
  web/          Web 前端
workers/
  compiler/     LaTeX 编译 Worker
packages/
  contracts/    前后端共享接口与 DTO
  runtime-store 当前阶段存储抽象与仓储适配层
  paper-assistant 论文检索、阅读与 LangChain 能力封装
  shared/       纯工具与共享基础能力
docs/
  engineering-principles.md
  modules.md
  product-phase.md
.kiro/
  specs/
```

## 当前约束

- 优先把 MVP 扩展为可持续演进的成品骨架
- 优先实现自动快照、存储升级和 AI 问答助手
- 保持模块边界清晰，避免跨模块复制业务逻辑
- 允许从当前文件化持久层升级到 PostgreSQL + 对象存储

## 关键文档

- [工程原则](./docs/engineering-principles.md)
- [模块边界](./docs/modules.md)
- [成品化阶段路线](./docs/product-phase.md)
- [论文多源检索设计](./docs/paper-search-architecture.md)
- [论文搜索服务部署指南](./docs/paper-service-deployment.md)
- [Agent 协作规范](./AGENTS.md)
- [MVP 规格](./.kiro/specs/overleaf-mvp/requirements.md)

## 初始化状态

当前仓库已具备：

- `npm workspace` 根配置
- 模块化目录骨架
- 工程原则与协作规范文档
- 与 `.kiro` 规格对齐的 MVP 设计约束
- 可运行的项目/文件/编译/预览闭环
- 基于 `考拉论文---在线-latex-协作平台/` 模板风格重写的 React 工作台前端
- `React + TypeScript + Vite + CodeMirror 6` 编辑器技术栈
- 自动快照、快照恢复与保护性恢复快照
- 已安装并验证可用的 `pdflatex` 真实编译环境
- AI 问答助手
- AI 问答流式回复
- 聊天接口已收敛为流式主入口
- 最近一次编译错误的 AI 结构化诊断
- AI 对话历史持久化
- 解释选中代码、优化选中代码、生成修复代码快捷动作
- 单一 OpenAI 兼容 Provider 接入（当前默认 `deepseek-chat`）
- `cased-kit + semchunk + 可选 LLMLingua` 上下文增强链路
- CodeMirror 6 inline completion（ghost text / Tab 接受 / Esc 拒绝）
- `Yjs + WebSocket + CodeMirror 6` 单文件实时协作
- 远端在线状态、共享光标感知与协作文档持久化
- 正式邮箱/密码登录、Cookie 会话与退出登录
- 个人空间、组织空间、团队空间与工作空间项目创建
- 项目成员关系与邀请链接加入
- `runtime-store` 已升级为统一存储门面，支持 `file / postgres` 元数据后端切换
- `runtime-store` 已支持 `file / s3(MinIO)` blob 后端切换，并保留本地缓存
- 已提供 [`migrate-storage.js`](/home/jia/overleaf/scripts/migrate-storage.js) 迁移元数据到 PostgreSQL
- 文件化元数据写入已补齐原子落盘，项目清单与 JSON 仓储在多进程并发下不再容易读到半截内容
- 项目级编译设置：主编译文件选择、`pdflatex/xelatex/lualatex` 引擎切换
- 编译任务设置快照、结构化诊断列表与日志跳转定位
- 编译 Worker 已支持多 worker 原子任务领取
- 编译 Worker 已支持宿主机模式与 Docker 隔离模式切换
- 协作文件主键已升级为稳定 `fileId`
- 评论与批注系统：批注、回复、解决状态、跳转定位
- `latexmk` 多轮编译与内容哈希编译缓存
- 论文检索、项目文献库、`refs.bib` 导入与 PDF 阅读
- 论文模块的产品目标已定义为“多源聚合检索 + 分层全文获取”；当前已接入 `arXiv / Semantic Scholar / PubMed`
- 主站已支持通过 `PAPER_ASSISTANT_BASE_URL` 对接独立论文搜索服务，适合部署到香港节点
- 轻回流：从论文阅读区插入引用、插入总结、保存阅读笔记
- 论文 PDF 摘录：高亮选区、保存备注、项目内回看
- 独立探索页：平台精选模板、功能示例、模板详情预览与“以模板创建项目”
- 探索页模板已扩充到论文、双栏投稿、学位论文、技术报告、研究提案、书稿、演示文稿、海报、简历、信件、作业讲义、会议纪要等可编辑场景
- 论文模板已接入基于官方类包的 `IEEEtran`、`acmart`、`elsarticle`、`llncs` 可编辑模板
- 论文模板池已继续扩充到 `IEEE journal`、`ACM journal`、`Elsevier CAS`、`REVTeX 4.2`、`AASTeX 6.31`、`survey`、`supplementary`、`rebuttal`
- 官方模板镜像已新增 `CVPR / ICCV / 3DV` 官方 author kit，并在创建项目时自动拉取到本地缓存后再进入编辑器
- 官方模板镜像已继续扩到 `NeurIPS 2025`、`ICML 2025`、`ICLR 2026`、`AAAI 2025`（匿名稿 / 终稿）
- 官方模板镜像已继续扩到 `ACL / EMNLP / NAACL`、`ECCV 2026`、`AISTATS 2025`、`COLM 2026`
- 官方模板镜像已继续扩到 `KDD 2025`、`TheWebConf 2026`、`SIGIR 2025`、`CIKM 2025`
- 顶栏全局聚合搜索：项目、文件、项目文献库、外部论文、模板、命令分组展示

## 当前进度

当前已经完成的成品化模块：

1. 核心编辑闭环
2. 自动快照与恢复
3. React 工作台前端重构
4. AI 问答与编译错误诊断
5. 实时协作编辑
6. 项目成员与邀请系统
7. AI 模块产品化升级
8. AI inline completion 与上下文增强
9. 编译体验增强
10. 正式登录体系与 Cookie 会话
11. 工作空间模型：个人 / 组织 / 团队
12. 审计日志与版本事件面板
13. 对象存储适配与多 worker 编译调度
14. `fileId` 协作主键升级
15. 评论与批注系统
16. `latexmk` 多轮编译与编译缓存
17. 论文检索与 PDF 阅读模块
18. 探索页与模板建项目入口
19. 顶栏全局聚合搜索

当前建议的下一阶段模块：

1. 版本回放与差异比较
2. 评论锚点和 PDF 预览联动
3. 更细粒度权限矩阵

## 本地运行

1. 安装依赖：`npm install`
2. 启动 API 服务：`npm run dev:api`
3. 如需本地调试独立论文搜索服务：`npm run dev:paper-service`
4. 启动编译 Worker：`npm run dev:worker`
5. 若要使用 Docker 隔离编译：`npm run dev:worker:docker`
6. 前端开发模式：`npm run dev:web`
7. 打开 `http://127.0.0.1:5173`

如果你要通过 API 服务直接托管前端产物：

1. 先构建前端：`npm run build:web`
2. 再启动 API 服务：`npm run dev:api`
3. 打开 `http://127.0.0.1:3000`

说明：

- 项目与编译运行数据会写入仓库根目录的 `.runtime/`。
- 快照归档与快照索引也会写入 `.runtime/`。
- 协作文档状态与 Yjs 状态快照也会写入 `.runtime/`。
- 项目成员、邀请与本地用户档案会写入 `.runtime/`。
- 元数据后端可通过 `RUNTIME_METADATA_BACKEND=file|postgres` 切换。
- 切换到 PostgreSQL 后可运行 `node scripts/migrate-storage.js` 导入现有元数据。
- 若启用正式登录、组织团队、审计日志与版本事件，必须配置 `RUNTIME_POSTGRES_URL`。
- 若主站需要通过香港节点使用独立论文搜索服务，可配置 `PAPER_ASSISTANT_BASE_URL` 指向该服务，例如 `http://127.0.0.1:8090`。
- 当前开发机已安装本地 PostgreSQL 14；由于 `5432` 被本机 Docker 占用，系统 PostgreSQL 集群实际监听在 `5433`。
- 当前可直接使用的本地连接串是 `postgresql://overleaf:overleaf@127.0.0.1:5433/overleaf`。
- 首次启用正式认证前，需确保目标数据库已创建 `pgcrypto` 扩展；当前本地 `overleaf` 数据库已完成该初始化。
- Blob 后端可通过 `RUNTIME_BLOB_BACKEND=file|s3` 切换；启用 `s3` 时需配置 MinIO/S3 兼容参数。
- 本仓库已提供 `npm run platform:up` 启动 PostgreSQL + MinIO。
- Worker 支持 `COMPILE_EXECUTION_MODE=host|docker`；`docker` 模式下会尝试使用 `COMPILE_DOCKER_IMAGE` 进行隔离编译。
- 若仅想验证本地链路，不依赖远端 AI，可运行 `npm run test:smoke:local-ai`。
- 当前宿主机编译已优先走 `latexmk`，若不可用才回退到多次引擎执行。
- 当前阶段前端已经切换到 React 工作台，不再维护旧的原生 DOM 版本。
- 当前阶段正式登录、工作空间、对象存储适配、多 worker 编译调度、`fileId` 协作主键、评论批注和编译缓存也已完成。

### 本地 PostgreSQL 说明

- 这里说的 “PostgreSQL 集群” 不是分布式集群，而是 PostgreSQL 在一台机器上的一个独立实例目录；Ubuntu/Debian 默认用 `版本号 + 集群名` 的方式管理，例如当前这台机器是 `14/main`。
- 当前机器同时存在一个占用 `5432` 的 Docker 代理进程，因此系统 PostgreSQL `14/main` 被分配到了 `5433`，这就是为什么应用要连 `5433` 而不是 `5432`。
- 如果你直接在本机启动 API 并使用正式认证，推荐这样运行：

```bash
RUNTIME_POSTGRES_URL=postgresql://overleaf:overleaf@127.0.0.1:5433/overleaf npm run dev:api
```
