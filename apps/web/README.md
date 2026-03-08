# Web 模块

本模块当前已切换为 `React + TypeScript + Vite + CodeMirror 6` 技术栈，负责承载成品化阶段的在线写作工作台。

当前能力包括：

- 项目列表与项目切换
- 文件树浏览和文本文件打开
- 基于 CodeMirror 6 的 LaTeX 编辑
- 编译日志与 PDF 预览
- 快照历史与恢复
- AI 问答助手

开发命令：

- `npm run dev:web`
- `npm run build:web`

运行约束：

- 开发模式通过 Vite 在 `127.0.0.1:5173` 提供前端页面，并代理 `/api` 到 `127.0.0.1:3000`
- 构建产物输出到 `apps/web/dist`，由 API 服务统一托管
- 当前视觉基线参考项目根目录的 `考拉论文---在线-latex-协作平台/`
