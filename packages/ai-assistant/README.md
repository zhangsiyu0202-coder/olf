# AI Assistant 模块

本模块用于承载成品化阶段的 AI 问答助手能力，负责：

- 收敛 AI 请求上下文
- 通过 `cased-kit`、`semchunk` 和可选 `LLMLingua` 增强上下文
- 调用单一 OpenAI 兼容 Provider
- 在无 API Key 或外部服务失败时提供本地兜底响应
- 提供流式对话输出
- 提供最近编译错误的结构化诊断结果
- 提供 inline completion 生成能力

当前配置说明：

- 默认从仓库根目录 `.env` 读取 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL_NAME`
- `AI_API_STYLE` 默认值为 `auto`
- `AI_REQUEST_TIMEOUT_MS` 默认值为 `15000`
- `AI_ENABLE_CONTEXT_OPTIMIZERS` 默认开启，会优先尝试 Python 可选增强器
- `AI_ENABLE_LLMLINGUA` 默认关闭；只有显式设为 `1` 时才启用重型 prompt 压缩模型
- 当 Provider 是 DeepSeek 这类 OpenAI 兼容接口时，本模块会优先兼容 `/chat/completions`，必要时回退到 `/responses`

当前聊天链路策略：

- 产品主聊天入口默认走流式输出
- 结构化错误诊断仍保留非流式请求，避免 JSON 流式解析复杂化
- inline completion 保持短请求非流式，优先压低延迟和实现复杂度

当前实现说明：

- `cased-kit` 已接入项目文件树摘要提取
- `semchunk` 已接入长文档语义分块
- `LLMLingua` 已接入为可选压缩器，默认不强制启用
- inline completion 已通过 `CodeMirror 6 + ghost text` 接入前端工作台

后续如果引入更复杂的流式输出或更多 AI 能力，也应优先在本模块内扩展，而不是把 AI 逻辑散落到 API 或前端。
