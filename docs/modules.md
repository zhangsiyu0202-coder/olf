# 模块边界说明

## 1. `apps/web`

职责：

- 承载页面、文件树、编辑器、编译日志和 PDF 预览
- 承载 AI 助手、快照历史与恢复入口
- 承载论文检索、论文阅读和项目文献库入口
- 承载探索页、模板预览与顶栏全局聚合搜索
- 负责用户操作流和前端状态管理

当前技术栈：

- `React + TypeScript + Vite`
- `CodeMirror 6` 作为编辑器内核

不负责：

- 直接操作数据库
- 执行 LaTeX 编译
- 持有业务真相来源

## 2. `apps/api`

职责：

- 提供项目、文件、编译任务相关 API
- 提供论文检索、论文阅读和引用导入 API
- 作为主站对接独立论文搜索服务的业务编排层
- 提供模板目录、模板建项目和全局聚合搜索 API
- 负责鉴权、权限检查和业务编排
- 对前端暴露统一接口

不负责：

- 直接在请求线程里执行编译
- 处理复杂前端状态

## 3. `workers/compiler`

职责：

- 消费编译任务
- 准备编译快照
- 执行 `pdflatex`
- 写回日志、错误和 PDF 结果

不负责：

- 项目管理
- 用户会话管理

## 3.1 `apps/paper-service`

职责：

- 提供可独立部署的论文搜索 HTTP 服务
- 暴露多源论文搜索、详情、BibTeX、PDF 代理和研究 Agent 接口
- 适合部署在香港等跨境访问更稳定的节点

不负责：

- 项目权限
- 项目文件写入
- 工作空间、成员、邀请等主站业务

## 4. `packages/contracts`

职责：

- 定义前后端共享 DTO
- 定义错误码和接口契约
- 作为单一真相来源，避免多处复制

## 5. `packages/runtime-store`

职责：

- 承载当前阶段的存储抽象与仓储适配
- 统一管理项目元数据、项目目录和编译任务状态
- 逐步吸纳快照元数据、版本索引和后续存储驱动适配
- 为 `apps/api` 与 `workers/compiler` 提供稳定仓储接口
- 提供统一元数据门面和本地对象存储适配器
- 统一维护项目文献库、论文摘录和平台模板目录

约束：

- 只处理持久化与数据装配，不承载 HTTP 或 UI 逻辑
- 升级为 PostgreSQL / Redis / 对象存储时，应优先收敛在本模块

## 6. `packages/shared`

职责：

- 存放无副作用的共享工具
- 存放通用辅助逻辑

约束：

- 不得在此放与具体业务强绑定的流程代码

## 7. `packages/ai-assistant`

职责：

- 承载 AI 问答助手的上下文拼装
- 承载单 Provider 调用和本地兜底策略
- 为 API 提供稳定的 AI 回复接口

约束：

- 不直接操作 HTTP 响应
- 不直接依赖前端状态管理
- 不直接读写项目存储，项目上下文由调用方显式传入

## 8. `packages/paper-assistant`

职责：

- 承载论文源适配、搜索聚合、全文加载、BibTeX 生成和研究场景 Agent 能力
- 通过 Python adapter + 官方 API / 原生包统一封装不同论文源，而不是把具体源规则散落到 API 或前端
- 当前已落地 `arXiv / PubMed / OpenAlex` 三源搜索，并在同一边界内统一处理 discovery 解析、详情、BibTeX 与 PDF 获取
- 为 API 提供稳定的论文能力封装，而不是直接暴露给前端
- 为独立论文搜索服务提供可复用的核心能力和 FastAPI 应用

约束：

- 不直接处理项目权限和用户会话
- 不直接写项目文件，引用导入仍由 API 和 `runtime-store` 负责
- 只服务“检索论文 + 阅读论文”场景，不侵入写作区 AI 主链路
- 搜索发现层与全文获取层必须分离建模，不能把“能搜到”误写成“默认能拿全文”

## 9. 依赖方向

推荐依赖方向如下：

```text
apps/web -> packages/contracts, packages/shared
apps/api -> packages/contracts, packages/runtime-store, packages/paper-assistant, packages/shared
apps/paper-service -> packages/paper-assistant
workers/compiler -> packages/contracts, packages/runtime-store, packages/shared
packages/runtime-store -> packages/contracts, packages/shared
packages/ai-assistant -> packages/contracts
packages/paper-assistant -> packages/shared
```

禁止反向依赖：

- `packages/*` 不得依赖 `apps/*`
- `packages/*` 不得依赖 `workers/*`
