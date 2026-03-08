/*
 * File: service.js
 * Module: packages/ai-assistant (AI 问答服务)
 *
 * Responsibility:
 *   - 为 LaTeX 问答与错误诊断构建统一上下文，并调用单一 OpenAI 兼容 Provider。
 *   - 提供轻量上下文压缩、结构化诊断和流式输出能力，把 AI 差异收敛在单模块内。
 *   - 在未配置 API Key 或远端调用失败时，返回本地兜底回复，确保产品链路始终可用。
 *
 * Runtime Logic Overview:
 *   1. API 传入用户消息、文件内容、选中文本和最近编译日志。
 *   2. 本模块先构造压缩后的 AI 上下文。
 *   3. 若配置了 API Key，则优先按当前 Provider 形态请求远端模型。
 *   4. 若需要流式输出，则优先使用流式 `/chat/completions`。
 *   5. 若远端失败或未配置，则回退到本地规则型回答或本地规则型诊断。
 *
 * Key Data Flow:
 *   - 输入：用户问题、当前文件路径、当前文件内容、选中文本、最近编译日志、历史消息。
 *   - 输出：AI 回答内容、流式增量、结构化诊断结果、来源和建议问题。
 *
 * Future Extension:
 *   - 可继续加入更细的上下文检索、缓存和成本监控。
  *   - 当前只保留单 Provider 入口，后续若确有需要再抽象更多 Provider。
 *
 * Dependencies:
 *   - Node.js 原生 fetch API
 *   - packages/ai-assistant/context-engine
 *   - packages/shared/env
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 接入上下文增强器并补全 inline completion 生成能力
 */

import { loadEnvFile } from "../../shared/src/env.js";
import { enhanceAIContext } from "./context-engine.js";

loadEnvFile();

const configuredApiKey =
  process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.API_KEY ?? null;
const configuredModel =
  process.env.AI_MODEL_NAME ?? process.env.OPENAI_MODEL ?? process.env.MODEL_NAME ?? "gpt-4.1-mini";
const configuredBaseUrl =
  process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? process.env.BASE_URL ?? "https://api.openai.com/v1";
const configuredApiStyle = process.env.AI_API_STYLE ?? "auto";
const configuredRequestTimeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 15000);
const normalizedBaseUrl = configuredBaseUrl.replace(/\/$/, "");
const openAIResponsesUrl = normalizedBaseUrl.endsWith("/responses")
  ? normalizedBaseUrl
  : `${normalizedBaseUrl}/responses`;
const openAIChatCompletionsUrl = normalizedBaseUrl.endsWith("/chat/completions")
  ? normalizedBaseUrl
  : `${normalizedBaseUrl}/chat/completions`;

function trimArray(items, maxLength) {
  return items.slice(0, maxLength);
}

function createRequestOptions(body, apiKey) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(configuredRequestTimeoutMs),
  };
}

function normalizeAbortError(error) {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new Error(`AI 请求超过 ${configuredRequestTimeoutMs}ms，已自动回退`);
  }

  return error;
}

