# Compiler Worker 模块

本模块承载 LaTeX 编译 Worker，后续将负责：

- 消费编译任务
- 调用编译环境执行 `pdflatex`
- 解析日志和错误
- 产出 PDF 及结构化结果

当前阶段仅初始化模块边界，后续实现应保持与 `apps/api` 的低耦合。
