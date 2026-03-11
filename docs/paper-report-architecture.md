# 论文报告生成架构（Assistant + Notes）

本文件描述论文阅读器“左侧 PDF + 右侧 Assistant/Notes”下的报告生成与缓存机制。

## 1. 核心目标

论文阅读场景不再把“阅读体验”绑定在 PDF 文本抽取质量上，而是升级为：

1. 报告优先：先给结构化报告与证据锚点
2. PDF 备查：用户随时回到 PDF 原文核验
3. Notes 沉淀：把问答结论与个人理解沉淀为项目私有笔记

## 2. 服务边界

### 2.1 paper-service（执行层）

- 新增 `POST /v1/reports/generate`
- 输入：`paperId/maxChars/language`
- 输出：`paper + report`
- 职责：单次执行报告生成，不管理任务队列和缓存状态

### 2.2 主站 API（编排层）

- `POST /api/projects/:id/papers/:paperId/report/ensure`
- `GET /api/projects/:id/papers/:paperId/report`
- `POST /api/projects/:id/papers/:paperId/report/regenerate`
- `GET/POST/PATCH/DELETE /api/projects/:id/papers/:paperId/notes...`

职责：

- 报告状态机编排（queued/running/ready/degraded/failed）
- 论文报告缓存命中与 TTL 判定
- Notes 的项目级读写与鉴权

### 2.3 runtime-store（持久层）

- `paper-reports`：全局论文维度缓存（键为 `canonicalPaperId`）
- `paper-report-jobs`：报告异步任务记录
- `paper-report-job-locks`：单飞锁
- `paper-notes`：项目维度私有笔记

### 2.4 paper-report worker（异步执行层）

- 轮询 pending 任务
- 调用 `generatePaperReport`
- 回写 `paper-reports`
- 更新任务终态 `ready/degraded/failed`

## 3. DSPy 约束链路

报告执行流程：

1. 从论文内容构建 evidence chunks（稳定 `chunkId`）
2. 使用 DSPy `Signature + JSONAdapter` 生成结构化 JSON
3. 进行最多 3 轮 refine（失败规则反馈）
4. 约束评分输出：
   - 必须包含 5 个章节
   - 每个章节要有可映射锚点
   - 锚点必须命中 evidence chunk
5. 分数不足时返回 `degraded`，仍输出可读报告和 `failedRules`

## 4. 前端交互语义

- 主阅读区：PDF
- 右栏：`Assistant`、`My Notes` 两标签
- Assistant：
  - `Highlight & Ask`
  - `Add Context`
  - 结构化报告展示
  - 底部常驻输入框
- Notes：
  - 创建、编辑、删除
  - 从笔记一键“加入上下文”

## 5. 默认配置

- `PAPER_REPORT_ENABLED=1`
- `PAPER_REPORT_TTL_HOURS=168`
- `PAPER_REPORT_MAX_REFINES=3`
- `PAPER_REPORT_CONSTRAINT_MIN_SCORE=0.72`
- `PAPER_REPORT_WORKER_POLL_INTERVAL_MS=1800`

配置非法时自动回退默认值，不影响已有论文搜索、PDF 阅读和摘录主链路。