function trimText(input, maxLength) {
  if (!input) {
    return "";
  }

  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength)}\n...[truncated]`;
}

function splitIntoParagraphChunks(content) {
  if (!content) {
    return [];
  }

  return content
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function extractDocumentSignals(content) {
  if (!content) {
    return {
      documentClass: null,
      packages: [],
      sections: [],
    };
  }

  const documentClass = content.match(/\\documentclass(?:\[[^\]]+\])?\{([^}]+)\}/)?.[1] ?? null;
  const packages = trimArray(
    [...content.matchAll(/\\usepackage(?:\[[^\]]+\])?\{([^}]+)\}/g)].map((match) => match[1]).filter(Boolean),
    8,
  );
  const sections = trimArray(
    [
      ...content.matchAll(/\\(?:section|subsection|subsubsection)\{([^}]+)\}/g),
    ].map((match) => match[1]).filter(Boolean),
    10,
  );

  return {
    documentClass,
    packages,
    sections,
  };
}

function getRelevantFileExcerpt(context) {
  const content = context.currentFileContent ?? "";

  if (!content) {
    return "";
  }

  if (context.selectedText?.trim()) {
    return trimText(context.selectedText.trim(), 1800);
  }

  const compileLine = extractLikelyCompileLine(context.recentCompileLog);

  if (compileLine) {
    const lines = content.split("\n");
    const from = Math.max(0, compileLine - 6);
    const to = Math.min(lines.length, compileLine + 4);
    return trimText(lines.slice(from, to).join("\n"), 2200);
  }

  const chunks = splitIntoParagraphChunks(content);

  if (chunks.length <= 2) {
    return trimText(content, 2200);
  }

  return trimText([chunks[0], chunks[1], chunks.at(-1)].filter(Boolean).join("\n\n"), 2200);
}

function buildContextDigest(context) {
  if (context.optimizedDigest) {
    return context.optimizedDigest;
  }

  const signals = extractDocumentSignals(context.currentFileContent ?? "");
  const excerpt = getRelevantFileExcerpt(context);

  return {
    signals,
    excerpt,
    repoSummary: {
      relatedFiles: context.currentFilePath ? [context.currentFilePath] : [],
      bibliographyKeys: [],
      includedFiles: [],
      fileCount: context.currentFilePath ? 1 : 0,
      overview: `当前文件: ${context.currentFilePath || "未指定"}`,
    },
    semanticChunks: [],
    compressedContextText: "",
    optimizerMeta: {
      source: "builtin",
      casedKit: { available: false, used: false },
      semchunk: { available: false, used: false },
      llmLingua: { available: false, used: false },
    },
    completionFocus: {
      prefixWindow: context.prefix ?? "",
      suffixWindow: context.suffix ?? "",
    },
  };
}

function formatRepoSummary(digest) {
  return digest.repoSummary?.overview || "无";
}

function formatSemanticChunks(digest) {
  const chunks = Array.isArray(digest.semanticChunks) ? digest.semanticChunks.filter(Boolean).slice(0, 3) : [];
  return chunks.length > 0 ? chunks.join("\n\n---\n\n") : "无";
}

function formatCompressedContext(digest) {
  return digest.compressedContextText?.trim() || "无";
}

function createSystemPrompt() {
  return [
    "你是一个面向 LaTeX 在线协作编辑器的写作助手。",
    "你的任务是根据当前文件、选中内容和编译日志，为用户提供简洁、准确、可直接执行的建议。",
    "优先解释 LaTeX 语法、编译错误、文稿结构和引用组织问题。",
    "如果给出代码示例，尽量提供可以直接插入编辑器的最小片段。",
    "回答使用中文，保持专业、直接，不要使用空泛鼓励性措辞。",
  ].join("\n");
}

function createExplainSystemPrompt() {
  return [
    "你是一个 LaTeX 代码解释助手。",
    "请用中文解释用户选中代码或当前片段的作用、关键命令和整体效果。",
    "不要泛泛而谈，要结合具体代码给出结构化解释。",
  ].join("\n");
}

function createImproveSystemPrompt() {
  return [
    "你是一个 LaTeX 代码优化助手。",
    "请基于用户选中代码或当前片段给出更规范、更可读、更易编译的改写版本。",
    "回答必须包含且只包含一个 ```latex``` 代码块，代码块里放可直接替换原内容的完整结果。",
    "代码块前可以先给 2 到 4 句中文说明，但不要输出多份候选代码。",
  ].join("\n");
}

function createFixSystemPrompt() {
  return [
    "你是一个 LaTeX 编译修复助手。",
    "请结合编译日志和当前相关片段，生成一份可直接应用到编辑器的修复版本。",
    "回答必须包含且只包含一个 ```latex``` 代码块，代码块里放修复后的完整片段。",
    "代码块前先用中文说明修复思路和原因。",
  ].join("\n");
}

function createUserPrompt(context) {
  const digest = buildContextDigest(context);
  const history = (context.history ?? [])
    .slice(-6)
    .map((entry) => `${entry.role === "assistant" ? "助手" : "用户"}: ${entry.content}`)
    .join("\n");

  return [
    `用户问题:\n${context.message}`,
    `当前文件路径:\n${context.currentFilePath || "未指定"}`,
    `文档类型:\n${digest.signals.documentClass || "未识别"}`,
    `已加载宏包:\n${digest.signals.packages.join(", ") || "无"}`,
    `章节结构:\n${digest.signals.sections.join(" / ") || "无"}`,
    `当前选中文本:\n${trimText(context.selectedText, 1200) || "无"}`,
    `当前相关片段:\n${digest.excerpt || "无"}`,
    `项目结构摘要:\n${formatRepoSummary(digest)}`,
    `语义相关片段:\n${formatSemanticChunks(digest)}`,
    `压缩上下文摘要:\n${formatCompressedContext(digest)}`,
    `最近编译日志:\n${trimText(context.recentCompileLog, 2500) || "无"}`,
    `最近对话历史:\n${history || "无"}`,
  ].join("\n\n");
}

function createExplainUserPrompt(context) {
  const digest = buildContextDigest(context);

  return [
    `当前文件路径:\n${context.currentFilePath || "未指定"}`,
    `用户选中文本:\n${trimText(context.selectedText, 1800) || "无"}`,
    `当前相关片段:\n${digest.excerpt || "无"}`,
    `项目结构摘要:\n${formatRepoSummary(digest)}`,
    `语义相关片段:\n${formatSemanticChunks(digest)}`,
    "请解释这段 LaTeX 的作用、关键命令、排版效果，以及用户应该重点理解哪些地方。",
  ].join("\n\n");
}

function createImproveUserPrompt(context) {
  const digest = buildContextDigest(context);

  return [
    `当前文件路径:\n${context.currentFilePath || "未指定"}`,
    `用户选中文本:\n${trimText(context.selectedText, 2200) || "无"}`,
    `当前相关片段:\n${digest.excerpt || "无"}`,
    `项目结构摘要:\n${formatRepoSummary(digest)}`,
    `语义相关片段:\n${formatSemanticChunks(digest)}`,
    `最近编译日志:\n${trimText(context.recentCompileLog, 1800) || "无"}`,
    "请给出更规范、更稳健的改写版本，并确保返回的 latex 代码块可以直接插入或替换原内容。",
  ].join("\n\n");
}

function createFixUserPrompt(context) {
  const digest = buildContextDigest(context);

  return [
    `当前文件路径:\n${context.currentFilePath || "未指定"}`,
    `用户选中文本:\n${trimText(context.selectedText, 2200) || "无"}`,
    `当前相关片段:\n${digest.excerpt || "无"}`,
    `项目结构摘要:\n${formatRepoSummary(digest)}`,
    `语义相关片段:\n${formatSemanticChunks(digest)}`,
    `最近编译日志:\n${trimText(context.recentCompileLog, 2500) || "无"}`,
    "请基于这次编译失败信息给出修复后的 latex 片段，要求可直接插入编辑器。",
  ].join("\n\n");
}

function createDiagnosisSystemPrompt() {
  return [
    "你是一个 LaTeX 编译错误诊断助手。",
    "请根据编译日志、当前文件片段和文档信号，输出严格 JSON 对象。",
    'JSON 字段必须包括: summary, errorType, explanation, likelyLine, likelyFilePath, suggestedFixes。',
    "suggestedFixes 必须是 2 到 4 条中文字符串。",
    "不要输出 JSON 以外的任何解释文字。",
  ].join("\n");
}

function createDiagnosisUserPrompt(context) {
  const digest = buildContextDigest(context);

  return [
    "请诊断下面这次 LaTeX 编译失败。",
    `当前文件路径:\n${context.currentFilePath || "未指定"}`,
    `文档类型:\n${digest.signals.documentClass || "未识别"}`,
    `已加载宏包:\n${digest.signals.packages.join(", ") || "无"}`,
    `相关文件片段:\n${digest.excerpt || "无"}`,
    `项目结构摘要:\n${formatRepoSummary(digest)}`,
    `语义相关片段:\n${formatSemanticChunks(digest)}`,
    `最近编译日志:\n${trimText(context.recentCompileLog, 3500) || "无"}`,
  ].join("\n\n");
}

function createCompletionSystemPrompt() {
  return [
    "你是一个 LaTeX inline completion 引擎。",
    "只返回需要插入到当前光标位置的后续文本，不要解释，不要使用 Markdown，不要输出代码块。",
    "不要重复用户已经输入的前缀，也不要重复文档中已经存在的后缀。",
    "优先给出最短但有价值的补全；如果没有高置信建议，返回空字符串。",
  ].join("\n");
}

function createCompletionUserPrompt(context) {
  const digest = buildContextDigest(context);
  const completionFocus = digest.completionFocus ?? {
    prefixWindow: trimText(context.prefix ?? "", 1400),
    suffixWindow: trimText(context.suffix ?? "", 800),
  };

  return [
    `当前文件路径:\n${context.currentFilePath || "未指定"}`,
    `文档类型:\n${digest.signals.documentClass || "未识别"}`,
    `已加载宏包:\n${digest.signals.packages.join(", ") || "无"}`,
    `章节结构:\n${digest.signals.sections.join(" / ") || "无"}`,
    `项目结构摘要:\n${formatRepoSummary(digest)}`,
    `语义相关片段:\n${formatSemanticChunks(digest)}`,
    `压缩上下文摘要:\n${formatCompressedContext(digest)}`,
    `光标前内容:\n${completionFocus.prefixWindow || "无"}`,
    `光标后内容:\n${completionFocus.suffixWindow || "无"}`,
    "请只输出应该插入的补全文本。",
  ].join("\n\n");
}

function computeEdgeOverlap(left, right, maxLength = 160) {
  const safeLeft = left.slice(-maxLength);
  const safeRight = right.slice(0, maxLength);
  const maxOverlap = Math.min(safeLeft.length, safeRight.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    if (safeLeft.slice(-size) === safeRight.slice(0, size)) {
      return size;
    }
  }

  return 0;
}

function sanitizeInlineCompletionText(rawText, context) {
  if (!rawText) {
    return "";
  }

  let normalized = rawText.trim();
  const codeBlock = normalized.match(/```(?:latex)?\s*([\s\S]*?)```/i)?.[1];

  if (codeBlock) {
    normalized = codeBlock.trim();
  }

  normalized = normalized
    .replace(/^completion\s*[:：]\s*/i, "")
    .replace(/^补全(?:内容)?\s*[:：]\s*/i, "")
    .replace(/^插入文本\s*[:：]\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "");

  if (!normalized) {
    return "";
  }

  const prefix = context.prefix ?? "";
  const suffix = context.suffix ?? "";
  const repeatedPrefixOverlap = computeEdgeOverlap(prefix, normalized, 200);

  if (repeatedPrefixOverlap > 0) {
    normalized = normalized.slice(repeatedPrefixOverlap);
  }

  const suffixOverlap = computeEdgeOverlap(normalized, suffix, 200);

  if (suffixOverlap > 0) {
    normalized = normalized.slice(0, normalized.length - suffixOverlap);
  }

  if (!normalized.trim()) {
    return "";
  }

  return normalized.slice(0, 240);
}

function findOpenEnvironmentName(prefix) {
  const openMatches = [...prefix.matchAll(/\\begin\{([^}\n]+)\}/g)].map((match) => match[1]);
  const closeMatches = [...prefix.matchAll(/\\end\{([^}\n]+)\}/g)].map((match) => match[1]);
  const stack = [];

  for (const envName of openMatches) {
    stack.push(envName);
  }

  for (const envName of closeMatches) {
    const index = stack.lastIndexOf(envName);

    if (index >= 0) {
      stack.splice(index, 1);
    }
  }

  return stack.at(-1) ?? null;
}

function buildLocalInlineCompletion(context) {
  const prefix = context.prefix ?? "";
  const currentLinePrefix = prefix.split("\n").at(-1) ?? prefix;
  const suffix = context.suffix ?? "";

  if (/\\(?:section|subsection|subsubsection|chapter)\{[^}\n]*$/u.test(currentLinePrefix)) {
    return "Section Title}";
  }

  if (/\\begin\{[^}\n]*$/u.test(currentLinePrefix)) {
    return "itemize}";
  }

  if (/\\end\{[^}\n]*$/u.test(currentLinePrefix)) {
    return `${findOpenEnvironmentName(prefix) ?? "itemize"}}`;
  }

  if (/\\cite\{[^}\n]*$/u.test(currentLinePrefix)) {
    return "reference-key}";
  }

  if (/\\label\{[^}\n]*$/u.test(currentLinePrefix)) {
    return "sec:placeholder}";
  }

  if (/\\ref\{[^}\n]*$/u.test(currentLinePrefix)) {
    return "sec:placeholder}";
  }

  if (/^\s*\\item\s*$/u.test(currentLinePrefix)) {
    return " ";
  }

  if (currentLinePrefix.endsWith("\\item") && !suffix.startsWith(" ")) {
    return " ";
  }

  if (currentLinePrefix.endsWith("{") && !suffix.startsWith("}")) {
    return "}";
  }

  if (currentLinePrefix.endsWith("[") && !suffix.startsWith("]")) {
    return "]";
  }

  return "";
}

function extractResponsesOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];

  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (part.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return null;
}

function extractChatCompletionsText(payload) {
  const messageContent = payload?.choices?.[0]?.message?.content;

  if (typeof messageContent === "string" && messageContent.trim()) {
    return messageContent.trim();
  }

  if (Array.isArray(messageContent)) {
    const text = messageContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part?.type === "text" && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();

    return text || null;
  }

  return null;
}

function extractChatCompletionsDelta(payload) {
  const rawDelta = payload?.choices?.[0]?.delta;

  function normalize(delta) {
    if (typeof delta === "string") {
      return delta;
    }

    if (Array.isArray(delta)) {
      return delta
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }

          if (part?.type === "text" && typeof part.text === "string") {
            return part.text;
          }

          return "";
        })
        .join("");
    }

    return "";
  }

  return {
    content: normalize(rawDelta?.content),
    reasoning: normalize(rawDelta?.reasoning_content),
  };
}

function parseJsonObjectFromText(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? null;

  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractLikelyCompileLine(logText) {
  if (!logText) {
    return null;
  }

  const lineMatch = logText.match(/\bl\.(\d+)\b/);
  return lineMatch ? Number(lineMatch[1]) : null;
}

function inferCompileErrorType(logText) {
  const source = (logText ?? "").toLowerCase();

  if (!source.trim()) {
    return "UNKNOWN";
  }

  if (source.includes("undefined control sequence")) {
    return "UNDEFINED_COMMAND";
  }

  if (source.includes("missing $ inserted")) {
    return "MISSING_MATH_MODE";
  }

  if (source.includes("runaway argument")) {
    return "RUNAWAY_ARGUMENT";
  }

  if (source.includes("file `") || source.includes("file `") || source.includes("not found")) {
    return "MISSING_FILE_OR_PACKAGE";
  }

  if (source.includes("emergency stop")) {
    return "EMERGENCY_STOP";
  }

  return "LATEX_COMPILE_ERROR";
}

function buildSuggestionCandidates(context) {
  const suggestions = [];

  if (context.recentCompileLog) {
    suggestions.push("请结合最近一次编译日志，告诉我错误怎么修");
  }

  if (context.selectedText) {
    suggestions.push("解释一下我选中的这段 LaTeX 代码");
  }

  if ((context.currentFileContent ?? "").includes("\\begin{table}")) {
    suggestions.push("帮我优化当前表格的排版");
  }

  suggestions.push("如何把这一段写得更学术一些？");
  suggestions.push("给我一个可以直接插入的 LaTeX 示例");

  return [...new Set(suggestions)].slice(0, 3);
}

function buildLocalDiagnosis(context) {
  const logText = context.recentCompileLog ?? "";
  const errorType = inferCompileErrorType(logText);
  const likelyLine = extractLikelyCompileLine(logText);
  const fixes = [];

  if (errorType === "UNDEFINED_COMMAND") {
    fixes.push("检查命令拼写是否正确，尤其是反斜杠后的命令名。");
    fixes.push("确认导言区是否加载了对应宏包。");
    fixes.push("如果是自定义命令，确认是否已使用 \\newcommand 定义。");
  } else if (errorType === "MISSING_MATH_MODE") {
    fixes.push("检查是否在普通文本里直接使用了数学符号。");
    fixes.push("将相关内容放入 `$...$`、`\\(...\\)` 或数学环境。");
    fixes.push("确认下划线 `_`、上标 `^` 是否只出现在数学模式中。");
  } else if (errorType === "RUNAWAY_ARGUMENT") {
    fixes.push("检查最近修改区域的花括号是否成对闭合。");
    fixes.push("检查环境开始和结束命令是否匹配。");
    fixes.push("优先查看报错行前后 5 行，通常真正问题出现在更早位置。");
  } else if (errorType === "MISSING_FILE_OR_PACKAGE") {
    fixes.push("检查缺失文件或宏包名称是否正确。");
    fixes.push("确认引用的图片、样式或 `.bib` 文件路径存在。");
    fixes.push("如果是宏包缺失，确认 TeX 环境已安装对应包。");
  } else {
    fixes.push("先查看报错行号附近的括号、环境和命令参数是否完整。");
    fixes.push("如果错误向后连锁，优先修复日志里最先出现的第一条错误。");
    fixes.push("修改后重新编译，确认错误是否消失而不是被后续日志掩盖。");
  }

  return {
    summary: "我已基于最近一次编译日志给出本地规则诊断。",
    errorType,
    explanation: trimText(logText, 1400) || "当前没有拿到可分析的编译日志。",
    likelyLine,
    likelyFilePath: context.currentFilePath ?? null,
    suggestedFixes: fixes.slice(0, 3),
    source: "local_fallback",
    model: "local-fallback",
    rawAnswer: null,
  };
}

function buildLocalFallbackAnswer(context) {
  const lowerMessage = context.message.toLowerCase();
  const selectedText = trimText(context.selectedText, 800);
  const compileLog = trimText(context.recentCompileLog, 1200);
  const hasTableIntent = /table|表格|tabular/.test(lowerMessage);
  const hasFigureIntent = /figure|图片|插图/.test(lowerMessage);
  const hasCitationIntent = /引用|参考文献|bib|cite/.test(lowerMessage);
  const hasCompileIntent = /编译|error|报错|undefined|失败/.test(lowerMessage);

  if (hasCompileIntent && compileLog) {
    return [
      "先看最近一次编译日志，可以优先检查以下几点：",
      `1. 日志摘要：\n${compileLog}`,
      "2. 如果报 `Undefined control sequence`，通常是命令拼写错误，或缺少对应宏包。",
      "3. 如果报行号错误，优先检查该行前后的花括号、环境开始/结束是否成对。",
      "4. 修改后重新编译，确认错误是否向后传导消失。",
    ].join("\n\n");
  }

  if (selectedText) {
    return [
      "我先基于你当前选中的内容给出解释：",
      selectedText,
      "这段内容大概率是在定义结构或排版行为。你可以重点检查：",
      "1. 是否引入了所需宏包。",
      "2. 环境开始与结束是否成对。",
      "3. 命令参数的花括号是否完整。",
      "如果你愿意，我下一轮可以直接把这段改写成更规范的 LaTeX 写法。",
    ].join("\n\n");
  }

  if (hasTableIntent) {
    return [
      "可以，下面给你一个适合直接插入的最小表格示例：",
      "```latex",
      "\\begin{table}[htbp]",
      "  \\centering",
      "  \\caption{示例表格}",
      "  \\begin{tabular}{lcc}",
      "    \\hline",
      "    方法 & 准确率 & 时间 \\\\",
      "    \\hline",
      "    Baseline & 91.2\\% & 12s \\\\",
      "    Ours & 94.8\\% & 9s \\\\",
      "    \\hline",
      "  \\end{tabular}",
      "\\end{table}",
      "```",
      "如果你有现成表格，我也可以按你的列数和内容重写。",
    ].join("\n");
  }

  if (hasFigureIntent) {
    return [
      "下面是一个可直接插入的插图示例：",
      "```latex",
      "\\begin{figure}[htbp]",
      "  \\centering",
      "  \\includegraphics[width=0.75\\textwidth]{images/example.png}",
      "  \\caption{示例图片}",
      "  \\label{fig:example}",
      "\\end{figure}",
      "```",
      "如果你的图片不显示，优先检查文件路径、扩展名和是否已加载 `graphicx` 宏包。",
    ].join("\n");
  }

  if (hasCitationIntent) {
    return [
      "参考文献常见操作可以先按这条路径检查：",
      "1. `.bib` 文件是否存在且条目 key 正确。",
      "2. 文中是否使用 `\\cite{your_key}`。",
      "3. 导言区是否设置了引用样式或加载了 `biblatex` / `natbib`。",
      "如果你把当前引用片段贴给我，我可以直接帮你改成可编译的版本。",
    ].join("\n\n");
  }

  return [
    "我已经拿到当前文件上下文，可以先从这几个方向帮你：",
    "1. 解释当前 LaTeX 代码或选中片段。",
    "2. 根据最近编译日志定位错误。",
    "3. 生成可直接插入的表格、图片、引用或公式模板。",
    "如果你希望我更精准，直接告诉我具体目标，或者选中一段代码再提问。",
  ].join("\n\n");
}

