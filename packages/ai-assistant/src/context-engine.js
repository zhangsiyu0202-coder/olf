/*
 * File: context-engine.js
 * Module: packages/ai-assistant (上下文工程)
 *
 * Responsibility:
 *   - 为 AI 问答、诊断和 inline completion 提供统一的上下文增强入口。
 *   - 在 Node 主链路中协调 cased-kit、semchunk、LLMLingua 这类可选增强器，并保持失败时可自动回退。
 *   - 输出稳定的结构化上下文摘要，避免上层业务直接感知 Python 依赖和子进程细节。
 *
 * Runtime Logic Overview:
 *   1. AI 服务传入项目根目录、当前文件内容、光标附近前后缀和最近编译日志。
 *   2. 本模块先构造内建的 LaTeX 信号、片段摘要和项目结构摘要。
 *   3. 若本地 Python 优化器可用，则额外调用 `context_tools.py` 获取语义分块和压缩结果。
 *   4. 最终把增强结果合并回上下文，供问答、诊断和补全 prompt 复用。
 *
 * Key Data Flow:
 *   - 输入：项目路径、文件路径、文件内容、选中文本、光标前后缀、编译日志、历史消息。
 *   - 输出：增强后的 `optimizedDigest`、completion 聚焦片段和优化器运行元信息。
 *
 * Future Extension:
 *   - 可继续接入真实的缓存层，避免重复扫描同一项目。
 *   - 若后续确定 Python 增强器稳定可用，可把子进程调用收敛为独立服务。
 *
 * Dependencies:
 *   - node:child_process
 *   - node:path
 *   - packages/shared/fs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 新增上下文增强器适配层并接入可选 Python 优化器
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileExists } from "../../shared/src/fs.js";
import { repositoryRoot } from "../../shared/src/paths.js";

const optimizerScriptPath = path.join(repositoryRoot, "packages", "ai-assistant", "src", "context_tools.py");
const optimizerPythonPath =
  process.env.AI_OPTIMIZER_PYTHON?.trim() || path.join(repositoryRoot, ".venv", "bin", "python");
const optimizerTimeoutMs = Number(process.env.AI_OPTIMIZER_TIMEOUT_MS ?? 3500);
const optimizersEnabled = process.env.AI_ENABLE_CONTEXT_OPTIMIZERS !== "0";
const maxPromptExcerptLength = 2200;
const maxSemanticChunks = 3;

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

function extractLikelyCompileLine(logText) {
  if (!logText) {
    return null;
  }

  const lineMatch = logText.match(/\bl\.(\d+)\b/);
  return lineMatch ? Number(lineMatch[1]) : null;
}

function extractDocumentSignals(content) {
  if (!content) {
    return {
      documentClass: null,
      packages: [],
      sections: [],
      labels: [],
      customCommands: [],
    };
  }

  const documentClass = content.match(/\\documentclass(?:\[[^\]]+\])?\{([^}]+)\}/)?.[1] ?? null;
  const packages = [
    ...content.matchAll(/\\usepackage(?:\[[^\]]+\])?\{([^}]+)\}/g),
  ]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 10);
  const sections = [
    ...content.matchAll(/\\(?:part|chapter|section|subsection|subsubsection)\{([^}]+)\}/g),
  ]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 12);
  const labels = [...content.matchAll(/\\label\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 12);
  const customCommands = [
    ...content.matchAll(/\\(?:newcommand|DeclareMathOperator)\*?\{\\([^}]+)\}/g),
  ]
    .map((match) => `\\${match[1]}`)
    .filter(Boolean)
    .slice(0, 12);

  return {
    documentClass,
    packages,
    sections,
    labels,
    customCommands,
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
    return trimText(lines.slice(from, to).join("\n"), maxPromptExcerptLength);
  }

  const chunks = splitIntoParagraphChunks(content);

  if (chunks.length <= 2) {
    return trimText(content, maxPromptExcerptLength);
  }

  return trimText([chunks[0], chunks[1], chunks.at(-1)].filter(Boolean).join("\n\n"), maxPromptExcerptLength);
}

function createFallbackRepoSummary(context, signals) {
  const relatedFiles = [];

  if (context.currentFilePath) {
    relatedFiles.push(context.currentFilePath);
  }

  const overviewLines = [
    `当前文件: ${context.currentFilePath || "未指定"}`,
    `文档类型: ${signals.documentClass || "未识别"}`,
    `宏包: ${signals.packages.join(", ") || "无"}`,
    `章节: ${signals.sections.join(" / ") || "无"}`,
    `标签: ${signals.labels.join(", ") || "无"}`,
    `自定义命令: ${signals.customCommands.join(", ") || "无"}`,
  ];

  return {
    relatedFiles,
    bibliographyKeys: [],
    includedFiles: [],
    fileCount: relatedFiles.length,
    overview: overviewLines.join("\n"),
  };
}

function createCompletionFocus(context) {
  const fullPrefix = context.prefix ?? "";
  const fullSuffix = context.suffix ?? "";

  return {
    prefixWindow: fullPrefix.slice(-1400),
    suffixWindow: fullSuffix.slice(0, 800),
  };
}

function buildFallbackDigest(context) {
  const signals = extractDocumentSignals(context.currentFileContent ?? "");
  const paragraphChunks = splitIntoParagraphChunks(context.currentFileContent ?? "");
  const semanticChunks = paragraphChunks.slice(0, maxSemanticChunks).map((chunk) => trimText(chunk, 600));

  return {
    signals,
    excerpt: getRelevantFileExcerpt(context),
    repoSummary: createFallbackRepoSummary(context, signals),
    semanticChunks,
    compressedContextText: "",
    optimizerMeta: {
      source: "builtin",
      casedKit: { available: false, used: false, reason: "未启用 Python 优化器" },
      semchunk: { available: false, used: false, reason: "未启用 Python 优化器" },
      llmLingua: { available: false, used: false, reason: "未启用 Python 优化器" },
    },
    completionFocus: createCompletionFocus(context),
  };
}

async function runOptimizerScript(payload) {
  if (!optimizersEnabled) {
    return null;
  }

  if (!(await fileExists(optimizerScriptPath)) || !(await fileExists(optimizerPythonPath))) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(optimizerPythonPath, [optimizerScriptPath], {
      cwd: repositoryRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      child.kill("SIGKILL");
      reject(new Error(`Python 上下文优化器超过 ${optimizerTimeoutMs}ms，已自动回退`));
    }, optimizerTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python 上下文优化器退出码异常: ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function mergeOptimizedDigest(baseDigest, optimizedPayload) {
  if (!optimizedPayload || typeof optimizedPayload !== "object") {
    return baseDigest;
  }

  const optimizerMeta = {
    ...baseDigest.optimizerMeta,
    ...(optimizedPayload.optimizerMeta ?? {}),
  };

  return {
    signals: {
      ...baseDigest.signals,
      ...(optimizedPayload.signals ?? {}),
    },
    excerpt: optimizedPayload.excerpt || baseDigest.excerpt,
    repoSummary: {
      ...baseDigest.repoSummary,
      ...(optimizedPayload.repoSummary ?? {}),
    },
    semanticChunks: Array.isArray(optimizedPayload.semanticChunks) && optimizedPayload.semanticChunks.length > 0
      ? optimizedPayload.semanticChunks.slice(0, maxSemanticChunks).map((chunk) => trimText(String(chunk), 800))
      : baseDigest.semanticChunks,
    compressedContextText:
      typeof optimizedPayload.compressedContextText === "string"
        ? optimizedPayload.compressedContextText
        : baseDigest.compressedContextText,
    optimizerMeta,
    completionFocus: {
      ...baseDigest.completionFocus,
      ...(optimizedPayload.completionFocus ?? {}),
    },
  };
}

export async function enhanceAIContext(context) {
  const fallbackDigest = buildFallbackDigest(context);
  const optimizerPayload = {
    projectRoot: context.projectRoot ?? null,
    currentFilePath: context.currentFilePath ?? null,
    currentFileContent: context.currentFileContent ?? "",
    selectedText: context.selectedText ?? "",
    recentCompileLog: context.recentCompileLog ?? "",
    message: context.message ?? "",
    history: Array.isArray(context.history) ? context.history.slice(-6) : [],
    prefix: context.prefix ?? "",
    suffix: context.suffix ?? "",
  };

  try {
    const optimizedPayload = await runOptimizerScript(optimizerPayload);

    return {
      ...context,
      optimizedDigest: mergeOptimizedDigest(fallbackDigest, optimizedPayload),
    };
  } catch (error) {
    return {
      ...context,
      optimizedDigest: {
        ...fallbackDigest,
        optimizerMeta: {
          ...fallbackDigest.optimizerMeta,
          source: "builtin_fallback",
          warning: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

/*
 * Code Review:
 * - 该模块把 Python 增强器边界控制在单一子进程入口，避免把 `cased-kit / semchunk / LLMLingua` 的运行细节扩散到 API 层。
 * - 当前实现优先保证“增强失败不影响主链路”，因此任何超时、缺包或解析错误都会自动回退到内建上下文摘要。
 * - 若后续优化器命中率和稳定性足够高，可再引入缓存与更细粒度的命中策略，而不是在现阶段提前复杂化。
 */
