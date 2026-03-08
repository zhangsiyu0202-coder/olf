/*
 * File: snapshots.js
 * Module: packages/runtime-store (快照服务与仓储)
 *
 * Responsibility:
 *   - 管理项目快照的创建、列表查询、恢复和保留策略。
 *   - 把快照相关的元数据、归档文件和项目状态同步集中在单一模块内。
 *
 * Runtime Logic Overview:
 *   1. 编译成功后由 Worker 调用本模块创建 `compile_success` 快照。
 *   2. API 进程周期性扫描脏项目并创建 `auto_checkpoint` 快照。
 *   3. 用户恢复快照时由 API 调用本模块执行保护性快照和整项目恢复。
 *
 * Key Data Flow:
 *   - 输入：项目 ID、快照类型、触发来源、可选源码目录。
 *   - 输出：快照元数据、归档文件、恢复结果和自动检查点扫描结果。
 *
 * Future Extension:
 *   - 可拆出独立 Snapshot Service 层，或迁移到 PostgreSQL + 对象存储。
 *   - 可继续引入快照标签、手动快照和更精细的恢复粒度。
 *
 * Dependencies:
 *   - node:crypto
 *   - node:fs/promises
 *   - packages/contracts
 *   - packages/runtime-store/storage
 *   - packages/shared
 *   - packages/runtime-store/projects
 *
 * Last Updated:
 *   - 2026-03-07 by Codex - 实现自动快照创建、查询、恢复与清理
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import {
  AUTO_CHECKPOINT_THRESHOLD_MS,
  SNAPSHOT_RETENTION_LIMIT,
  SNAPSHOT_TYPE,
} from "../../contracts/src/index.js";
import {
  createDirectoryFingerprint,
  createTarGzArchive,
  extractTarGzArchive,
} from "../../shared/src/archive.js";
import { emptyDirectory } from "../../shared/src/fs.js";
import {
  getSnapshotArchivePath,
  getSnapshotMetadataPath,
  runtimeSnapshotArchivesRoot,
  runtimeSnapshotMetadataRoot,
} from "../../shared/src/paths.js";
import {
  blobExists,
  ensureBlobDirectory,
  removeBlob,
} from "./storage/blob-store.js";
import { ensureMetadataStorage, getMetadataStore } from "./storage/metadata-store.js";
import {
  getProject,
  listProjects,
  markProjectRestored,
  markProjectSnapshotRecorded,
  readProjectRootInfo,
} from "./projects.js";

function getSnapshotNamespace(projectId) {
  return `project-snapshots:${projectId}`;
}

async function readSnapshotManifest(projectId) {
  const store = await getMetadataStore();
  return store.readManifest({
    namespace: getSnapshotNamespace(projectId),
    filePath: getSnapshotMetadataPath(projectId),
    fallbackValue: [],
  });
}

async function writeSnapshotManifest(projectId, snapshots) {
  const store = await getMetadataStore();
  await store.writeManifest({
    namespace: getSnapshotNamespace(projectId),
    filePath: getSnapshotMetadataPath(projectId),
    value: snapshots,
  });
}

function buildSnapshotLabel(type) {
  if (type === SNAPSHOT_TYPE.compileSuccess) {
    return "Compiled successfully";
  }

  if (type === SNAPSHOT_TYPE.autoCheckpoint) {
    return "Automatic checkpoint";
  }

  if (type === SNAPSHOT_TYPE.restoreGuard) {
    return "Guard before restore";
  }

  return "Project snapshot";
}

async function pruneSnapshots(projectId) {
  const snapshots = await readSnapshotManifest(projectId);

  if (snapshots.length <= SNAPSHOT_RETENTION_LIMIT) {
    return [];
  }

  const keptSnapshots = [...snapshots];
  const removedSnapshots = [];

  while (keptSnapshots.length > SNAPSHOT_RETENTION_LIMIT) {
    const autoCheckpointIndex = keptSnapshots.findLastIndex(
      (snapshot) => snapshot.type === SNAPSHOT_TYPE.autoCheckpoint,
    );
    const removeIndex = autoCheckpointIndex >= 0 ? autoCheckpointIndex : keptSnapshots.length - 1;
    removedSnapshots.push(...keptSnapshots.splice(removeIndex, 1));
  }

  await writeSnapshotManifest(projectId, keptSnapshots);

  for (const snapshot of removedSnapshots) {
    await removeBlob(snapshot.archivePath);
  }

  return removedSnapshots;
}

function shouldClearDirtyAfterSnapshot(type, sourceMatchesCurrentProject) {
  if (type === SNAPSHOT_TYPE.autoCheckpoint) {
    return true;
  }

  if (type === SNAPSHOT_TYPE.compileSuccess) {
    return sourceMatchesCurrentProject;
  }

  return false;
}

export async function ensureSnapshotStorage() {
  await ensureMetadataStorage();
  await ensureBlobDirectory(runtimeSnapshotArchivesRoot);
  await ensureBlobDirectory(runtimeSnapshotMetadataRoot);
}

export async function listSnapshots(projectId) {
  await ensureSnapshotStorage();
  const project = await getProject(projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const snapshots = await readSnapshotManifest(projectId);
  return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getSnapshot(projectId, snapshotId) {
  const snapshots = await listSnapshots(projectId);
  return snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
}

export async function createSnapshot({
  projectId,
  type,
  triggerSource,
  sourceRef = null,
  restoredFromSnapshotId = null,
  label = null,
  sourceDirectory = null,
  forceCreate = false,
} = {}) {
  await ensureSnapshotStorage();
  const { projectRoot } = await readProjectRootInfo(projectId);
  const snapshotSourceDirectory = sourceDirectory ?? projectRoot;
  const fingerprint = await createDirectoryFingerprint(snapshotSourceDirectory);
  const existingSnapshots = await listSnapshots(projectId);
  const latestSnapshot = existingSnapshots[0] ?? null;

  if (!forceCreate && latestSnapshot?.contentHash === fingerprint.contentHash) {
    await markProjectSnapshotRecorded(projectId, {
      snapshotType: type,
      clearDirty: type === SNAPSHOT_TYPE.autoCheckpoint,
    });

    return {
      skipped: true,
      snapshot: latestSnapshot,
    };
  }

  const snapshotId = crypto.randomUUID();
  const archivePath = getSnapshotArchivePath(projectId, snapshotId);
  const createdAt = new Date().toISOString();
  await createTarGzArchive(snapshotSourceDirectory, archivePath);
  const archiveStat = await fs.stat(archivePath);

  const snapshot = {
    id: snapshotId,
    projectId,
    type,
    createdAt,
    triggerSource,
    sourceRef,
    contentHash: fingerprint.contentHash,
    archivePath,
    fileCount: fingerprint.fileCount,
    sizeBytes: archiveStat.size,
    label: label ?? buildSnapshotLabel(type),
    restoredFromSnapshotId,
  };

  await writeSnapshotManifest(projectId, [snapshot, ...existingSnapshots]);

  let sourceMatchesCurrentProject = snapshotSourceDirectory === projectRoot;

  if (!sourceMatchesCurrentProject) {
    const currentProjectFingerprint = await createDirectoryFingerprint(projectRoot);
    sourceMatchesCurrentProject = currentProjectFingerprint.contentHash === fingerprint.contentHash;
  }

  await markProjectSnapshotRecorded(projectId, {
    snapshotType: type,
    createdAt,
    clearDirty: shouldClearDirtyAfterSnapshot(type, sourceMatchesCurrentProject),
  });

  await pruneSnapshots(projectId);

  return {
    skipped: false,
    snapshot,
  };
}

export async function restoreSnapshot(projectId, snapshotId) {
  const targetSnapshot = await getSnapshot(projectId, snapshotId);

  if (!targetSnapshot) {
    throw new Error("快照不存在");
  }

  if (!(await blobExists(targetSnapshot.archivePath))) {
    throw new Error("快照归档不存在");
  }

  const guardResult = await createSnapshot({
    projectId,
    type: SNAPSHOT_TYPE.restoreGuard,
    triggerSource: "restore_api",
    sourceRef: snapshotId,
    restoredFromSnapshotId: snapshotId,
    label: "Guard before restoring snapshot",
    forceCreate: true,
  });

  const { projectRoot } = await readProjectRootInfo(projectId);
  await emptyDirectory(projectRoot);
  await extractTarGzArchive(targetSnapshot.archivePath, projectRoot);
  await markProjectRestored(projectId);

  return {
    success: true,
    restoredSnapshotId: snapshotId,
    guardSnapshotId: guardResult.snapshot?.id ?? null,
  };
}

export async function runAutoCheckpointCycle({
  thresholdMs = AUTO_CHECKPOINT_THRESHOLD_MS,
} = {}) {
  const now = Date.now();
  const projects = await listProjects();
  const results = [];

  for (const project of projects) {
    if (!project.dirtyState.isDirty || !project.dirtyState.dirtySince) {
      continue;
    }

    const dirtyDurationMs = now - Date.parse(project.dirtyState.dirtySince);

    if (dirtyDurationMs < thresholdMs) {
      continue;
    }

    const result = await createSnapshot({
      projectId: project.id,
      type: SNAPSHOT_TYPE.autoCheckpoint,
      triggerSource: "api_scheduler",
      label: "Automatic checkpoint",
    });

    results.push({
      projectId: project.id,
      skipped: result.skipped,
      snapshotId: result.snapshot?.id ?? null,
    });
  }

  return results;
}

/*
 * Code Review:
 * - `createSnapshot` 支持从指定目录创建快照，这是为编译成功快照绑定真实编译工作区而保留的关键边界。
 * - 去重逻辑只比较最近一次快照的内容哈希，足以满足当前阶段目标，同时避免引入复杂全量索引查重。
 * - 恢复前强制创建 `restore_guard`，是当前实现中最关键的风险控制措施，不能在后续重构中省略。
 */
