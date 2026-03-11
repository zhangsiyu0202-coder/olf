/*
 * File: service.js
 * Module: packages/paper-assistant (论文模块服务封装)
 *
 * Responsibility:
 *   - 在 Node 主链路中统一封装论文检索、加载、BibTeX、PDF 缓存与研究 Agent 能力。
 *   - 优先通过独立论文搜索 HTTP 服务访问多源论文能力；未配置远端服务时，再回退到本地 Python CLI。
 *
 * Runtime Logic Overview:
 *   1. API 调用本模块发起论文搜索、阅读或 Agent 问答。
 *   2. 若配置了 `PAPER_ASSISTANT_BASE_URL`，请求会转发到独立论文搜索服务。
 *   3. 若未配置远端服务，则以 JSON stdin/stdout 方式调用 `paper_tools.py` 本地回退。
 *   4. PDF 下载结果继续做本地缓存，供前端稳定预览。
 *
 * Dependencies:
 *   - node:child_process
 *   - node:fs
 *   - node:path
 *   - packages/shared/env
 *   - packages/shared/fs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增结构化论文报告生成封装
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "../../shared/src/env.js";
import { ensureDir, fileExists, writeBinary } from "../../shared/src/fs.js";
import { normalizePaperReference } from "../../shared/src/paper-refs.js";
import { getPaperPdfCachePath, repositoryRoot, runtimePapersRoot } from "../../shared/src/paths.js";

loadEnvFile();

const paperScriptPath = path.join(repositoryRoot, "packages", "paper-assistant", "src", "paper_tools.py");
const dedicatedPaperPythonPath = path.join(repositoryRoot, ".venv-paper-service", "bin", "python");
const sharedPaperPythonPath = path.join(repositoryRoot, ".venv", "bin", "python");
const paperPythonPath =
  process.env.PAPER_ASSISTANT_PYTHON?.trim() ||
  (existsSync(dedicatedPaperPythonPath) ? dedicatedPaperPythonPath : sharedPaperPythonPath);
const paperToolTimeoutMs = Number(process.env.PAPER_ASSISTANT_TIMEOUT_MS ?? 60000);
const paperAssistantBaseUrl = String(process.env.PAPER_ASSISTANT_BASE_URL ?? "").trim().replace(/\/+$/, "");
const defaultPaperSearchLimit = 200;

function normalizePaperId(paperId) {
  return normalizePaperReference(paperId);
}

function buildRemotePaperServiceUrl(pathname, query = null) {
  if (!paperAssistantBaseUrl) {
    throw new Error("当前未配置 PAPER_ASSISTANT_BASE_URL");
  }

  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${paperAssistantBaseUrl}${normalizedPath}${query ? `?${query}` : ""}`;
}

async function fetchPaperServiceJson(pathname, { method = "GET", body = null, query = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), paperToolTimeoutMs);

  try {
    const response = await fetch(buildRemotePaperServiceUrl(pathname, query), {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = payload.detail || payload.error?.message || `论文服务请求失败: ${response.status}`;
      throw new Error(message);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function runPaperTool(payload) {
  await ensureDir(runtimePapersRoot);

  if (!(await fileExists(paperScriptPath)) || !(await fileExists(paperPythonPath))) {
    throw new Error("论文 Python 工具不可用，请检查 paper-assistant 脚本和解释器");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(paperPythonPath, [paperScriptPath], {
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
      reject(new Error(`论文服务超过 ${paperToolTimeoutMs}ms，已自动中断`));
    }, paperToolTimeoutMs);

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

      try {
        const parsed = JSON.parse(stdout || "{}");

        if (code !== 0 || parsed.error) {
          reject(new Error(parsed.error?.message || stderr.trim() || "论文工具执行失败"));
          return;
        }

        resolve(parsed);
      } catch (error) {
        reject(new Error(`论文工具返回了非法 JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

export async function searchPapers(query, limit = defaultPaperSearchLimit, sources = []) {
  if (paperAssistantBaseUrl) {
    return await fetchPaperServiceJson("/v1/search", {
      method: "POST",
      body: {
        query,
        limit,
        sources,
      },
    });
  }

  return await runPaperTool({
    action: "search",
    query,
    limit,
    sources,
  });
}

export async function loadPaperDetails(paperId, maxChars = 18000) {
  const normalizedPaperId = normalizePaperId(paperId);

  if (paperAssistantBaseUrl) {
    const payload = await fetchPaperServiceJson(`/v1/papers/${encodeURIComponent(normalizedPaperId)}`, {
      method: "GET",
      body: null,
      query: new URLSearchParams({
        max_chars: String(maxChars),
      }).toString(),
    });
    return payload.paper;
  }

  const payload = await runPaperTool({
    action: "load",
    paperId: normalizedPaperId,
    maxChars,
  });

  return payload.paper;
}

export async function loadPaperMetadata(paperId, maxChars = 6000) {
  const normalizedPaperId = normalizePaperId(paperId);

  if (paperAssistantBaseUrl) {
    const payload = await fetchPaperServiceJson(`/v1/paper-metadata/${encodeURIComponent(normalizedPaperId)}`, {
      method: "GET",
      body: null,
      query: new URLSearchParams({
        max_chars: String(maxChars),
      }).toString(),
    });
    return payload.paper;
  }

  const payload = await runPaperTool({
    action: "metadata",
    paperId: normalizedPaperId,
    maxChars,
  });

  return payload.paper;
}

export async function generatePaperReport(paperId, { maxChars = 24000, language = "zh-CN" } = {}) {
  const normalizedPaperId = normalizePaperId(paperId);

  if (paperAssistantBaseUrl) {
    return fetchPaperServiceJson("/v1/reports/generate", {
      method: "POST",
      body: {
        paperId: normalizedPaperId,
        maxChars,
        language,
      },
    });
  }

  return runPaperTool({
    action: "report_generate",
    paperId: normalizedPaperId,
    maxChars,
    language,
  });
}

export async function generatePaperBibtex(paperId) {
  const normalizedPaperId = normalizePaperId(paperId);

  if (paperAssistantBaseUrl) {
    return fetchPaperServiceJson(`/v1/papers/${encodeURIComponent(normalizedPaperId)}/bibtex`);
  }

  return runPaperTool({
    action: "bibtex",
    paperId: normalizedPaperId,
  });
}

export async function askPaperAgent({ message, selectedPaperIds = [], sources = [] }) {
  if (paperAssistantBaseUrl) {
    const payload = await fetchPaperServiceJson("/v1/agent", {
      method: "POST",
      body: {
        message,
        selectedPaperIds: selectedPaperIds.map((paperId) => normalizePaperId(paperId)),
        sources,
      },
    });

    return payload.reply;
  }

  const payload = await runPaperTool({
    action: "agent",
    message,
    selectedPaperIds: selectedPaperIds.map((paperId) => normalizePaperId(paperId)),
    sources,
  });

  return payload.reply;
}

export async function ensurePaperPdfCached(paperId) {
  const normalizedPaperId = normalizePaperId(paperId);
  const cachePath = getPaperPdfCachePath(normalizedPaperId);

  if (await fileExists(cachePath)) {
    return cachePath;
  }

  const response = paperAssistantBaseUrl
    ? await fetch(buildRemotePaperServiceUrl(`/v1/papers/${encodeURIComponent(normalizedPaperId)}/pdf`), {
        redirect: "follow",
      })
    : await (async () => {
        const paper = await loadPaperDetails(normalizedPaperId, 4000);
        if (!paper?.pdfUrl) {
          throw new Error("当前论文来源未提供可直接访问的 PDF");
        }
        return fetch(paper.pdfUrl, {
          redirect: "follow",
        });
      })();

  if (!response.ok) {
    throw new Error(`下载论文 PDF 失败: ${response.status}`);
  }

  const pdfBuffer = Buffer.from(await response.arrayBuffer());
  await writeBinary(cachePath, pdfBuffer);
  return cachePath;
}

/*
 * Code Review:
 * - 主站封装层优先走独立 HTTP 论文服务，只有在未配置远端服务时才回退本地 CLI，能让大陆主站和香港论文服务保持清晰分工。
 * - 多源论文 ID 已统一交给共享工具解析，避免继续把 `paperId` 默认等同于 arXiv 裸 ID。
 * - 本地回退解释器优先指向 `.venv-paper-service`，能把论文服务和共享 `.venv` 中的可选 AI 依赖冲突隔离开，同时仍保留 `PAPER_ASSISTANT_PYTHON` 的显式覆盖口。
 * - PDF 仍在主站侧做本地缓存，保证前端阅读面板不会因反复切换论文而重复命中远端论文源或香港服务。
 * - 默认搜索规模也必须在 Node 封装层同步放大，否则前端和 Python 侧即便都改了，这里仍会把未显式传参的请求压回旧值。
 * - 报告生成入口在 Node 层保持“远端优先 + 本地 CLI 回退”一致语义，避免不同部署形态下出现行为漂移。
 */