function buildLocalExplainAnswer(context) {
  const excerpt = getRelevantFileExcerpt(context);

  return [
    "我先基于当前片段给出本地解释：",
    excerpt || "当前没有可解释的选中内容或相关片段。",
    "重点可以先看这几个方面：",
    "1. 命令是否在控制结构、引用、表格或环境。",
    "2. 花括号里的参数是否在定义标题、标签或内容。",
    "3. 环境开始和结束是否成对。",
    "如果你希望我给更细的逐行解释，可以直接选中更小的一段继续提问。",
  ].join("\n\n");
}

function buildLocalImproveAnswer(context) {
  const excerpt = getRelevantFileExcerpt(context);

  return [
    "外部 AI 当前不可用，我先给你本地优化方向：",
    "1. 确保环境开始和结束命令成对。",
    "2. 保持命令参数和内容之间留出清晰空行。",
    "3. 为表格、图片和章节补齐 `\\caption`、`\\label` 等常见结构。",
    excerpt ? `当前片段：\n${excerpt}` : "当前没有拿到可优化的片段。",
  ].join("\n\n");
}

function buildLocalFixAnswer(context) {
  const diagnosis = buildLocalDiagnosis(context);

  return [
    "外部 AI 当前不可用，我先基于本地规则给出修复方向：",
    diagnosis.explanation,
    ...diagnosis.suggestedFixes.map((fix, index) => `${index + 1}. ${fix}`),
  ].join("\n\n");
}

