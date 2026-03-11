/*
 * File: paper-report-jobs.js
 * Module: packages/runtime-store (论文报告任务仓储)
 *
 * Responsibility:
 *   - 管理论文报告异步生成任务状态机（queued/running/ready/degraded/failed）。
 *   - 提供“同一 canonicalPaperId 单飞”所需的任务锁与任务领取能力。
 *
 * Runtime Logic Overview:
 *   1. API 触发 ensure/regenerate 时创建或复用报告任务。
 *   2. 报告 worker 轮询领取 pending 任务并更新为 running。
 *   3. 任务结束后回写 ready/degraded/failed，并释放 canonical 级单飞锁。
 *
 * Dependencies:
 *   - node:crypto
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paper-refs
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-11 by Codex - 新增论文报告异步任务与单飞锁仓储
 */

import crypto from "node:crypto";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";
import { normalizePaperReference } from "../../shared/src/paper-refs.js";
import { getPaperReportJobFilePath, getPaperReportJobLockPath, runtimePaperReportJobsRoot } from "../../shared/src/paths.js";

const paperReportJobsNamespace = "paper-report-jobs";
const paperReportJobLocksNamespace = "paper-report-job-locks";
const inFlightStatuses = new Set(["pending", "running"]);
const terminalStatuses = new Set(["ready", "degraded", "failed"]);

function normalizePaperReportJob(record) {
  const canonicalPaperId = normalizePaperReference(record?.canonicalPaperId ?? record?.paperId ?? "");
  const nowIso = new Date().toISOString();
  return {
    id: String(record?.id ?? crypto.randomUUID()),
    projectId: String(record?.projectId ?? ""),
    paperId: String(record?.paperId ?? canonicalPaperId),
    canonicalPaperId,
    status: String(record?.status ?? "pending"),
    attempts:
      typeof record?.attempts === "number" && Number.isFinite(record.attempts)
        ? Math.max(0, Math.floor(record.attempts))
        : 0,
    maxAttempts:
      typeof record?.maxAttempts === "number" && Number.isFinite(record.maxAttempts)
        ? Math.max(1, Math.floor(record.maxAttempts))
        : 3,
    requestedByUserId: record?.requestedByUserId ? String(record.requestedByUserId) : null,
    forceRegenerate: Boolean(record?.forceRegenerate),
    claimedByWorkerId: record?.claimedByWorkerId ? String(record.claimedByWorkerId) : null,
    errorMessage: record?.errorMessage ? String(record.errorMessage) : null,
    createdAt: String(record?.createdAt ?? nowIso),
    updatedAt: String(record?.updatedAt ?? nowIso),
    startedAt: record?.startedAt ? String(record.startedAt) : null,
    finishedAt: record?.finishedAt ? String(record.finishedAt) : null,
    reportStatus: record?.reportStatus ? String(record.reportStatus) : null,
  };
}

function normalizePaperReportJobLock(record, canonicalPaperId) {
  return {
    canonicalPaperId,
    jobId: record?.jobId ? String(record.jobId) : null,
    status: record?.status ? String(record.status) : "idle",
    updatedAt: record?.updatedAt ? String(record.updatedAt) : new Date().toISOString(),
    lastFinishedJobId: record?.lastFinishedJobId ? String(record.lastFinishedJobId) : null,
    lastFinishedStatus: record?.lastFinishedStatus ? String(record.lastFinishedStatus) : null,
  };
}

async function readPaperReportJobLock(canonicalPaperId) {
  const normalizedCanonicalPaperId = normalizePaperReference(canonicalPaperId);
  const store = await getMetadataStore();
  const lockRecord = await store.readRecord({
    namespace: paperReportJobLocksNamespace,
    key: normalizedCanonicalPaperId,
    filePath: getPaperReportJobLockPath(normalizedCanonicalPaperId),
    fallbackValue: null,
  });
  return lockRecord ? normalizePaperReportJobLock(lockRecord, normalizedCanonicalPaperId) : null;
}

async function writePaperReportJobLock(canonicalPaperId, payload) {
  const normalizedCanonicalPaperId = normalizePaperReference(canonicalPaperId);
  const lockRecord = normalizePaperReportJobLock(payload, normalizedCanonicalPaperId);
  const store = await getMetadataStore();
  await store.writeRecord({
    namespace: paperReportJobLocksNamespace,
    key: normalizedCanonicalPaperId,
    filePath: getPaperReportJobLockPath(normalizedCanonicalPaperId),
    value: lockRecord,
  });
  return lockRecord;
}

export async function ensurePaperReportJobStorage() {
  await ensureMetadataStorage();
}

export async function getPaperReportJob(jobId) {
  await ensurePaperReportJobStorage();
  const store = await getMetadataStore();
  const record = await store.readRecord({
    namespace: paperReportJobsNamespace,
    key: String(jobId),
    filePath: getPaperReportJobFilePath(String(jobId)),
    fallbackValue: null,
  });
  return record ? normalizePaperReportJob(record) : null;
}

