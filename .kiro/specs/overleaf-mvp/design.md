# Overleaf 类网站应用 MVP - 设计文档

## 1. 设计目标

本设计文档定义第一阶段推荐架构。原则只有两个：

1. 先让主链路跑通
2. 让后续扩展不需要推翻已有实现

因此第一阶段采用“轻量前后端分层 + 独立编译 worker”的结构，而不是一开始做多个分布式子系统。

## 2. 推荐架构

```text
Browser
  |
  | HTTPS / WebSocket
  v
Web App (React + Monaco)
  |
  | REST / WS
  v
API Server (Node.js / TypeScript)
  |
  +--> PostgreSQL
  |
  +--> Redis
  |
  +--> Object Storage / Local Files
  |
  +--> Compile Worker
```

## 3. 模块拆分

### 3.1 Web App

职责：

- 登录和项目列表页面
- 文件树和编辑器界面
- 编译按钮、日志面板、PDF 预览面板
- 基础状态管理

边界：

- 不直接访问数据库
- 不直接管理编译任务生命周期
- 所有持久化操作通过 API Server

### 3.2 API Server

职责：

- 用户认证和会话校验
- 项目和文件 CRUD
- 编译任务创建、状态查询、结果查询
- 前端页面所需聚合接口

边界：

- 不直接在请求线程里执行 LaTeX 编译
- 不承担复杂 AI 推理职责

### 3.3 Compile Worker

职责：

- 从队列中消费编译任务
- 拉取项目当前快照
- 在隔离环境中执行 `pdflatex`
- 保存 PDF、日志和结构化错误结果

边界：

- 不处理用户登录
- 不管理项目元数据

### 3.4 Storage Layer

职责：

- PostgreSQL 保存用户、项目、文件元数据、编译记录
- 对象存储或本地文件系统保存项目内容和编译产物
- Redis 保存短期状态，如编译队列状态和会话缓存

边界：

- Redis 不作为永久业务真相来源
- 文件元数据以 PostgreSQL 为准

## 4. 推荐数据流

### 4.1 编辑保存流程

1. 前端编辑器产生内容变更
2. 前端进行防抖后调用保存接口
3. API Server 校验权限
4. API Server 更新文件内容和元数据
5. 返回最新版本号和更新时间

### 4.2 编译流程

1. 前端点击编译
2. API Server 创建编译任务并写入队列
3. Compile Worker 消费任务
4. Worker 读取项目文件快照
5. Worker 执行编译并解析日志
6. Worker 写回 PDF、日志、错误摘要和任务状态
7. 前端轮询或订阅状态更新

### 4.3 预览流程

1. 前端获取最新成功编译结果
2. API Server 返回 PDF 访问地址或流
3. 前端预览面板加载 PDF

## 5. 目录结构建议

```text
apps/
  web/
  api/
workers/
  compiler/
packages/
  shared/
  contracts/
infra/
  docker/
  scripts/
```

说明：

- `packages/contracts` 放接口类型、请求响应 DTO、错误码
- `packages/shared` 放纯工具和可复用逻辑
- 避免把业务逻辑散落到前后端重复实现

## 6. 关键设计决策

### 6.1 为什么不是微服务

当前项目还没有代码规模和团队规模证明需要微服务。过早拆分只会带来部署、调试、接口一致性和事务边界复杂度。

### 6.2 为什么不先做 GlusterFS

MVP 的瓶颈不在分布式文件系统，而在编辑、保存、编译、预览的核心体验是否稳定。对象存储或本地文件系统已经足够支撑第一阶段。

### 6.3 为什么 AI 模块后置

AI 是增强能力，不是产品最小闭环。若在核心编辑和编译链路未稳定前引入 AI，会显著抬高接口复杂度、成本和调试难度。

### 6.4 为什么保留独立 Compile Worker

LaTeX 编译属于高耗时、高隔离要求任务，和 API 请求链路天然不同。即便在 MVP 阶段，也应把编译从 Web 请求线程中拆出。

## 7. 与现有规格的收敛建议

- `file-storage` 中的混合存储与双副本设计下调为“元数据 + 简单文件存储”
- `latex-compiler` 中的多服务器与 Redis 主从设计下调为“单 Redis + 单队列 + 可扩展 worker”
- `ai-module` 保留接口草案，但默认不进入 P0 排期

## 8. 扩展点

以下设计在第一阶段先留接口，不落复杂实现：

- 文档协作适配层：后续可接入 Yjs
- AI 助手服务适配层：后续可接入 OpenAI 等模型
- 编译引擎扩展点：后续支持 `xelatex`、`lualatex`
- 文件存储驱动接口：后续从本地文件系统切换到对象存储