async function requestGenericResponsesReply({ systemPrompt, userPrompt, apiKey, source, suggestions = [] }) {
  let response;

  try {
    response = await fetch(
      openAIResponsesUrl,
      createRequestOptions(
        {
          model: configuredModel,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: systemPrompt }],
            },
            {
              role: "user",
              content: [{ type: "input_text", text: userPrompt }],
            },
          ],
        },
        apiKey,
      ),
    );
  } catch (error) {
    throw normalizeAbortError(error);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const answer = extractResponsesOutputText(payload);

  if (!answer) {
    throw new Error("OpenAI 返回结果中未解析到文本内容");
  }

  return {
    answer,
    source,
    model: payload.model ?? configuredModel,
    suggestions,
  };
}

async function requestGenericChatReply({
  systemPrompt,
  userPrompt,
  apiKey,
  source,
  suggestions = [],
  responseFormat,
}) {
  let response;

  try {
    response = await fetch(
      openAIChatCompletionsUrl,
      createRequestOptions(
        {
          model: configuredModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        },
        apiKey,
      ),
    );
  } catch (error) {
    throw normalizeAbortError(error);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Chat Completions request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const answer = extractChatCompletionsText(payload);

  if (!answer) {
    throw new Error("Chat Completions 返回结果中未解析到文本内容");
  }

  return {
    answer,
    source,
    model: payload.model ?? configuredModel,
    suggestions,
    payload,
  };
}

async function requestGenericReply({ systemPrompt, userPrompt, suggestions = [] }) {
  const apiKey = configuredApiKey;

  if (!apiKey) {
    return null;
  }

  const source = "openai_compatible";

  if (configuredApiStyle === "chat_completions") {
    return requestGenericChatReply({ systemPrompt, userPrompt, apiKey, source, suggestions });
  }

  if (configuredApiStyle === "responses") {
    return requestGenericResponsesReply({ systemPrompt, userPrompt, apiKey, source, suggestions });
  }

  const useChatCompletionsFirst = /deepseek/i.test(configuredBaseUrl) || /deepseek/i.test(configuredModel);

  try {
    if (useChatCompletionsFirst) {
      return await requestGenericChatReply({ systemPrompt, userPrompt, apiKey, source, suggestions });
    }

    return await requestGenericResponsesReply({ systemPrompt, userPrompt, apiKey, source, suggestions });
  } catch (primaryError) {
    try {
      if (useChatCompletionsFirst) {
        return await requestGenericResponsesReply({ systemPrompt, userPrompt, apiKey, source, suggestions });
      }

      return await requestGenericChatReply({ systemPrompt, userPrompt, apiKey, source, suggestions });
    } catch (secondaryError) {
      throw new Error(
        [
          primaryError instanceof Error ? primaryError.message : String(primaryError),
          secondaryError instanceof Error ? secondaryError.message : String(secondaryError),
        ].join(" | fallback failed: "),
      );
    }
  }
}

async function requestResponsesReply(context, apiKey, source) {
  return requestGenericResponsesReply({
    systemPrompt: createSystemPrompt(),
    userPrompt: createUserPrompt(context),
    apiKey,
    source,
    suggestions: buildSuggestionCandidates(context),
  });
}

async function requestChatCompletionsReply(context, apiKey, source) {
  const reply = await requestGenericChatReply({
    systemPrompt: createSystemPrompt(),
    userPrompt: createUserPrompt(context),
    apiKey,
    source,
    suggestions: buildSuggestionCandidates(context),
  });

  return {
    answer: reply.answer,
    source: reply.source,
    model: reply.model,
    suggestions: reply.suggestions,
  };
}

async function requestDiagnosisReply(context, apiKey, source) {
  const reply = await requestGenericChatReply({
    systemPrompt: createDiagnosisSystemPrompt(),
    userPrompt: createDiagnosisUserPrompt(context),
    apiKey,
    source,
    responseFormat: { type: "json_object" },
  });
  const answer = reply.answer;
  const parsed = answer ? parseJsonObjectFromText(answer) : null;

  if (!parsed) {
    throw new Error("诊断结果未返回可解析 JSON");
  }

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "AI 已生成诊断结果。",
    errorType:
      typeof parsed.errorType === "string" && parsed.errorType.trim()
        ? parsed.errorType
        : inferCompileErrorType(context.recentCompileLog),
    explanation:
      typeof parsed.explanation === "string" ? parsed.explanation : "AI 未提供完整解释。",
    likelyLine:
      typeof parsed.likelyLine === "number" ? parsed.likelyLine : extractLikelyCompileLine(context.recentCompileLog),
    likelyFilePath:
      typeof parsed.likelyFilePath === "string" && parsed.likelyFilePath.trim()
        ? parsed.likelyFilePath
        : context.currentFilePath ?? null,
    suggestedFixes: Array.isArray(parsed.suggestedFixes)
      ? parsed.suggestedFixes.filter((item) => typeof item === "string").slice(0, 4)
      : [],
    source,
    model: reply.model ?? configuredModel,
    rawAnswer: answer,
  };
}

