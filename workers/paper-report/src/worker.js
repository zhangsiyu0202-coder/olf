/*
 * File: worker.js
 * Module: workers/paper-report (论文报告异步生成 Worker)
 *
 * Responsibility:
 *   - 轮询领取待处理的论文报告任务。
 *   - 调用 paper-service 生成结构化报告，并将结果写回全局报告缓存。
 *
 * Runtime Logic Overview:
 *   1. Worker 启动后轮询 `paper-report-jobs`，按单飞锁领取 pending 任务。
 *   2. 调用 `generatePaperReport` 执行报告生成（远端 paper-service 优先，本地 CLI 回退）。
 *   3. 将报告缓存写入 `paper-reports`，再把任务标记为 ready/degraded/failed。
 *
 * Dependencies:
 *   - node:os
 *   - node:path
 *   - node:url
 *   - packages/paper-assistant/src/service.js
 *   - packages/runtime-store/src/paper-report-jobs.js
 *   - packages/runtime-store/src/paper-reports.js
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增论文报告 worker，支撑异步报告生成链路
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePaperReport } from "../../../packages/paper-assistant/src/service.js";
import {
  claimNextPendingPaperReportJob,
  ensurePaperReportJobStorage,
  markPaperReportJobFinished,
} from "../../../packages/runtime-store/src/paper-report-jobs.js";
import { ensurePaperReportStorage, upsertPaperReport } from "../../../packages/runtime-store/src/paper-reports.js";

const pollIntervalMs = Math.max(800, Number(process.env.PAPER_REPORT_WORKER_POLL_INTERVAL_MS ?? 1800));
const workerId = String(process.env.PAPER_REPORT_WORKER_ID ?? `${os.hostname()}-${process.pid}`).trim();
const reportMaxChars = Math.max(8000, Number(process.env.PAPER_REPORT_MAX_CHARS ?? 24000));
const reportLanguage = String(process.env.PAPER_REPORT_LANGUAGE ?? "zh-CN").trim() || "zh-CN";

let isProcessing = false;
const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

function resolveTerminalStatus(reportStatus) {
  return reportStatus === "degraded" ? "degraded" : "ready";
}

async function processOneReportJob() {
  if (isProcessing) {
    return;
  }
  isProcessing = true;

  let claimedJob = null;
  try {
    claimedJob = await claimNextPendingPaperReportJob(workerId);
    if (!claimedJob) {
      return;
    }

    const generated = await generatePaperReport(claimedJob.paperId, {
      maxChars: reportMaxChars,
      language: reportLanguage,
    });
    const generatedReport = generated?.report ?? null;
    if (!generatedReport || !generatedReport.canonicalPaperId) {
      throw new Error("论文报告生成结果缺少 canonicalPaperId");
    }

    const reportRecord = await upsertPaperReport(generatedReport.canonicalPaperId, generatedReport);
    await markPaperReportJobFinished(claimedJob.id, {
      status: resolveTerminalStatus(reportRecord.status),
      reportStatus: reportRecord.status,
    });
    console.log(`[${workerId}] Paper report job ${claimedJob.id} finished with status=${reportRecord.status}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (claimedJob) {
      await markPaperReportJobFinished(claimedJob.id, {
        status: "failed",
        errorMessage,
      });
    }
    console.error(`[${workerId}] Paper report worker failed:`, errorMessage);
  } finally {
    isProcessing = false;
  }
}

async function startWorker() {
  await ensurePaperReportStorage();
  await ensurePaperReportJobStorage();
  console.log(`Paper report worker ${workerId} is watching jobs...`);
  await processOneReportJob();
  setInterval(() => {
    void processOneReportJob();
  }, pollIntervalMs);
}

if (isMainModule) {
  void startWorker().catch((error) => {
    console.error("Paper report worker failed to start:", error);
    process.exitCode = 1;
  });
}

/*
 * Code Review:
 * - 该 worker 只关心任务执行与结果回写，不侵入 API 层路由逻辑，部署边界清晰。
 * - 执行端复用 `paper-assistant/service.js` 的远端优先策略，保持线上与本地行为一致。
 * - 任务失败不会阻塞后续队列消费；单条失败会回写 failed 状态，便于前端展示和重试。
 */
