/*
 * File: worker.js
 * Module: workers/compiler (编译 Worker)
 *
 * Responsibility:
 *   - 轮询领取待处理编译任务。
 *   - 准备编译工作目录、调用项目选择的 LaTeX 引擎、收集日志并写回任务结果。
 *
 * Runtime Logic Overview:
 *   1. Worker 启动后初始化任务存储，并定时扫描 `pending` 任务。
  *   2. 领取任务后复制项目目录到独立工作目录，避免污染原始项目文件。
 *   3. 命中编译缓存时直接复用缓存结果；未命中则优先使用 `latexmk` 多轮编译。
 *   4. 根据配置走宿主机或 Docker 隔离编译，并收集日志与产物。
 *
 * Key Data Flow:
 *   - 输入：编译任务 ID、项目根目录、主入口文件名、编译引擎。
 *   - 输出：任务日志、诊断结果、成功 PDF 路径或失败原因。
 *
 * Future Extension:
 *   - 可替换为 Redis 队列消费者。
 *   - 已支持 Docker 隔离执行，后续可继续叠加 latexmk、多轮编译和更细的资源限制。
 *
 * Dependencies:
 *   - node:child_process
 *   - node:fs/promises
 *   - node:path
 *   - packages/runtime-store
 *   - packages/shared
 *
 * Last Updated:
 *   - 2026-03-09 by Codex - 修正缓存命中日志，避免向用户暴露历史原始编译输出
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCompileCacheKey,
  ensureCompileCacheStorage,
  getCompileCacheEntry,
  writeCompileCacheEntry,
} from "../../../packages/runtime-store/src/compile-cache.js";
import { DEFAULT_COMPILE_ENGINE, SNAPSHOT_TYPE } from "../../../packages/contracts/src/index.js";
import {
  ensureJobStorage,
  claimPendingJob,
  claimNextPendingJob,
  markCompileJobFailed,
  markCompileJobSucceeded,
  updateCompileJob,
} from "../../../packages/runtime-store/src/jobs.js";
import { appendAuditLog } from "../../../packages/runtime-store/src/audit.js";
import { readProjectRootInfo } from "../../../packages/runtime-store/src/projects.js";
import { createSnapshot, ensureSnapshotStorage } from "../../../packages/runtime-store/src/snapshots.js";
import { appendVersionEvent } from "../../../packages/runtime-store/src/version-events.js";
import { createDirectoryFingerprint } from "../../../packages/shared/src/archive.js";
import { copyDirectory, ensureDir, fileExists, removePath } from "../../../packages/shared/src/fs.js";
import {
  getCompileCacheLogPath,
  getCompileCachePdfPath,
  getCompileJobRoot,
} from "../../../packages/shared/src/paths.js";

const workerPollIntervalMs = 1500;
const compileExecutionMode = (process.env.COMPILE_EXECUTION_MODE ?? "host").trim().toLowerCase();
const compileDockerImage = (process.env.COMPILE_DOCKER_IMAGE ?? "blang/latex:ubuntu").trim();
const compileDockerNetwork = (process.env.COMPILE_DOCKER_NETWORK ?? "none").trim();
const workerId = (process.env.COMPILE_WORKER_ID ?? `${os.hostname()}-${process.pid}`).trim();
const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
let isProcessing = false;
let dockerImageEnsured = false;
let latexmkAvailable = null;

async function tryAppendAuditLog(entry) {
  try {
    await appendAuditLog(entry);
  } catch (error) {
    console.error("Failed to append worker audit log:", error);
  }
}

async function tryAppendVersionEvent(event) {
  try {
    await appendVersionEvent(event);
  } catch (error) {
    console.error("Failed to append worker version event:", error);
  }
}

function extractDiagnostics(logText) {
  const diagnostics = [];
  const fileLineMatches = logText.matchAll(/([^\s:]+\.tex):(\d+):\s+(.+)/g);

  for (const match of fileLineMatches) {
    diagnostics.push({
      file: match[1],
      line: Number(match[2]),
      message: match[3].trim(),
    });
  }

  if (diagnostics.length > 0) {
    return diagnostics;
  }

  const fallbackLineMatch = logText.match(/l\.(\d+)/);

  if (fallbackLineMatch) {
    diagnostics.push({
      file: null,
      line: Number(fallbackLineMatch[1]),
      message: "LaTeX 编译失败，请检查附近代码。",
    });
  }

  return diagnostics;
}

async function executeLatexEngine(engine, workspaceRoot, rootFile) {
  return new Promise((resolve) => {
    const args = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", rootFile];
    const child = spawn(engine, args, {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        log: `${engine} 不可用：${error.message}\n\n请先安装对应 LaTeX 引擎，例如完整 TeX Live 或包含 ${engine} 的发行版。`,
      });
    });

    child.on("close", (code) => {
      const log = [stdout, stderr].filter(Boolean).join("\n");

      if (code !== 0) {
        resolve({ ok: false, log });
        return;
      }

      resolve({ ok: true, log });
    });
  });
}

async function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", `command -v ${command}`], {
      stdio: "ignore",
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function ensureLatexmkAvailable() {
  if (latexmkAvailable !== null) {
    return latexmkAvailable;
  }

  latexmkAvailable = await commandExists("latexmk");
  return latexmkAvailable;
}

function getLatexmkArgs(engine, rootFile) {
  const baseArgs = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error"];

  if (engine === "xelatex") {
    return ["-xelatex", ...baseArgs, rootFile];
  }

  if (engine === "lualatex") {
    return ["-lualatex", ...baseArgs, rootFile];
  }

  return ["-pdf", ...baseArgs, rootFile];
}

async function executeLatexmk(engine, workspaceRoot, rootFile) {
  return new Promise((resolve) => {
    const child = spawn("latexmk", getLatexmkArgs(engine, rootFile), {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        log: `latexmk 不可用：${error.message}`,
      });
    });

    child.on("close", (code) => {
      const log = [stdout, stderr].filter(Boolean).join("\n");
      resolve({
        ok: code === 0,
        log,
      });
    });
  });
}

async function executeLatexmkInDocker(engine, workspaceRoot, rootFile) {
  await ensureDockerCompilerImage();

  return new Promise((resolve) => {
    const latexmkArgs = getLatexmkArgs(engine, rootFile).map((argument) => JSON.stringify(argument)).join(" ");
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        compileDockerNetwork,
        "-v",
        `${workspaceRoot}:/workspace`,
        "-w",
        "/workspace",
        compileDockerImage,
        "sh",
        "-lc",
        `latexmk ${latexmkArgs}`,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        log: `Docker latexmk 不可用：${error.message}`,
      });
    });

    child.on("close", (code) => {
      const log = [stdout, stderr].filter(Boolean).join("\n");
      resolve({
        ok: code === 0,
        log,
      });
    });
  });
}

async function executeLatexEngineMultiPass(engine, workspaceRoot, rootFile) {
  let combinedLog = "";

  for (let pass = 1; pass <= 3; pass += 1) {
    const passResult =
      compileExecutionMode === "docker"
        ? await executeLatexEngineInDocker(engine, workspaceRoot, rootFile)
        : await executeLatexEngine(engine, workspaceRoot, rootFile);
    combinedLog += `\n[Pass ${pass}]\n${passResult.log}`;

    if (!passResult.ok) {
      return {
        ok: false,
        log: combinedLog.trim(),
      };
    }

    if (!/Rerun to get|undefined references|Label\\(s\\) may have changed/i.test(passResult.log)) {
      return {
        ok: true,
        log: combinedLog.trim(),
      };
    }
  }

  return {
    ok: true,
    log: combinedLog.trim(),
  };
}

async function ensureDockerCompilerImage() {
  if (dockerImageEnsured || compileExecutionMode !== "docker") {
    return;
  }

  const inspectResult = await new Promise((resolve, reject) => {
    const child = spawn("docker", ["image", "inspect", compileDockerImage], {
      stdio: "ignore",
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code === 0));
  });

  if (inspectResult) {
    dockerImageEnsured = true;
    return;
  }

  await new Promise((resolve, reject) => {
    const child = spawn("docker", ["pull", compileDockerImage], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`拉取 Docker 编译镜像失败：${compileDockerImage}`));
        return;
      }

      resolve();
    });
  });

  dockerImageEnsured = true;
}

async function executeLatexEngineInDocker(engine, workspaceRoot, rootFile) {
  await ensureDockerCompilerImage();

  return new Promise((resolve) => {
    const args = [
      "run",
      "--rm",
      "--network",
      compileDockerNetwork,
      "-v",
      `${workspaceRoot}:/workspace`,
      "-w",
      "/workspace",
      compileDockerImage,
      "sh",
      "-lc",
      `${engine} -interaction=nonstopmode -halt-on-error -file-line-error ${JSON.stringify(rootFile)}`,
    ];
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        log: `Docker 编译不可用：${error.message}\n\n请确认本机已安装 Docker，且镜像 ${compileDockerImage} 可用。`,
      });
    });

    child.on("close", (code) => {
      const log = [stdout, stderr].filter(Boolean).join("\n");

      if (code !== 0) {
        resolve({
          ok: false,
          log: `Docker Image: ${compileDockerImage}\n${log}`,
        });
        return;
      }

      resolve({
        ok: true,
        log: `Docker Image: ${compileDockerImage}\n${log}`,
      });
    });
  });
}

async function compileJob(job) {
  const { project, projectRoot } = await readProjectRootInfo(job.projectId);
  const rootFile = job.rootFile ?? project.rootFile;
  const compileEngine = job.compileEngine ?? project.compileEngine ?? DEFAULT_COMPILE_ENGINE;
  const compileRoot = getCompileJobRoot(job.id);
  const workspaceRoot = path.join(compileRoot, "workspace");
  const snapshotSourceRoot = path.join(compileRoot, "snapshot-source");
  const outputPdfPath = path.join(compileRoot, "output.pdf");

  await removePath(compileRoot);
  await ensureDir(workspaceRoot);
  await ensureDir(snapshotSourceRoot);
  await copyDirectory(projectRoot, workspaceRoot);
  await copyDirectory(projectRoot, snapshotSourceRoot);

  const fingerprint = await createDirectoryFingerprint(snapshotSourceRoot);
  const cacheKey = buildCompileCacheKey({
    contentHash: fingerprint.contentHash,
    compileEngine,
    rootFile,
  });
  const cachedEntry = await getCompileCacheEntry(cacheKey);

  if (cachedEntry) {
    await fs.copyFile(cachedEntry.pdfPath, outputPdfPath);
    const cacheLog = [
      `Worker ID: ${workerId}`,
      `Execution Mode: cache`,
      `Compile Engine: ${compileEngine}`,
      `Root File: ${rootFile}`,
      `Cache Key: ${cacheKey}`,
      "",
      "命中编译缓存，已直接复用最近一次成功编译的 PDF 产物。",
      "当前任务未重新执行 LaTeX 引擎，因此这里不展示历史原始编译输出。",
    ].join("\n");
    await markCompileJobSucceeded(job.id, {
      log: cacheLog,
      diagnostics: cachedEntry.diagnostics ?? [],
      pdfFilePath: outputPdfPath,
      claimedByWorkerId: workerId,
    });
    await tryAppendAuditLog({
      actorUserId: null,
      projectId: job.projectId,
      action: "compile.cache_hit",
      targetType: "compile_job",
      targetId: job.id,
      payload: {
        rootFile,
        compileEngine,
        cacheKey,
      },
    });
    await tryAppendVersionEvent({
      projectId: job.projectId,
      actorUserId: null,
      filePath: rootFile,
      eventType: "compile_succeeded",
      payload: {
        jobId: job.id,
        compileEngine,
        cacheHit: true,
      },
    });
    try {
      const snapshotResult = await createSnapshot({
        projectId: job.projectId,
        type: SNAPSHOT_TYPE.compileSuccess,
        triggerSource: "compile_worker_cache",
        sourceRef: job.id,
        label: "Compiled successfully (cache hit)",
        sourceDirectory: snapshotSourceRoot,
      });

      await updateCompileJob(job.id, {
        snapshotId: snapshotResult.snapshot?.id ?? null,
        snapshotStatus: snapshotResult.skipped ? "skipped" : "created",
        snapshotError: null,
      });
    } catch (error) {
      await updateCompileJob(job.id, {
        snapshotStatus: "failed",
        snapshotError: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const latexmkResult =
    compileExecutionMode === "docker"
      ? await executeLatexmkInDocker(compileEngine, workspaceRoot, rootFile)
      : (await ensureLatexmkAvailable())
        ? await executeLatexmk(compileEngine, workspaceRoot, rootFile)
        : { ok: false, log: "latexmk 不可用，回退到多次引擎执行。" };
  const result = latexmkResult.ok ? latexmkResult : await executeLatexEngineMultiPass(compileEngine, workspaceRoot, rootFile);
  const prefixedLog = [
    `Worker ID: ${workerId}`,
    `Execution Mode: ${compileExecutionMode}`,
    `Compile Engine: ${compileEngine}`,
    `Root File: ${rootFile}`,
    `Cache Key: ${cacheKey}`,
    `Compile Strategy: ${latexmkResult.ok ? "latexmk" : "multi_pass_fallback"}`,
    "",
    latexmkResult.ok ? latexmkResult.log : `${latexmkResult.log}\n${result.log}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (!result.ok) {
    await markCompileJobFailed(job.id, {
      log: prefixedLog,
      diagnostics: extractDiagnostics(prefixedLog),
      pdfFilePath: null,
      claimedByWorkerId: workerId,
    });
    await tryAppendAuditLog({
      actorUserId: null,
      projectId: job.projectId,
      action: "compile.failed",
      targetType: "compile_job",
      targetId: job.id,
      payload: {
        rootFile,
        compileEngine,
      },
    });
    await tryAppendVersionEvent({
      projectId: job.projectId,
      actorUserId: null,
      filePath: rootFile,
      eventType: "compile_failed",
      payload: {
        jobId: job.id,
        compileEngine,
      },
    });
    return;
  }

  const generatedPdfPath = path.join(workspaceRoot, rootFile.replace(/\.tex$/i, ".pdf"));

  if (!(await fileExists(generatedPdfPath))) {
    await markCompileJobFailed(job.id, {
      log: `${prefixedLog}\n\n编译进程已结束，但未找到输出 PDF。`,
      diagnostics: extractDiagnostics(prefixedLog),
      pdfFilePath: null,
      claimedByWorkerId: workerId,
    });
    await tryAppendAuditLog({
      actorUserId: null,
      projectId: job.projectId,
      action: "compile.failed",
      targetType: "compile_job",
      targetId: job.id,
      payload: {
        reason: "missing_pdf",
        rootFile,
        compileEngine,
      },
    });
    return;
  }

  await fs.copyFile(generatedPdfPath, outputPdfPath);
  const diagnostics = extractDiagnostics(prefixedLog);
  const cachePdfPath = getCompileCachePdfPath(cacheKey);
  await ensureDir(path.dirname(cachePdfPath));
  await fs.copyFile(generatedPdfPath, cachePdfPath);
  await writeCompileCacheEntry(cacheKey, {
    contentHash: fingerprint.contentHash,
    rootFile,
    compileEngine,
    diagnostics,
    pdfPath: cachePdfPath,
    logPath: getCompileCacheLogPath(cacheKey),
    log: prefixedLog,
  });
  await markCompileJobSucceeded(job.id, {
    log: prefixedLog,
    diagnostics,
    pdfFilePath: outputPdfPath,
    claimedByWorkerId: workerId,
  });
  await tryAppendAuditLog({
    actorUserId: null,
    projectId: job.projectId,
    action: "compile.succeeded",
    targetType: "compile_job",
    targetId: job.id,
    payload: {
      rootFile,
      compileEngine,
    },
  });
  await tryAppendVersionEvent({
    projectId: job.projectId,
    actorUserId: null,
    filePath: rootFile,
    eventType: "compile_succeeded",
    payload: {
      jobId: job.id,
      compileEngine,
    },
  });

  try {
    const snapshotResult = await createSnapshot({
      projectId: job.projectId,
      type: SNAPSHOT_TYPE.compileSuccess,
      triggerSource: "compile_worker",
      sourceRef: job.id,
      label: "Compiled successfully",
      sourceDirectory: snapshotSourceRoot,
    });

    await updateCompileJob(job.id, {
      snapshotId: snapshotResult.snapshot?.id ?? null,
      snapshotStatus: snapshotResult.skipped ? "skipped" : "created",
      snapshotError: null,
    });
  } catch (error) {
    await updateCompileJob(job.id, {
      snapshotStatus: "failed",
      snapshotError: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function processPendingJob() {
  if (isProcessing) {
    return;
  }

  isProcessing = true;
  let claimedJob = null;

  try {
    const nextPendingJob = await claimNextPendingJob();

    if (!nextPendingJob) {
      return;
    }

    claimedJob = await claimPendingJob(nextPendingJob.id, workerId);

    if (!claimedJob) {
      return;
    }

    console.log(
      `[${workerId}] Compiling job ${claimedJob.id} for project ${claimedJob.projectId} via ${compileExecutionMode}`,
    );
    await compileJob(claimedJob);
  } catch (error) {
    console.error("Worker failed to process compile job:", error);

    if (claimedJob) {
      await markCompileJobFailed(claimedJob.id, {
        log: error instanceof Error ? error.stack ?? error.message : String(error),
        diagnostics: [],
        pdfFilePath: null,
        claimedByWorkerId: workerId,
      });
    }
  } finally {
    isProcessing = false;
  }
}

export async function startWorker() {
  await ensureJobStorage();
  await ensureSnapshotStorage();
  await ensureCompileCacheStorage();
  if (compileExecutionMode === "docker") {
    await ensureDockerCompilerImage();
  }
  console.log(`Compiler worker ${workerId} is watching for pending jobs with mode=${compileExecutionMode}...`);
  setInterval(() => {
    void processPendingJob();
  }, workerPollIntervalMs);
  await processPendingJob();
}

if (isMainModule) {
  await startWorker();
}

/*
 * Code Review:
 * - Worker 当前以轮询方式工作，简单直接，适合零依赖 MVP；后续可平滑换成队列驱动。
 * - 编译工作目录独立于项目目录，避免 LaTeX 产物污染原始项目内容，这是后续容器化前的重要隔离边界。
 * - 任务在入队时就固定根文件和编译引擎，Worker 只负责执行，避免前后端对编译配置的理解出现偏差。
 * - 宿主机执行和 Docker 隔离执行共用同一份任务协议，便于在开发环境和成品部署间切换。
 * - 目标引擎不存在时返回明确日志而不是静默失败，保证当前环境下也能验证任务链路是否打通。
 * - 任务执行异常时会回写失败状态，避免任务长期停留在 `running`。
 * - 成功编译后的快照直接基于编译工作区创建，避免快照内容和实际成功编译版本发生漂移。
 * - 缓存命中时只返回当前任务的缓存摘要，不再把历史原始编译日志整段拼给用户，避免把成功结果展示成噪声。
 */