export async function listPaperReportJobs() {
  await ensurePaperReportJobStorage();
  const store = await getMetadataStore();
  const records = await store.listRecordValues({
    namespace: paperReportJobsNamespace,
    directoryPath: runtimePaperReportJobsRoot,
    fallbackValue: [],
  });
  return records
    .map(normalizePaperReportJob)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getActivePaperReportJob(canonicalPaperId) {
  await ensurePaperReportJobStorage();
  const lockRecord = await readPaperReportJobLock(canonicalPaperId);
  if (!lockRecord || !lockRecord.jobId || !inFlightStatuses.has(lockRecord.status)) {
    return null;
  }
  const job = await getPaperReportJob(lockRecord.jobId);
  if (!job || !inFlightStatuses.has(job.status)) {
    return null;
  }
  return job;
}

export async function getLatestPaperReportJob(canonicalPaperId) {
  await ensurePaperReportJobStorage();
  const normalizedCanonicalPaperId = normalizePaperReference(canonicalPaperId);
  const jobs = await listPaperReportJobs();
  return jobs.find((job) => job.canonicalPaperId === normalizedCanonicalPaperId) ?? null;
}

export async function createOrReusePaperReportJob({
  projectId,
  paperId,
  canonicalPaperId,
  requestedByUserId = null,
  forceRegenerate = false,
  maxAttempts = 3,
}) {
  await ensurePaperReportJobStorage();
  const normalizedCanonicalPaperId = normalizePaperReference(canonicalPaperId);

  if (!forceRegenerate) {
    const activeJob = await getActivePaperReportJob(normalizedCanonicalPaperId);
    if (activeJob) {
      return {
        job: activeJob,
        reused: true,
      };
    }
  }

  const job = normalizePaperReportJob({
    id: crypto.randomUUID(),
    projectId,
    paperId,
    canonicalPaperId: normalizedCanonicalPaperId,
    status: "pending",
    attempts: 0,
    maxAttempts,
    requestedByUserId,
    forceRegenerate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const store = await getMetadataStore();
  await store.writeRecord({
    namespace: paperReportJobsNamespace,
    key: job.id,
    filePath: getPaperReportJobFilePath(job.id),
    value: job,
  });

  await writePaperReportJobLock(normalizedCanonicalPaperId, {
    jobId: job.id,
    status: "pending",
    updatedAt: new Date().toISOString(),
  });

  return {
    job,
    reused: false,
  };
}

export async function claimPendingPaperReportJob(jobId, workerId) {
  await ensurePaperReportJobStorage();
  const normalizedJobId = String(jobId);
  const store = await getMetadataStore();
  const nowIso = new Date().toISOString();
  const patchResult = await store.patchRecordAtomically({
    namespace: paperReportJobsNamespace,
    key: normalizedJobId,
    filePath: getPaperReportJobFilePath(normalizedJobId),
    fallbackValue: null,
    transform(current) {
      if (!current || current.status !== "pending") {
        return undefined;
      }
      const normalizedCurrent = normalizePaperReportJob(current);
      return {
        ...normalizedCurrent,
        status: "running",
        attempts: normalizedCurrent.attempts + 1,
        claimedByWorkerId: String(workerId),
        startedAt: nowIso,
        updatedAt: nowIso,
      };
    },
  });

  if (!patchResult.updated) {
    return null;
  }

  const claimedJob = normalizePaperReportJob(patchResult.value);
  await writePaperReportJobLock(claimedJob.canonicalPaperId, {
    jobId: claimedJob.id,
    status: "running",
    updatedAt: nowIso,
  });
  return claimedJob;
}

export async function claimNextPendingPaperReportJob(workerId) {
  const jobs = await listPaperReportJobs();
  const pendingJob = jobs.find((job) => job.status === "pending") ?? null;
  if (!pendingJob) {
    return null;
  }
  return claimPendingPaperReportJob(pendingJob.id, workerId);
}

export async function updatePaperReportJob(jobId, patch) {
  await ensurePaperReportJobStorage();
  const normalizedJobId = String(jobId);
  const existingJob = await getPaperReportJob(normalizedJobId);
  if (!existingJob) {
    throw new Error("论文报告任务不存在");
  }

  const nextJob = normalizePaperReportJob({
    ...existingJob,
    ...patch,
    id: existingJob.id,
    canonicalPaperId: existingJob.canonicalPaperId,
    updatedAt: new Date().toISOString(),
  });
  const store = await getMetadataStore();
  await store.writeRecord({
    namespace: paperReportJobsNamespace,
    key: normalizedJobId,
    filePath: getPaperReportJobFilePath(normalizedJobId),
    value: nextJob,
  });
  return nextJob;
}

export async function markPaperReportJobFinished(jobId, { status, errorMessage = null, reportStatus = null }) {
  await ensurePaperReportJobStorage();
  if (!terminalStatuses.has(status)) {
    throw new Error("论文报告任务结束状态非法");
  }

  const finishedJob = await updatePaperReportJob(jobId, {
    status,
    finishedAt: new Date().toISOString(),
    errorMessage: errorMessage ? String(errorMessage) : null,
    reportStatus: reportStatus ? String(reportStatus) : null,
  });

  const currentLock = await readPaperReportJobLock(finishedJob.canonicalPaperId);
  if (currentLock?.jobId === finishedJob.id) {
    await writePaperReportJobLock(finishedJob.canonicalPaperId, {
      jobId: null,
      status: "idle",
      updatedAt: new Date().toISOString(),
      lastFinishedJobId: finishedJob.id,
      lastFinishedStatus: status,
    });
  }

  return finishedJob;
}

/*
 * Code Review:
 * - 任务与单飞锁分离存储：任务保留完整历史，锁只表达“当前 canonical 是否在跑”，便于观测与故障恢复。
 * - `forceRegenerate` 允许创建新任务覆盖锁，但结束时会校验 lock.jobId 再释放，避免旧任务回写时误清空新任务状态。
 * - 仓储层不直接触发报告生成，仅提供状态机原语，保持 API 和 worker 可独立演进。
 */
