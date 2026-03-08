/*
 * File: jobs.js
 * Module: packages/runtime-store (编译任务仓储)
 *
 * Responsibility:
 *   - 管理 MVP 阶段的编译任务生命周期与任务状态持久化。
 *   - 为 API 和 Worker 提供统一的任务创建、查询、领取和状态更新能力。
 *
 * Runtime Logic Overview:
 *   1. API 创建任务并持久化到 `.runtime/data/jobs`。
 *   2. Worker 轮询领取 `pending` 任务并更新状态。
 *   3. 前端通过 API 查询单个任务获取日志和 PDF 输出地址。
 *
 * Key Data Flow:
 *   - 输入：项目 ID、任务状态、编译日志、输出 PDF 路径。
 *   - 输出：单个任务详情和按时间排序的任务列表。
 *
 * Future Extension:
 *   - 可替换为 Redis 队列 + PostgreSQL 任务表。
 *   - 可继续增加取消任务、重试次数和优先级字段。
 *   - 当前已通过元数据存储门面的原子更新支持多 worker 并发领取。
 *
 * Dependencies:
 *   - node:crypto
 *   - packages/contracts
 *   - packages/runtime-store/storage/metadata-store
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 为多 worker 编译调度补充原子任务领取
 */

import crypto from "node:crypto";
import { COMPILE_STATUS, DEFAULT_COMPILE_ENGINE, DEFAULT_MAIN_FILE } from "../../contracts/src/index.js";
import { getJobFilePath, runtimeJobsRoot } from "../../shared/src/paths.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";

const compileJobsNamespace = "compile-jobs";

export async function ensureJobStorage() {
  await ensureMetadataStorage();
}

export async function createCompileJob(projectId, options = {}) {
  await ensureJobStorage();
  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    projectId,
    rootFile: options.rootFile ?? DEFAULT_MAIN_FILE,
    compileEngine: options.compileEngine ?? DEFAULT_COMPILE_ENGINE,
    status: COMPILE_STATUS.pending,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    claimedByWorkerId: null,
    log: "",
    diagnostics: [],
    pdfFilePath: null,
    snapshotId: null,
    snapshotStatus: null,
    snapshotError: null,
  };

  const store = await getMetadataStore();
  await store.writeRecord({
    namespace: compileJobsNamespace,
    key: job.id,
    filePath: getJobFilePath(job.id),
    value: job,
  });
  return job;
}

export async function getCompileJob(jobId) {
  const store = await getMetadataStore();
  return store.readRecord({
    namespace: compileJobsNamespace,
    key: jobId,
    filePath: getJobFilePath(jobId),
    fallbackValue: null,
  });
}

export async function listCompileJobs() {
  await ensureJobStorage();
  const store = await getMetadataStore();
  const jobs = await store.listRecordValues({
    namespace: compileJobsNamespace,
    directoryPath: runtimeJobsRoot,
    fallbackValue: [],
  });

  return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function claimNextPendingJob() {
  const jobs = await listCompileJobs();
  return jobs.find((job) => job.status === COMPILE_STATUS.pending) ?? null;
}

export async function claimPendingJob(jobId, workerId) {
  const store = await getMetadataStore();
  const now = new Date().toISOString();
  const result = await store.patchRecordAtomically({
    namespace: compileJobsNamespace,
    key: jobId,
    filePath: getJobFilePath(jobId),
    fallbackValue: null,
    transform(currentJob) {
      if (!currentJob || currentJob.status !== COMPILE_STATUS.pending) {
        return undefined;
      }

      return {
        ...currentJob,
        status: COMPILE_STATUS.running,
        startedAt: now,
        updatedAt: now,
        claimedByWorkerId: workerId,
      };
    },
  });

  return result.updated ? result.value : null;
}

export async function updateCompileJob(jobId, patch) {
  const existingJob = await getCompileJob(jobId);

  if (!existingJob) {
    throw new Error("编译任务不存在");
  }

  const updatedJob = {
    ...existingJob,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const store = await getMetadataStore();
  await store.writeRecord({
    namespace: compileJobsNamespace,
    key: jobId,
    filePath: getJobFilePath(jobId),
    value: updatedJob,
  });
  return updatedJob;
}

export async function markCompileJobSucceeded(jobId, payload) {
  return updateCompileJob(jobId, {
    status: COMPILE_STATUS.succeeded,
    finishedAt: new Date().toISOString(),
    claimedByWorkerId: payload.claimedByWorkerId ?? undefined,
    ...payload,
  });
}

export async function markCompileJobFailed(jobId, payload) {
  return updateCompileJob(jobId, {
    status: COMPILE_STATUS.failed,
    finishedAt: new Date().toISOString(),
    claimedByWorkerId: payload.claimedByWorkerId ?? undefined,
    ...payload,
  });
}

/*
 * Code Review:
 * - 每个任务单独一个 JSON 文件，避免 API 创建任务与 Worker 更新任务时频繁争抢同一个清单文件。
 * - 任务领取现在通过元数据门面的原子更新完成，单机多进程和 PostgreSQL 后端下都能避免重复领取。
 * - 任务创建时就快照 `rootFile` 和 `compileEngine`，避免项目设置在排队期间被改动后导致结果漂移。
 * - 任务状态字段已预留 `startedAt`、`finishedAt`、`diagnostics` 和快照结果字段，方便后续接入更真实的编译反馈。
 */
