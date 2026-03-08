# Collaboration 模块

本模块用于承载实时协作编辑的服务端能力，负责：

- WebSocket 房间管理
- Yjs 文档同步
- Awareness 在线状态广播
- 协作文档状态持久化

当前实现依赖：

- `Yjs`
- `ws`
- `y-protocols`

前端编辑器仍由 `apps/web` 中的 CodeMirror 6 绑定负责，本模块只处理服务端协作同步与房间生命周期。
