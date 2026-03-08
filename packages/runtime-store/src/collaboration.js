/*
 * File: collaboration.js
 * Module: packages/runtime-store (协作持久化仓储)
 *
 * Responsibility:
 *   - 为实时协作模块提供文档状态加载、Yjs 状态快照持久化和基础存储初始化。
 *   - 保持协作文档状态和项目文件内容的单一持久化入口，避免服务端房间逻辑直接操作路径细节。
 *
 * Runtime Logic Overview:
 *   1. 协作房间首次创建时，通过稳定 `fileId` 解析到当前文件路径并恢复文档。
 *   2. 文档变更后，定期将最新文本和 Yjs 状态更新写回磁盘。
 *   3. 协作状态文件与项目目录分离存放，避免影响普通文件树浏览。
 *
 * Dependencies:
 *   - packages/runtime-store/projects
 *   - packages/runtime-store/storage/blob-store
 *   - packages/shared/paths
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 将协作状态持久化从 filePath 切换到稳定 fileId
 */

import {
  getCollaborationFileStatePath,
  getCollaborationProjectRoot,
  runtimeCollaborationRoot,
} from "../../shared/src/paths.js";
import {
  blobExists,
  ensureBlobDirectory,
  readBinaryBlob,
  writeBinaryBlob,
} from "./storage/blob-store.js";
import {
  markProjectEdited,
  resolveProjectEntryById,
  readProjectFile,
  updateProjectFile,
} from "./projects.js";

export async function ensureCollaborationStorage() {
  await ensureBlobDirectory(runtimeCollaborationRoot);
}

export async function loadCollaborativeDocument(projectId, fileId) {
  await ensureCollaborationStorage();
  const entry = await resolveProjectEntryById(projectId, fileId);

  if (!entry || entry.type !== "file") {
    throw new Error("协作文件不存在");
  }

  const file = await readProjectFile(projectId, entry.path);
  const statePath = getCollaborationFileStatePath(projectId, file.id ?? fileId);
  const stateUpdate = (await blobExists(statePath)) ? await readBinaryBlob(statePath) : null;

  return {
    fileId: file.id ?? fileId,
    path: file.path,
    content: file.content,
    stateUpdate,
  };
}

export async function persistCollaborativeDocument(
  projectId,
  fileId,
  {
    content,
    stateUpdate,
    updatedAt = new Date().toISOString(),
  },
) {
  const entry = await resolveProjectEntryById(projectId, fileId);

  if (!entry || entry.type !== "file") {
    throw new Error("协作文件不存在");
  }

  await ensureBlobDirectory(getCollaborationProjectRoot(projectId));
  await updateProjectFile(projectId, entry.path, content);
  await writeBinaryBlob(getCollaborationFileStatePath(projectId, fileId), stateUpdate);
  await markProjectEdited(projectId, updatedAt);
}

/*
 * Code Review:
 * - 当前实现选择把 Yjs 状态和项目文本同时落盘，优先保证协作恢复和普通文件读取都稳定可用。
 * - `persistCollaborativeDocument` 会更新项目脏状态，这让自动快照机制能自然感知协作编辑活动。
 * - 后续若迁移到 PostgreSQL 或对象存储，应继续保留本模块作为协作状态的单一持久化入口。
 */