async function streamChatCompletionsReply(context, apiKey, source, onDelta) {
  let response;

  try {
    response = await fetch(
      openAIChatCompletionsUrl,
      createRequestOptions(
        {
          model: configuredModel,
          messages: [
            { role: "system", content: createSystemPrompt() },
            { role: "user", content: createUserPrompt(context) },
          ],
          stream: true,
        },
        apiKey,
      ),
    );
  } catch (error) {
    throw normalizeAbortError(error);
  }

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    throw new Error(`Chat Completions stream failed: ${response.status} ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8");
  let buffer = "";
  let answer = "";
  let reasoning = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line.startsWith("data:")) {
        continue;
      }

      const payloadText = line.slice(5).trim();

      if (!payloadText || payloadText === "[DONE]") {
        continue;
      }

      const payload = JSON.parse(payloadText);
      const delta = extractChatCompletionsDelta(payload);

      if (delta.reasoning) {
        reasoning += delta.reasoning;
      }

      if (!delta.content) {
        continue;
      }

      answer += delta.content;
      onDelta(delta.content);
    }
  }

  if (!answer.trim()) {
    const fallbackReply = await requestChatCompletionsReply(context, apiKey, source);
    return {
      ...fallbackReply,
      reasoning,
    };
  }

  return {
    answer,
    source,
    model: configuredModel,
    suggestions: buildSuggestionCandidates(context),
    reasoning,
  };
}

export async function streamAssistantReply(context, callbacks = {}) {
  const preparedContext = await enhanceAIContext(context);
  const emitDelta = callbacks.onDelta ?? (() => {});

  try {
    if (!configuredApiKey) {
      const fallbackAnswer = buildLocalFallbackAnswer(preparedContext);
      emitDelta(fallbackAnswer);
      return {
        answer: fallbackAnswer,
        source: "local_fallback",
        model: "local-fallback",
        suggestions: buildSuggestionCandidates(preparedContext),
      };
    }

    if (configuredApiStyle === "responses") {
      const reply = await requestResponsesReply(preparedContext, configuredApiKey, "openai_compatible");
      emitDelta(reply.answer);
      return reply;
    }

    const useChatCompletionsFirst = /deepseek/i.test(configuredBaseUrl) || /deepseek/i.test(configuredModel);

    if (configuredApiStyle === "chat_completions" || useChatCompletionsFirst) {
      return await streamChatCompletionsReply(preparedContext, configuredApiKey, "openai_compatible", emitDelta);
    }

    const reply = await requestChatCompletionsReply(preparedContext, configuredApiKey, "openai_compatible");
    emitDelta(reply.answer);
    return reply;
  } catch (error) {
    const fallbackAnswer = [
      "外部 AI 服务暂时不可用，我先给你本地兜底建议。",
      buildLocalFallbackAnswer(preparedContext),
    ].join("\n\n");
    emitDelta(fallbackAnswer);
    return {
      answer: fallbackAnswer,
      source: "local_fallback",
      model: "local-fallback",
      suggestions: buildSuggestionCandidates(preparedContext),
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function generateDiagnosisResult(context) {
  const preparedContext = await enhanceAIContext(context);

  try {
    if (configuredApiKey) {
      return await requestDiagnosisReply(preparedContext, configuredApiKey, "openai_compatible");
    }
  } catch (error) {
    const fallback = buildLocalDiagnosis(preparedContext);
    return {
      ...fallback,
      rawAnswer: error instanceof Error ? error.message : String(error),
    };
  }

  return buildLocalDiagnosis(preparedContext);
}

export async function generateExplainReply(context) {
  const preparedContext = await enhanceAIContext(context);

  try {
    const reply = await requestGenericReply({
      systemPrompt: createExplainSystemPrompt(),
      userPrompt: createExplainUserPrompt(preparedContext),
    });

    if (reply) {
      return reply;
    }
  } catch (error) {
    return {
      answer: [
        "外部 AI 服务暂时不可用，我先给你本地解释。",
        buildLocalExplainAnswer(preparedContext),
      ].join("\n\n"),
      source: "local_fallback",
      model: "local-fallback",
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    answer: buildLocalExplainAnswer(preparedContext),
    source: "local_fallback",
    model: "local-fallback",
  };
}

export async function generateImproveReply(context) {
  const preparedContext = await enhanceAIContext(context);

  try {
    const reply = await requestGenericReply({
      systemPrompt: createImproveSystemPrompt(),
      userPrompt: createImproveUserPrompt(preparedContext),
    });

    if (reply) {
      return reply;
    }
  } catch (error) {
    return {
      answer: [
        "外部 AI 服务暂时不可用，我先给你本地优化建议。",
        buildLocalImproveAnswer(preparedContext),
      ].join("\n\n"),
      source: "local_fallback",
      model: "local-fallback",
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    answer: buildLocalImproveAnswer(preparedContext),
    source: "local_fallback",
    model: "local-fallback",
  };
}

export async function generateFixReply(context) {
  const preparedContext = await enhanceAIContext(context);

  try {
    const reply = await requestGenericReply({
      systemPrompt: createFixSystemPrompt(),
      userPrompt: createFixUserPrompt(preparedContext),
    });

    if (reply) {
      return reply;
    }
  } catch (error) {
    return {
      answer: [
        "外部 AI 服务暂时不可用，我先给你本地修复方向。",
        buildLocalFixAnswer(preparedContext),
      ].join("\n\n"),
      source: "local_fallback",
      model: "local-fallback",
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    answer: buildLocalFixAnswer(preparedContext),
    source: "local_fallback",
    model: "local-fallback",
  };
}

export async function generateInlineCompletion(context) {
  const preparedContext = await enhanceAIContext(context);

  try {
    const reply = await requestGenericReply({
      systemPrompt: createCompletionSystemPrompt(),
      userPrompt: createCompletionUserPrompt(preparedContext),
    });

    if (reply) {
      const completion = sanitizeInlineCompletionText(reply.answer, preparedContext);

      if (completion) {
        return {
          completion,
          source: reply.source,
          model: reply.model,
          strategy: "remote_ai",
        };
      }
    }
  } catch (error) {
    const fallbackCompletion = buildLocalInlineCompletion(preparedContext);

    return {
      completion: fallbackCompletion,
      source: "local_fallback",
      model: "local-fallback",
      strategy: "heuristic",
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    completion: buildLocalInlineCompletion(preparedContext),
    source: "local_fallback",
    model: "local-fallback",
    strategy: "heuristic",
  };
}

/*
 * Code Review:
 * - 当前仍保持单一 OpenAI 兼容 Provider 入口，没有引入多 Provider 调度平台，符合现阶段约束。
 * - 通过上下文增强器、结构化诊断、解释/优化/修复动作、inline completion 和流式输出，把 DeepSeek 这类 OpenAI 兼容模型的差异收敛在模块内部。
 * - 本地兜底保证了无 API Key 或网络失败时前端仍可联调，不会因为外部依赖阻塞产品开发。
 * - Python 增强器被设计成“可选加速层”而不是硬依赖，因此即便 `cased-kit / semchunk / LLMLingua` 中某一项不可用，主链路也仍可用。
 */
